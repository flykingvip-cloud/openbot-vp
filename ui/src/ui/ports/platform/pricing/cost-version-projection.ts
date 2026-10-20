import type { EconomicsProjectionContext } from "../../../capability/cost-economics/index.ts";

type SelectorStrategy = "cheapest" | "balanced" | "best_quality" | "bandit";

function normalizeWeights(weights: Record<string, number>): Record<string, number> {
  const sum = Object.values(weights).reduce((acc, value) => acc + value, 0);
  if (sum <= 0) {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [tier, weight] of Object.entries(weights)) {
    out[tier] = weight / sum;
  }
  return out;
}

function filterToAllowedTiers(
  weights: Record<string, number>,
  allowedTiers: readonly string[],
): Record<string, number> {
  const allowed = new Set(allowedTiers.map((tier) => tier.trim()).filter(Boolean));
  const filtered: Record<string, number> = {};
  for (const [tier, weight] of Object.entries(weights)) {
    if (allowed.has(tier) && weight > 0) {
      filtered[tier] = weight;
    }
  }
  return normalizeWeights(filtered);
}

function equalMix(tiers: readonly string[]): Record<string, number> {
  if (tiers.length === 0) {
    return {};
  }
  const weight = 1 / tiers.length;
  return Object.fromEntries(tiers.map((tier) => [tier, weight]));
}

function blendMix(
  a: Record<string, number>,
  b: Record<string, number>,
  bWeight: number,
): Record<string, number> {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: Record<string, number> = {};
  for (const tier of keys) {
    out[tier] = (a[tier] ?? 0) * (1 - bWeight) + (b[tier] ?? 0) * bWeight;
  }
  return normalizeWeights(out);
}

export function resolveTierMixForPlan(params: {
  allowedTiers: readonly string[];
  selectorStrategy: string;
  projectionContext: EconomicsProjectionContext;
}): Record<string, number> {
  const allowed = params.allowedTiers.map((tier) => tier.trim()).filter(Boolean);
  if (allowed.length === 0) {
    return {};
  }
  const strategy = (params.selectorStrategy || "balanced") as SelectorStrategy;
  const profiles = params.projectionContext.selectorMixProfiles ?? {};
  const profile = profiles[strategy] ?? profiles.balanced ?? equalMix(allowed);
  let mix = filterToAllowedTiers(profile, allowed);
  if (Object.keys(mix).length === 0) {
    mix = equalMix(allowed);
  }
  const observed = filterToAllowedTiers(params.projectionContext.tierObservedMix ?? {}, allowed);
  if ((strategy === "bandit" || strategy === "balanced") && Object.keys(observed).length > 0) {
    mix = blendMix(mix, observed, strategy === "bandit" ? 0.7 : 0.4);
  }
  return mix;
}

export function projectFullQuotaCostFromContext(params: {
  monthlyCredits: number | null;
  allowedTiers: readonly string[];
  selectorStrategy?: string;
  projectionContext: EconomicsProjectionContext | null | undefined;
}): number | null {
  const credits = params.monthlyCredits;
  if (credits === null || credits <= 0 || !params.projectionContext) {
    return null;
  }
  const tierSet = new Set(params.allowedTiers.map((t) => t.trim()).filter(Boolean));
  if (tierSet.size === 0) {
    return null;
  }
  const tierMix = resolveTierMixForPlan({
    allowedTiers: params.allowedTiers,
    selectorStrategy: params.selectorStrategy ?? "balanced",
    projectionContext: params.projectionContext,
  });
  let blended = 0;
  let weightSum = 0;
  for (const [tier, weight] of Object.entries(tierMix)) {
    const cost = params.projectionContext.tierCosts[tier]?.providerCostPerCreditCents;
    if (cost && cost > 0) {
      blended += weight * cost;
      weightSum += weight;
    }
  }
  if (weightSum <= 0) {
    const costs: number[] = [];
    for (const tier of tierSet) {
      const row = params.projectionContext.tierCosts[tier];
      if (row?.providerCostPerCreditCents && row.providerCostPerCreditCents > 0) {
        costs.push(row.providerCostPerCreditCents);
      }
    }
    if (costs.length === 0) {
      return null;
    }
    blended = costs.reduce((sum, value) => sum + value, 0) / costs.length;
    return Math.round(credits * blended);
  }
  return Math.round(credits * (blended / weightSum));
}

export function marginRateFromCost(
  basePriceCents: number,
  providerCostCents: number | null,
): number | null {
  if (providerCostCents === null || basePriceCents <= 0) {
    return null;
  }
  return (basePriceCents - providerCostCents) / basePriceCents;
}
