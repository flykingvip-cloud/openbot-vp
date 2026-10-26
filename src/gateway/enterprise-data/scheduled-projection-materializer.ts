/**
 * Scheduled enterprise knowledge projection materialization.
 * Invoked from gateway maintenance ticks; bounded, overlap-safe, with failure backoff.
 */

import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import {
  resolveTenantControlPlaneStorePath,
  resolveTenantsRoot,
  TENANT_ENTERPRISE_DATA_FILE,
} from "../tenant-store-paths.js";
import { getProcessControlledSarProvider } from "./controlled-sar-provider.js";
import { listEnterpriseKnowledgeProjectionBindings } from "./enterprise-knowledge-projection-binding-store.js";
import { isImplementedMaterializationMode } from "./knowledge-publication.js";
import { runProjectionMaterialization } from "./projection-materializer.js";
import { findEnterpriseKnowledgeProjectionSpec } from "./projection-spec-store.js";
import { loadEnterpriseDataStore, saveEnterpriseDataStore } from "./store.js";
import type { EnterpriseDataStore } from "./types.js";

const MAX_SCHEDULED_PER_TICK = 5;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1h when binding has no schedule metadata
/** First failure waits 5m; doubles per consecutive failure up to 6h. */
const BASE_FAILURE_BACKOFF_MS = 5 * 60 * 1000;
const MAX_FAILURE_BACKOFF_MS = 6 * 60 * 60 * 1000;
const MAX_TENANTS_PER_TICK = 50;

export type ScheduleCursor = {
  /** Success timestamps keyed by `${tenantId}::${bindingId}` (legacy: bare bindingId). */
  lastRunByBindingId: Record<string, string>;
  /** Last failure timestamps for backoff. */
  lastFailureByBindingId: Record<string, string>;
  /** Consecutive failure counts for exponential backoff. */
  failureCountByBindingId: Record<string, number>;
};

export type ScheduledStoreRunResult = {
  succeeded: number;
  failed: number;
  skipped: number;
  cursor: ScheduleCursor;
  cursorChanged: boolean;
};

export function scheduleCursorKey(tenantId: string, bindingId: string): string {
  return `${tenantId.trim()}::${bindingId.trim()}`;
}

export function computeFailureBackoffMs(failureCount: number): number {
  const safeCount = Math.max(1, Math.floor(failureCount));
  const exp = safeCount - 1;
  const raw = BASE_FAILURE_BACKOFF_MS * 2 ** Math.min(exp, 10);
  return Math.min(MAX_FAILURE_BACKOFF_MS, raw);
}

function emptyCursor(): ScheduleCursor {
  return {
    lastRunByBindingId: {},
    lastFailureByBindingId: {},
    failureCountByBindingId: {},
  };
}

function normalizeCursor(raw: unknown): ScheduleCursor {
  const cursor = emptyCursor();
  if (!raw || typeof raw !== "object") {
    return cursor;
  }
  const record = raw as Partial<ScheduleCursor>;
  if (record.lastRunByBindingId && typeof record.lastRunByBindingId === "object") {
    for (const [key, value] of Object.entries(record.lastRunByBindingId)) {
      if (typeof value === "string" && value.trim()) {
        cursor.lastRunByBindingId[key] = value;
      }
    }
  }
  if (record.lastFailureByBindingId && typeof record.lastFailureByBindingId === "object") {
    for (const [key, value] of Object.entries(record.lastFailureByBindingId)) {
      if (typeof value === "string" && value.trim()) {
        cursor.lastFailureByBindingId[key] = value;
      }
    }
  }
  if (record.failureCountByBindingId && typeof record.failureCountByBindingId === "object") {
    for (const [key, value] of Object.entries(record.failureCountByBindingId)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        cursor.failureCountByBindingId[key] = Math.floor(value);
      }
    }
  }
  return cursor;
}

let cursorPathOverride: string | null = null;

/** Test hook: pin cursor file under a temp directory. */
export function setScheduleCursorPathForTests(cursorPath: string | null): void {
  cursorPathOverride = cursorPath;
}

export function scheduleCursorPath(): string {
  return cursorPathOverride ?? path.join(CONFIG_DIR, "enterprise-knowledge-schedule-cursor.json");
}

export function readScheduleCursor(cursorPath?: string): ScheduleCursor {
  const resolved = cursorPath ?? scheduleCursorPath();
  try {
    const raw = fs.readFileSync(resolved, "utf-8");
    return normalizeCursor(JSON.parse(raw) as unknown);
  } catch {
    return emptyCursor();
  }
}

