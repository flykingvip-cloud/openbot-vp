import type { Plan } from "../../../capability/cost-budget-billing/index.ts";
import type {
  EconomicsProjectionContext,
  EconomicsSummary,
} from "../../../capability/cost-economics/index.ts";
import type { PlatformCommercialSummary } from "../../../capability/platform-subscriptions/index.ts";
import type { RoutingPolicy } from "../../../capability/policy-engine/index.ts";
import type { CreditWeight } from "../../../capability/resource-catalog/index.ts";
import {
  marginRateFromCost,
  projectFullQuotaCostFromContext,
  resolveTierMixForPlan,
} from "./cost-version-projection.ts";
import { formatMarginRate } from "./unit-economics.ts";

export type ResourceCatalogSectionOptions = {
  plans?: Plan[];
  catalogPolicies?: RoutingPolicy[];
  economicsProjectionContext?: EconomicsProjectionContext | null;
  economicsSummary?: EconomicsSummary | null;
  commercialSummary?: PlatformCommercialSummary | null;
  onOpenTier?: (tierId: string, focus?: "modelPool") => void;
  versionMetaById?: Record<
    string,
    {
      entitlementSnapshot?: {
        monthlyCredits?: number | null;
        allowedTiers?: string[];
        maxBots?: number;
        maxConcurrentRuns?: number;
        allowedPolicies?: string[];
        overagePolicy?: { type: string; allowBurstConcurrency: boolean };
      };
      binding?: {
        allowedTiers?: string[];
        policyId?: string | null;
        allowedPolicies?: string[];
      };
    }
  >;
};

export type PlanMarginPreviewRow = {
  planId: string;
  planName: string;
  monthlyCredits: number | null;
  savedMarginLabel: string;
  draftMarginLabel: string;
  savedTasksLabel: string;
  draftTasksLabel: string;
  marginChanged: boolean;
};

const EXAMPLE_QUOTA_CREDITS = 10_000;

function resolvePlanEntitlement(
  plan: Plan,
  versionMetaById: ResourceCatalogSectionOptions["versionMetaById"],
): {
  monthlyCredits: number | null;
  allowedTiers: string[];
  policyId: string;
} {
  const meta = versionMetaById?.[plan.currentVersionId];
  const monthlyCredits = meta?.entitlementSnapshot?.monthlyCredits ?? null;
  const allowedTiers = meta?.binding?.allowedTiers ?? meta?.entitlementSnapshot?.allowedTiers ?? [];
  const policyId = meta?.binding?.policyId ?? "balanced";
  return { monthlyCredits, allowedTiers, policyId };
}

function resolveSelectorStrategy(
  policyId: string,
  catalogPolicies: RoutingPolicy[] | undefined,
): string {
  return catalogPolicies?.find((policy) => policy.id === policyId)?.selectorStrategy ?? "balanced";
}

export function rebuildProjectionContextWithCreditWeights(
  base: EconomicsProjectionContext,
  creditWeights: CreditWeight[],
): EconomicsProjectionContext {
  const byTier = new Map(creditWeights.map((weight) => [weight.tier, weight.creditCost]));
  const tierCosts = Object.fromEntries(
    Object.entries(base.tierCosts).map(([tier, row]) => {
      const creditCost = byTier.get(tier) ?? row.creditCost;
      return [
        tier,
        {
          ...row,
          creditCost,
          providerCostPerCreditCents:
            creditCost > 0 ? row.providerCostPerTaskCents / creditCost : null,
        },
      ];
    }),
  );
  return {
    ...base,
    creditWeights: creditWeights.map((weight) => ({
      tier: weight.tier,
      creditCost: weight.creditCost,
    })),
    tierCosts,
  };
}

