/**
 * Agent Run 并发等待队列（P2：`ConcurrencyPolicy.mode=queue`）。
 *
 * 租户级 FIFO；席位级超限不入队。落盘：`CONFIG_DIR/openbot-agent-run-queue.json`。
 */

import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import {
  tryAcquireAgentRunSlot,
  type TryAcquireAgentRunSlotInput,
  type TryAcquireAgentRunSlotResult,
} from "./agent-run-registry.js";

const STORE_VERSION = 1;

export type QueuedAgentRunEntry = {
  queueId: string;
  runId: string;
  enterpriseId: string;
  enqueuedAt: string;
};

type AgentRunQueueStore = {
  version: number;
  /** enterpriseId -> FIFO */
  queues: Record<string, QueuedAgentRunEntry[]>;
};

function createEmptyStore(): AgentRunQueueStore {
  return { version: STORE_VERSION, queues: {} };
}

export function resolveDefaultAgentRunQueueStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-agent-run-queue.json");
}

const withLock = createAsyncLock();

function tenant(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

async function loadStore(storePath?: string): Promise<AgentRunQueueStore> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultAgentRunQueueStorePath());
  const parsed = await readJsonFile<Partial<AgentRunQueueStore>>(resolvedPath);
  if (!parsed || typeof parsed.queues !== "object" || parsed.queues === null) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, queues: parsed.queues };
}

async function saveStore(store: AgentRunQueueStore, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultAgentRunQueueStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveCommercialRunQueueMaxWaitMs(): number {
  const raw = process.env.OPENBOT_COMMERCIAL_RUN_QUEUE_MAX_WAIT_MS?.trim();
  if (!raw) {
    return 120_000;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 120_000;
  }
  return parsed;
}

export type AcquireAgentRunSlotWithQueueResult =
  | TryAcquireAgentRunSlotResult
  | { ok: false; reason: "CONCURRENCY_QUEUE_TIMEOUT"; waitedMs: number; queuePosition: number };

/**
 * 在 queue 模式下于租户并发满时 FIFO 等待；block / pay_as_you_go 行为与 registry 一致。
 */
export async function acquireAgentRunSlotWithQueuePolicy(
  input: TryAcquireAgentRunSlotInput,
  options?: {
    maxWaitMs?: number;
    pollIntervalMs?: number;
    queueStorePath?: string;
    registryStorePath?: string;
  },
): Promise<AcquireAgentRunSlotWithQueueResult> {
  if (input.concurrencyMode !== "queue") {
    return tryAcquireAgentRunSlot(input, options?.registryStorePath);
  }

  const maxWaitMs = options?.maxWaitMs ?? resolveCommercialRunQueueMaxWaitMs();
  const pollIntervalMs = Math.max(50, options?.pollIntervalMs ?? 250);
  const enterpriseKey = tenant(input.enterpriseId);
  const runId = input.runId.trim();

  const first = await tryAcquireAgentRunSlot(input, options?.registryStorePath);
  if (
    first.ok ||
    first.reason === "DUPLICATE_ACTIVE" ||
    first.reason === "SEAT_CONCURRENCY_LIMIT_EXCEEDED"
  ) {
    return first;
  }
  if (first.reason !== "CONCURRENCY_LIMIT_EXCEEDED") {
    return first;
  }

  const enqueued = await enqueueAgentRun(
    { runId, enterpriseId: input.enterpriseId },
    options?.queueStorePath,
  );
  const started = Date.now();

  try {
    while (Date.now() - started < maxWaitMs) {
      const atHead = await isQueueHead(runId, input.enterpriseId, options?.queueStorePath);
      if (atHead) {
        const attempt = await tryAcquireAgentRunSlot(input, options?.registryStorePath);
        if (attempt.ok || attempt.reason === "DUPLICATE_ACTIVE") {
          await dequeueAgentRun(runId, input.enterpriseId, options?.queueStorePath);
          return attempt;
        }
        if (attempt.reason === "SEAT_CONCURRENCY_LIMIT_EXCEEDED") {
          await dequeueAgentRun(runId, input.enterpriseId, options?.queueStorePath);
          return attempt;
        }
      }
      await sleep(pollIntervalMs);
    }
    return {
      ok: false,
      reason: "CONCURRENCY_QUEUE_TIMEOUT",
      waitedMs: Date.now() - started,
      queuePosition: enqueued.position,
    };
  } finally {
    await dequeueAgentRun(runId, enterpriseKey, options?.queueStorePath).catch(() => undefined);
  }
}

export async function enqueueAgentRun(
  input: { runId: string; enterpriseId: string; enqueuedAt?: string },
  storePath?: string,
): Promise<{ queueId: string; position: number }> {
  const runId = input.runId.trim();
  const enterpriseKey = tenant(input.enterpriseId);
  return withLock(async () => {
    const store = await loadStore(storePath);
    const queue = store.queues[enterpriseKey] ?? [];
    const existing = queue.find((e) => e.runId === runId);
    if (existing) {
      const position = queue.findIndex((e) => e.runId === runId) + 1;
      return { queueId: existing.queueId, position };
    }
    const entry: QueuedAgentRunEntry = {
      queueId: `arq-${runId}`,
      runId,
      enterpriseId: enterpriseKey,
      enqueuedAt: input.enqueuedAt ?? new Date().toISOString(),
    };
    queue.push(entry);
    store.queues[enterpriseKey] = queue;
    await saveStore(store, storePath);
    return { queueId: entry.queueId, position: queue.length };
  });
}

export async function dequeueAgentRun(
  runId: string,
  enterpriseId: string,
  storePath?: string,
): Promise<void> {
  const id = runId.trim();
  const enterpriseKey = tenant(enterpriseId);
  await withLock(async () => {
    const store = await loadStore(storePath);
    const queue = store.queues[enterpriseKey];
    if (!queue?.length) {
      return;
    }
    store.queues[enterpriseKey] = queue.filter((e) => e.runId !== id);
    if (store.queues[enterpriseKey].length === 0) {
      delete store.queues[enterpriseKey];
    }
    await saveStore(store, storePath);
  });
}

export async function isQueueHead(
  runId: string,
  enterpriseId: string,
  storePath?: string,
): Promise<boolean> {
  const id = runId.trim();
  const enterpriseKey = tenant(enterpriseId);
  const store = await loadStore(storePath);
  const queue = store.queues[enterpriseKey];
  if (!queue?.length) {
    return true;
  }
  return queue[0].runId === id;
}

export async function listQueuedAgentRuns(
  enterpriseId: string,
  storePath?: string,
): Promise<readonly QueuedAgentRunEntry[]> {
  const store = await loadStore(storePath);
  return [...(store.queues[tenant(enterpriseId)] ?? [])];
}

export async function __resetAgentRunQueueForTest(storePath?: string): Promise<void> {
  await withLock(async () => {
    await saveStore(createEmptyStore(), storePath);
  });
}
