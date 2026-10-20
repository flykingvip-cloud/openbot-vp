/**
 * 企业订阅 store（按 enterpriseId 隔离）。
 *
 * - Subscription 头记录可 upsert（状态/pendingChange 演进）；
 * - 状态变更追加 `SubscriptionEvent`（append-only 历史，R4.7 / R11.2）。
 *
 * 落盘：`CONFIG_DIR/openbot-billing-subscriptions.json`。
 * 所有查询/写入首参为 `enterpriseId`（纵深防御，无「无租户查询」）。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { appendLedgerRecord } from "./append-only-ledger.js";
import type { Subscription, SubscriptionEvent, SubscriptionStatus } from "./types.js";

const SUBSCRIPTIONS_STORE_VERSION = 1;

type SubscriptionsStore = {
  version: number;
  subscriptions: Record<string, Subscription>;
  events: SubscriptionEvent[]; // append-only
};

function createEmptyStore(): SubscriptionsStore {
  return { version: SUBSCRIPTIONS_STORE_VERSION, subscriptions: {}, events: [] };
}

export function resolveDefaultSubscriptionsStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-billing-subscriptions.json");
}

const withLock = createAsyncLock();

function tenant(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

async function loadStore(storePath?: string): Promise<SubscriptionsStore> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultSubscriptionsStorePath());
  const parsed = await readJsonFile<Partial<SubscriptionsStore>>(resolvedPath);
  if (!parsed) {
    return createEmptyStore();
  }
  return {
    version: SUBSCRIPTIONS_STORE_VERSION,
    subscriptions: parsed.subscriptions ?? {},
    events: Array.isArray(parsed.events) ? parsed.events : [],
  };
}

async function saveStore(store: SubscriptionsStore, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultSubscriptionsStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

/** 取某企业待支付订阅（status=pending_payment），无则 null。 */
export async function getPendingPaymentSubscription(
  enterpriseId: string,
  storePath?: string,
): Promise<Subscription | null> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  return (
    Object.values(store.subscriptions).find(
      (s) => s.enterpriseId === t && s.status === "pending_payment",
    ) ?? null
  );
}

/** 取某企业当前生效订阅（status=active），无则 null。 */
export async function getActiveSubscription(
  enterpriseId: string,
  storePath?: string,
): Promise<Subscription | null> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  return (
    Object.values(store.subscriptions).find((s) => s.enterpriseId === t && s.status === "active") ??
    null
  );
}

/** final 结算可纳入的订阅状态：含 expired/canceled 等历史订阅上的未结周期。 */
const SETTLEABLE_SUBSCRIPTION_STATUSES = new Set<SubscriptionStatus>([
  "active",
  "suspended",
  "expired",
  "canceled",
]);

/**
 * 列举企业可结算订阅（active + 历史 expired/canceled/suspended）。
 * 按 startTime、id 升序，便于「先旧后新」补结。
 */
export async function listEnterpriseSettleableSubscriptions(
  enterpriseId: string,
  storePath?: string,
): Promise<Subscription[]> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  return Object.values(store.subscriptions)
    .filter((s) => s.enterpriseId === t && SETTLEABLE_SUBSCRIPTION_STATUSES.has(s.status))
    .toSorted((a, b) => {
      const byStart = a.startTime.localeCompare(b.startTime);
      if (byStart !== 0) {
        return byStart;
      }
      return a.id.localeCompare(b.id);
    });
}

/**
 * 只读列举「有 active 订阅」的企业 tenantId（去重）。
 * 供 model-entitlement doctor 做 per-tenant 缺失核查（不修改任何状态）。
 */
export async function listActiveSubscriptionTenantIds(storePath?: string): Promise<string[]> {
  const store = await loadStore(storePath);
  const ids = new Set<string>();
  for (const sub of Object.values(store.subscriptions)) {
    if (sub.status === "active" && sub.enterpriseId) {
      ids.add(sub.enterpriseId);
    }
  }
  return [...ids];
}

/** 列举所有 active 订阅（平台聚合只读）。 */
export async function listActiveSubscriptions(storePath?: string): Promise<Subscription[]> {
  const store = await loadStore(storePath);
  return Object.values(store.subscriptions).filter(
    (sub) => sub.status === "active" && sub.enterpriseId,
  );
}

