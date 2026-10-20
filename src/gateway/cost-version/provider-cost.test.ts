import { describe, expect, it } from "vitest";
import {
  computeMarginCents,
  computeProviderCostCents,
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

  it("computeTenantRevenueCents multiplies credits by unit price", () => {
    expect(computeTenantRevenueCents({ creditsCharged: 5, creditPriceCents: 10 })).toBe(50);
    expect(computeTenantRevenueCents({ creditsCharged: 5, creditPriceCents: null })).toBe(0);
  });

  it("computeMarginCents subtracts provider cost from revenue", () => {
    expect(computeMarginCents({ tenantRevenueCents: 100, providerCostCents: 30 })).toBe(70);
  });
});
