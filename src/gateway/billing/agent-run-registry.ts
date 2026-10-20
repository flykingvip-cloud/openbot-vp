/**
 * Agent Run 运行时注册表（租户并发计数真源）。
 *
 * 落盘：`CONFIG_DIR/openbot-agent-run-registry.json`。
 * P1 consumption-forecast 将读取 startedAt/finishedAt 时序。
 */

import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";

const STORE_VERSION = 1;

/** Active runs older than this are treated as orphaned and auto-finished before counting. */
export const DEFAULT_AGENT_RUN_STALE_MS = 3 * 60 * 60 * 1000;

export function resolveAgentRunStaleMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.OPENBOT_AGENT_RUN_STALE_MS ?? env.OPENCLAW_AGENT_RUN_STALE_MS;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_AGENT_RUN_STALE_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_AGENT_RUN_STALE_MS;
  }
  return Math.floor(parsed);
}

export type AgentRunRecord = {
  runId: string;
  enterpriseId: string;
  agentId?: string;
  botId?: string;
  /** P1：计费席位归属，用于席位级并发计数。 */
  billingSeatId?: string;
  startedAt: string;
  finishedAt?: string;
};

type AgentRunRegistryStore = {
  version: number;
  runs: Record<string, AgentRunRecord>;
};

function createEmptyStore(): AgentRunRegistryStore {
  return { version: STORE_VERSION, runs: {} };
}

export function resolveDefaultAgentRunRegistryStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-agent-run-registry.json");
}

const withLock = createAsyncLock();

function tenant(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

async function loadStore(storePath?: string): Promise<AgentRunRegistryStore> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultAgentRunRegistryStorePath(),
  );
  const parsed = await readJsonFile<Partial<AgentRunRegistryStore>>(resolvedPath);
  if (!parsed || typeof parsed.runs !== "object" || parsed.runs === null) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, runs: parsed.runs };
}

async function saveStore(store: AgentRunRegistryStore, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultAgentRunRegistryStorePath(),
  );
  await writeJsonAtomic(resolvedPath, store);
}

function isActive(record: AgentRunRecord): boolean {
  return record.finishedAt === undefined;
}

export type ReapStaleAgentRunsResult = {
  reapedRunIds: string[];
};

/** Finish active runs whose startedAt is older than staleMs (orphaned slot leak recovery). */
export function reapStaleActiveAgentRunsInStore(
  store: AgentRunRegistryStore,
  staleMs: number,
  nowMs: number = Date.now(),
): ReapStaleAgentRunsResult {
  const thresholdMs = Math.max(0, Math.floor(staleMs));
  if (thresholdMs <= 0) {
    return { reapedRunIds: [] };
  }
  const reapedRunIds: string[] = [];
  for (const [runId, record] of Object.entries(store.runs)) {
    if (!isActive(record)) {
      continue;
    }
    const startedMs = Date.parse(record.startedAt);
    if (!Number.isFinite(startedMs) || nowMs - startedMs < thresholdMs) {
      continue;
    }
    store.runs[runId] = {
      ...record,
      finishedAt: new Date(nowMs).toISOString(),
    };
    reapedRunIds.push(runId);
  }
  return { reapedRunIds };
}

async function reapStaleActiveAgentRuns(
  store: AgentRunRegistryStore,
  storePath?: string,
  staleMs?: number,
): Promise<ReapStaleAgentRunsResult> {
  const result = reapStaleActiveAgentRunsInStore(store, staleMs ?? resolveAgentRunStaleMs());
  if (result.reapedRunIds.length > 0) {
    await saveStore(store, storePath);
  }
  return result;
}

export async function reapStaleActiveAgentRunsOnStartup(
  storePath?: string,
  staleMs?: number,
): Promise<ReapStaleAgentRunsResult> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    return reapStaleActiveAgentRuns(store, storePath, staleMs);
  });
}

function countActiveRunsInStore(store: AgentRunRegistryStore, enterpriseId: string): number {
  const t = tenant(enterpriseId);
  return Object.values(store.runs).filter((r) => r.enterpriseId === t && isActive(r)).length;
}

function countActiveRunsForSeatInStore(
  store: AgentRunRegistryStore,
  enterpriseId: string,
  billingSeatId: string,
): number {
  const t = tenant(enterpriseId);
  const seatId = billingSeatId.trim();
  return Object.values(store.runs).filter(
    (r) => r.enterpriseId === t && isActive(r) && r.billingSeatId === seatId,
  ).length;
}

export type TryAcquireAgentRunSlotInput = {
  runId: string;
  enterpriseId: string;
  /** includedRuns — 套餐内含并发。 */
  maxConcurrentRuns: number;
  /** P1：Burst 上限；缺省等于 maxConcurrentRuns。 */
  maxBurstRuns?: number;
  allowBurstConcurrency: boolean;
  /** P1：queue / pay_as_you_go 预留；当前仅 block + burst 生效。 */
  concurrencyMode?: "block" | "queue" | "pay_as_you_go";
  agentId?: string;
  botId?: string;
  /** P1：席位级并发计数键。 */
  billingSeatId?: string;
  /** P1：席位 profile 并发上限（与 maxConcurrentRuns 取 min 后传入）。 */
  seatMaxConcurrentRuns?: number;
  startedAt?: string;
};

