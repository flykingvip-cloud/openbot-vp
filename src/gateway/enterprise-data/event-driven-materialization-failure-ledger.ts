/**
 * P1-F durable materialization failure ledger (minimal).
 *
 * Honest scope: records open failures after ingest/rematerialize so operators can
 * retry by eventId via `enterprise-data.events.rematerialize`. This is NOT a
 * durable restart queue, ordered multi-consumer replay, or claim that resending
 * the same externalId rematerializes (dedupe still skips ingest materialization).
 */
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import type {
  EventDrivenMaterializationErrorCode,
  EventDrivenMaterializationStage,
} from "./event-driven-projection-materializer.js";

export const EVENT_DRIVEN_MATERIALIZATION_FAILURE_LEDGER_VERSION = 1;
const DEFAULT_FILENAME = "openbot-enterprise-data-event-materialization-failures.json";
/** Soft cap per tenant (oldest open/resolved pruned by failedAt). */
export const FAILURE_LEDGER_RETENTION_PER_TENANT = 100;

export type MaterializationFailureLedgerStatus = "open" | "resolved";

export type MaterializationFailureLedgerEntry = {
  eventId: string;
  tenantId: string;
  sourceId: string;
  externalId?: string;
  stage: EventDrivenMaterializationStage;
  errorCode: EventDrivenMaterializationErrorCode;
  failedAt: string;
  attemptCount: number;
  lastError?: string;
  status: MaterializationFailureLedgerStatus;
  resolvedAt?: string;
};

export type MaterializationFailureLedgerStore = {
  version: number;
  /** Keyed by `${tenantId}:${eventId}`. */
  entries: Record<string, MaterializationFailureLedgerEntry>;
};

export function materializationFailureLedgerKey(tenantId: string, eventId: string): string {
  return `${tenantId}:${eventId}`;
}

export function normalizeMaterializationFailureLedgerStore(
  parsed: Partial<MaterializationFailureLedgerStore> | null | undefined,
): MaterializationFailureLedgerStore {
  const entries = parsed?.entries ?? {};
  const normalized: Record<string, MaterializationFailureLedgerEntry> = {};
  for (const [key, entry] of Object.entries(entries)) {
    if (!entry?.eventId || !entry?.tenantId) {
      continue;
    }
    const tenantId = canonicalizeTenantId(entry.tenantId) ?? entry.tenantId;
    normalized[key] = {
      ...entry,
      tenantId,
      status: entry.status === "resolved" ? "resolved" : "open",
      attemptCount: Math.max(1, Number(entry.attemptCount) || 1),
    };
  }
  return {
    version: parsed?.version ?? EVENT_DRIVEN_MATERIALIZATION_FAILURE_LEDGER_VERSION,
    entries: normalized,
  };
}

export function resolveDefaultMaterializationFailureLedgerPath(): string {
  return path.join(CONFIG_DIR, DEFAULT_FILENAME);
}

export async function loadMaterializationFailureLedger(
  storePath?: string,
): Promise<MaterializationFailureLedgerStore> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultMaterializationFailureLedgerPath(),
  );
  const parsed = await readJsonFile<Partial<MaterializationFailureLedgerStore>>(resolvedPath);
  return normalizeMaterializationFailureLedgerStore(parsed);
}

export async function saveMaterializationFailureLedger(
  store: MaterializationFailureLedgerStore,
  storePath?: string,
): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultMaterializationFailureLedgerPath(),
  );
  const normalized = normalizeMaterializationFailureLedgerStore({
    ...store,
    version: EVENT_DRIVEN_MATERIALIZATION_FAILURE_LEDGER_VERSION,
  });
  await writeJsonAtomic(resolvedPath, normalized);
}

const ledgerLock = createAsyncLock();

export async function withMaterializationFailureLedgerWriteLock<T>(
  run: (store: MaterializationFailureLedgerStore) => Promise<T> | T,
  storePath?: string,
): Promise<T> {
  return ledgerLock(async () => {
    const store = await loadMaterializationFailureLedger(storePath);
    const result = await run(store);
    await saveMaterializationFailureLedger(store, storePath);
    return result;
  });
}

function pruneTenantLedger(store: MaterializationFailureLedgerStore, tenantId: string): void {
  const tenantEntries = Object.entries(store.entries).filter(
    ([, entry]) => entry.tenantId === tenantId,
  );
  if (tenantEntries.length <= FAILURE_LEDGER_RETENTION_PER_TENANT) {
    return;
  }
  const staleFirst = tenantEntries.toSorted((left, right) => {
    const byTime = left[1].failedAt.localeCompare(right[1].failedAt);
    return byTime !== 0 ? byTime : left[0].localeCompare(right[0]);
  });
  const removeCount = tenantEntries.length - FAILURE_LEDGER_RETENTION_PER_TENANT;
  for (const [key] of staleFirst.slice(0, removeCount)) {
    delete store.entries[key];
  }
}

export function recordMaterializationFailure(params: {
  store: MaterializationFailureLedgerStore;
  tenantId: string;
  eventId: string;
  sourceId: string;
  externalId?: string;
  stage: EventDrivenMaterializationStage;
  errorCode: EventDrivenMaterializationErrorCode;
  nowIso: string;
  lastError?: string;
}): MaterializationFailureLedgerEntry {
  const tenantId = params.tenantId.trim();
  const eventId = params.eventId.trim();
  const key = materializationFailureLedgerKey(tenantId, eventId);
  const existing = params.store.entries[key];
  const entry: MaterializationFailureLedgerEntry = {
    eventId,
    tenantId,
    sourceId: params.sourceId,
    externalId: params.externalId,
    stage: params.stage,
    errorCode: params.errorCode,
    failedAt: params.nowIso,
    attemptCount: (existing?.attemptCount ?? 0) + 1,
    lastError: params.lastError,
    status: "open",
    resolvedAt: undefined,
  };
  params.store.entries[key] = entry;
  pruneTenantLedger(params.store, tenantId);
  return entry;
}

export function resolveMaterializationFailure(params: {
  store: MaterializationFailureLedgerStore;
  tenantId: string;
  eventId: string;
  nowIso: string;
}): MaterializationFailureLedgerEntry | null {
  const key = materializationFailureLedgerKey(params.tenantId.trim(), params.eventId.trim());
  const existing = params.store.entries[key];
  if (!existing) {
    return null;
  }
  const resolved: MaterializationFailureLedgerEntry = {
    ...existing,
    status: "resolved",
    resolvedAt: params.nowIso,
  };
  params.store.entries[key] = resolved;
  return resolved;
}

export function findMaterializationFailure(
  store: MaterializationFailureLedgerStore,
  tenantId: string,
  eventId: string,
): MaterializationFailureLedgerEntry | null {
  return store.entries[materializationFailureLedgerKey(tenantId, eventId)] ?? null;
}

export function listOpenMaterializationFailures(params: {
  store: MaterializationFailureLedgerStore;
  tenantId: string;
  limit?: number;
}): MaterializationFailureLedgerEntry[] {
  const entries = Object.values(params.store.entries)
    .filter((entry) => entry.tenantId === params.tenantId && entry.status === "open")
    .toSorted((left, right) => right.failedAt.localeCompare(left.failedAt));
  if (params.limit != null && params.limit >= 0) {
    return entries.slice(0, params.limit);
  }
  return entries;
}
