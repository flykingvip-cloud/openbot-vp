import { describe, expect, it } from "vitest";
import {
  computeMarginCents,
  computeProviderCostCents,
  computeProviderCostCentsOrMissing,
  computeTenantRevenueCents,
} from "./provider-cost.js";

describe("provider-cost", () => {
  it("computeProviderCostCents scales per-1M token rates", () => {
    expect(
      computeProviderCostCents({
        usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
        inputCostPer1MCents: 100,
        outputCostPer1MCents: 200,
      }),
    ).toBe(200);
  });

  it("includes cache read/write when unit prices are configured", () => {
    expect(
      computeProviderCostCents({
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 1_000_000,
          cacheWriteTokens: 500_000,
        },
        inputCostPer1MCents: 0,
        outputCostPer1MCents: 0,
        cacheReadCostPer1MCents: 40,
        cacheWriteCostPer1MCents: 100,
      }),
    ).toBe(90);
  });

  it("does not treat missing cache prices as a known zero when cache was used", () => {
    expect(
      computeProviderCostCentsOrMissing({
        usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 9 },
        inputCostPer1MCents: 0,
        outputCostPer1MCents: 0,
      }),
    ).toBeNull();
    expect(
      computeProviderCostCentsOrMissing({
        usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 9 },
        inputCostPer1MCents: 0,
        outputCostPer1MCents: 0,
        cacheReadCostPer1MCents: 0,
        cacheWriteCostPer1MCents: 0,
      }),
    ).toBe(0);
  });

  it("computeTenantRevenueCents multiplies credits by unit price", () => {
    expect(computeTenantRevenueCents({ creditsCharged: 5, creditPriceCents: 10 })).toBe(50);
    expect(computeTenantRevenueCents({ creditsCharged: 5, creditPriceCents: null })).toBe(0);
  });

  it("computeMarginCents subtracts provider cost from revenue", () => {
    expect(computeMarginCents({ tenantRevenueCents: 100, providerCostCents: 30 })).toBe(70);
  });
});
