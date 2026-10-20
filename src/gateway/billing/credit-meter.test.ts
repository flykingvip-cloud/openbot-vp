import { describe, expect, it } from "vitest";
import {
  computeCreditsBalance,
  resolveCreditCostForTier,
  resolveTokenWeightedCreditCost,
  wouldExceedCredits,
} from "./credit-meter.js";

describe("credit-meter", () => {
  it("resolveCreditCostForTier returns weight or 0", () => {
    const weights = [
      { tier: "tier_a", creditCost: 1, updatedAt: "2026-01-01T00:00:00.000Z" },
      { tier: "tier_b", creditCost: 5, updatedAt: "2026-01-01T00:00:00.000Z" },
    ];
    expect(resolveCreditCostForTier("tier_a", weights)).toBe(1);
    expect(resolveCreditCostForTier("tier_b", weights)).toBe(5);
    expect(resolveCreditCostForTier("unknown", weights)).toBe(0);
  });

  it("computeCreditsBalance derives remaining", () => {
    const balance = computeCreditsBalance({
      enterpriseId: "ent-1",
      cycleStart: "2026-06-01T00:00:00.000Z",
      monthlyCredits: 100,
      creditsConsumed: 30,
    });
    expect(balance.creditsRemaining).toBe(70);
    expect(balance.monthlyCredits).toBe(100);
  });

  it("wouldExceedCredits respects allocation", () => {
    expect(wouldExceedCredits({ monthlyCredits: 0, creditsConsumed: 0, creditsToCharge: 99 })).toBe(
      false,
    );
    expect(wouldExceedCredits({ monthlyCredits: 10, creditsConsumed: 8, creditsToCharge: 2 })).toBe(
      false,
    );
    expect(wouldExceedCredits({ monthlyCredits: 10, creditsConsumed: 8, creditsToCharge: 3 })).toBe(
      true,
    );
  });

  it("resolveTokenWeightedCreditCost scales by token usage", () => {
    expect(resolveTokenWeightedCreditCost({ tierBaseCost: 5 })).toBe(5);
    expect(
      resolveTokenWeightedCreditCost({
        tierBaseCost: 5,
        tokenUsage: { inputTokens: 1500, outputTokens: 500 },
      }),
    ).toBe(5);
    expect(
      resolveTokenWeightedCreditCost({
        tierBaseCost: 5,
        tokenUsage: { inputTokens: 6000, outputTokens: 2000 },
        benchmark: { inputTokens: 1500, outputTokens: 500 },
      }),
    ).toBe(20);
    expect(
      resolveTokenWeightedCreditCost({
        tierBaseCost: 5,
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
        benchmark: { inputTokens: 1500, outputTokens: 500 },
      }),
    ).toBe(2);
  });
});
