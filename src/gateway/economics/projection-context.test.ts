import { describe, expect, it } from "vitest";
import type { CostVersion } from "../cost-version/types.js";
import type { ResourceModelCatalogEntry } from "../resource-catalog/types.js";
import {
  buildEconomicsProjectionContext,
  buildTierProjectionCost,
  projectFullQuotaProviderCostCents,
} from "./projection-context.js";

const model = (
  over: Partial<ResourceModelCatalogEntry> & Pick<ResourceModelCatalogEntry, "modelId">,
): ResourceModelCatalogEntry => ({
  modelId: over.modelId,
  provider: "openai",
  displayName: over.modelId,
  tier: over.tier ?? "tier_a",
  enabled: over.enabled ?? true,
  inputCostPer1MCents: over.inputCostPer1MCents ?? 100,
  outputCostPer1MCents: over.outputCostPer1MCents ?? 200,
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("projection-context", () => {
  it("builds tier cost per credit from CostVersion rates", () => {
    const active: CostVersion = {
      id: "cv-1",
      version: 1,
      status: "active",
      modelCosts: {
        "openai/gpt-4o": {
          modelId: "openai/gpt-4o",
          tier: "tier_a",
          inputCostPer1MCents: 500,
          outputCostPer1MCents: 1000,
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const row = buildTierProjectionCost({
      tier: "tier_a",
      model: model({ modelId: "openai/gpt-4o", tier: "tier_a" }),
      activeCostVersion: active,
      creditWeights: [{ tier: "tier_a", creditCost: 2, updatedAt: "2026-01-01T00:00:00.000Z" }],
      benchmark: { inputTokens: 1_000_000, outputTokens: 0 },
    });
    expect(row.providerCostPerTaskCents).toBe(500);
    expect(row.providerCostPerCreditCents).toBe(250);
  });

  it("projects full quota cost across allowed tiers", () => {
    const ctx = buildEconomicsProjectionContext({
      models: [
        model({ modelId: "openai/gpt-4o", tier: "tier_a" }),
        model({
          modelId: "openai/gpt-4.1",
          tier: "tier_b",
          inputCostPer1MCents: 300,
          outputCostPer1MCents: 600,
        }),
      ],
      creditWeights: [
        { tier: "tier_a", creditCost: 1, updatedAt: "2026-01-01T00:00:00.000Z" },
        { tier: "tier_b", creditCost: 5, updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
      activeCostVersion: null,
      benchmark: { inputTokens: 1_000_000, outputTokens: 0 },
    });
    const tierProjections = Object.entries(ctx.tierCosts).map(([tier, row]) => ({
      tier,
      modelId: row.modelId,
      creditCost: row.creditCost,
      providerCostPerTaskCents: row.providerCostPerTaskCents,
      providerCostPerCreditCents: row.providerCostPerCreditCents,
    }));
    const projected = projectFullQuotaProviderCostCents({
      monthlyCredits: 100,
      allowedTiers: ["tier_a", "tier_b"],
      tierProjections,
    });
    expect(projected).toBeGreaterThan(0);
  });
});