/** 列举某套餐下所有 active 订阅。 */
export async function listActiveSubscriptionsForPlan(
  planId: string,
  storePath?: string,
): Promise<Subscription[]> {
  const store = await loadStore(storePath);
  const id = planId.trim();
  if (!id) {
    return [];
  }
  return Object.values(store.subscriptions).filter(
    (sub) => sub.status === "active" && sub.planId === id && sub.enterpriseId,
  );
}

/** 列举全部订阅（平台历史快照 / 环比只读）。 */
export async function listAllSubscriptions(storePath?: string): Promise<Subscription[]> {
  const store = await loadStore(storePath);
  return Object.values(store.subscriptions).filter((sub) => sub.enterpriseId);
}

/** 列举全部订阅事件（平台活动流 / 环比只读，按时间降序）。 */
export async function listAllSubscriptionEvents(storePath?: string): Promise<SubscriptionEvent[]> {
  const store = await loadStore(storePath);
  return store.events.toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

export async function getSubscription(
  enterpriseId: string,
  subscriptionId: string,
  storePath?: string,
): Promise<Subscription | null> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  const sub = store.subscriptions[subscriptionId];
  return sub && sub.enterpriseId === t ? sub : null;
}

export type CreateSubscriptionInput = {
  enterpriseId: string;
  planId: string;
  planVersionId: string;
  startTime?: string;
  resolvedFromPlanId?: boolean;
  /** 默认 active；商业订单创建时可置 pending_payment。 */
  initialStatus?: SubscriptionStatus;
};

/** 创建订阅。调用方需先校验无重复生效/待支付订阅。 */
export async function createSubscription(
  input: CreateSubscriptionInput,
  storePath?: string,
): Promise<Subscription> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(input.enterpriseId);
    const now = new Date().toISOString();
    const status = input.initialStatus ?? "active";
    const subscription: Subscription = {
      id: `sub-${randomUUID()}`,
      enterpriseId: t,
      planId: input.planId,
      planVersionId: input.planVersionId,
      startTime: input.startTime ?? now,
      endTime: null,
      status,
      ...(input.resolvedFromPlanId ? { resolvedFromPlanId: true } : {}),
      createdAt: now,
    };
    store.subscriptions[subscription.id] = subscription;
    store.events = appendLedgerRecord(store.events, {
      id: `subev-${randomUUID()}`,
      enterpriseId: t,
      subscriptionId: subscription.id,
      fromStatus: null,
      toStatus: status,
      planVersionId: input.planVersionId,
      occurredAt: now,
    });
    await saveStore(store, storePath);
    return subscription;
  });
}

/** 变更订阅状态，追加状态历史事件。 */
export async function transitionSubscriptionStatus(
  enterpriseId: string,
  subscriptionId: string,
  toStatus: SubscriptionStatus,
  storePath?: string,
): Promise<Subscription | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(enterpriseId);
    const existing = store.subscriptions[subscriptionId];
    if (!existing || existing.enterpriseId !== t) {
      return null;
    }
    const now = new Date().toISOString();
    const updated: Subscription = {
      ...existing,
      status: toStatus,
      endTime: toStatus === "canceled" || toStatus === "expired" ? now : existing.endTime,
    };
    store.subscriptions[subscriptionId] = updated;
    store.events = appendLedgerRecord(store.events, {
      id: `subev-${randomUUID()}`,
      enterpriseId: t,
      subscriptionId,
      fromStatus: existing.status,
      toStatus,
      planVersionId: existing.planVersionId,
      occurredAt: now,
    });
    await saveStore(store, storePath);
    return updated;
  });
}

/** 设置/清除待生效套餐变更（下一周期生效，R17.4）。 */
export async function setPendingChange(
  enterpriseId: string,
  subscriptionId: string,
  pendingChange: Subscription["pendingChange"] | null,
  storePath?: string,
): Promise<Subscription | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(enterpriseId);
    const existing = store.subscriptions[subscriptionId];
    if (!existing || existing.enterpriseId !== t) {
      return null;
    }
    const updated: Subscription = { ...existing };
    if (pendingChange) {
      updated.pendingChange = pendingChange;
    } else {
      delete updated.pendingChange;
    }
    store.subscriptions[subscriptionId] = updated;
    await saveStore(store, storePath);
    return updated;
  });
}

