// @vitest-environment node
import { describe, expect, it } from "vitest";
import { prioritizeRelationshipEdgesForPreview } from "./knowledge-universe-insights-preview.ts";

describe("prioritizeRelationshipEdgesForPreview", () => {
  it("surfaces conflict edges before related edges", () => {
    const edges = [
      { sourceId: "a", targetId: "b", relationType: "related" as const, score: 99 },
      { sourceId: "c", targetId: "d", relationType: "conflicts" as const, score: 10 },
      { sourceId: "e", targetId: "f", relationType: "related" as const, score: 50 },
    ];
    const preview = prioritizeRelationshipEdgesForPreview(edges, 2);
    expect(preview).toHaveLength(2);
    expect(preview[0]?.relationType).toBe("conflicts");
    expect(preview[1]?.relationType).toBe("related");
    expect(preview[1]?.sourceId).toBe("a");
  });
});
