import { describe, expect, it } from "vitest";
import { hasKnowledgeRecommendationContext } from "./knowledge-universe-recommendation-context.ts";

describe("hasKnowledgeRecommendationContext", () => {
  it("is false on the idle workbench home", () => {
    expect(
      hasKnowledgeRecommendationContext({
        selectedNodeId: null,
        selectedObject: null,
        query: "",
        kbSearchQuery: "",
        selectedKnowledgeBaseId: null,
      }),
    ).toBe(false);
  });

  it("is true when a graph node is selected", () => {
    expect(
      hasKnowledgeRecommendationContext({
        selectedNodeId: "node:a",
        selectedObject: null,
        query: "",
        kbSearchQuery: "",
        selectedKnowledgeBaseId: null,
      }),
    ).toBe(true);
  });

  it("is true when the workspace search query is non-empty", () => {
    expect(
      hasKnowledgeRecommendationContext({
        selectedNodeId: null,
        selectedObject: null,
        query: "销售",
        kbSearchQuery: "",
        selectedKnowledgeBaseId: null,
      }),
    ).toBe(true);
  });

  it("is true when a library search is active inside a space", () => {
    expect(
      hasKnowledgeRecommendationContext({
        selectedNodeId: null,
        selectedObject: null,
        query: "",
        kbSearchQuery: "制度",
        selectedKnowledgeBaseId: "kb-1",
      }),
    ).toBe(true);
  });
});
