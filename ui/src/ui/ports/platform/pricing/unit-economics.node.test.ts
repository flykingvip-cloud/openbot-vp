import { describe, expect, it } from "vitest";
import { projectFullQuotaCostFromContext } from "./cost-version-projection.ts";
import {
  buildPlanUnitEconomics,
  computeActivationMarginDelta,
  formatMarginRate,
  formatMarginRateDelta,
} from "./unit-economics.ts";

const projectionContext = {
  benchmark: { inputTokens: 1_000_000, outputTokens: 0 },
  benchmarkSource: "default" as const,
  benchmarkSampleCount: 0,
  creditWeights: [{ tier: "tier_a", creditCost: 2 }],
  tierCosts: {
    tier_a: {
      modelId: "openai/gpt-4o",
      inputCostPer1MCents: 500,
      outputCostPer1MCents: 0,
      creditCost: 2,
      providerCostPerTaskCents: 500,
      providerCostPerCreditCents: 250,
    },
  },
  tierObservedMix: {},
  selectorMixProfiles: {
    balanced: { tier_a: 1 },
    cheapest: { tier_a: 1 },
    best_quality: { tier_a: 1 },
    bandit: { tier_a: 1 },
  },
};

describe("buildPlanUnitEconomics", () => {
  it("projects margin from plan-level cost per credit", () => {
    const unit = buildPlanUnitEconomics({
      planId: "plan-a",
      basePriceCents: 10_000,
      monthlyCredits: 100,
      commercial: {
        totals: { activeSubscriptions: 2, mrrCents: 20_000 },
        plans: {
          "plan-a": {
            planId: "plan-a",
            activeSubscriptions: 2,
            mrrCents: 20_000,
            versions: {},
          },
        },
      },
      planActual: {
        taskCount: 5,
        creditsCharged: 50,
        providerCostCents: 2_500,
        tenantRevenueCents: 5_000,
        marginCents: 2_500,
      },
      platformSummary: undefined,
    });

    expect(unit.projectedFullQuotaCostCents).toBe(5_000);
    expect(unit.projectedSubscriptionMarginCents).toBe(5_000);
    expect(unit.projectedMarginRate).toBeCloseTo(0.5);
    expect(unit.projectionSource).toBe("plan");
    expect(unit.cohortMarginCents).toBe(17_500);
  });

  it("prefers CostVersion projection when context is available", () => {
    const unit = buildPlanUnitEconomics({
      planId: "plan-a",
      basePriceCents: 10_000,
      monthlyCredits: 100,
      allowedTiers: ["tier_a"],
      commercial: null,
      planActual: undefined,
      platformSummary: undefined,
      economicsOverview: { projectionContext } as never,
    });
    expect(unit.costVersionFullQuotaCostCents).toBe(25_000);
    expect(unit.preferredProjectionLabel).toBe("cost_version");
  });

  it("falls back to platform average when plan has no usage", () => {
    const unit = buildPlanUnitEconomics({
      planId: "plan-b",
      basePriceCents: 5_000,
      monthlyCredits: 20,
      commercial: null,
      planActual: undefined,
      platformSummary: {
        taskCount: 10,
        creditsCharged: 100,
        providerCostCents: 4_000,
        tenantRevenueCents: 8_000,
        marginCents: 4_000,
      },
    });

    expect(unit.projectedFullQuotaCostCents).toBe(800);
    expect(unit.projectionSource).toBe("platform");
  });
});

describe("computeActivationMarginDelta", () => {
  it("returns draft minus active projected margin rates", () => {
    const delta = computeActivationMarginDelta({
      basePriceCents: 10_000,
      activeMonthlyCredits: 100,
      draftMonthlyCredits: 200,
      planActual: {
        taskCount: 1,
        creditsCharged: 10,
        providerCostCents: 500,
        tenantRevenueCents: 1_000,
        marginCents: 500,
      },
      platformSummary: undefined,
    });

    expect(delta).not.toBeNull();
    expect(delta!).toBeLessThan(0);
  });
});

describe("projectFullQuotaCostFromContext", () => {
  it("blends tier cost per credit for allowed tiers", () => {
    const cost = projectFullQuotaCostFromContext({
      monthlyCredits: 100,
      allowedTiers: ["tier_a"],
      projectionContext,
    });
    expect(cost).toBe(25_000);
  });
});

describe("formatMarginRate helpers", () => {
  it("formats rates and deltas", () => {
    expect(formatMarginRate(0.425)).toBe("42.5%");
    expect(formatMarginRate(null)).toBe("—");
    expect(formatMarginRateDelta(0.05)).toBe("+5.0%");
    expect(formatMarginRateDelta(-0.03)).toBe("-3.0%");
  });
});