export type TryAcquireAgentRunSlotResult =
  | { ok: true; record: AgentRunRecord }
  | { ok: false; reason: "CONCURRENCY_LIMIT_EXCEEDED"; activeCount: number }
  | { ok: false; reason: "SEAT_CONCURRENCY_LIMIT_EXCEEDED"; activeCount: number }
  | { ok: false; reason: "DUPLICATE_ACTIVE"; record: AgentRunRecord };

function resolveEffectiveConcurrencyLimit(input: TryAcquireAgentRunSlotInput): number {
  const included = Math.max(0, Math.floor(input.maxConcurrentRuns));
  if (!input.allowBurstConcurrency) {
    return included;
  }
  if (input.concurrencyMode === "pay_as_you_go") {
    return Number.POSITIVE_INFINITY;
  }
  const burst = Math.max(included, Math.floor(input.maxBurstRuns ?? included));
  return burst;
}

/**
 * 原子 acquire：在同一 store 锁内计数 + 校验 + 写入，避免 TOCTOU 超卖并发槽。
 */
export async function tryAcquireAgentRunSlot(
  input: TryAcquireAgentRunSlotInput,
  storePath?: string,
): Promise<TryAcquireAgentRunSlotResult> {
  const runId = input.runId.trim();
  if (!runId) {
    throw new Error("runId is required");
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const existing = store.runs[runId];
    if (existing && isActive(existing)) {
      return { ok: false, reason: "DUPLICATE_ACTIVE", record: existing };
    }

    const tryCountAndAcquire = (): TryAcquireAgentRunSlotResult => {
      const activeCount = countActiveRunsInStore(store, input.enterpriseId);
      const limit = resolveEffectiveConcurrencyLimit(input);
      if (Number.isFinite(limit) && limit > 0 && activeCount >= limit) {
        return { ok: false, reason: "CONCURRENCY_LIMIT_EXCEEDED", activeCount };
      }
      const billingSeatId = input.billingSeatId?.trim();
      const seatLimit = Math.floor(input.seatMaxConcurrentRuns ?? 0);
      if (billingSeatId && seatLimit > 0) {
        const seatActive = countActiveRunsForSeatInStore(store, input.enterpriseId, billingSeatId);
        if (seatActive >= seatLimit) {
          return { ok: false, reason: "SEAT_CONCURRENCY_LIMIT_EXCEEDED", activeCount: seatActive };
        }
      }
      const record: AgentRunRecord = {
        runId,
        enterpriseId: tenant(input.enterpriseId),
        startedAt: input.startedAt ?? new Date().toISOString(),
        ...(input.agentId?.trim() ? { agentId: input.agentId.trim() } : {}),
        ...(input.botId?.trim() ? { botId: input.botId.trim() } : {}),
        ...(billingSeatId ? { billingSeatId } : {}),
      };
      store.runs[runId] = record;
      return { ok: true, record };
    };

    let result = tryCountAndAcquire();
    if (
      !result.ok &&
      (result.reason === "CONCURRENCY_LIMIT_EXCEEDED" ||
        result.reason === "SEAT_CONCURRENCY_LIMIT_EXCEEDED")
    ) {
      const reaped = reapStaleActiveAgentRunsInStore(store, resolveAgentRunStaleMs());
      if (reaped.reapedRunIds.length > 0) {
        result = tryCountAndAcquire();
      }
    }

    if (!result.ok) {
      return result;
    }
    await saveStore(store, storePath);
    return result;
  });
}

export async function registerAgentRun(
  input: {
    runId: string;
    enterpriseId: string;
    agentId?: string;
    botId?: string;
    startedAt?: string;
  },
  storePath?: string,
): Promise<AgentRunRecord> {
  const result = await tryAcquireAgentRunSlot(
    {
      ...input,
      maxConcurrentRuns: 0,
      allowBurstConcurrency: true,
    },
    storePath,
  );
  if (result.ok) {
    return result.record;
  }
  if (result.reason === "DUPLICATE_ACTIVE") {
    return result.record;
  }
  throw new Error(`registerAgentRun refused: ${result.reason}`);
}

export async function finishAgentRun(
  runId: string,
  storePath?: string,
  finishedAt?: string,
): Promise<AgentRunRecord | null> {
  const id = runId.trim();
  if (!id) {
    return null;
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const record = store.runs[id];
    if (!record) {
      return null;
    }
    if (record.finishedAt) {
      return record;
    }
    const updated: AgentRunRecord = {
      ...record,
      finishedAt: finishedAt ?? new Date().toISOString(),
    };
    store.runs[id] = updated;
    await saveStore(store, storePath);
    return updated;
  });
}

export async function getAgentRun(
  runId: string,
  storePath?: string,
): Promise<AgentRunRecord | null> {
  const store = await loadStore(storePath);
  return store.runs[runId.trim()] ?? null;
}

export async function countActiveAgentRuns(
  enterpriseId: string,
  storePath?: string,
): Promise<number> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    return countActiveRunsInStore(store, enterpriseId);
  });
}

export async function listAgentRunsForEnterprise(
  enterpriseId: string,
  options?: { activeOnly?: boolean; limit?: number },
  storePath?: string,
): Promise<AgentRunRecord[]> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  let rows = Object.values(store.runs).filter((r) => r.enterpriseId === t);
  if (options?.activeOnly) {
    rows = rows.filter(isActive);
  }
  rows.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const limit = options?.limit;
  if (limit !== undefined && limit > 0) {
    rows = rows.slice(0, limit);
  }
  return rows;
}

export async function __resetAgentRunRegistryForTest(storePath?: string): Promise<void> {
  await withLock(async () => {
    await saveStore(createEmptyStore(), storePath);
  });
}
