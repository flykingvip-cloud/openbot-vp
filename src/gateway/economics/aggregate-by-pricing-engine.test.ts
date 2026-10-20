import { describe, expect, it } from "vitest";
import type { UsageLedgerEntry } from "../package-entitlement/types.js";
import {
  aggregateLedgerEconomicsByPricingEngine,
  resolveLedgerPricingEngine,
  sumLedgerCreditsByPricingEngine,
} from "./aggregate-by-pricing-engine.js";

function entry(
  partial: Partial<UsageLedgerEntry> & Pick<UsageLedgerEntry, "id" | "taskId">,
): UsageLedgerEntry {
  return {
    enterpriseId: "ent-1",
    modelId: "openai/gpt-4o",
    tier: "tier_b",
    policyId: "balanced",
    creditsCharged: 5,
    providerCostCents: 10,
    tenantRevenueCents: 20,
    occurredAt: "2026-06-15T00:00:00.000Z",
    ...partial,
  };
}

describe("aggregate-by-pricing-engine", () => {
  it("resolveLedgerPricingEngine treats missing field as v1", () => {
    expect(resolveLedgerPricingEngine({})).toBe("v1");
    expect(resolveLedgerPricingEngine({ pricingEngine: "v1" })).toBe("v1");
    expect(resolveLedgerPricingEngine({ pricingEngine: "v2" })).toBe("v2");
  });

  it("splits credits by pricing engine", () => {
    const rows = [
      entry({ id: "a", taskId: "t1", creditsCharged: 3, pricingEngine: "v1" }),
      entry({ id: "b", taskId: "t2", creditsCharged: 7, pricingEngine: "v2" }),
      entry({ id: "c", taskId: "t3", creditsCharged: 2 }),
    ];
    const split = aggregateLedgerEconomicsByPricingEngine(rows);
    expect(split.v1.creditsCharged).toBe(5);
    expect(split.v1.taskCount).toBe(2);
    expect(split.v2.creditsCharged).toBe(7);
    expect(split.v2.taskCount).toBe(1);

    const sums = sumLedgerCreditsByPricingEngine(rows);
    expect(sums.ledgerCreditsV1).toBe(5);
    expect(sums.ledgerCreditsV2).toBe(7);
  });
});
