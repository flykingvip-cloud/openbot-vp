/**
 * 在指定时间点重建订阅/MRR 快照（用于环比趋势）。
 * Phase 5：MRR 使用锁定 PlanVersion + 合同周期标准化，禁止 Plan.basePrice 漂移。
 */

import { resolveContractNormalizedMrr } from "./mrr-contract.js";
import type {
  Plan,
  PlanVersion,
  Subscription,
  SubscriptionEvent,
  SubscriptionStatus,
} from "./types.js";

export type CommercialMetricsSnapshot = {
  activeSubscriptions: number;
  mrrCents: number;
  plans: Record<
    string,
    {
      planId: string;
      activeSubscriptions: number;
      mrrCents: number;
    }
  >;
};

function resolveSubscriptionStatusAt(
  subscription: Subscription,
  events: readonly SubscriptionEvent[],
  asOf: string,
): SubscriptionStatus | null {
  if (subscription.startTime >= asOf) {
    return null;
  }
  const relevant = events
    .filter((event) => event.subscriptionId === subscription.id && event.occurredAt < asOf)
    .toSorted((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  if (relevant.length > 0) {
    return relevant[relevant.length - 1].toStatus;
  }
  if (subscription.startTime < asOf) {
    return "active";
  }
  return null;
}

function isPlanVersionMap(
  value: readonly PlanVersion[] | ReadonlyMap<string, PlanVersion>,
): value is ReadonlyMap<string, PlanVersion> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as ReadonlyMap<string, PlanVersion>).get === "function"
  );
}

function indexPlanVersions(
  planVersions: readonly PlanVersion[] | ReadonlyMap<string, PlanVersion> | undefined,
): Map<string, PlanVersion> {
  const versionById = new Map<string, PlanVersion>();
  if (!planVersions) {
    return versionById;
  }
  // 显式分支循环：不依赖 instanceof Map 收窄 ReadonlyMap
  if (isPlanVersionMap(planVersions)) {
    for (const [id, version] of planVersions.entries()) {
      versionById.set(id, version);
    }
    return versionById;
  }
  for (const version of planVersions) {
    versionById.set(version.id, version);
  }
  return versionById;
}

export function buildCommercialMetricsSnapshot(params: {
  plans: readonly Plan[];
  /** 锁定版本表：缺省时 MRR=0（不回退 live basePrice） */
  planVersions?: readonly PlanVersion[] | ReadonlyMap<string, PlanVersion>;
  subscriptions: readonly Subscription[];
  events: readonly SubscriptionEvent[];
  asOf: string;
}): CommercialMetricsSnapshot {
  const planById = new Map(params.plans.map((plan) => [plan.id, plan]));
  const versionById = indexPlanVersions(params.planVersions);

  const plansOut: CommercialMetricsSnapshot["plans"] = Object.fromEntries(
    params.plans.map((plan) => [plan.id, { planId: plan.id, activeSubscriptions: 0, mrrCents: 0 }]),
  );

  let totalSubs = 0;
  let totalMrr = 0;

  for (const subscription of params.subscriptions) {
    const status = resolveSubscriptionStatusAt(subscription, params.events, params.asOf);
    if (status !== "active") {
      continue;
    }
    const plan = planById.get(subscription.planId);
    if (!plan) {
      continue;
    }
    let entry = plansOut[subscription.planId];
    if (!entry) {
      entry = { planId: subscription.planId, activeSubscriptions: 0, mrrCents: 0 };
      plansOut[subscription.planId] = entry;
    }
    const version = versionById.get(subscription.planVersionId) ?? null;
    const mrr = resolveContractNormalizedMrr({
      subscription,
      planVersion: version,
      plan,
    });
    const mrrCents = mrr.versionLocked ? mrr.mrrCents : 0;
    entry.activeSubscriptions += 1;
    entry.mrrCents += mrrCents;
    totalSubs += 1;
    totalMrr += mrrCents;
  }

  return {
    activeSubscriptions: totalSubs,
    mrrCents: totalMrr,
    plans: plansOut,
  };
}

export function fractionalTrendDelta(current: number, previous: number): number | null {
  if (previous <= 0) {
    return null;
  }
  return (current - previous) / previous;
}
