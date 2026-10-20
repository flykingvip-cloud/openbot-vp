import { describe, expect, it } from "vitest";
import type { UsageLedgerEntry } from "../package-entitlement/types.js";
import {
  DEFAULT_BENCHMARK_USAGE,
  deriveBenchmarkUsageFromLedger,
  deriveObservedTierMixFromLedger,
} from "./ledger-benchmark.js";

describe("ledger-benchmark", () => {
  it("uses median tokens from ledger when available", () => {
    const entries: UsageLedgerEntry[] = [
      {
        id: "1",
        enterpriseId: "ent-a",
        taskId: "t1",
        modelId: "m1",
        tier: "tier_a",
        policyId: "balanced",
        creditsCharged: 1,
        providerCostCents: 10,
        tenantRevenueCents: 20,
        inputTokens: 1000,
        outputTokens: 200,
        occurredAt: "2026-06-01T00:00:00.000Z",
      },
      {
        id: "2",
        enterpriseId: "ent-a",
        taskId: "t2",
        modelId: "m1",
        tier: "tier_a",
        policyId: "balanced",
        creditsCharged: 1,
        providerCostCents: 10,
        tenantRevenueCents: 20,
        inputTokens: 3000,
        outputTokens: 600,
        occurredAt: "2026-06-02T00:00:00.000Z",
      },
    ];
    const result = deriveBenchmarkUsageFromLedger(entries);
    expect(result.source).toBe("ledger");
    expect(result.benchmark.inputTokens).toBe(2000);
    expect(result.benchmark.outputTokens).toBe(400);
  });

  it("falls back to default benchmark without token samples", () => {
    const result = deriveBenchmarkUsageFromLedger([]);
    expect(result.source).toBe("default");
    expect(result.benchmark).toEqual(DEFAULT_BENCHMARK_USAGE);
  });

  it("derives observed tier mix by credits charged", () => {
    const mix = deriveObservedTierMixFromLedger([
      {
        id: "1",
        enterpriseId: "ent-a",
        taskId: "t1",
        modelId: "m1",
        tier: "tier_a",
        policyId: "balanced",
        creditsCharged: 30,
        providerCostCents: 10,
        tenantRevenueCents: 20,
        occurredAt: "2026-06-01T00:00:00.000Z",
      },
      {
        id: "2",
        enterpriseId: "ent-a",
        taskId: "t2",
        modelId: "m2",
        tier: "tier_b",
        policyId: "balanced",
        creditsCharged: 70,
        providerCostCents: 10,
        tenantRevenueCents: 20,
        occurredAt: "2026-06-02T00:00:00.000Z",
      },
    ]);
    expect(mix.tier_a).toBeCloseTo(0.3);
    expect(mix.tier_b).toBeCloseTo(0.7);
  });
});
