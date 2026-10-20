import { describe, expect, test } from "vitest";
import { applyContextBudgetToEvidence, resolveContextBudget } from "./budget.js";

describe("context budget enforcement", () => {
  test("maxFiles=0 drops every evidence row", () => {
    const budget = resolveContextBudget({ mode: "minimal" });
    const kept = applyContextBudgetToEvidence({
      budget,
      evidence: [{ chunkText: "alpha" }, { chunkText: "beta" }],
    });
    expect(budget.maxFiles).toBe(0);
    expect(kept).toEqual([]);
  });

  test("maxFiles hard-caps the retrieved set", () => {
    const kept = applyContextBudgetToEvidence({
      budget: {
        maxTokens: 24_000,
        maxSources: 8,
        maxFiles: 2,
        maxRetrievalDepth: 1,
        maxToolCalls: 4,
      },
      evidence: [{ chunkText: "one" }, { chunkText: "two" }, { chunkText: "three" }],
    });
    expect(kept.map((item) => item.chunkText)).toEqual(["one", "two"]);
  });

  test("maxTokens stops after the first overflowing row", () => {
    const kept = applyContextBudgetToEvidence({
      budget: {
        maxTokens: 1,
        maxSources: 8,
        maxFiles: 20,
        maxRetrievalDepth: 1,
        maxToolCalls: 4,
      },
      evidence: [{ chunkText: "abcd" }, { chunkText: "efghijklmn" }],
    });
    expect(kept).toHaveLength(1);
    expect(kept[0]?.chunkText).toBe("abcd");
  });
});