export function writeScheduleCursor(cursor: ScheduleCursor, cursorPath?: string): void {
  const resolved = cursorPath ?? scheduleCursorPath();
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const normalized = normalizeCursor(cursor);
  fs.writeFileSync(resolved, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
}

function lookupIso(
  map: Record<string, string>,
  tenantId: string,
  bindingId: string,
): string | undefined {
  const key = scheduleCursorKey(tenantId, bindingId);
  return map[key] ?? map[bindingId];
}

function lookupCount(map: Record<string, number>, tenantId: string, bindingId: string): number {
  const key = scheduleCursorKey(tenantId, bindingId);
  return map[key] ?? map[bindingId] ?? 0;
}

export function isScheduledBindingDue(params: {
  tenantId: string;
  bindingId: string;
  cursor: ScheduleCursor;
  nowMs: number;
  intervalMs?: number;
}): boolean {
  const intervalMs = params.intervalMs ?? DEFAULT_INTERVAL_MS;
  const lastFailureAt = lookupIso(
    params.cursor.lastFailureByBindingId,
    params.tenantId,
    params.bindingId,
  );
  const failureCount = lookupCount(
    params.cursor.failureCountByBindingId,
    params.tenantId,
    params.bindingId,
  );
  if (lastFailureAt && failureCount > 0) {
    const failedAt = Date.parse(lastFailureAt);
    if (Number.isFinite(failedAt)) {
      const backoffMs = computeFailureBackoffMs(failureCount);
      if (params.nowMs - failedAt < backoffMs) {
        return false;
      }
    }
  }

  const lastRunAt = lookupIso(params.cursor.lastRunByBindingId, params.tenantId, params.bindingId);
  if (!lastRunAt) {
    return true;
  }
  const last = Date.parse(lastRunAt);
  if (!Number.isFinite(last)) {
    return true;
  }
  return params.nowMs - last >= intervalMs;
}

function recordSuccess(params: {
  cursor: ScheduleCursor;
  tenantId: string;
  bindingId: string;
  nowIso: string;
}): void {
  const key = scheduleCursorKey(params.tenantId, params.bindingId);
  params.cursor.lastRunByBindingId[key] = params.nowIso;
  delete params.cursor.lastFailureByBindingId[key];
  delete params.cursor.failureCountByBindingId[key];
  // Clear legacy bare keys if present.
  delete params.cursor.lastRunByBindingId[params.bindingId];
  delete params.cursor.lastFailureByBindingId[params.bindingId];
  delete params.cursor.failureCountByBindingId[params.bindingId];
}

function recordFailure(params: {
  cursor: ScheduleCursor;
  tenantId: string;
  bindingId: string;
  nowIso: string;
}): void {
  const key = scheduleCursorKey(params.tenantId, params.bindingId);
  const previous = lookupCount(
    params.cursor.failureCountByBindingId,
    params.tenantId,
    params.bindingId,
  );
  params.cursor.lastFailureByBindingId[key] = params.nowIso;
  params.cursor.failureCountByBindingId[key] = previous + 1;
  delete params.cursor.lastFailureByBindingId[params.bindingId];
  delete params.cursor.failureCountByBindingId[params.bindingId];
}

/**
 * Materialize due `scheduled` bindings for one tenant store.
 */
export async function runScheduledProjectionsForStore(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
  maxPerTick?: number;
  cursor?: ScheduleCursor;
  intervalMs?: number;
}): Promise<ScheduledStoreRunResult> {
  const cursor = params.cursor ?? readScheduleCursor();
  const nowMs = Date.parse(params.nowIso) || Date.now();
  const max = params.maxPerTick ?? MAX_SCHEDULED_PER_TICK;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let cursorChanged = false;
  let attempted = 0;

  const bindings = listEnterpriseKnowledgeProjectionBindings({
    store: params.store,
    tenantId: params.tenantId,
    enabled: true,
  }).filter(
    (binding) =>
      binding.materializationMode === "scheduled" &&
      isImplementedMaterializationMode(binding.materializationMode),
  );

  for (const binding of bindings) {
    if (attempted >= max) {
      skipped += 1;
      continue;
    }
    if (
      !isScheduledBindingDue({
        tenantId: params.tenantId,
        bindingId: binding.bindingId,
        cursor,
        nowMs,
        intervalMs: params.intervalMs,
      })
    ) {
      skipped += 1;
      continue;
    }
    const spec = findEnterpriseKnowledgeProjectionSpec(
      params.store,
      params.tenantId,
      binding.projectionId,
    );
    if (!spec || spec.lifecycle !== "active") {
      skipped += 1;
      continue;
    }
    attempted += 1;
    try {
      await runProjectionMaterialization({
        store: params.store,
        tenantId: params.tenantId,
        bindingId: binding.bindingId,
        sarProvider: getProcessControlledSarProvider(),
        nowIso: params.nowIso,
      });
      recordSuccess({
        cursor,
        tenantId: params.tenantId,
        bindingId: binding.bindingId,
        nowIso: params.nowIso,
      });
      succeeded += 1;
      cursorChanged = true;
    } catch {
      // Bound failure isolation + backoff so the next tick does not hammer immediately.
      recordFailure({
        cursor,
        tenantId: params.tenantId,
        bindingId: binding.bindingId,
        nowIso: params.nowIso,
      });
      failed += 1;
      cursorChanged = true;
    }
  }
  return { succeeded, failed, skipped, cursor, cursorChanged };
}

