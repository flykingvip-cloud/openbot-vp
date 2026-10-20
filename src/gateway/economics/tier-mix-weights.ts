/**
 * Policy / 观测混合 Tier 权重（P4 满额成本预测）。
 */

import type { SelectionStrategy } from "@openbot/aor-core";

export type TierMixWeights = Record<string, number>;

const STRATEGIES: SelectionStrategy[] = ["cheapest", "balanced", "best_quality", "bandit"];

function normalizeWeights(weights: TierMixWeights): TierMixWeights {
  const sum = Object.values(weights).reduce((acc, value) => acc + value, 0);
  if (sum <= 0) {
    return {};
  }
  const out: TierMixWeights = {};
  for (const [tier, weight] of Object.entries(weights)) {
    out[tier] = weight / sum;
  }
  return out;
}

function filterToAllowedTiers(
  weights: TierMixWeights,
  allowedTiers: readonly string[],
): TierMixWeights {
  const allowed = new Set(allowedTiers.map((tier) => tier.trim()).filter(Boolean));
  const filtered: TierMixWeights = {};
  for (const [tier, weight] of Object.entries(weights)) {
    if (allowed.has(tier) && weight > 0) {
      filtered[tier] = weight;
    }
  }
  return normalizeWeights(filtered);
}

function equalMix(tiers: readonly string[]): TierMixWeights {
  if (tiers.length === 0) {
    return {};
  }
  const weight = 1 / tiers.length;
  return Object.fromEntries(tiers.map((tier) => [tier, weight]));
}

function blendMix(a: TierMixWeights, b: TierMixWeights, bWeight: number): TierMixWeights {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: TierMixWeights = {};
  for (const tier of keys) {
    out[tier] = (a[tier] ?? 0) * (1 - bWeight) + (b[tier] ?? 0) * bWeight;
  }
  return normalizeWeights(out);
}

export function buildSelectorMixProfiles(params: {
  tiers: readonly string[];
  costPerCreditByTier: Record<string, number | null | undefined>;
  creditCostByTier: Record<string, number | undefined>;
}): Record<SelectionStrategy, TierMixWeights> {
  const tiers = params.tiers.map((tier) => tier.trim()).filter(Boolean);
  const profiles = {} as Record<SelectionStrategy, TierMixWeights>;
  profiles.balanced = equalMix(tiers);
  profiles.bandit = equalMix(tiers);

  const cheapest: TierMixWeights = {};
  for (const tier of tiers) {
    const cost = params.costPerCreditByTier[tier];
    if (cost !== null && cost !== undefined && cost > 0) {
      cheapest[tier] = 1 / cost;
    }
  }
  profiles.cheapest = normalizeWeights(cheapest);

  const bestQuality: TierMixWeights = {};
  for (const tier of tiers) {
    const creditCost = params.creditCostByTier[tier];
    if (creditCost !== undefined && creditCost > 0) {
      bestQuality[tier] = creditCost;
    }
  }
  profiles.best_quality = normalizeWeights(bestQuality);

  return profiles;
}

export function resolveTierMixForPlan(params: {
  allowedTiers: readonly string[];
  selectorStrategy: SelectionStrategy;
  selectorMixProfiles: Partial<Record<SelectionStrategy, TierMixWeights>>;
  tierObservedMix?: TierMixWeights;
}): TierMixWeights {
  const allowed = params.allowedTiers.map((tier) => tier.trim()).filter(Boolean);
  if (allowed.length === 0) {
    return {};
  }
  const strategy = params.selectorStrategy || "balanced";
  const profile =
    params.selectorMixProfiles[strategy] ??
    params.selectorMixProfiles.balanced ??
    equalMix(allowed);
  let mix = filterToAllowedTiers(profile, allowed);
  if (Object.keys(mix).length === 0) {
    mix = equalMix(allowed);
  }
  const observed = filterToAllowedTiers(params.tierObservedMix ?? {}, allowed);
  if ((strategy === "bandit" || strategy === "balanced") && Object.keys(observed).length > 0) {
    mix = blendMix(mix, observed, strategy === "bandit" ? 0.7 : 0.4);
  }
  return mix;
}

export function weightedCostPerCredit(params: {
  tierMix: TierMixWeights;
  costPerCreditByTier: Record<string, number | null | undefined>;
}): number | null {
  let sum = 0;
  let weightSum = 0;
  for (const [tier, weight] of Object.entries(params.tierMix)) {
    const cost = params.costPerCreditByTier[tier];
    if (cost !== null && cost !== undefined && cost > 0) {
      sum += weight * cost;
      weightSum += weight;
    }
  }
  if (weightSum <= 0) {
    return null;
  }
  return sum / weightSum;
}

export { STRATEGIES as PROJECTION_SELECTOR_STRATEGIES };
