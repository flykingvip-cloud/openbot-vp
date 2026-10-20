import { describe, expect, it } from "vitest";
import {
  anchorHierarchicalChunks,
  buildStableKnowledgeChunkAnchor,
  planChunkDelta,
  summarizeChunkDelta,
  type PreviousChunkSnapshot,
} from "./chunk-delta.js";
import type { HierarchicalChunk } from "./chunkers/hierarchical.js";

function chunk(
  partial: Partial<HierarchicalChunk> & Pick<HierarchicalChunk, "text" | "hash">,
): HierarchicalChunk {
  return {
    heading: partial.heading ?? null,
    section: partial.section ?? null,
    startLine: partial.startLine ?? 1,
    endLine: partial.endLine ?? 1,
    text: partial.text,
    hash: partial.hash,
  };
}

describe("chunk-delta (P4)", () => {
  it("builds stable anchors independent of version/text hash", () => {
    const a = buildStableKnowledgeChunkAnchor({
      kbId: "kb",
      docId: "doc",
      sectionKey: "s\0h",
      ordinal: 0,
    });
    const b = buildStableKnowledgeChunkAnchor({
      kbId: "kb",
      docId: "doc",
      sectionKey: "s\0h",
      ordinal: 0,
    });
    const c = buildStableKnowledgeChunkAnchor({
      kbId: "kb",
      docId: "doc",
      sectionKey: "s\0h",
      ordinal: 1,
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith("lfchk:")).toBe(true);
  });

  it("plans keep/update/add/remove by anchor and text hash", () => {
    const next = anchorHierarchicalChunks({
      kbId: "kb",
      docId: "doc",
      chunks: [
        chunk({ text: "same body", hash: "h1", heading: "A", startLine: 1, endLine: 2 }),
        chunk({ text: "changed body", hash: "h2b", heading: "B", startLine: 3, endLine: 4 }),
        chunk({ text: "brand new", hash: "h3", heading: "C", startLine: 5, endLine: 6 }),
      ],
    });

    const previous: PreviousChunkSnapshot[] = [
      {
        chunkId: next[0].anchorId,
        text: "same body",
        textHash: "h1",
        model: "mock",
        heading: "A",
        section: null,
        startLine: 1,
        endLine: 2,
        sectionKey: next[0].sectionKey,
        ordinal: 0,
        anchorId: next[0].anchorId,
      },
      {
        chunkId: next[1].anchorId,
        text: "old body",
        textHash: "h2a",
        model: "mock",
        heading: "B",
        section: null,
        startLine: 3,
        endLine: 4,
        sectionKey: next[1].sectionKey,
        ordinal: 0,
        anchorId: next[1].anchorId,
      },
      {
        chunkId: "orphan-id",
        text: "gone",
        textHash: "hx",
        model: "mock",
        heading: "Z",
        section: null,
        startLine: 9,
        endLine: 10,
        sectionKey: "\0Z",
        ordinal: 0,
        anchorId: buildStableKnowledgeChunkAnchor({
          kbId: "kb",
          docId: "doc",
          sectionKey: "\0Z",
          ordinal: 0,
        }),
      },
    ];

    const plan = planChunkDelta({ previous, next, model: "mock" });
    expect(plan.keep).toHaveLength(1);
    expect(plan.keep[0]?.next.text).toBe("same body");
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]?.next.text).toBe("changed body");
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0]?.text).toBe("brand new");
    expect(plan.remove).toHaveLength(1);
    expect(plan.remove[0]?.text).toBe("gone");

    const stats = summarizeChunkDelta(plan);
    expect(stats.kept).toBe(1);
    expect(stats.updated).toBe(1);
    expect(stats.added).toBe(1);
    expect(stats.removed).toBe(1);
    expect(stats.embedCount).toBe(2);
  });
});
