import { describe, expect, it } from "vitest";
import type { RoutingPolicy } from "../../../capability/policy-engine/index.ts";
import type {
  ResourceModelCatalogEntry,
  ResourceTier,
} from "../../../capability/resource-catalog/index.ts";
import {
  buildPolicyRoutingPreview,
  creditWeightDraftChanges,
  estimateTasksForCredits,
  formatContextWindow,
  formatProviderCostPer1M,
  groupModelsByTier,
  inferModelCapabilityTags,
  resolveModelCapabilityTags,
  estimateProviderCostPerTaskCents,
  formatAvgCostPerTask,
} from "./resource-catalog-display.ts";

const TIERS: ResourceTier[] = [
  {
    id: "tier_a",
    code: "A",
    name: "Tier A",
    description: "Cost models",
    sortOrder: 0,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "tier_b",
    code: "B",
    name: "Tier B",
    description: "Balanced models",
    sortOrder: 1,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

function model(
  partial: Partial<ResourceModelCatalogEntry> & Pick<ResourceModelCatalogEntry, "modelId">,
): ResourceModelCatalogEntry {
  return {
    provider: "openai",
    displayName: partial.modelId,
    tier: "tier_b",
    enabled: true,
    inputCostPer1MCents: 100,
    outputCostPer1MCents: 200,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("resource-catalog-display", () => {
  it("groups models under tiers with credit weights", () => {
    const groups = groupModelsByTier({
      tiers: TIERS,
      creditWeights: [
        { tier: "tier_a", creditCost: 1, updatedAt: "2026-01-01T00:00:00.000Z" },
        { tier: "tier_b", creditCost: 5, updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
      models: [
        model({ modelId: "openai/gpt-4o", displayName: "GPT-4o", tier: "tier_b" }),
        model({
          modelId: "deepseek/chat",
          displayName: "DeepSeek Chat",
          tier: "tier_a",
          inputCostPer1MCents: 10,
          outputCostPer1MCents: 20,
        }),
      ],
    });
    expect(groups).toHaveLength(2);
    expect(groups[0]?.tier.id).toBe("tier_a");
    expect(groups[0]?.creditCost).toBe(1);
    expect(groups[0]?.models.map((entry) => entry.displayName)).toEqual(["DeepSeek Chat"]);
    expect(groups[1]?.models.map((entry) => entry.displayName)).toEqual(["GPT-4o"]);
  });

  it("builds cheapest policy preview from lowest provider cost", () => {
    const policy: RoutingPolicy = {
      id: "cost",
      name: "Cost",
      description: "",
      selectorStrategy: "cheapest",
      status: "active",
      builtin: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const preview = buildPolicyRoutingPreview(
      policy,
      [
        model({
          modelId: "a",
          displayName: "Claude",
          inputCostPer1MCents: 300,
          outputCostPer1MCents: 1500,
        }),
        model({
          modelId: "b",
          displayName: "DeepSeek",
          tier: "tier_a",
          inputCostPer1MCents: 10,
          outputCostPer1MCents: 20,
        }),
      ],
      TIERS,
    );
    expect(preview[0]?.displayName).toBe("DeepSeek");
  });

  it("detects draft credit weight changes", () => {
    expect(
      creditWeightDraftChanges({
        creditWeights: [{ tier: "tier_b", creditCost: 5, updatedAt: "2026-01-01T00:00:00.000Z" }],
        drafts: { tier_b: "8" },
      }),
    ).toEqual([{ tier: "tier_b", creditCost: 8, previous: 5 }]);
  });

  it("formats provider cost and context labels", () => {
    expect(formatProviderCostPer1M(300)).toBe("$3.00");
    expect(formatProviderCostPer1M(0)).toBe("—");
    expect(formatContextWindow(200_000)).toBe("200k");
    expect(
      inferModelCapabilityTags(
        model({ modelId: "anthropic/claude-opus", displayName: "Claude Opus" }),
      ),
    ).toContain("reasoning");
    expect(
      resolveModelCapabilityTags(
        model({
          modelId: "openai/gpt-4o",
          displayName: "GPT-4o",
          capabilities: ["vision", "tool_use"],
        }),
      ),
    ).toEqual(["vision", "toolUse"]);
    expect(
      formatAvgCostPerTask(
        estimateProviderCostPerTaskCents(
          model({
            modelId: "deepseek/chat",
            inputCostPer1MCents: 133_333,
            outputCostPer1MCents: 0,
            avgTokensPerTask: 2000,
          }),
        ),
      ),
    ).toBe("$2.00");
    expect(estimateTasksForCredits(10_000, 5)).toBe(2000);
  });
});