export async function listSubscriptionEvents(
  enterpriseId: string,
  storePath?: string,
): Promise<SubscriptionEvent[]> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  return store.events
    .filter((e) => e.enterpriseId === t)
    .toSorted((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

/** 写入/更新预付合同周期（订阅 commerce 履约后调用）。 */
export async function setSubscriptionCommercialContract(
  enterpriseId: string,
  subscriptionId: string,
  commercialContract: Subscription["commercialContract"],
  storePath?: string,
): Promise<Subscription | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(enterpriseId);
    const existing = store.subscriptions[subscriptionId];
    if (!existing || existing.enterpriseId !== t) {
      return null;
    }
    const updated: Subscription = {
      ...existing,
      ...(commercialContract ? { commercialContract } : {}),
    };
    store.subscriptions[subscriptionId] = updated;
    await saveStore(store, storePath);
    return updated;
  });
}

/**
 * 平台激活同套餐新版本后，自动把现有 active 订阅切到新的 planVersionId。
 *
 * 说明：
 * - 这是“同套餐下版本切换”的自动迁移，不改变 `planId`
 * - 保留同一 subscription id，避免企业侧出现显式手动迁移动作
 * - 记录一条 active -> active 的订阅事件，作为版本漂移的审计线索
 */
export async function migrateActiveSubscriptionsToPlanVersion(
  params: {
    planId: string;
    targetPlanVersionId: string;
  },
  storePath?: string,
): Promise<Subscription[]> {
  const planId = params.planId.trim();
  const targetPlanVersionId = params.targetPlanVersionId.trim();
  if (!planId || !targetPlanVersionId) {
    return [];
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const now = new Date().toISOString();
    const migrated: Subscription[] = [];
    for (const sub of Object.values(store.subscriptions)) {
      if (
        sub.status !== "active" ||
        sub.planId !== planId ||
        sub.planVersionId === targetPlanVersionId
      ) {
        continue;
      }
      const updated: Subscription = {
        ...sub,
        planVersionId: targetPlanVersionId,
        migratedBinding: true,
      };
      store.subscriptions[sub.id] = updated;
      store.events = appendLedgerRecord(store.events, {
        id: `subev-${randomUUID()}`,
        enterpriseId: updated.enterpriseId,
        subscriptionId: updated.id,
        fromStatus: "active",
        toStatus: "active",
        planVersionId: targetPlanVersionId,
        occurredAt: now,
      });
      migrated.push(updated);
    }
    if (migrated.length > 0) {
      await saveStore(store, storePath);
    }
    return migrated;
  });
}

/**
 * 平台级引用检查：是否存在任一订阅锁定（或待生效变更指向）该 planVersionId。
 * 仅返回布尔，不泄露订阅/租户信息。用于删除版本前的安全守卫——被引用版本删除
 * 会破坏该订阅的历史账单复算。
 */
export async function isPlanVersionReferenced(
  planVersionId: string,
  storePath?: string,
): Promise<boolean> {
  const store = await loadStore(storePath);
  return Object.values(store.subscriptions).some(
    (s) =>
      s.planVersionId === planVersionId || s.pendingChange?.targetPlanVersionId === planVersionId,
  );
}

/**
 * 列举锁定到指定 planVersionId 的「有 active 订阅」企业 tenantId（去重）。
 * 供 model-entitlement 在平台修改 planVersion→模型绑定后，刷新存量订阅企业的 entitlement。
 */
export async function listActiveTenantIdsForPlanVersion(
  planVersionId: string,
  storePath?: string,
): Promise<string[]> {
  const id = planVersionId.trim();
  if (!id) {
    return [];
  }
  const store = await loadStore(storePath);
  const ids = new Set<string>();
  for (const sub of Object.values(store.subscriptions)) {
    if (sub.status === "active" && sub.planVersionId === id && sub.enterpriseId) {
      ids.add(sub.enterpriseId);
    }
  }
  return [...ids];
}

export async function __resetSubscriptionsForTest(storePath?: string): Promise<void> {
  await withLock(async () => {
    await saveStore(createEmptyStore(), storePath);
  });
}
