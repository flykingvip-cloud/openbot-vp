/**
 * 平台套餐商业指标聚合（订阅数 / MRR / 版本锁定数 / 环比 / 活动流）。
 * 供 platform-subscriptions.summary RPC 与运营控制台 UI 使用。
 *
 * Phase 5：MRR = 锁定 PlanVersion 月价按合同周期标准化（effectiveMonthly），禁止 live basePrice。
 */

import { buildCommercialMetricsSnapshot, fractionalTrendDelta } from "./commercial-snapshot.js";
import { resolveContractNormalizedMrr } from "./mrr-contract.js";
import { listPlans, listPlanVersions } from "./plans-store.js";
import {
  buildPlatformPricingActivityFeed,
  type PlatformPricingActivityItem,
} from "./platform-pricing-activity.js";
import { resolveCycleWindow } from "./runtime.js";
import {
  listActiveSubscriptions,
  listAllSubscriptionEvents,
  listAllSubscriptions,
} from "./subscriptions-store.js";
import type { PlanVersion } from "./types.js";

export type PlanVersionCommercialMetrics = {
  lockedSubscriptions: number;
  mrrCents?: number;
};

export type PlanCommercialMetrics = {
  planId: string;
  activeSubscriptions: number;
  mrrCents: number;
  previousActiveSubscriptions?: number;
  previousMrrCents?: number;
  subsTrendDelta?: number;
  mrrTrendDelta?: number | null;
  versions: Record<string, PlanVersionCommercialMetrics>;
};

export type PlatformCommercialSummary = {
  totals: {
    activeSubscriptions: number;
    mrrCents: number;
    previousActiveSubscriptions?: number;
    previousMrrCents?: number;
    subsTrendDelta?: number;
    mrrTrendDelta?: number | null;
  };
  plans: Record<string, PlanCommercialMetrics>;
  recentActivity?: PlatformPricingActivityItem[];
};

export type {
  PlatformPricingActivityItem,
  PlatformPricingActivityKind,
} from "./platform-pricing-activity.js";

export async function buildPlatformCommercialSummary(
  storePath?: string,
): Promise<PlatformCommercialSummary> {
  const [plans, subscriptions, allSubscriptions, events, recentActivity] = await Promise.all([
    listPlans(storePath),
    listActiveSubscriptions(storePath),
    listAllSubscriptions(storePath),
    listAllSubscriptionEvents(storePath),
    buildPlatformPricingActivityFeed({ limit: 20, storePath }),
  ]);

  // 加载全部相关 plan versions（锁定价真源）
  const versionLists = await Promise.all(plans.map((p) => listPlanVersions(p.id, storePath)));
  const allVersions: PlanVersion[] = versionLists.flat();
  const versionById = new Map(allVersions.map((v) => [v.id, v]));
  const planById = new Map(plans.map((plan) => [plan.id, plan]));

  const plansOut: Record<string, PlanCommercialMetrics> = Object.fromEntries(
    plans.map((plan) => [
      plan.id,
      {
        planId: plan.id,
        activeSubscriptions: 0,
        mrrCents: 0,
        versions: {},
      },
    ]),
  );

  let totalSubs = 0;
  let totalMrr = 0;

  for (const sub of subscriptions) {
    const plan = planById.get(sub.planId);
    if (!plan) {
      continue;
    }
    let entry = plansOut[sub.planId];
    if (!entry) {
      entry = {
        planId: sub.planId,
        activeSubscriptions: 0,
        mrrCents: 0,
        versions: {},
      };
      plansOut[sub.planId] = entry;
    }
    const planVersion = versionById.get(sub.planVersionId) ?? null;
    const mrr = resolveContractNormalizedMrr({
      subscription: sub,
      planVersion,
      plan,
    });
    const mrrCents = mrr.versionLocked ? mrr.mrrCents : 0;

    entry.activeSubscriptions += 1;
    entry.mrrCents += mrrCents;
    const versionEntry = entry.versions[sub.planVersionId] ?? {
      lockedSubscriptions: 0,
      mrrCents: 0,
    };
    versionEntry.lockedSubscriptions += 1;
    versionEntry.mrrCents = (versionEntry.mrrCents ?? 0) + mrrCents;
    entry.versions[sub.planVersionId] = versionEntry;
    totalSubs += 1;
    totalMrr += mrrCents;
  }

  const { cycleStart } = resolveCycleWindow();
  const previousSnapshot = buildCommercialMetricsSnapshot({
    plans,
    planVersions: versionById,
    subscriptions: allSubscriptions,
    events,
    asOf: cycleStart,
  });

  for (const [planId, entry] of Object.entries(plansOut)) {
    const previous = previousSnapshot.plans[planId];
    const previousSubs = previous?.activeSubscriptions ?? 0;
    const previousMrr = previous?.mrrCents ?? 0;
    entry.previousActiveSubscriptions = previousSubs;
    entry.previousMrrCents = previousMrr;
    entry.subsTrendDelta = entry.activeSubscriptions - previousSubs;
    entry.mrrTrendDelta = fractionalTrendDelta(entry.mrrCents, previousMrr);
  }

  return {
    totals: {
      activeSubscriptions: totalSubs,
      mrrCents: totalMrr,
      previousActiveSubscriptions: previousSnapshot.activeSubscriptions,
      previousMrrCents: previousSnapshot.mrrCents,
      subsTrendDelta: totalSubs - previousSnapshot.activeSubscriptions,
      mrrTrendDelta: fractionalTrendDelta(totalMrr, previousSnapshot.mrrCents),
    },
    plans: plansOut,
    recentActivity,
  };
}
