/**
 * 平台 Economics — 套餐推荐健康度（毛利 × Forecast 风险 × 画像）。
 */

import {
  evaluateMarginHealth,
  type MarginHealth,
} from "../../../../../../src/gateway/billing/package-margin.js";
import type { Plan } from "../../../capability/cost-budget-billing/index.ts";
import type { EconomicsOverviewResponse } from "../../../capability/cost-economics/index.ts";
import type { PlatformConsumptionForecastOverview } from "../../../capability/cost-economics/index.ts";
import type { PlatformPlanBundleVersionRow } from "../../../capability/platform-plan-bundle/index.ts";
import type { PlatformCommercialSummary } from "../../../capability/platform-subscriptions/index.ts";
import type { RoutingPolicy } from "../../../capability/policy-engine/index.ts";
import { buildPlanUnitEconomics } from "./unit-economics.ts";

export type PlanRecommendationHealthRow = {
  planId: string;
  planName: string;
  targetPersonas: string[];
  targetMarginRate: number | null;
  guardMarginRate: number | null;
  actualMarginRate: number | null;
  projectedMarginRate: number | null;
  marginHealth: MarginHealth;
  atRiskEnterpriseCount: number;
  upgradeAlertCount: number;
};

function resolveSelectorStrategy(
  policyId: string | null | undefined,
  catalogPolicies: readonly RoutingPolicy[],
): string {
  if (!policyId) {
    return "balanced";
  }
  return catalogPolicies.find((entry) => entry.id === policyId)?.selectorStrategy ?? "balanced";
}

export function buildPlanRecommendationHealthRows(params: {
  plans: readonly Plan[];
  economics: EconomicsOverviewResponse | null;
  forecastOverview: PlatformConsumptionForecastOverview | null;
  commercialSummary: PlatformCommercialSummary | null;
  versionMetaById: Record<string, PlatformPlanBundleVersionRow | undefined>;
  catalogPolicies: readonly RoutingPolicy[];
}): PlanRecommendationHealthRow[] {
  const atRiskByPlan = new Map<string, number>();
  const upgradeAlertsByPlan = new Map<string, number>();
  for (const row of params.forecastOverview?.atRiskEnterprises ?? []) {
    if (!row.planId) {
      continue;
    }
    atRiskByPlan.set(row.planId, (atRiskByPlan.get(row.planId) ?? 0) + 1);
    if (
      row.alerts.includes("credits") ||
      row.alerts.includes("concurrency") ||
      row.alerts.includes("bots")
    ) {
      upgradeAlertsByPlan.set(row.planId, (upgradeAlertsByPlan.get(row.planId) ?? 0) + 1);
    }
  }

  return params.plans
    .filter((plan) => plan.status === "active")
    .map((plan) => {
      const meta = params.versionMetaById[plan.currentVersionId];
      const allowedTiers =
        meta?.binding?.allowedTiers ?? meta?.entitlementSnapshot?.allowedTiers ?? [];
      const monthlyCredits = meta?.entitlementSnapshot?.monthlyCredits ?? null;
      const policyId = meta?.binding?.policyId ?? null;
      const planActual = params.economics?.byPlan?.[plan.id];
      const unit = buildPlanUnitEconomics({
        planId: plan.id,
        basePriceCents: plan.basePriceCents,
        monthlyCredits,
        allowedTiers,
        selectorStrategy: resolveSelectorStrategy(policyId, params.catalogPolicies),
        commercial: params.commercialSummary,
        planActual,
        platformSummary: params.economics?.summary,
        economicsOverview: params.economics,
      });
      const actualMarginRate =
        unit.cohortMarginRate ??
        (planActual && planActual.tenantRevenueCents > 0
          ? planActual.marginCents / planActual.tenantRevenueCents
          : null);
      const projectedMarginRate = unit.preferredProjectedMarginRate;
      const marginHealth = evaluateMarginHealth({
        actualMarginRate: actualMarginRate ?? projectedMarginRate,
        targetMarginRate: plan.targetMarginRate,
        guardMarginRate: plan.guardMarginRate,
      }).health;

      return {
        planId: plan.id,
        planName: plan.name,
        targetPersonas: plan.matchingProfile?.targetPersonas ?? [],
        targetMarginRate: plan.targetMarginRate ?? null,
        guardMarginRate: plan.guardMarginRate ?? null,
        actualMarginRate,
        projectedMarginRate,
        marginHealth,
        atRiskEnterpriseCount: atRiskByPlan.get(plan.id) ?? 0,
        upgradeAlertCount: upgradeAlertsByPlan.get(plan.id) ?? 0,
      };
    })
    .toSorted(
      (a, b) =>
        b.atRiskEnterpriseCount - a.atRiskEnterpriseCount || a.planName.localeCompare(b.planName),
    );
}

export function marginHealthLabelKey(health: MarginHealth): string {
  switch (health) {
    case "healthy":
      return "platformEconomics.recHealthHealthy";
    case "warning":
      return "platformEconomics.recHealthWarning";
    case "critical":
      return "platformEconomics.recHealthCritical";
    default:
      return "platformEconomics.recHealthUnknown";
  }
}
