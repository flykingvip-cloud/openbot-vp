import path from "node:path";
/**
 * Durable commercial usage outbox — receipt before delivery.
 *
 * Chat/cron write a pending record (payload = RecordCreditUsageInput) before
 * treating the commercial usage as accepted. A drain consumer calls the
 * idempotent recordCreditUsage stage machine.
 */
import { withFileLock, SESSION_TASK_BOARD_LOCK_OPTIONS } from "../../infra/file-lock.js";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import type { RecordCreditUsageInput } from "./record-credit-usage.js";

const STORE_VERSION = 1;

export type UsageOutboxStatus = "pending" | "processing" | "done" | "failed";

export type UsageOutboxRecord = {
  id: string;
  taskId: string;
  enterpriseId: string;
  status: UsageOutboxStatus;
  attempts: number;
  payload: RecordCreditUsageInput;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  nextAttemptAt?: string;
};

type Store = {
  version: number;
  byId: Record<string, UsageOutboxRecord>;
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, byId: {} };
}

export function resolveDefaultUsageOutboxStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-usage-outbox.json");
}

const serialize = createAsyncLock();
function withLock<T>(storePath: string | undefined, work: () => Promise<T>): Promise<T> {
  const file = resolveUserPath(storePath?.trim() || resolveDefaultUsageOutboxStorePath());
  return serialize(() => withFileLock(file, SESSION_TASK_BOARD_LOCK_OPTIONS, work));
}

async function loadStore(storePath?: string): Promise<Store> {
  const resolved = resolveUserPath(storePath?.trim() || resolveDefaultUsageOutboxStorePath());
  const parsed = await readJsonFile<Partial<Store>>(resolved);
  if (!parsed || typeof parsed.byId !== "object" || parsed.byId === null) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, byId: parsed.byId };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolved = resolveUserPath(storePath?.trim() || resolveDefaultUsageOutboxStorePath());
  await writeJsonAtomic(resolved, store);
}

/**
 * Enqueue (or return existing) usage receipt. Idempotent on taskId.
 * Must succeed before the main flow treats usage as accepted.
 */
export async function enqueueUsageOutbox(
  payload: RecordCreditUsageInput,
  storePath?: string,
): Promise<UsageOutboxRecord> {
  const taskId = payload.taskId.trim();
  if (!taskId) {
    throw new Error("taskId is required for usage outbox");
  }
  const id = taskId;
  return withLock(storePath, async () => {
    const store = await loadStore(storePath);
    const existing = store.byId[id];
    if (
      existing &&
      (existing.status === "done" ||
        existing.status === "pending" ||
        existing.status === "processing")
    ) {
      return existing;
    }
    const now = new Date().toISOString();
    const record: UsageOutboxRecord = {
      id,
      taskId,
      enterpriseId: payload.enterpriseId,
      status: "pending",
      attempts: existing?.attempts ?? 0,
      payload: { ...payload, taskId },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    store.byId[id] = record;
    await saveStore(store, storePath);
    return record;
  });
}

export async function listUsageOutboxDue(params?: {
  storePath?: string;
  limit?: number;
  nowMs?: number;
}): Promise<UsageOutboxRecord[]> {
  const store = await loadStore(params?.storePath);
  const nowMs = params?.nowMs ?? Date.now();
  const limit = params?.limit ?? 50;
  return Object.values(store.byId)
    .filter((record) => {
      if (record.status === "done") {
        return false;
      }
      if (record.status === "failed" && record.attempts >= 20) {
        return false;
      }
      if (record.nextAttemptAt) {
        const next = Date.parse(record.nextAttemptAt);
        if (Number.isFinite(next) && next > nowMs) {
          return false;
        }
      }
      return (
        record.status === "pending" || record.status === "failed" || record.status === "processing"
      );
    })
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, limit);
}

export async function markUsageOutboxProcessing(
  id: string,
  storePath?: string,
): Promise<UsageOutboxRecord | null> {
  return withLock(storePath, async () => {
    const store = await loadStore(storePath);
    const existing = store.byId[id];
    if (!existing || existing.status === "done") {
      return existing ?? null;
    }
    const now = new Date().toISOString();
    const next: UsageOutboxRecord = {
      ...existing,
      status: "processing",
      attempts: existing.attempts + 1,
      updatedAt: now,
    };
    store.byId[id] = next;
    await saveStore(store, storePath);
    return next;
  });
}

export async function markUsageOutboxDone(id: string, storePath?: string): Promise<void> {
  await withLock(storePath, async () => {
    const store = await loadStore(storePath);
    const existing = store.byId[id];
    if (!existing) {
      return;
    }
    store.byId[id] = {
      ...existing,
      status: "done",
      updatedAt: new Date().toISOString(),
      lastError: undefined,
      nextAttemptAt: undefined,
    };
    await saveStore(store, storePath);
  });
}

export async function markUsageOutboxFailed(input: {
  id: string;
  error: string;
  storePath?: string;
  backoffMs?: number;
}): Promise<void> {
  await withLock(input.storePath, async () => {
    const store = await loadStore(input.storePath);
    const existing = store.byId[input.id];
    if (!existing || existing.status === "done") {
      return;
    }
    const attempts = existing.attempts;
    const backoff = input.backoffMs ?? Math.min(60 * 60_000, 5_000 * 2 ** Math.min(attempts, 8));
    const nextAt = new Date(Date.now() + backoff).toISOString();
    store.byId[input.id] = {
      ...existing,
      status: "failed",
      lastError: input.error.slice(0, 500),
      nextAttemptAt: nextAt,
      updatedAt: new Date().toISOString(),
    };
    await saveStore(store, input.storePath);
  });
}

export async function countUsageOutboxBacklog(storePath?: string): Promise<{
  pending: number;
  failed: number;
  processing: number;
}> {
  const store = await loadStore(storePath);
  let pending = 0;
  let failed = 0;
  let processing = 0;
  for (const record of Object.values(store.byId)) {
    if (record.status === "pending") {
      pending += 1;
    } else if (record.status === "failed") {
      failed += 1;
    } else if (record.status === "processing") {
      processing += 1;
    }
  }
  return { pending, failed, processing };
}
