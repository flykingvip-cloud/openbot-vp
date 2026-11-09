/**
 * Scheduled connector sync. Gateway maintenance calls the tick.
 * Eligible sources are connected (or in error) and have a registered sync driver.
 * A due source syncs, then default products for the finished streams are
 * rematerialized. Overlap-safe, with the same failure backoff shape as
 * scheduled projection materialization.
 */

import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import {
  resolveTenantControlPlaneStorePath,
  resolveTenantsRoot,
  TENANT_ENTERPRISE_DATA_FILE,
} from "../tenant-store-paths.js";
import {
  sourceEligibleForAutoSync,
  syncConnectedSourceAndSupply,
} from "./connector-sync-lifecycle.js";
import { computeFailureBackoffMs } from "./scheduled-projection-materializer.js";
import { loadEnterpriseDataStore, saveEnterpriseDataStore } from "./store.js";
import type { EnterpriseDataStore } from "./types.js";

const MAX_SOURCES_PER_TICK = 2;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const MAX_TENANTS_PER_TICK = 50;

export type ConnectorSyncScheduleCursor = {
  lastRunBySourceId: Record<string, string>;
  lastFailureBySourceId: Record<string, string>;
  failureCountBySourceId: Record<string, number>;
};

export type ScheduledConnectorSyncStoreResult = {
  succeeded: number;
  failed: number;
  skipped: number;
  cursor: ConnectorSyncScheduleCursor;
  cursorChanged: boolean;
};

export function connectorSyncCursorKey(tenantId: string, sourceId: string): string {
  return `${tenantId.trim()}::${sourceId.trim()}`;
}

function emptyCursor(): ConnectorSyncScheduleCursor {
  return {
    lastRunBySourceId: {},
    lastFailureBySourceId: {},
    failureCountBySourceId: {},
  };
}

function normalizeCursor(raw: unknown): ConnectorSyncScheduleCursor {
  const cursor = emptyCursor();
  if (!raw || typeof raw !== "object") {
    return cursor;
  }
  const record = raw as Partial<ConnectorSyncScheduleCursor>;
  for (const [key, value] of Object.entries(record.lastRunBySourceId ?? {})) {
    if (typeof value === "string" && value.trim()) {
      cursor.lastRunBySourceId[key] = value;
    }
  }
  for (const [key, value] of Object.entries(record.lastFailureBySourceId ?? {})) {
    if (typeof value === "string" && value.trim()) {
      cursor.lastFailureBySourceId[key] = value;
    }
  }
  for (const [key, value] of Object.entries(record.failureCountBySourceId ?? {})) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      cursor.failureCountBySourceId[key] = Math.floor(value);
    }
  }
  return cursor;
}

let cursorPathOverride: string | null = null;

export function setConnectorSyncCursorPathForTests(cursorPath: string | null): void {
  cursorPathOverride = cursorPath;
}

export function connectorSyncCursorPath(): string {
  return cursorPathOverride ?? path.join(CONFIG_DIR, "enterprise-connector-sync-cursor.json");
}

export function readConnectorSyncCursor(cursorPath?: string): ConnectorSyncScheduleCursor {
  const resolved = cursorPath ?? connectorSyncCursorPath();
  try {
    return normalizeCursor(JSON.parse(fs.readFileSync(resolved, "utf-8")) as unknown);
  } catch {
    return emptyCursor();
  }
}

