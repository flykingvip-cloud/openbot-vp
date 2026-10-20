/**
 * CreditBucket — 分桶 Credits 归属（P1 Phase 3）。
 *
 * 消费顺序：plan_cycle → proration_bonus → recharge → manual_adjustment
 *
 * 落盘：`CONFIG_DIR/openbot-credit-buckets.json`。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import type { TenantCreditsBalance } from "../package-entitlement/types.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { computeCreditsBalance } from "./credit-meter.js";
import { getTenantCreditsBalance } from "./tenant-credits-store.js";
import type { CreditBucket, CreditBucketType } from "./types.js";

const STORE_VERSION = 1;

const CONSUME_ORDER: CreditBucketType[] = [
  "plan_cycle",
  "proration_bonus",
  "recharge",
  "manual_adjustment",
];

type Store = {
  version: number;
  buckets: Record<string, CreditBucket>;
  /**
   * taskId 级幂等预约/扣减。
   * amount = 实际从桶扣减的 includedCredits；同时冻结 overage 分账结果，防并发 TOCTOU。
   */
  taskConsumptions?: Record<
    string,
    {
      amount: number;
      creditsRequested: number;
      overageCredits: number;
      overageAmountCents: number;
      cycleStart: string;
      at: string;
    }
  >;
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, buckets: {}, taskConsumptions: {} };
}

function taskConsumptionKey(enterpriseId: string, taskId: string): string {
  return `${tenant(enterpriseId)}|${taskId.trim()}`;
}

export function resolveDefaultCreditBucketsStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-credit-buckets.json");
}

const withLock = createAsyncLock();

function tenant(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultCreditBucketsStorePath());
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.buckets !== "object" || parsed.buckets === null) {
    return createEmptyStore();
  }
  return {
    version: STORE_VERSION,
    buckets: parsed.buckets,
    taskConsumptions:
      typeof parsed.taskConsumptions === "object" && parsed.taskConsumptions
        ? parsed.taskConsumptions
        : {},
  };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultCreditBucketsStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

function bucketRemaining(bucket: CreditBucket): number {
  return Math.max(0, bucket.creditsGranted - bucket.creditsConsumed);
}

function listBucketsForCycle(
  store: Store,
  enterpriseId: string,
  cycleStart: string,
): CreditBucket[] {
  const t = tenant(enterpriseId);
  return Object.values(store.buckets).filter(
    (b) => b.enterpriseId === t && b.cycleStart === cycleStart,
  );
}

function sortForConsume(buckets: CreditBucket[]): CreditBucket[] {
  return buckets.toSorted((left, right) => {
    const li = CONSUME_ORDER.indexOf(left.bucketType);
    const ri = CONSUME_ORDER.indexOf(right.bucketType);
    if (li !== ri) {
      return li - ri;
    }
    return left.createdAt.localeCompare(right.createdAt);
  });
}

export async function appendCreditBucket(
  input: {
    enterpriseId: string;
    cycleStart: string;
    bucketType: CreditBucketType;
    creditsGranted: number;
    subscriptionSnapshotId?: string;
    expiresAt?: string;
  },
  storePath?: string,
): Promise<CreditBucket> {
  const granted = Math.max(0, Math.floor(input.creditsGranted));
  if (granted <= 0) {
    throw new Error("creditsGranted must be positive");
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const now = new Date().toISOString();
    const bucket: CreditBucket = {
      id: `cb-${randomUUID()}`,
      enterpriseId: tenant(input.enterpriseId),
      cycleStart: input.cycleStart,
      bucketType: input.bucketType,
      creditsGranted: granted,
      creditsConsumed: 0,
      createdAt: now,
      updatedAt: now,
      ...(input.subscriptionSnapshotId?.trim()
        ? { subscriptionSnapshotId: input.subscriptionSnapshotId.trim() }
        : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    };
    store.buckets[bucket.id] = bucket;
    await saveStore(store, storePath);
    return bucket;
  });
}

export async function ensurePlanCycleCreditBucket(
  input: {
    enterpriseId: string;
    cycleStart: string;
    monthlyCredits: number;
    subscriptionSnapshotId?: string;
  },
  storePath?: string,
): Promise<CreditBucket> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const existing = listBucketsForCycle(store, input.enterpriseId, input.cycleStart).find(
      (b) => b.bucketType === "plan_cycle",
    );
    if (existing) {
      if (existing.creditsGranted < input.monthlyCredits) {
        existing.creditsGranted = Math.max(0, Math.floor(input.monthlyCredits));
        existing.updatedAt = new Date().toISOString();
        await saveStore(store, storePath);
      }
      return existing;
    }
    const now = new Date().toISOString();
    const bucket: CreditBucket = {
      id: `cb-${randomUUID()}`,
      enterpriseId: tenant(input.enterpriseId),
      cycleStart: input.cycleStart,
      bucketType: "plan_cycle",
      creditsGranted: Math.max(0, Math.floor(input.monthlyCredits)),
      creditsConsumed: 0,
      createdAt: now,
      updatedAt: now,
      ...(input.subscriptionSnapshotId?.trim()
        ? { subscriptionSnapshotId: input.subscriptionSnapshotId.trim() }
        : {}),
    };
    store.buckets[bucket.id] = bucket;
    await saveStore(store, storePath);
    return bucket;
  });
}

