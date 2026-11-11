/**
 * Durable diagnosis handling-loop store.
 * File-backed records survive process restart; the memory store is for
 * in-process tests that do not exercise restart.
 *
 * On reload, in-flight "executing" rows are moved to "result_unverified"
 * and are never auto-retried.
 *
 * File stores are single-writer: one open instance per records file. Commit
 * on a snapshot copy and replace the in-memory snapshot only after persist
 * succeeds, so a failed disk write cannot leak an uncommitted state.
 */
import fs from "node:fs";
import path from "node:path";
import { diagnosisJobTenantHash16 } from "./diagnosis-job-store.js";
import type { HandlingRecord, HandlingState } from "./handling-loop.js";

export const DIAGNOSIS_HANDLING_DIR = "diagnosis-handling";
export const DIAGNOSIS_HANDLING_SINGLE_WRITER_VIOLATION =
  "diagnosis_handling_store_single_writer_violation" as const;

export type HandlingStore = {
  get(handlingId: string): HandlingRecord | undefined;
  getByIdempotency(tenantId: string, idempotencyKey: string): HandlingRecord | undefined;
  put(row: HandlingRecord): HandlingRecord;
  list(filter?: { tenantId?: string; status?: HandlingState | HandlingState[] }): HandlingRecord[];
  /** Re-read durable snapshot (file store). Recovers stale executing rows. */
  reload(): void;
  /** Release the single-writer lease for this store instance. */
  close(): void;
};

export type HandlingFileSnapshot = { records: Record<string, HandlingRecord> };

export type FileHandlingStoreOptions = {
  /** Test hook. Defaults to an atomic write. Thrown errors must not mutate memory. */
  writeSnapshot?: (filePath: string, snapshot: HandlingFileSnapshot) => void;
};

const fileStoreWriters = new Map<string, { closed: boolean }>();

function cloneRecord(row: HandlingRecord): HandlingRecord {
  return structuredClone(row);
}

function recoverExecuting(row: HandlingRecord, now: string): HandlingRecord {
  if (row.status !== "executing") {
    return row;
  }
  return {
    ...row,
    status: "result_unverified",
    failureReason: "unknown_result_after_interrupt",
    updatedAt: now,
  };
}

function recoverSnapshot(
  snapshot: HandlingFileSnapshot,
  now: string,
): { snapshot: HandlingFileSnapshot; dirty: boolean } {
  let dirty = false;
  const records: Record<string, HandlingRecord> = {};
  for (const [id, row] of Object.entries(snapshot.records)) {
    const next = recoverExecuting(row, now);
    if (next !== row && next.status !== row.status) {
      dirty = true;
    }
    records[id] = next;
  }
  return { snapshot: { records }, dirty };
}

function emptySnapshot(): HandlingFileSnapshot {
  return { records: {} };
}

function readFile(filePath: string): HandlingFileSnapshot {
  if (!fs.existsSync(filePath)) {
    return emptySnapshot();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<HandlingFileSnapshot>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !parsed.records ||
      typeof parsed.records !== "object"
    ) {
      return emptySnapshot();
    }
    return { records: parsed.records };
  } catch {
    return emptySnapshot();
  }
}

