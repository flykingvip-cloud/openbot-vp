/**
 * 企业周期 Credits 余额 store（按 enterpriseId + cycleStart 隔离）。
 * 落盘：`CONFIG_DIR/openbot-tenant-credits.json`。
 */

import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import type { TenantCreditsBalance } from "../package-entitlement/types.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { computeCreditsBalance } from "./credit-meter.js";

const STORE_VERSION = 1;

type TenantCreditsRecord = {
  enterpriseId: string;
  cycleStart: string;
  monthlyCredits: number;
  creditsConsumed: number;
  updatedAt: string;
};

type Store = {
  version: number;
  /** key: `${enterpriseId}::${cycleStart}` */
  balances: Record<string, TenantCreditsRecord>;
  /** taskId 幂等消费：key = `${enterpriseId}|${taskId}` */
  taskConsumptions?: Record<string, { amount: number; cycleStart: string; at: string }>;
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, balances: {}, taskConsumptions: {} };
}

function taskConsumptionKey(enterpriseId: string, taskId: string): string {
  return `${tenant(enterpriseId)}|${taskId.trim()}`;
}

export function resolveDefaultTenantCreditsStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-tenant-credits.json");
}

const withLock = createAsyncLock();

function tenant(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

function balanceKey(enterpriseId: string, cycleStart: string): string {
  return `${tenant(enterpriseId)}::${cycleStart}`;
}

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultTenantCreditsStorePath());
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.balances !== "object" || parsed.balances === null) {
    return createEmptyStore();
  }
  return {
    version: STORE_VERSION,
    balances: parsed.balances,
    taskConsumptions:
      typeof parsed.taskConsumptions === "object" && parsed.taskConsumptions
        ? parsed.taskConsumptions
        : {},
  };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultTenantCreditsStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

export async function getTenantCreditsBalance(
  enterpriseId: string,
  cycleStart: string,
  storePath?: string,
): Promise<TenantCreditsBalance | null> {
  const store = await loadStore(storePath);
  const record = store.balances[balanceKey(enterpriseId, cycleStart)];
  if (!record) {
    return null;
  }
  return computeCreditsBalance({
    enterpriseId: record.enterpriseId,
    cycleStart: record.cycleStart,
    monthlyCredits: record.monthlyCredits,
    creditsConsumed: record.creditsConsumed,
    now: record.updatedAt,
  });
}

/** 初始化或刷新周期配额（不重置已消耗，仅在新 key 时写入）。 */
export async function ensureTenantCreditsAllocation(
  input: {
    enterpriseId: string;
    cycleStart: string;
    monthlyCredits: number;
  },
  storePath?: string,
): Promise<TenantCreditsBalance> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const key = balanceKey(input.enterpriseId, input.cycleStart);
    const now = new Date().toISOString();
    const existing = store.balances[key];
    if (!existing) {
      store.balances[key] = {
        enterpriseId: tenant(input.enterpriseId),
        cycleStart: input.cycleStart,
        monthlyCredits: Math.max(0, Math.floor(input.monthlyCredits)),
        creditsConsumed: 0,
        updatedAt: now,
      };
      await saveStore(store, storePath);
    }
    const record = store.balances[key];
    return computeCreditsBalance({
      enterpriseId: record.enterpriseId,
      cycleStart: record.cycleStart,
      monthlyCredits: record.monthlyCredits,
      creditsConsumed: record.creditsConsumed,
      now: record.updatedAt,
    });
  });
}

