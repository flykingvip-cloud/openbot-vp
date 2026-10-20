import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./document-ego-graph-runtime.js", () => ({
  buildKnowledgeBaseLibraryGraphForKnowledgeBase: vi.fn(
    async (params: { knowledgeBaseId: string }) => ({
      nodes: [
        {
          id: "node:obj:doc:doc-a",
          kind: "knowledge-object",
          title: "文档 A",
          objectId: "obj:doc:doc-a",
          summary: "库内文档",
          governance: { status: "healthy", conflictCount: 0 },
        },
        {
          id: "node:obj:doc:doc-b",
          kind: "knowledge-object",
          title: "文档 B",
          objectId: "obj:doc:doc-b",
          summary: "库内文档",
          governance: { status: "healthy", conflictCount: 0 },
        },
      ],
      edges: [
        {
          sourceId: "node:obj:doc:doc-a",
          targetId: "node:obj:doc:doc-b",
          relationType: "related",
          score: 0.8,
          reasons: [`library-panorama:${params.knowledgeBaseId}`],
        },
      ],
    }),
  ),
  buildDocumentEgoGraphForKnowledgeBase: vi.fn(async () => null),
}));

import { buildKnowledgeBaseLibraryGraphForKnowledgeBase } from "./document-ego-graph-runtime.js";
import { knowledgeRelationships } from "./router.js";

describe("knowledgeRelationships library panorama", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns library document panorama when knowledgeBaseId is set without document focus", async () => {
    const graph = await knowledgeRelationships(null, {
      knowledgeBaseId: "kb-enterprise-1",
    });

    expect(buildKnowledgeBaseLibraryGraphForKnowledgeBase).toHaveBeenCalledWith({
      knowledgeBaseId: "kb-enterprise-1",
    });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.every((node) => node.kind === "knowledge-object")).toBe(true);
    expect(graph.edges).toHaveLength(1);
  });
});
