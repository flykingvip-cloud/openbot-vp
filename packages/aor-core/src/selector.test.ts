import { describe, expect, it } from "vitest";
import { defaultModelCatalog } from "./catalog.js";
import { NoCandidateError, estimateCostUsd, rankModels, selectModel } from "./selector.js";
import type { ModelProfile } from "./types.js";

const costProfile = { expectedInputTokens: 1_000_000, expectedOutputTokens: 1_000_000 };

describe("selectModel", () => {
  it("cheapest strategy picks the lowest-cost eligible model", () => {
    const result = selectModel({
      taskType: "summarization",
      strategy: "cheapest",
      candidates: defaultModelCatalog(),
      costProfile,
    });
    expect(result.model).toEqual({ provider: "openai", id: "gpt-5.4-mini" });
    expect(result.reason).toContain("cost");
  });

  it("best_quality strategy picks the highest task-type score", () => {
    const result = selectModel({
      taskType: "coding.review",
      strategy: "best_quality",
      candidates: defaultModelCatalog(),
      costProfile,
    });
    expect(result.model).toEqual({ provider: "anthropic", id: "claude-opus-4-6" });
  });

  it("enforces the budget constraint", () => {
    const result = selectModel({
      taskType: "summarization",
      strategy: "best_quality",
      candidates: defaultModelCatalog(),
      costProfile,
      constraints: { budgetUsd: 5 },
    });
    // Only the cheap model fits a $5 budget at 1M+1M tokens.
    expect(result.model).toEqual({ provider: "openai", id: "gpt-5.4-mini" });
  });

  it("throws when no model satisfies the constraints", () => {
    expect(() =>
      selectModel({
        taskType: "summarization",
        strategy: "cheapest",
        candidates: defaultModelCatalog(),
        costProfile,
        constraints: { budgetUsd: 0.0001 },
      }),
    ).toThrow(NoCandidateError);
  });

  it("respects allowedModels", () => {
    const result = selectModel({
      taskType: "coding.review",
      strategy: "best_quality",
      candidates: defaultModelCatalog(),
      costProfile,
      constraints: { allowedModels: [{ provider: "openai", id: "gpt-5.4" }] },
    });
    expect(result.model).toEqual({ provider: "openai", id: "gpt-5.4" });
  });

  it("excludes unavailable models", () => {
    const candidates: ModelProfile[] = defaultModelCatalog().map((m) =>
      m.ref.id === "gpt-5.4-mini" ? { ...m, available: false } : m,
    );
    const result = selectModel({
      taskType: "summarization",
      strategy: "cheapest",
      candidates,
      costProfile,
    });
    expect(result.model.id).not.toBe("gpt-5.4-mini");
  });
});

describe("rankModels", () => {
  it("returns all eligible models best-first (primary + fallback chain)", () => {
    const ranked = rankModels({
      taskType: "coding.review",
      strategy: "best_quality",
      candidates: defaultModelCatalog(),
      costProfile,
    });
    expect(ranked).toHaveLength(3);
    expect(ranked[0].model).toEqual({ provider: "anthropic", id: "claude-opus-4-6" });
    // selectModel is just the top of the ranking.
    expect(
      selectModel({
        taskType: "coding.review",
        strategy: "best_quality",
        candidates: defaultModelCatalog(),
        costProfile,
      }).model,
    ).toEqual(ranked[0].model);
  });

  it("drops budget-excluded models from the fallback chain too", () => {
    const ranked = rankModels({
      taskType: "summarization",
      strategy: "best_quality",
      candidates: defaultModelCatalog(),
      costProfile,
      constraints: { budgetUsd: 5 },
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].model.id).toBe("gpt-5.4-mini");
  });
});

describe("estimateCostUsd", () => {
  it("computes per-million-token cost", () => {
    const [anthropic] = defaultModelCatalog();
    const cost = estimateCostUsd(anthropic, {
      expectedInputTokens: 1_000_000,
      expectedOutputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(90, 5);
  });
});