export async function listCreditBucketsForCycle(
  enterpriseId: string,
  cycleStart: string,
  storePath?: string,
): Promise<CreditBucket[]> {
  const store = await loadStore(storePath);
  return sortForConsume(listBucketsForCycle(store, enterpriseId, cycleStart));
}

export async function summarizeCreditBucketsForCycle(
  enterpriseId: string,
  cycleStart: string,
  storePath?: string,
): Promise<TenantCreditsBalance> {
  const buckets = await listCreditBucketsForCycle(enterpriseId, cycleStart, storePath);
  const monthlyCredits = buckets.reduce((sum, b) => sum + b.creditsGranted, 0);
  const creditsConsumed = buckets.reduce((sum, b) => sum + b.creditsConsumed, 0);
  const now = new Date().toISOString();
  return computeCreditsBalance({
    enterpriseId: tenant(enterpriseId),
    cycleStart,
    monthlyCredits,
    creditsConsumed,
    now,
  });
}

/**
 * 将 legacy tenant-credits 余额投影到 plan_cycle 分桶（幂等，只增不减）。
 * 用于修复「账本 + legacy 有消耗但分桶未初始化」的历史漂移。
 */
export async function syncPlanCycleBucketFromLegacyBalance(
  input: {
    enterpriseId: string;
    cycleStart: string;
    subscriptionSnapshotId?: string;
  },
  storePaths?: { creditBuckets?: string; tenantCredits?: string },
): Promise<{ repaired: boolean }> {
  const legacy = await getTenantCreditsBalance(
    input.enterpriseId,
    input.cycleStart,
    storePaths?.tenantCredits,
  );
  if (!legacy || legacy.monthlyCredits <= 0) {
    return { repaired: false };
  }

  return withLock(async () => {
    const store = await loadStore(storePaths?.creditBuckets);
    const existing = listBucketsForCycle(store, input.enterpriseId, input.cycleStart).find(
      (b) => b.bucketType === "plan_cycle",
    );
    const now = new Date().toISOString();
    let repaired = false;

    if (!existing) {
      const bucket: CreditBucket = {
        id: `cb-${randomUUID()}`,
        enterpriseId: tenant(input.enterpriseId),
        cycleStart: input.cycleStart,
        bucketType: "plan_cycle",
        creditsGranted: legacy.monthlyCredits,
        creditsConsumed: legacy.creditsConsumed,
        createdAt: now,
        updatedAt: now,
        ...(input.subscriptionSnapshotId?.trim()
          ? { subscriptionSnapshotId: input.subscriptionSnapshotId.trim() }
          : {}),
      };
      store.buckets[bucket.id] = bucket;
      await saveStore(store, storePaths?.creditBuckets);
      return { repaired: true };
    }

    const record = store.buckets[existing.id];
    if (!record) {
      return { repaired: false };
    }
    if (record.creditsGranted < legacy.monthlyCredits) {
      record.creditsGranted = legacy.monthlyCredits;
      repaired = true;
    }
    if (record.creditsConsumed < legacy.creditsConsumed) {
      record.creditsConsumed = legacy.creditsConsumed;
      repaired = true;
    }
    if (repaired) {
      record.updatedAt = now;
      await saveStore(store, storePaths?.creditBuckets);
    }
    return { repaired };
  });
}

