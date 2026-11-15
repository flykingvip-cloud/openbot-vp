import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KNOWLEDGE_RELATIONSHIPS_SUMMARY_MAX_EDGES,
  KNOWLEDGE_RELATIONSHIPS_SUMMARY_MAX_NODES,
} from "./relationship-graph-limits.js";

vi.mock("./source-bundle.js", () => ({
  loadKnowledgeSourceBundle: vi.fn(async () => {
    const nodes = [
      { id: "node:me", kind: "owner", title: "hub-me" },
      {
        id: "node:obj:kb:1",
        kind: "knowledge-base",
        title: "hub-kb",
        objectId: "obj:kb:1",
      },
    ];
    for (let index = 0; index < KNOWLEDGE_RELATIONSHIPS_SUMMARY_MAX_NODES + 10; index += 1) {
      nodes.push({
        id: `node:obj:${index}`,
        kind: "knowledge-object",
        title: `n-${index}`,
        objectId: `obj:${index}`,
      });
    }
    const edges = nodes.slice(1).map((node, index) => ({
      sourceId: "node:me",
      targetId: node.id,
      relationType: "related",
      score: 1 - index / nodes.length,
    }));
    return {
      objects: [],
      dataCapabilities: [],
      sourceSummary: {
        personal: { documentCount: 0, recentUpdates: 0 },
        enterprise: { libraryCount: 0, accessibleCount: 0 },
        data: { grantedCount: 0, requestableCount: 0, externalSourceCount: 0 },
      },
      sourceBrowse: { personal: [], enterprise: [], enterpriseRestricted: [] },
      externalDataSources: [],
      feedItems: [],
      graph: { nodes, edges },
    };
  }),
}));

import { knowledgeRelationships } from "./router.js";

describe("knowledgeRelationships unfocused summary", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("caps the default home graph and keeps space/hub nodes", async () => {
    const graph = await knowledgeRelationships(null, {});
    expect(graph.nodes.length).toBeLessThanOrEqual(KNOWLEDGE_RELATIONSHIPS_SUMMARY_MAX_NODES);
    expect(graph.edges.length).toBeLessThanOrEqual(KNOWLEDGE_RELATIONSHIPS_SUMMARY_MAX_EDGES);
    expect(graph.nodes.some((node) => node.kind === "knowledge-base")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "node:me")).toBe(true);
  });
});
