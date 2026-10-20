import { describe, expect, it } from "vitest";
import {
  resolveCommercialCreditCost,
  resolveCreditsV2Enabled,
} from "./resolve-commercial-credit-cost.js";

const weights = [
  { tier: "tier_a", creditCost: 1, updatedAt: "2026-01-01T00:00:00.000Z" },
  { tier: "tier_b", creditCost: 5, updatedAt: "2026-01-01T00:00:00.000Z" },
];

describe("resolveCreditsV2Enabled", () => {
  it("defaults to false", () => {
    expect(resolveCreditsV2Enabled(undefined)).toBe(false);
    expect(resolveCreditsV2Enabled({ auditLog: true })).toBe(false);
  });

  it("returns true when feature flag set", () => {
    expect(resolveCreditsV2Enabled({ creditsV2Enabled: true })).toBe(true);
  });
});

describe("resolveCommercialCreditCost", () => {
  it("v1 path matches tier fixed cost when switch off", () => {
    const result = resolveCommercialCreditCost({
      creditsV2Enabled: false,
      tier: "tier_b",
      weights,
    });
    expect(result.pricingEngine).toBe("v1");
    expect(result.creditsCharged).toBe(5);
    expect(result.tierWeight).toBe(5);
  });

  it("v1 path applies token weight multiplier", () => {
    const result = resolveCommercialCreditCost({
      creditsV2Enabled: false,
      tier: "tier_b",
      weights,
      tokenUsage: { inputTokens: 6000, outputTokens: 2000 },
    });
    expect(result.pricingEngine).toBe("v1");
    expect(result.creditsCharged).toBe(20);
  });

  it("v2 path uses multi-factor formula when switch on", () => {
    const result = resolveCommercialCreditCost({
      creditsV2Enabled: true,
      tier: "tier_b",
      weights,
      tokenUsage: { inputTokens: 6000, outputTokens: 2000 },
    });
    expect(result.pricingEngine).toBe("v2");
    expect(result.creditsCharged).toBe(20);
  });

  it("v2 returns zero when tier weight is zero", () => {
    const result = resolveCommercialCreditCost({
      creditsV2Enabled: true,
      tier: "unknown",
      weights,
    });
    expect(result.creditsCharged).toBe(0);
  });

  it("v2 applies tool and runtime factors when signals present", () => {
    const baseline = resolveCommercialCreditCost({
      creditsV2Enabled: true,
      tier: "tier_b",
      weights,
    });
    const heavy = resolveCommercialCreditCost({
      creditsV2Enabled: true,
      tier: "tier_b",
      weights,
      toolCallCount: 6,
      toolClasses: ["browser_navigate"],
      durationMs: 60_000,
      retryCount: 1,
    });
    expect(heavy.creditsCharged).toBeGreaterThan(baseline.creditsCharged);
    expect(heavy.toolFactor).toBeGreaterThan(1);
    expect(heavy.runtimeFactor).toBeGreaterThan(1);
  });
});
