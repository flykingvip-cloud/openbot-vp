import { describe, expect, it } from "vitest";
import type { Plan } from "../../../capability/cost-budget-billing/index.ts";
import type { RoutingPolicy } from "../../../capability/policy-engine/index.ts";
import type { CreditWeight } from "../../../capability/resource-catalog/index.ts";
import {
  buildPlanMarginPreviews,
  draftCreditWeightsFromState,
  rebuildProjectionContextWithCreditWeights,
} from "./resource-catalog-plan-preview.ts";

const projectionContext = {
  benchmark: { inputTokens: 1_000_000, outputTokens: 0 },
  benchmarkSource: "default" as const,
  benchmarkSampleCount: 0,
  creditWeights: [
    { tier: "tier_a", creditCost: 1 },
    { tier: "tier_b", creditCost: 5 },
  ],
  tierCosts: {
    tier_a: {
      modelId: "deepseek/chat",
      inputCostPer1MCents: 100,
      outputCostPer1MCents: 200,
      creditCost: 1,
      providerCostPerTaskCents: 100,
      providerCostPerCreditCents: 100,
    },
    tier_b: {
      modelId: "openai/gpt-4o",
      inputCostPer1MCents: 500,
      outputCostPer1MCents: 1500,
      creditCost: 5,
      providerCostPerTaskCents: 500,
      providerCostPerCreditCents: 100,
    },
  },
  tierObservedMix: {},
  selectorMixProfiles: {
    balanced: { tier_a: 0.5, tier_b: 0.5 },
    cheapest: { tier_a: 1 },
    best_quality: { tier_b: 1 },
    bandit: { tier_a: 0.5, tier_b: 0.5 },
  },
};

const plans: Plan[] = [
  {
    id: "plan-growth",
    name: "Growth",
    billingCycle: "monthly",
    basePriceCents: 10_000,
    status: "active",
    currentVersionId: "pv-growth",
    seatQuota: {},
    botQuota: 10,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

const savedWeights: CreditWeight[] = [
  { tier: "tier_a", creditCost: 1, updatedAt: "2026-01-01T00:00:00.000Z" },
  { tier: "tier_b", creditCost: 5, updatedAt: "2026-01-01T00:00:00.000Z" },
];

const catalogPolicies: RoutingPolicy[] = [
  {
    id: "balanced",
    name: "Balanced",
    description: "",
    selectorStrategy: "balanced",
    status: "active",
    builtin: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("resource-catalog-plan-preview", () => {
  it("rebuilds projection context when credit weights change", () => {
    const rebuilt = rebuildProjectionContextWithCreditWeights(projectionContext, [
      { tier: "tier_a", creditCost: 2, updatedAt: "2026-01-01T00:00:00.000Z" },
      { tier: "tier_b", creditCost: 5, updatedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(rebuilt.tierCosts.tier_a?.creditCost).toBe(2);
    expect(rebuilt.tierCosts.tier_a?.providerCostPerCreditCents).toBe(50);
  });

  it("builds plan margin previews and marks changed rows", () => {
    const draftWeights = draftCreditWeightsFromState({
      creditWeights: savedWeights,
      drafts: { tier_a: "2", tier_b: "5" },
    });
    const rows = buildPlanMarginPreviews({
      plans,
      savedWeights,
      draftWeights,
      options: {
        economicsProjectionContext: projectionContext,
        catalogPolicies,
        versionMetaById: {
          "pv-growth": {
            entitlementSnapshot: { monthlyCredits: 100, allowedTiers: ["tier_a", "tier_b"] },
            binding: { allowedTiers: ["tier_a", "tier_b"], policyId: "balanced" },
          },
        },
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.planName).toBe("Growth");
    expect(rows[0]?.marginChanged).toBe(true);
    expect(rows[0]?.savedMarginLabel).not.toBe(rows[0]?.draftMarginLabel);
  });

  it("returns empty rows without projection context", () => {
    expect(
      buildPlanMarginPreviews({
        plans,
        savedWeights,
        draftWeights: savedWeights,
        options: {},
      }),
    ).toEqual([]);
  });
});