export function writeHandlingSnapshotAtomic(
  filePath: string,
  snapshot: HandlingFileSnapshot,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function matchesFilter(
  row: HandlingRecord,
  filter?: { tenantId?: string; status?: HandlingState | HandlingState[] },
): boolean {
  if (!filter) {
    return true;
  }
  if (filter.tenantId !== undefined && row.tenantId !== filter.tenantId) {
    return false;
  }
  if (filter.status) {
    const statuses = new Set(Array.isArray(filter.status) ? filter.status : [filter.status]);
    if (!statuses.has(row.status)) {
      return false;
    }
  }
  return true;
}

export function handlingStorePath(configDir: string, tenantId: string): string {
  return path.join(
    configDir,
    DIAGNOSIS_HANDLING_DIR,
    diagnosisJobTenantHash16(tenantId),
    "records.json",
  );
}

export function createMemoryHandlingStore(seed: readonly HandlingRecord[] = []): HandlingStore {
  const map = new Map<string, HandlingRecord>();
  for (const row of seed) {
    map.set(row.handlingId, cloneRecord(row));
  }
  const recover = () => {
    const now = new Date().toISOString();
    for (const [id, row] of map) {
      const next = recoverExecuting(row, now);
      if (next.status !== row.status) {
        map.set(id, next);
      }
    }
  };
  return {
    get: (handlingId) => {
      const row = map.get(handlingId);
      return row ? cloneRecord(row) : undefined;
    },
    getByIdempotency: (tenantId, idempotencyKey) => {
      for (const row of map.values()) {
        if (row.tenantId === tenantId && row.idempotencyKey === idempotencyKey) {
          return cloneRecord(row);
        }
      }
      return undefined;
    },
    put: (row) => {
      const saved = cloneRecord(row);
      map.set(saved.handlingId, saved);
      return cloneRecord(saved);
    },
    list: (filter) =>
      [...map.values()].filter((row) => matchesFilter(row, filter)).map(cloneRecord),
    reload: recover,
    close: () => {},
  };
}

export function createFileHandlingStore(
  configDir: string,
  tenantId: string,
  options: FileHandlingStoreOptions = {},
): HandlingStore {
  const filePath = path.resolve(handlingStorePath(configDir, tenantId));
  if (fileStoreWriters.has(filePath)) {
    throw new Error(DIAGNOSIS_HANDLING_SINGLE_WRITER_VIOLATION);
  }
  const lease = { closed: false };
  fileStoreWriters.set(filePath, lease);
  const writeSnapshot = options.writeSnapshot ?? writeHandlingSnapshotAtomic;
  const assertOpen = () => {
    if (lease.closed) {
      throw new Error(DIAGNOSIS_HANDLING_SINGLE_WRITER_VIOLATION);
    }
  };
  const load = (): HandlingFileSnapshot => {
    const now = new Date().toISOString();
    const recovered = recoverSnapshot(readFile(filePath), now);
    if (recovered.dirty) {
      writeSnapshot(filePath, recovered.snapshot);
    }
    return recovered.snapshot;
  };
  let snapshot = load();
  const close = () => {
    if (lease.closed) {
      return;
    }
    lease.closed = true;
    if (fileStoreWriters.get(filePath) === lease) {
      fileStoreWriters.delete(filePath);
    }
  };
  return {
    get: (handlingId) => {
      assertOpen();
      const row = snapshot.records[handlingId];
      return row ? cloneRecord(row) : undefined;
    },
    getByIdempotency: (tenantIdValue, idempotencyKey) => {
      assertOpen();
      for (const row of Object.values(snapshot.records)) {
        if (row.tenantId === tenantIdValue && row.idempotencyKey === idempotencyKey) {
          return cloneRecord(row);
        }
      }
      return undefined;
    },
    put: (row) => {
      assertOpen();
      const saved = cloneRecord(row);
      const next: HandlingFileSnapshot = {
        records: { ...snapshot.records, [saved.handlingId]: saved },
      };
      writeSnapshot(filePath, next);
      snapshot = next;
      return cloneRecord(saved);
    },
    list: (filter) => {
      assertOpen();
      return Object.values(snapshot.records)
        .filter((row) => matchesFilter(row, filter))
        .map(cloneRecord);
    },
    reload: () => {
      assertOpen();
      snapshot = load();
    },
    close,
  };
}

export function createTenantFileHandlingStore(
  configDir: string,
  options: FileHandlingStoreOptions = {},
): HandlingStore {
  const stores = new Map<string, HandlingStore>();
  const storeFor = (tenantId: string): HandlingStore => {
    const existing = stores.get(tenantId);
    if (existing) {
      return existing;
    }
    const created = createFileHandlingStore(configDir, tenantId, options);
    stores.set(tenantId, created);
    return created;
  };
  return {
    get: (handlingId) => {
      for (const store of stores.values()) {
        const row = store.get(handlingId);
        if (row) {
          return row;
        }
      }
      return undefined;
    },
    getByIdempotency: (tenantId, idempotencyKey) =>
      storeFor(tenantId).getByIdempotency(tenantId, idempotencyKey),
    put: (row) => storeFor(row.tenantId).put(row),
    list: (filter) => {
      if (filter?.tenantId) {
        return storeFor(filter.tenantId).list(filter);
      }
      const out: HandlingRecord[] = [];
      for (const store of stores.values()) {
        out.push(...store.list(filter));
      }
      return out;
    },
    reload: () => {
      for (const store of stores.values()) {
        store.reload();
      }
    },
    close: () => {
      for (const store of stores.values()) {
        store.close();
      }
      stores.clear();
    },
  };
}
