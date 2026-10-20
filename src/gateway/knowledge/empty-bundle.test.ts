import { describe, expect, it } from "vitest";
import { buildKnowledgeSourceBundle } from "./empty-bundle.js";
import type { KnowledgeObject, RelationshipEdge } from "./types.js";

function personalObject(id: string, title: string, tags: string[]): KnowledgeObject {
  return {
    id,
    title,
    source: "personal",
    kind: "document",
    summary: title,
    tags,
    updatedAt: 1,
  };
}

describe("buildKnowledgeSourceBundle extraEdges merge", () => {
  it("merges valid extra edges and drops self-loops and unknown-node edges", () => {
    const objects = [
      personalObject("obj:x", "X", ["alpha"]),
      personalObject("obj:y", "Y", ["beta"]),
    ];
    const extraEdges: RelationshipEdge[] = [
      { sourceId: "node:obj:x", targetId: "node:obj:y", relationType: "conflicts", score: 50 },
      // self-loop → dropped
      { sourceId: "node:obj:x", targetId: "node:obj:x", relationType: "related", score: 1 },
      // endpoint not a known node → dropped
      { sourceId: "node:obj:x", targetId: "node:obj:zzz", relationType: "related", score: 1 },
    ];

    const bundle = buildKnowledgeSourceBundle({ objects, extraEdges });

    const conflictEdges = bundle.graph.edges.filter(
      (edge) =>
        edge.relationType === "conflicts" &&
        ((edge.sourceId === "node:obj:x" && edge.targetId === "node:obj:y") ||
          (edge.sourceId === "node:obj:y" && edge.targetId === "node:obj:x")),
    );
    expect(conflictEdges).toHaveLength(1);
    expect(bundle.graph.edges.some((edge) => edge.sourceId === edge.targetId)).toBe(false);
    expect(
      bundle.graph.edges.some(
        (edge) => edge.sourceId === "node:obj:zzz" || edge.targetId === "node:obj:zzz",
      ),
    ).toBe(false);
  });

  it("deduplicates extra edges by unordered endpoint pair and relation type", () => {
    const objects = [
      personalObject("obj:x", "X", ["alpha"]),
      personalObject("obj:y", "Y", ["beta"]),
    ];
    const extraEdges: RelationshipEdge[] = [
      { sourceId: "node:obj:x", targetId: "node:obj:y", relationType: "conflicts", score: 50 },
      // same pair (reversed) + same type → deduped
      { sourceId: "node:obj:y", targetId: "node:obj:x", relationType: "conflicts", score: 90 },
    ];

    const bundle = buildKnowledgeSourceBundle({ objects, extraEdges });

    const conflictEdges = bundle.graph.edges.filter((edge) => edge.relationType === "conflicts");
    expect(conflictEdges).toHaveLength(1);
  });
});
