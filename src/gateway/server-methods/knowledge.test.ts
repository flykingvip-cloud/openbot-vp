import { describe, expect, it } from "vitest";
import { buildDefaultKnowledgeObjects } from "../knowledge/mock-graph.js";
import {
  knowledgeObjectForNode,
  knowledgeRecent,
  knowledgeRecentRecord,
  knowledgeRecommendations,
  knowledgeRelated,
  knowledgeRelationships,
  knowledgeSearch,
} from "../knowledge/router.js";

describe("knowledge router", () => {
  it("returns search payload with source summary and data capabilities", async () => {
    const result = await knowledgeSearch(null, { query: "" });
    const demoIds = new Set(buildDefaultKnowledgeObjects().map((item) => item.id));
    expect(result.results).toBeInstanceOf(Array);
    expect(result.results.every((item) => !demoIds.has(item.id))).toBe(true);
    expect(result.sourceSummary.personal).toBeTruthy();
    expect(result.sourceSummary.enterprise).toBeTruthy();
    expect(result.sourceSummary.data).toBeTruthy();
    expect(result.dataCapabilities).toBeInstanceOf(Array);
    expect(result.sourceBrowse.personal).toBeInstanceOf(Array);
    expect(result.sourceBrowse.enterprise).toBeInstanceOf(Array);
    expect(result.externalDataSources).toBeInstanceOf(Array);
  });

  it("returns a relationship graph with hub nodes", async () => {
    const graph = await knowledgeRelationships(null, {});
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges).toBeInstanceOf(Array);
  });

  it("returns runtime-driven recommendations with score and reason when graph has links", async () => {
    const search = await knowledgeSearch(null, { query: "", limit: 8 });
    if (search.results.length < 2) {
      return;
    }
    const recommendations = await knowledgeRecommendations(null, {
      limit: 4,
      focusObjectId: search.results[0]?.id ?? null,
    });
    if (!recommendations.length) {
      return;
    }
    expect(recommendations[0]?.object).toBeTruthy();
    expect(typeof recommendations[0]?.score).toBe("number");
    expect(recommendations[0]?.reason).toBeTruthy();
  });

  it("returns grouped related objects for a knowledge object", async () => {
    const search = await knowledgeSearch(null, { query: "", limit: 1 });
    const objectId = search.results[0]?.id;
    if (!objectId) {
      return;
    }
    const related = await knowledgeRelated(null, { objectId });
    expect(related).toHaveProperty("knowledge");
    expect(related).toHaveProperty("dataCapabilities");
    expect(related).toHaveProperty("agents");
    expect(related).toHaveProperty("owners");
    expect(related).toHaveProperty("conflicts");
    expect(related.graph).toBeTruthy();
  });

  it("records and lists recent visits", async () => {
    const search = await knowledgeSearch(null, { query: "", limit: 1 });
    const objectId = search.results[0]?.id;
    if (!objectId) {
      return;
    }
    const recorded = await knowledgeRecentRecord(null, { objectId });
    expect(recorded.visits.length).toBeGreaterThan(0);
    const listed = await knowledgeRecent(null, { limit: 8 });
    expect(listed[0]?.objectId).toBe(objectId);
  });

  it("resolves object by node id when present", async () => {
    const graph = await knowledgeRelationships(null, {});
    const node = graph.nodes.find(
      (entry) => entry.objectId && !entry.objectId.startsWith("obj:hub:"),
    );
    if (!node?.objectId) {
      return;
    }
    const object = await knowledgeObjectForNode(null, node.id);
    expect(object?.id).toBe(node.objectId);
  });
});