function averageCreditCostPerTask(params: {
  monthlyCredits: number;
  allowedTiers: readonly string[];
  selectorStrategy: string;
  projectionContext: EconomicsProjectionContext;
}): number | null {
  if (params.monthlyCredits <= 0 || params.allowedTiers.length === 0) {
    return null;
  }
  const tierMix = resolveTierMixForPlan({
    allowedTiers: params.allowedTiers,
    selectorStrategy: params.selectorStrategy,
    projectionContext: params.projectionContext,
  });
  let blended = 0;
  let weightSum = 0;
  for (const [tier, weight] of Object.entries(tierMix)) {
    const creditCost = params.projectionContext.tierCosts[tier]?.creditCost;
    if (creditCost && creditCost > 0) {
      blended += weight * creditCost;
      weightSum += weight;
    }
  }
  if (weightSum <= 0) {
    return null;
  }
  return blended / weightSum;
}

function tasksAtQuota(params: {
  monthlyCredits: number;
  allowedTiers: readonly string[];
  selectorStrategy: string;
  projectionContext: EconomicsProjectionContext;
}): number | null {
  const avgCredit = averageCreditCostPerTask(params);
  if (avgCredit === null || avgCredit <= 0) {
    return null;
  }
  return Math.floor(params.monthlyCredits / avgCredit);
}

export function buildPlanMarginPreviews(params: {
  plans: Plan[];
  savedWeights: CreditWeight[];
  draftWeights: CreditWeight[];
  options: ResourceCatalogSectionOptions;
}): PlanMarginPreviewRow[] {
  const baseContext = params.options.economicsProjectionContext;
  if (!baseContext || params.plans.length === 0) {
    return [];
  }
  const savedContext = rebuildProjectionContextWithCreditWeights(baseContext, params.savedWeights);
  const draftContext = rebuildProjectionContextWithCreditWeights(baseContext, params.draftWeights);

  return params.plans
    .map((plan) => {
      const { monthlyCredits, allowedTiers, policyId } = resolvePlanEntitlement(
        plan,
        params.options.versionMetaById,
      );
      const selectorStrategy = resolveSelectorStrategy(policyId, params.options.catalogPolicies);
      const creditsForPreview = monthlyCredits ?? EXAMPLE_QUOTA_CREDITS;
      const savedCost = projectFullQuotaCostFromContext({
        monthlyCredits: creditsForPreview,
        allowedTiers,
        selectorStrategy,
        projectionContext: savedContext,
      });
      const draftCost = projectFullQuotaCostFromContext({
        monthlyCredits: creditsForPreview,
        allowedTiers,
        selectorStrategy,
        projectionContext: draftContext,
      });
      const savedMargin = marginRateFromCost(plan.basePriceCents, savedCost);
      const draftMargin = marginRateFromCost(plan.basePriceCents, draftCost);
      const savedTasks = tasksAtQuota({
        monthlyCredits: creditsForPreview,
        allowedTiers,
        selectorStrategy,
        projectionContext: savedContext,
      });
      const draftTasks = tasksAtQuota({
        monthlyCredits: creditsForPreview,
        allowedTiers,
        selectorStrategy,
        projectionContext: draftContext,
      });
      return {
        planId: plan.id,
        planName: plan.name,
        monthlyCredits,
        savedMarginLabel: formatMarginRate(savedMargin),
        draftMarginLabel: formatMarginRate(draftMargin),
        savedTasksLabel: savedTasks === null ? "—" : String(savedTasks),
        draftTasksLabel: draftTasks === null ? "—" : String(draftTasks),
        marginChanged:
          savedMargin !== null &&
          draftMargin !== null &&
          Math.abs(savedMargin - draftMargin) >= 0.0001,
      };
    })
    .toSorted((left, right) => left.planName.localeCompare(right.planName));
}

export function draftCreditWeightsFromState(params: {
  creditWeights: CreditWeight[];
  drafts: Record<string, string>;
}): CreditWeight[] {
  return params.creditWeights.map((weight) => {
    const raw = params.drafts[weight.tier] ?? String(weight.creditCost);
    const parsed = Number.parseInt(raw.trim(), 10);
    return {
      ...weight,
      creditCost: Number.isFinite(parsed) && parsed >= 0 ? parsed : weight.creditCost,
    };
  });
}
