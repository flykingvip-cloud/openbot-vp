import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./document-ego-graph-runtime.js", () => ({
  buildDocumentEgoGraphForKnowledgeBase: vi.fn(async (params: { docId: string }) => ({
    nodes: [
      {
        id: `node:obj:doc:${params.docId}`,
        kind: "knowledge-object",
        title: `Doc ${params.docId}`,
        objectId: `obj:doc:${params.docId}`,
        summary: "暂无跨文档关系",
        governance: { status: "healthy", conflictCount: 0 },
      },
    ],
    edges: [],
  })),
}));

import { buildDocumentEgoGraphForKnowledgeBase } from "./document-ego-graph-runtime.js";
import { knowledgeRelationships } from "./router.js";

describe("knowledgeRelationships document focus", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns document ego topology instead of KB-folder panorama", async () => {
    const graph = await knowledgeRelationships(null, {
      focusDocumentId: "doc-focus-1",
      knowledgeBaseId: "kb-focus-1",
    });

    expect(buildDocumentEgoGraphForKnowledgeBase).toHaveBeenCalledWith({
      knowledgeBaseId: "kb-focus-1",
      docId: "doc-focus-1",
    });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.objectId).toBe("obj:doc:doc-focus-1");
    expect(graph.nodes.some((node) => node.kind === "knowledge-base")).toBe(false);
  });
});
