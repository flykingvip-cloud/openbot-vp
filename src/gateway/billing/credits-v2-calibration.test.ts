import { describe, expect, it } from "vitest";
import type { UsageLedgerEntry } from "../package-entitlement/types.js";
import { calibrateCreditsV2AgainstLedger } from "./credits-v2-calibration.js";

const weights = [{ tier: "tier_b", creditCost: 5, updatedAt: "2026-01-01T00:00:00.000Z" }];

function ledgerRow(overrides: Partial<UsageLedgerEntry>): UsageLedgerEntry {
  return {
    id: "led-1",
    enterpriseId: "ent-cal",
    taskId: "task-1",
    modelId: "openai/gpt-4o",
    tier: "tier_b",
    policyId: "balanced",
    creditsCharged: 5,
    providerCostCents: 10,
    tenantRevenueCents: 20,
    occurredAt: "2026-06-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("credits-v2-calibration", () => {
  it("replays v1 and v2 costs for ledger rows", () => {
    const summary = calibrateCreditsV2AgainstLedger(
      [
        ledgerRow({ id: "a", pricingEngine: "v1", creditsCharged: 5 }),
        ledgerRow({
          id: "b",
          pricingEngine: "v2",
          creditsCharged: 6,
          toolCallCount: 2,
          durationMs: 30_000,
        }),
      ],
      weights,
    );
    expect(summary.sampleCount).toBe(2);
    expect(summary.v1LedgerCount).toBe(1);
    expect(summary.v2LedgerCount).toBe(1);
    expect(summary.rows[0]?.replayV1Credits).toBe(5);
    expect(summary.rows[0]?.replayV2Credits).toBeGreaterThanOrEqual(5);
    expect(summary.meanDeltaV2MinusV1).not.toBeNull();
  });

  it("returns empty summary for no entries", () => {
    const summary = calibrateCreditsV2AgainstLedger([], weights);
    expect(summary.sampleCount).toBe(0);
    expect(summary.meanDeltaV2MinusV1).toBeNull();
    expect(summary.maxAbsDelta).toBe(0);
  });
});
