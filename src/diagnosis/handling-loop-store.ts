/**
 * Durable diagnosis handling-loop store.
 * File-backed records survive process restart; the memory store is for
 * in-process tests that do not exercise restart.
 *
 * On reload, in-flight "executing" rows are moved to "result_unverified"
 * and are never auto-retried.
 */
import fs from "node:fs";
import path from "node:path";
import { diagnosisJobTenantHash16 } from "./diagnosis-job-store.js";
import type { HandlingRecord, HandlingState } from "./handling-loop.js";

export const DIAGNOSIS_HANDLING_DIR = "diagnosis-handling";

export type HandlingStore = {
  get(handlingId: string): HandlingRecord | undefined;
  getByIdempotency(tenantId: string, idempotencyKey: string): HandlingRecord | undefined;
  put(row: HandlingRecord): HandlingRecord;
  list(filter?: { tenantId?: string; status?: HandlingState | HandlingState[] }): HandlingRecord[];
  /** Re-read durable snapshot (file store). Recovers stale executing rows. */
  reload(): void;
};

type FileSnapshot = { records: Record<string, HandlingRecord> };

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
  snapshot: FileSnapshot,
  now: string,
): { snapshot: FileSnapshot; dirty: boolean } {
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

function emptySnapshot(): FileSnapshot {
  return { records: {} };
}

function readFile(filePath: string): FileSnapshot {
  if (!fs.existsSync(filePath)) {
    return emptySnapshot();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<FileSnapshot>;
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

function writeFileAtomic(filePath: string, snapshot: FileSnapshot): void {
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
  };
}

export function createFileHandlingStore(configDir: string, tenantId: string): HandlingStore {
  const filePath = handlingStorePath(configDir, tenantId);
  const load = (): FileSnapshot => {
    const now = new Date().toISOString();
    const recovered = recoverSnapshot(readFile(filePath), now);
    if (recovered.dirty) {
      writeFileAtomic(filePath, recovered.snapshot);
    }
    return recovered.snapshot;
  };
  let snapshot = load();
  const persist = () => writeFileAtomic(filePath, snapshot);
  return {
    get: (handlingId) => {
      const row = snapshot.records[handlingId];
      return row ? cloneRecord(row) : undefined;
    },
    getByIdempotency: (tenantIdValue, idempotencyKey) => {
      for (const row of Object.values(snapshot.records)) {
        if (row.tenantId === tenantIdValue && row.idempotencyKey === idempotencyKey) {
          return cloneRecord(row);
        }
      }
      return undefined;
    },
    put: (row) => {
      const saved = cloneRecord(row);
      snapshot.records[saved.handlingId] = saved;
      persist();
      return cloneRecord(saved);
    },
    list: (filter) =>
      Object.values(snapshot.records)
        .filter((row) => matchesFilter(row, filter))
        .map(cloneRecord),
    reload: () => {
      snapshot = load();
    },
  };
}

export function createTenantFileHandlingStore(configDir: string): HandlingStore {
  const stores = new Map<string, HandlingStore>();
  const storeFor = (tenantId: string): HandlingStore => {
    const existing = stores.get(tenantId);
    if (existing) {
      return existing;
    }
    const created = createFileHandlingStore(configDir, tenantId);
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
  };
}
