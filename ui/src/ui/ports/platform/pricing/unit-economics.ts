import type {
  EconomicsOverviewResponse,
  EconomicsSummary,
} from "../../../capability/cost-economics/index.ts";
import type { PlatformCommercialSummary } from "../../../capability/platform-subscriptions/index.ts";
import { marginRateFromCost, projectFullQuotaCostFromContext } from "./cost-version-projection.ts";

export type PlanUnitEconomics = {
  subscriptionRevenueCents: number;
  monthlyCredits: number | null;
  activeSubscriptions: number;
  mrrCents: number;
  actualProviderCostCents: number | null;
  actualCreditsUsed: number | null;
  cohortMarginCents: number | null;
  cohortMarginRate: number | null;
  projectedFullQuotaCostCents: number | null;
  projectedSubscriptionMarginCents: number | null;
  projectedMarginRate: number | null;
  projectionSource: "plan" | "platform" | "none";
  costVersionFullQuotaCostCents: number | null;
  costVersionMarginRate: number | null;
  preferredProjectedMarginRate: number | null;
  preferredProjectionLabel: "cost_version" | "heuristic" | "none";
};

function resolveCostPerCreditCents(
  planActual: EconomicsSummary | undefined,
  platformSummary: EconomicsSummary | undefined,
): { costPerCredit: number | null; source: PlanUnitEconomics["projectionSource"] } {
  if (planActual && planActual.creditsCharged > 0) {
    return {
      costPerCredit: planActual.providerCostCents / planActual.creditsCharged,
      source: "plan",
    };
  }
  if (platformSummary && platformSummary.creditsCharged > 0) {
    return {
      costPerCredit: platformSummary.providerCostCents / platformSummary.creditsCharged,
      source: "platform",
    };
  }
  return { costPerCredit: null, source: "none" };
}

function marginRate(marginCents: number, revenueCents: number): number | null {
  if (revenueCents <= 0) {
    return null;
  }
  return marginCents / revenueCents;
}

export function buildPlanUnitEconomics(params: {
  planId: string;
  basePriceCents: number;
  monthlyCredits: number | null;
  allowedTiers?: readonly string[];
  selectorStrategy?: string;
  commercial: PlatformCommercialSummary | null;
  planActual: EconomicsSummary | undefined;
  platformSummary: EconomicsSummary | undefined;
  economicsOverview?: EconomicsOverviewResponse | null;
}): PlanUnitEconomics {
  const commercial = params.commercial?.plans[params.planId];
  const activeSubscriptions = commercial?.activeSubscriptions ?? 0;
  const mrrCents = commercial?.mrrCents ?? 0;
  const actualProviderCostCents =
    params.planActual && params.planActual.providerCostCents > 0
      ? params.planActual.providerCostCents
      : null;
  const actualCreditsUsed =
    params.planActual && params.planActual.creditsCharged > 0
      ? params.planActual.creditsCharged
      : null;
  const cohortMarginCents =
    mrrCents > 0 && actualProviderCostCents !== null ? mrrCents - actualProviderCostCents : null;
  const cohortMarginRate =
    cohortMarginCents !== null ? marginRate(cohortMarginCents, mrrCents) : null;

  const { costPerCredit, source } = resolveCostPerCreditCents(
    params.planActual,
    params.platformSummary,
  );
  let projectedFullQuotaCostCents: number | null = null;
  let projectedSubscriptionMarginCents: number | null = null;
  let projectedMarginRate: number | null = null;

  if (params.monthlyCredits !== null && params.monthlyCredits > 0 && costPerCredit !== null) {
    projectedFullQuotaCostCents = Math.round(params.monthlyCredits * costPerCredit);
    projectedSubscriptionMarginCents = params.basePriceCents - projectedFullQuotaCostCents;
    projectedMarginRate = marginRate(projectedSubscriptionMarginCents, params.basePriceCents);
  }

  const costVersionFullQuotaCostCents = projectFullQuotaCostFromContext({
    monthlyCredits: params.monthlyCredits,
    allowedTiers: params.allowedTiers ?? [],
    selectorStrategy: params.selectorStrategy ?? "balanced",
    projectionContext: params.economicsOverview?.projectionContext,
  });
  const costVersionMarginRate = marginRateFromCost(
    params.basePriceCents,
    costVersionFullQuotaCostCents,
  );
  const preferredProjectedMarginRate = costVersionMarginRate ?? projectedMarginRate;
  const preferredProjectionLabel: PlanUnitEconomics["preferredProjectionLabel"] =
    costVersionMarginRate !== null
      ? "cost_version"
      : projectedMarginRate !== null
        ? "heuristic"
        : "none";

  return {
    subscriptionRevenueCents: params.basePriceCents,
    monthlyCredits: params.monthlyCredits,
    activeSubscriptions,
    mrrCents,
    actualProviderCostCents,
    actualCreditsUsed,
    cohortMarginCents,
    cohortMarginRate,
    projectedFullQuotaCostCents,
    projectedSubscriptionMarginCents,
    projectedMarginRate,
    projectionSource: source,
    costVersionFullQuotaCostCents,
    costVersionMarginRate,
    preferredProjectedMarginRate,
    preferredProjectionLabel,
  };
}

export function projectedMarginRateForCredits(params: {
  basePriceCents: number;
  monthlyCredits: number | null;
  allowedTiers?: readonly string[];
  selectorStrategy?: string;
  planActual: EconomicsSummary | undefined;
  platformSummary: EconomicsSummary | undefined;
  economicsOverview?: EconomicsOverviewResponse | null;
}): number | null {
  return buildPlanUnitEconomics({
    planId: "",
    basePriceCents: params.basePriceCents,
    monthlyCredits: params.monthlyCredits,
    allowedTiers: params.allowedTiers,
    selectorStrategy: params.selectorStrategy,
    commercial: null,
    planActual: params.planActual,
    platformSummary: params.platformSummary,
    economicsOverview: params.economicsOverview,
  }).preferredProjectedMarginRate;
}

export function formatMarginRate(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) {
    return "—";
  }
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatMarginRateDelta(delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) {
    return "—";
  }
  const pct = delta * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function computeActivationMarginDelta(params: {
  basePriceCents: number;
  activeMonthlyCredits: number | null;
  draftMonthlyCredits: number | null;
  activeAllowedTiers?: readonly string[];
  draftAllowedTiers?: readonly string[];
  activeSelectorStrategy?: string;
  draftSelectorStrategy?: string;
  planActual: EconomicsSummary | undefined;
  platformSummary: EconomicsSummary | undefined;
  economicsOverview?: EconomicsOverviewResponse | null;
}): number | null {
  const activeRate = projectedMarginRateForCredits({
    basePriceCents: params.basePriceCents,
    monthlyCredits: params.activeMonthlyCredits,
    allowedTiers: params.activeAllowedTiers,
    selectorStrategy: params.activeSelectorStrategy,
    planActual: params.planActual,
    platformSummary: params.platformSummary,
    economicsOverview: params.economicsOverview,
  });
  const draftRate = projectedMarginRateForCredits({
    basePriceCents: params.basePriceCents,
    monthlyCredits: params.draftMonthlyCredits,
    allowedTiers: params.draftAllowedTiers,
    selectorStrategy: params.draftSelectorStrategy,
    planActual: params.planActual,
    platformSummary: params.platformSummary,
    economicsOverview: params.economicsOverview,
  });
  if (activeRate === null || draftRate === null) {
    return null;
  }
  return draftRate - activeRate;
}
