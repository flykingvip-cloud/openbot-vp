import { describe, expect, it } from "vitest";
import type { KnowledgeObject } from "../types.js";
import { enrichKnowledgeObjectsWithExplicitMetadata } from "./explicit-graph-enrichment.js";
import { buildCandidateRelationships } from "./relationship-builder.js";

function obj(id: string, title: string, tags: string[] = []): KnowledgeObject {
  return {
    id,
    title,
    source: "personal",
    kind: "document",
    summary: title,
    tags,
    updatedAt: Date.now(),
  };
}

describe("explicit graph enrichment (P2)", () => {
  it("merges tags and relatedObjectIds from explicit metadata by docId only", () => {
    const objects = [obj("doc-a", "Alpha"), obj("doc-b", "Beta")];
    const enriched = enrichKnowledgeObjectsWithExplicitMetadata({
      objects,
      metadataRecords: [
        {
          docId: "doc-a",
          title: "Alpha",
          knowledgeBaseId: "kb-1",
          wikilinks: [{ target: "Beta", raw: "[[Beta]]" }],
          tags: ["wiki", "plan"],
          frontmatter: { title: "Alpha" },
          updatedAtMs: Date.now(),
        },
      ],
    });
    const alpha = enriched.find((item) => item.id === "doc-a")!;
    expect(alpha.tags).toEqual(expect.arrayContaining(["wiki", "plan"]));
    expect(alpha.relatedObjectIds).toContain("doc-b");
  });

  it("does not attach metadata by title alone (cross-space safety)", () => {
    const objects = [obj("other-id", "Alpha")];
    const enriched = enrichKnowledgeObjectsWithExplicitMetadata({
      objects,
      metadataRecords: [
        {
          docId: "doc-a",
          title: "Alpha",
          knowledgeBaseId: "kb-other",
          wikilinks: [],
          tags: ["leaked"],
          frontmatter: {},
          updatedAtMs: Date.now(),
        },
      ],
    });
    expect(enriched[0]?.tags).not.toContain("leaked");
  });

  it("emits explicit-wikilink candidates from metadata by docId source", () => {
    const objects = [obj("doc-a", "Alpha"), obj("doc-b", "Beta")];
    const candidates = buildCandidateRelationships({
      objects,
      explicitMetadata: [
        {
          docId: "doc-a",
          title: "Alpha",
          wikilinks: [{ target: "Beta", raw: "[[Beta]]" }],
          tags: [],
          frontmatter: {},
          updatedAtMs: Date.now(),
        },
      ],
    });
    const edge = candidates.find(
      (item) => item.sourceObjectId === "doc-a" && item.targetObjectId === "doc-b",
    );
    expect(edge?.reasons?.some((r) => r.startsWith("explicit-wikilink"))).toBe(true);
    expect(edge?.baseScore).toBeGreaterThanOrEqual(84);
  });

  it("does not attach wikilink source to wrong same-title object when docId differs", () => {
    const objects = [
      obj("doc-a", "Shared Title"),
      obj("doc-wrong", "Shared Title"),
      obj("doc-b", "Beta"),
    ];
    const candidates = buildCandidateRelationships({
      objects,
      explicitMetadata: [
        {
          docId: "doc-a",
          title: "Shared Title",
          wikilinks: [{ target: "Beta", raw: "[[Beta]]" }],
          tags: [],
          frontmatter: {},
          updatedAtMs: Date.now(),
        },
      ],
    });
    const edgesFromA = candidates.filter(
      (item) =>
        item.sourceObjectId === "doc-a" &&
        item.targetObjectId === "doc-b" &&
        item.reasons?.some((r) => r.startsWith("explicit-wikilink")),
    );
    const edgesFromWrong = candidates.filter(
      (item) =>
        item.sourceObjectId === "doc-wrong" &&
        item.reasons?.some((r) => r.startsWith("explicit-wikilink")),
    );
    expect(edgesFromA.length).toBe(1);
    expect(edgesFromWrong.length).toBe(0);
  });
});