export async function consumeTenantCredits(
  input: {
    enterpriseId: string;
    cycleStart: string;
    credits: number;
    /** 提供时按 taskId 幂等：同一 task 只扣一次 */
    taskId?: string;
    /** true：不足时扣到上限（PAYG）；false：不足仍累加（兼容旧行为）或可拒绝 */
    allowPartial?: boolean;
  },
  storePath?: string,
): Promise<TenantCreditsBalance & { consumed: number; shortfall: number; deduped: boolean }> {
  const amount = Math.max(0, Math.floor(input.credits));
  return withLock(async () => {
    const store = await loadStore(storePath);
    if (!store.taskConsumptions) {
      store.taskConsumptions = {};
    }
    const taskId = input.taskId?.trim();
    if (taskId) {
      const tkey = taskConsumptionKey(input.enterpriseId, taskId);
      const prior = store.taskConsumptions[tkey];
      if (prior) {
        const record = store.balances[balanceKey(input.enterpriseId, input.cycleStart)];
        if (!record) {
          throw new Error("tenant credits not initialized for cycle");
        }
        return {
          ...computeCreditsBalance({
            enterpriseId: record.enterpriseId,
            cycleStart: record.cycleStart,
            monthlyCredits: record.monthlyCredits,
            creditsConsumed: record.creditsConsumed,
            now: record.updatedAt,
          }),
          consumed: prior.amount,
          shortfall: Math.max(0, amount - prior.amount),
          deduped: true,
        };
      }
    }

    const key = balanceKey(input.enterpriseId, input.cycleStart);
    const record = store.balances[key];
    if (!record) {
      throw new Error("tenant credits not initialized for cycle");
    }
    const available = Math.max(0, record.monthlyCredits - record.creditsConsumed);
    let take = amount;
    let shortfall = 0;
    if (input.allowPartial && amount > available) {
      take = available;
      shortfall = amount - available;
    }
    record.creditsConsumed += take;
    record.updatedAt = new Date().toISOString();
    if (taskId) {
      store.taskConsumptions[taskConsumptionKey(input.enterpriseId, taskId)] = {
        amount: take,
        cycleStart: input.cycleStart,
        at: record.updatedAt,
      };
    }
    await saveStore(store, storePath);
    return {
      ...computeCreditsBalance({
        enterpriseId: record.enterpriseId,
        cycleStart: record.cycleStart,
        monthlyCredits: record.monthlyCredits,
        creditsConsumed: record.creditsConsumed,
        now: record.updatedAt,
      }),
      consumed: take,
      shortfall,
      deduped: false,
    };
  });
}

/** 容量包充值：追加到当前周期 monthlyCredits（与套餐配额分账在同一余额池）。 */
export async function appendRechargeCredits(
  input: {
    enterpriseId: string;
    cycleStart: string;
    credits: number;
  },
  storePath?: string,
): Promise<TenantCreditsBalance> {
  const amount = Math.max(0, Math.floor(input.credits));
  if (amount <= 0) {
    throw new Error("充值 credits 必须大于 0");
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const key = balanceKey(input.enterpriseId, input.cycleStart);
    const now = new Date().toISOString();
    let record = store.balances[key];
    if (!record) {
      record = {
        enterpriseId: tenant(input.enterpriseId),
        cycleStart: input.cycleStart,
        monthlyCredits: 0,
        creditsConsumed: 0,
        updatedAt: now,
      };
      store.balances[key] = record;
    }
    record.monthlyCredits += amount;
    record.updatedAt = now;
    await saveStore(store, storePath);
    return computeCreditsBalance({
      enterpriseId: record.enterpriseId,
      cycleStart: record.cycleStart,
      monthlyCredits: record.monthlyCredits,
      creditsConsumed: record.creditsConsumed,
      now: record.updatedAt,
    });
  });
}

export type TenantCreditsCycleSummary = {
  cycleStart: string;
  monthlyCredits: number;
  creditsConsumed: number;
  creditsRemaining: number;
  updatedAt: string;
};

/** 列出企业各计费周期的 Credits 余额快照（按 cycleStart 升序）。 */
export async function listTenantCreditsCycles(
  enterpriseId: string,
  opts?: { limit?: number; storePath?: string },
): Promise<TenantCreditsCycleSummary[]> {
  const store = await loadStore(opts?.storePath);
  const canonical = tenant(enterpriseId);
  const records = Object.values(store.balances)
    .filter((record) => record.enterpriseId === canonical)
    .map((record) =>
      computeCreditsBalance({
        enterpriseId: record.enterpriseId,
        cycleStart: record.cycleStart,
        monthlyCredits: record.monthlyCredits,
        creditsConsumed: record.creditsConsumed,
        now: record.updatedAt,
      }),
    )
    .toSorted((left, right) => left.cycleStart.localeCompare(right.cycleStart));
  const limit = opts?.limit;
  if (limit != null && limit > 0 && records.length > limit) {
    return records.slice(records.length - limit);
  }
  return records;
}

export async function __resetTenantCreditsForTest(storePath?: string): Promise<void> {
  await saveStore(createEmptyStore(), storePath);
}