let scheduledTickInFlight = false;

/** Test hook: reset overlap guard. */
export function resetScheduledTickInFlightForTests(): void {
  scheduledTickInFlight = false;
}

/** Test hook: observe overlap guard. */
export function isScheduledTickInFlightForTests(): boolean {
  return scheduledTickInFlight;
}

/**
 * Gateway maintenance entry: scan tenant enterprise-data stores for due scheduled bindings.
 * Overlap-protected; does not throw. Persists cursor after success or failure (backoff).
 */
export async function tickScheduledProjectionMaterialization(params?: {
  tenantsRoot?: string;
  maxTenants?: number;
  nowIso?: string;
  cursorPath?: string;
}): Promise<{ tenantsScanned: number; succeeded: number; failed: number }> {
  if (scheduledTickInFlight) {
    return { tenantsScanned: 0, succeeded: 0, failed: 0 };
  }
  scheduledTickInFlight = true;
  let tenantsScanned = 0;
  let succeeded = 0;
  let failed = 0;
  try {
    const tenantsRoot = params?.tenantsRoot ?? resolveTenantsRoot();
    if (!fs.existsSync(tenantsRoot)) {
      return { tenantsScanned: 0, succeeded: 0, failed: 0 };
    }
    const nowIso = params?.nowIso ?? new Date().toISOString();
    const cursorFile = params?.cursorPath ?? scheduleCursorPath();
    let cursor = readScheduleCursor(cursorFile);
    let cursorChanged = false;
    const tenantDirs = fs
      .readdirSync(tenantsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .slice(0, params?.maxTenants ?? MAX_TENANTS_PER_TICK);

    for (const tenantId of tenantDirs) {
      // Prefer the scan root (OPENBOT_TENANTS_ROOT / test inject) so path discovery matches load.
      const primaryStorePath = path.join(
        tenantsRoot,
        tenantId,
        "control-plane",
        TENANT_ENTERPRISE_DATA_FILE,
      );
      const fallbackStorePath = resolveTenantControlPlaneStorePath(
        tenantId,
        TENANT_ENTERPRISE_DATA_FILE,
      );
      const resolvedStorePath = fs.existsSync(primaryStorePath)
        ? primaryStorePath
        : fs.existsSync(fallbackStorePath)
          ? fallbackStorePath
          : null;
      if (!resolvedStorePath) {
        continue;
      }
      tenantsScanned += 1;
      try {
        const store = await loadEnterpriseDataStore(resolvedStorePath);
        const result = await runScheduledProjectionsForStore({
          store,
          tenantId,
          nowIso,
          cursor,
        });
        cursor = result.cursor;
        if (result.cursorChanged) {
          cursorChanged = true;
        }
        succeeded += result.succeeded;
        failed += result.failed;
        if (result.succeeded > 0) {
          await saveEnterpriseDataStore(store, resolvedStorePath);
        }
      } catch {
        // Tenant isolation: one store failure must not block others.
      }
    }
    if (cursorChanged) {
      writeScheduleCursor(cursor, cursorFile);
    }
    return { tenantsScanned, succeeded, failed };
  } finally {
    scheduledTickInFlight = false;
  }
}