export function writeConnectorSyncCursor(
  cursor: ConnectorSyncScheduleCursor,
  cursorPath?: string,
): void {
  const resolved = cursorPath ?? connectorSyncCursorPath();
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(normalizeCursor(cursor), null, 2)}\n`, "utf-8");
}

export function isConnectorSyncDue(params: {
  tenantId: string;
  sourceId: string;
  cursor: ConnectorSyncScheduleCursor;
  nowMs: number;
  intervalMs?: number;
}): boolean {
  const key = connectorSyncCursorKey(params.tenantId, params.sourceId);
  const intervalMs = params.intervalMs ?? DEFAULT_INTERVAL_MS;
  const failureCount = params.cursor.failureCountBySourceId[key] ?? 0;
  const lastFailureAt = params.cursor.lastFailureBySourceId[key];
  if (lastFailureAt && failureCount > 0) {
    const failedAt = Date.parse(lastFailureAt);
    if (
      Number.isFinite(failedAt) &&
      params.nowMs - failedAt < computeFailureBackoffMs(failureCount)
    ) {
      return false;
    }
  }
  const lastRunAt = params.cursor.lastRunBySourceId[key];
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
  cursor: ConnectorSyncScheduleCursor;
  tenantId: string;
  sourceId: string;
  nowIso: string;
}): void {
  const key = connectorSyncCursorKey(params.tenantId, params.sourceId);
  params.cursor.lastRunBySourceId[key] = params.nowIso;
  delete params.cursor.lastFailureBySourceId[key];
  delete params.cursor.failureCountBySourceId[key];
}

function recordFailure(params: {
  cursor: ConnectorSyncScheduleCursor;
  tenantId: string;
  sourceId: string;
  nowIso: string;
}): void {
  const key = connectorSyncCursorKey(params.tenantId, params.sourceId);
  const previous = params.cursor.failureCountBySourceId[key] ?? 0;
  params.cursor.lastFailureBySourceId[key] = params.nowIso;
  params.cursor.failureCountBySourceId[key] = previous + 1;
}

export async function runScheduledConnectorSyncForStore(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
  maxPerTick?: number;
  cursor?: ConnectorSyncScheduleCursor;
  intervalMs?: number;
}): Promise<ScheduledConnectorSyncStoreResult> {
  const cursor = params.cursor ?? readConnectorSyncCursor();
  const nowMs = Date.parse(params.nowIso) || Date.now();
  const max = params.maxPerTick ?? MAX_SOURCES_PER_TICK;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let cursorChanged = false;
  let attempted = 0;
  const now = new Date(nowMs);

  for (const source of Object.values(params.store.dataSources)) {
    if (source.tenantId !== params.tenantId || !sourceEligibleForAutoSync(source)) {
      continue;
    }
    if (attempted >= max) {
      skipped += 1;
      continue;
    }
    if (
      !isConnectorSyncDue({
        tenantId: params.tenantId,
        sourceId: source.sourceId,
        cursor,
        nowMs,
        intervalMs: params.intervalMs,
      })
    ) {
      skipped += 1;
      continue;
    }
    attempted += 1;
    try {
      const result = await syncConnectedSourceAndSupply({
        store: params.store,
        tenantId: params.tenantId,
        sourceId: source.sourceId,
        now,
        requireDriver: true,
      });
      if (!result.sync || result.sync.status === "failure") {
        recordFailure({
          cursor,
          tenantId: params.tenantId,
          sourceId: source.sourceId,
          nowIso: params.nowIso,
        });
        failed += 1;
      } else {
        recordSuccess({
          cursor,
          tenantId: params.tenantId,
          sourceId: source.sourceId,
          nowIso: params.nowIso,
        });
        succeeded += 1;
      }
      cursorChanged = true;
    } catch {
      recordFailure({
        cursor,
        tenantId: params.tenantId,
        sourceId: source.sourceId,
        nowIso: params.nowIso,
      });
      failed += 1;
      cursorChanged = true;
    }
  }

  return { succeeded, failed, skipped, cursor, cursorChanged };
}

let syncTickInFlight = false;

export function resetConnectorSyncTickInFlightForTests(): void {
  syncTickInFlight = false;
}

export async function tickScheduledConnectorSync(params?: {
  tenantsRoot?: string;
  maxTenants?: number;
  nowIso?: string;
  cursorPath?: string;
  intervalMs?: number;
}): Promise<{ tenantsScanned: number; succeeded: number; failed: number }> {
  if (syncTickInFlight) {
    return { tenantsScanned: 0, succeeded: 0, failed: 0 };
  }
  syncTickInFlight = true;
  let tenantsScanned = 0;
  let succeeded = 0;
  let failed = 0;
  try {
    const tenantsRoot = params?.tenantsRoot ?? resolveTenantsRoot();
    if (!fs.existsSync(tenantsRoot)) {
      return { tenantsScanned: 0, succeeded: 0, failed: 0 };
    }
    const nowIso = params?.nowIso ?? new Date().toISOString();
    const cursorFile = params?.cursorPath ?? connectorSyncCursorPath();
    let cursor = readConnectorSyncCursor(cursorFile);
    let cursorChanged = false;
    const tenantDirs = fs
      .readdirSync(tenantsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .slice(0, params?.maxTenants ?? MAX_TENANTS_PER_TICK);

    for (const tenantId of tenantDirs) {
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
        const result = await runScheduledConnectorSyncForStore({
          store,
          tenantId,
          nowIso,
          cursor,
          intervalMs: params?.intervalMs,
        });
        cursor = result.cursor;
        if (result.cursorChanged) {
          cursorChanged = true;
        }
        succeeded += result.succeeded;
        failed += result.failed;
        if (result.succeeded > 0 || result.failed > 0) {
          await saveEnterpriseDataStore(store, resolvedStorePath);
        }
      } catch {
        // Tenant isolation: one store failure must not block others.
      }
    }
    if (cursorChanged) {
      writeConnectorSyncCursor(cursor, cursorFile);
    }
    return { tenantsScanned, succeeded, failed };
  } finally {
    syncTickInFlight = false;
  }
}
