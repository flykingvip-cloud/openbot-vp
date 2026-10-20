import { describe, expect, it } from "vitest";
import {
  estimateProviderCostPerTaskCents,
  inferModelCapabilities,
  resolveModelCapabilities,
} from "./model-metadata.js";
import type { ResourceModelCatalogEntry } from "./types.js";

describe("resource-catalog model-metadata", () => {
  it("infers capabilities from model id and context window", () => {
    expect(
      inferModelCapabilities({
        modelId: "anthropic/claude-opus-4",
        displayName: "Claude Opus",
        contextWindow: 200_000,
      }),
    ).toEqual(expect.arrayContaining(["reasoning", "long_context"]));
  });

  it("prefers stored capabilities over inference", () => {
    const entry: ResourceModelCatalogEntry = {
      modelId: "openai/gpt-4o",
      provider: "openai",
      displayName: "GPT-4o",
      tier: "tier_b",
      enabled: true,
      capabilities: ["coding"],
      inputCostPer1MCents: 250,
      outputCostPer1MCents: 1000,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(resolveModelCapabilities(entry)).toEqual(["coding"]);
  });

  it("estimates provider cost per task from token benchmark", () => {
    const entry: ResourceModelCatalogEntry = {
      modelId: "openai/gpt-4o",
      provider: "openai",
      displayName: "GPT-4o",
      tier: "tier_b",
      enabled: true,
      avgTokensPerTask: 2000,
      inputCostPer1MCents: 300,
      outputCostPer1MCents: 1500,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(estimateProviderCostPerTaskCents(entry)).toBeGreaterThan(0);
  });
});
