/**
 * Billing 运行时编排（IO 层，组合纯引擎 + store）。
 *
 * 负责把「订阅 + 锁定定价版本 + Seat 区间 + 用量」组装成当前周期的成本结算输入，
 * 调用纯函数 `settleCycle` 产出 estimated/final 结果。供 dashboard / cost-control /
 * resources / settle 复用。
 *
 * 周期窗口：以订阅合同/生效锚点推导（见 billing-period.ts）；不再用「自然月」代替合同账期。
 */

import { aggregateLedgerEconomics } from "../economics/aggregate.js";
import type { EnterpriseBillingMode } from "../package-entitlement/billing-mode.js";
import { getPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { resolveEnterpriseBillingMode } from "../package-entitlement/resolve-billing-mode.js";
import {
  buildSettlementKey,
  deterministicBillId,
  deterministicSnapshotId,
  resolveContainingCycle,
  resolveCreditsResetCycle,
} from "./billing-period.js";
import { countActiveBotsAt } from "./bot-resources-store.js";
import { getBudget } from "./budgets-store.js";
import { checkBudget, daysBetween, predictMonthEndCost, settleCycle } from "./engine.js";
import { buildMeterDefinitions } from "./meter-contract.js";
import { getPlan, getPlanVersion } from "./plans-store.js";
import { listSeatEntitlementProfileIntervals } from "./seat-entitlement-assignments-store.js";
import { countSeatsByRole, listSeatIntervals } from "./seats-store.js";
import { getActiveSubscription } from "./subscriptions-store.js";
import type {
  Bill,
  BudgetCheckLevel,
  CostSnapshot,
  Plan,
  PlanVersion,
  SnapshotType,
  Subscription,
} from "./types.js";
import { listUsageLedgerEntries } from "./usage-ledger-store.js";
import { listUsageRecords } from "./usage-records-store.js";

/**
 * @deprecated 仅用于**无企业订阅上下文**的 legacy 调用。
 * 企业账期必须用 `resolveEnterpriseCycleWindow` / `resolveContainingCycle`。
 */
export function resolveCycleWindow(at: Date = new Date()): {
  cycleStart: string;
  cycleEnd: string;
} {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { cycleStart: start.toISOString(), cycleEnd: end.toISOString() };
}

/**
 * 企业 **消费出账** 进行中窗口（usage_settlement）。
 * 周期长度跟合同/套餐 billingCycle；**不是** Credits 重置周期。
 */
export async function resolveEnterpriseCycleWindow(
  enterpriseId: string,
  now: Date = new Date(),
  storePaths?: Pick<BillingStorePaths, "subscriptions" | "plans">,
): Promise<{ cycleStart: string; cycleEnd: string; source: string; purpose: string }> {
  const subscription = await getActiveSubscription(enterpriseId, storePaths?.subscriptions);
  if (!subscription) {
    const w = resolveCycleWindow(now);
    return { ...w, source: "calendar_month_fallback", purpose: "usage_settlement" };
  }
  const plan = await getPlan(subscription.planId, storePaths?.plans);
  const cycle = resolveContainingCycle(
    subscription,
    now,
    plan?.billingCycle ?? subscription.commercialContract?.billingCycle,
    "usage_settlement",
  );
  return {
    cycleStart: cycle.cycleStart,
    cycleEnd: cycle.cycleEnd,
    source: cycle.source,
    purpose: cycle.purpose,
  };
}

/**
 * 企业 **Credits 额度重置** 窗口（始终 monthly）。
 * 可选传入已锁定的 subscription（延迟上报/升级后必须用锁定订阅，禁止 active）。
 */
export async function resolveEnterpriseCreditsResetWindow(
  enterpriseId: string,
  now: Date = new Date(),
  storePaths?: Pick<BillingStorePaths, "subscriptions">,
  lockedSubscription?: Parameters<typeof resolveCreditsResetCycle>[0] | null,
): Promise<{ cycleStart: string; cycleEnd: string; source: string; purpose: "credits_reset" }> {
  const subscription =
    lockedSubscription ?? (await getActiveSubscription(enterpriseId, storePaths?.subscriptions));
  if (!subscription) {
    const w = resolveCycleWindow(now);
    return { ...w, source: "calendar_month_fallback", purpose: "credits_reset" };
  }
  const cycle = resolveCreditsResetCycle(subscription, now);
  return {
    cycleStart: cycle.cycleStart,
    cycleEnd: cycle.cycleEnd,
    source: cycle.source,
    purpose: "credits_reset",
  };
}

export type CycleCostResult = {
  subscription: Subscription;
  plan: Plan | null;
  version: PlanVersion;
  bill: Bill;
  snapshot: CostSnapshot;
  cycleStart: string;
  cycleEnd: string;
  settlementKey: string;
};

/**
 * 计算某企业当前合同账期成本（确定性投影）。无生效订阅 → null。
 * snapshotType 由调用方指定（dashboard=estimated，settle=final）。
 * 注意：本函数不执行 final 落账；正式结算请用 `settleEnterpriseCycle`。
 */
export async function computeCurrentCycleCost(
  enterpriseId: string,
  snapshotType: SnapshotType,
  now: Date = new Date(),
  storePaths?: BillingStorePaths,
): Promise<CycleCostResult | null> {
  const subscription = await getActiveSubscription(enterpriseId, storePaths?.subscriptions);
  if (!subscription) {
    return null;
  }
  // 版本锁定计费（Property 16）：使用订阅锁定的 planVersionId，而非当前 active 版本。
  const version = await getPlanVersion(subscription.planVersionId, storePaths?.plans);
  if (!version) {
    return null;
  }
  const plan = await getPlan(subscription.planId, storePaths?.plans);
  const cycle = resolveContainingCycle(
    subscription,
    now,
    plan?.billingCycle ?? subscription.commercialContract?.billingCycle,
  );
  const { cycleStart, cycleEnd } = cycle;
  const settlementKey = buildSettlementKey({
    enterpriseId,
    subscriptionId: subscription.id,
    planVersionId: subscription.planVersionId,
    cycleStart,
    cycleEnd,
  });
  const intervals = await listSeatIntervals(enterpriseId, storePaths?.seats);
  const usage = await listUsageRecords(
    enterpriseId,
    { startTime: cycleStart, endTime: cycleEnd },
    storePaths?.usage,
  );
  const seatCountByRole = await countSeatsByRole(enterpriseId, storePaths?.seats);
  const botCount = await countActiveBotsAt(enterpriseId, cycleEnd, storePaths?.resources);
  const entitlement = await getPlanEntitlementSnapshot(
    subscription.planVersionId,
    storePaths?.entitlementSnapshot,
  );
  const aiProfileIntervals = await listSeatEntitlementProfileIntervals(
    enterpriseId,
    storePaths?.seatEntitlementAssignments,
  );
  const meters = buildMeterDefinitions({
    version,
    entitlement,
    usageKeys: [...new Set(usage.map((u) => u.key))],
  });
  const result = settleCycle({
    enterpriseId,
    version,
    planVersionId: subscription.planVersionId,
    cycleStart,
    cycleEnd,
    date: now.toISOString().slice(0, 10),
    intervals,
    usage,
    meters,
    seatCountByRole,
    botCount,
    aiProfileIntervals,
    aiProfileQuota: entitlement?.aiProfileQuota,
    snapshotType,
    generatedAt: now.toISOString(),
    billId: deterministicBillId(settlementKey),
    snapshotId: deterministicSnapshotId(settlementKey, snapshotType),
    settlementKey,
  });
  const bill: Bill = {
    ...result.bill,
    subscriptionId: subscription.id,
    settlementKey,
    status: snapshotType === "final" ? "finalized" : "estimated",
  };
  return {
    subscription,
    plan,
    version,
    bill,
    snapshot: result.snapshot,
    cycleStart,
    cycleEnd,
    settlementKey,
  };
}

export type BudgetStatusResult = {
  level: BudgetCheckLevel;
  monthlyLimitCents: number;
  alertThreshold: number;
  accruedCents: number;
  predictedCents: number | null;
  billingMode: EnterpriseBillingMode;
};

/** 计算当前周期预算状态 + 预计周期末费用。无订阅则按 0 成本计算。 */
export async function computeBudgetStatus(
  enterpriseId: string,
  now: Date = new Date(),
  storePaths?: BillingStorePaths,
): Promise<BudgetStatusResult> {
  const budget = await getBudget(enterpriseId, storePaths?.budgets);
  const monthlyLimitCents = budget?.monthlyLimitCents ?? 0;
  const alertThreshold = budget?.alertThreshold ?? 0.8;
  const billingMode = await resolveEnterpriseBillingMode(enterpriseId, {
    subscriptions: storePaths?.subscriptions,
    entitlementSnapshot: storePaths?.entitlementSnapshot,
  });
  const cost = await computeCurrentCycleCost(enterpriseId, "estimated", now, storePaths);
  let accruedCents = cost?.bill.totalCostCents ?? 0;
  const cycleStart = cost?.cycleStart ?? resolveCycleWindow(now).cycleStart;
  const cycleEnd = cost?.cycleEnd ?? resolveCycleWindow(now).cycleEnd;
  if (billingMode === "enterprise_budget") {
    const entries = await listUsageLedgerEntries(
      enterpriseId,
      { startTime: cycleStart, endTime: cycleEnd },
      storePaths?.ledger,
    );
    accruedCents = aggregateLedgerEconomics(entries).providerCostCents;
  }
  const { level } = checkBudget({
    totalCostCents: accruedCents,
    monthlyLimitCents,
    alertThreshold,
  });
  const totalDays = daysBetween(cycleStart, cycleEnd);
  const elapsedDays = Math.max(
    0,
    Math.floor((now.getTime() - new Date(cycleStart).getTime()) / 86_400_000),
  );
  const prediction = predictMonthEndCost({ accruedCents, elapsedDays, totalDays });
  const predictedCents = "predictedCents" in prediction ? prediction.predictedCents : null;
  return { level, monthlyLimitCents, alertThreshold, accruedCents, predictedCents, billingMode };
}

/** 可注入的 store 路径（测试用）。 */
export type BillingStorePaths = {
  plans?: string;
  subscriptions?: string;
  seats?: string;
  budgets?: string;
  usage?: string;
  resources?: string;
  ledger?: string;
  entitlementSnapshot?: string;
  seatEntitlementAssignments?: string;
  usageLedger?: string;
};
