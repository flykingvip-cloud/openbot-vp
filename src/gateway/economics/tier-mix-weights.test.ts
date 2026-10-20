import { describe, expect, it } from "vitest";
import {
  buildSelectorMixProfiles,
  resolveTierMixForPlan,
  weightedCostPerCredit,
} from "./tier-mix-weights.js";

describe("tier-mix-weights", () => {
  it("cheapest profile favors lower cost tiers", () => {
    const profiles = buildSelectorMixProfiles({
      tiers: ["tier_a", "tier_b"],
      costPerCreditByTier: { tier_a: 10, tier_b: 50 },
      creditCostByTier: { tier_a: 1, tier_b: 5 },
    });
    expect(profiles.cheapest.tier_a).toBeGreaterThan(profiles.cheapest.tier_b);
  });

  it("bandit blends observed mix into allowed tiers", () => {
    const mix = resolveTierMixForPlan({
      allowedTiers: ["tier_a", "tier_b"],
      selectorStrategy: "bandit",
      selectorMixProfiles: buildSelectorMixProfiles({
        tiers: ["tier_a", "tier_b"],
        costPerCreditByTier: { tier_a: 10, tier_b: 20 },
        creditCostByTier: { tier_a: 1, tier_b: 5 },
      }),
      tierObservedMix: { tier_b: 1 },
    });
    expect(mix.tier_b).toBeGreaterThan(mix.tier_a);
  });

  it("weightedCostPerCredit respects tier mix", () => {
    const cost = weightedCostPerCredit({
      tierMix: { tier_a: 0.25, tier_b: 0.75 },
      costPerCreditByTier: { tier_a: 100, tier_b: 200 },
    });
    expect(cost).toBe(175);
  });
});
