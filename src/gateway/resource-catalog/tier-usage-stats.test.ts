// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { UsageLedgerEntry } from "../package-entitlement/types.js";
import {
  aggregateTierTaskCountsFromLedger,
  buildModelTierIndex,
  resolveTierForModelRef,
} from "./tier-usage-stats.js";
import type { ResourceModelCatalogEntry } from "./types.js";

function ledgerEntry(over: Partial<UsageLedgerEntry> & { tier: string }): UsageLedgerEntry {
  return {
    id: over.id ?? "e1",
    enterpriseId: over.enterpriseId ?? "ent-1",
    taskId: over.taskId ?? "task-1",
    modelId: over.modelId ?? "openai/gpt-4o",
    tier: over.tier,
    policyId: over.policyId ?? "balanced",
    creditsCharged: over.creditsCharged ?? 1,
    providerCostCents: over.providerCostCents ?? 0,
    tenantRevenueCents: over.tenantRevenueCents ?? 0,
    occurredAt: over.occurredAt ?? "2026-06-15T00:00:00.000Z",
  };
}

describe("tier-usage-stats", () => {
  it("aggregates ledger task counts by tier", () => {
    const counts = aggregateTierTaskCountsFromLedger([
      ledgerEntry({ tier: "tier_a", taskId: "t1" }),
      ledgerEntry({ tier: "tier_a", taskId: "t2" }),
      ledgerEntry({ tier: "tier_b", taskId: "t3" }),
    ]);
    expect(counts.get("tier_a")).toBe(2);
    expect(counts.get("tier_b")).toBe(1);
  });

  it("maps model refs to tiers via catalog index", () => {
    const models: ResourceModelCatalogEntry[] = [
      {
        modelId: "anthropic/claude-sonnet",
        provider: "anthropic",
        displayName: "Claude Sonnet",
        tier: "tier_b",
        enabled: true,
        inputCostPer1MCents: 0,
        outputCostPer1MCents: 0,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const index = buildModelTierIndex(models);
    expect(resolveTierForModelRef("anthropic/claude-sonnet", index)).toBe("tier_b");
    expect(resolveTierForModelRef("claude-sonnet", index)).toBe("tier_b");
  });
});
