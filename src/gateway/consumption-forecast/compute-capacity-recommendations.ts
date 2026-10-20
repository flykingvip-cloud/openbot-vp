/**
 * 加载套餐候选并生成容量建议（IO 层）。
 */

import { getBudget } from "../billing/budgets-store.js";
import { listPlans } from "../billing/plans-store.js";
import { getActiveSubscription } from "../billing/subscriptions-store.js";
import { defaultMaxConcurrentRuns } from "../package-entitlement/normalize-entitlement.js";
import { getPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import {
  buildCapacityRecommendations,
  type PlanUpgradeCandidate,
} from "./capacity-recommendations.js";
import type { CapacityRecommendation, ConsumptionForecast } from "./types.js";

async function loadUpgradeCandidates(): Promise<PlanUpgradeCandidate[]> {
  const plans = await listPlans();
  const activePlans = plans.filter((plan) => plan.status === "active");
  const rows: PlanUpgradeCandidate[] = [];
  for (const plan of activePlans) {
    const snapshot = await getPlanEntitlementSnapshot(plan.currentVersionId);
    const maxBots = snapshot?.maxBots ?? plan.botQuota;
    rows.push({
      planId: plan.id,
      planName: plan.name,
      maxBots,
      maxConcurrentRuns: snapshot?.maxConcurrentRuns ?? defaultMaxConcurrentRuns(maxBots),
      monthlyCredits: snapshot?.monthlyCredits ?? 0,
      monthlyPriceCents: snapshot?.monthlyPriceCents ?? plan.basePriceCents,
    });
  }
  return rows;
}

export async function computeEnterpriseCapacityRecommendations(
  enterpriseId: string,
  forecast: ConsumptionForecast,
): Promise<CapacityRecommendation[]> {
  const subscription = await getActiveSubscription(enterpriseId);
  if (!subscription) {
    return [];
  }
  const plans = await listPlans();
  const currentPlan = plans.find((plan) => plan.id === subscription.planId);
  const budget = await getBudget(enterpriseId);
  const candidates = await loadUpgradeCandidates();
  return buildCapacityRecommendations({
    forecast,
    currentPlanId: subscription.planId,
    currentPlanName: currentPlan?.name ?? subscription.planId,
    upgradeCandidates: candidates,
    monthlyBudgetCents: budget?.monthlyLimitCents ?? 0,
  });
}