export async function consumeCreditBuckets(
  input: {
    enterpriseId: string;
    cycleStart: string;
    credits: number;
    /** 提供时按 taskId 幂等：同一 task 只扣一次 */
    taskId?: string;
    /** true：额度不足时扣至 0，返回 shortfall（PAYG）；false：不足则抛错 */
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
      const key = taskConsumptionKey(input.enterpriseId, taskId);
      const prior = store.taskConsumptions[key];
      if (prior) {
        const balance = await summarizeCreditBucketsForCycle(
          input.enterpriseId,
          input.cycleStart,
          storePath,
        );
        return {
          ...balance,
          consumed: prior.amount,
          shortfall: prior.overageCredits ?? Math.max(0, amount - prior.amount),
          deduped: true,
        };
      }
    }

    const buckets = sortForConsume(
      listBucketsForCycle(store, input.enterpriseId, input.cycleStart),
    );
    if (buckets.length === 0 && amount > 0 && !input.allowPartial) {
      throw new Error("no credit buckets for cycle");
    }
    let remaining = amount;
    const now = new Date().toISOString();
    let consumed = 0;
    for (const bucket of buckets) {
      if (remaining <= 0) {
        break;
      }
      const available = bucketRemaining(bucket);
      if (available <= 0) {
        continue;
      }
      const take = Math.min(available, remaining);
      const record = store.buckets[bucket.id];
      if (!record) {
        continue;
      }
      record.creditsConsumed += take;
      record.updatedAt = now;
      remaining -= take;
      consumed += take;
    }
    if (remaining > 0 && !input.allowPartial) {
      throw new Error("insufficient credits in buckets");
    }
    if (taskId) {
      store.taskConsumptions[taskConsumptionKey(input.enterpriseId, taskId)] = {
        amount: consumed,
        creditsRequested: amount,
        overageCredits: remaining,
        overageAmountCents: 0,
        cycleStart: input.cycleStart,
        at: now,
      };
    }
    await saveStore(store, storePath);
    const balance = await summarizeCreditBucketsForCycle(
      input.enterpriseId,
      input.cycleStart,
      storePath,
    );
    return {
      ...balance,
      consumed,
      shortfall: remaining,
      deduped: false,
    };
  });
}

export type PaygReservationResult = {
  includedCredits: number;
  overageCredits: number;
  overageAmountCents: number;
  deduped: boolean;
};

/**
 * 原子预约：在同一把锁内读取剩余额度、拆 included/overage、扣减 included。
 * 解决多 taskId 并发争抢时 included 总和超过余额的 TOCTOU。
 */
export async function reserveAndDebitCreditsForTask(
  input: {
    enterpriseId: string;
    cycleStart: string;
    creditsRequested: number;
    taskId: string;
    overageUnitPriceCents: number;
    /** pay_as_you_go=true 时 shortfall 记入 overage；否则不足抛错 */
    allowOverage: boolean;
  },
  storePath?: string,
): Promise<PaygReservationResult> {
  const requested = Math.max(0, Math.floor(input.creditsRequested));
  const unit = Math.max(0, Math.floor(input.overageUnitPriceCents));
  const taskId = input.taskId.trim();
  if (!taskId) {
    throw new Error("taskId is required for credit reservation");
  }

  return withLock(async () => {
    const store = await loadStore(storePath);
    if (!store.taskConsumptions) {
      store.taskConsumptions = {};
    }
    const key = taskConsumptionKey(input.enterpriseId, taskId);
    const prior = store.taskConsumptions[key];
    if (prior) {
      return {
        includedCredits: prior.amount,
        overageCredits: prior.overageCredits,
        overageAmountCents: prior.overageAmountCents,
        deduped: true,
      };
    }

    const buckets = sortForConsume(
      listBucketsForCycle(store, input.enterpriseId, input.cycleStart),
    );
    let available = 0;
    for (const b of buckets) {
      available += bucketRemaining(b);
    }

    let included = Math.min(available, requested);
    let overage = Math.max(0, requested - included);
    if (!input.allowOverage && overage > 0) {
      throw new Error("insufficient credits in buckets");
    }
    if (!input.allowOverage) {
      included = requested;
      overage = 0;
    }

    const now = new Date().toISOString();
    let left = included;
    for (const bucket of buckets) {
      if (left <= 0) {
        break;
      }
      const take = Math.min(bucketRemaining(bucket), left);
      const record = store.buckets[bucket.id];
      if (!record || take <= 0) {
        continue;
      }
      record.creditsConsumed += take;
      record.updatedAt = now;
      left -= take;
    }
    if (left > 0 && !input.allowOverage) {
      throw new Error("insufficient credits in buckets");
    }
    // 若 allowOverage 下 available 被并发耗尽，included 可能小于预期——以实际扣减为准
    const actualIncluded = included - left;
    const actualOverage = Math.max(0, requested - actualIncluded);

    store.taskConsumptions[key] = {
      amount: actualIncluded,
      creditsRequested: requested,
      overageCredits: actualOverage,
      overageAmountCents: actualOverage * unit,
      cycleStart: input.cycleStart,
      at: now,
    };
    await saveStore(store, storePath);
    return {
      includedCredits: actualIncluded,
      overageCredits: actualOverage,
      overageAmountCents: actualOverage * unit,
      deduped: false,
    };
  });
}

export async function __resetCreditBucketsForTest(storePath?: string): Promise<void> {
  await withLock(async () => {
    await saveStore(createEmptyStore(), storePath);
  });
}
