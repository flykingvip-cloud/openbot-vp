import { describe, expect, it } from "vitest";
import {
  buildDefaultKnowledgeObjects,
  buildDefaultKnowledgeSourceSummary,
  buildDefaultRelationshipGraph,
} from "./mock-graph.js";
import { knowledgeRecommendationsFromBundle } from "./router.js";
import type { KnowledgeSourceBundle } from "./sources/types.js";

function mockKnowledgeBundle(): KnowledgeSourceBundle {
  return {
    objects: buildDefaultKnowledgeObjects(),
    dataCapabilities: [],
    sourceSummary: buildDefaultKnowledgeSourceSummary(),
    sourceBrowse: { personal: [], enterprise: [], enterpriseRestricted: [] },
    externalDataSources: [],
    feedItems: [],
    graph: buildDefaultRelationshipGraph(),
  };
}

describe("knowledge recommendations", () => {
  it("includes reason on each recommendation item", () => {
    const recommendations = knowledgeRecommendationsFromBundle(mockKnowledgeBundle(), { limit: 4 });
    expect(recommendations.length).toBeGreaterThan(0);
    for (const item of recommendations) {
      expect(item.reason.trim().length).toBeGreaterThan(0);
      expect(item.object.title.trim().length).toBeGreaterThan(0);
    }
  });

  it("returns graph-linked recommendations for a focus object", () => {
    const bundle = mockKnowledgeBundle();
    const focus = bundle.objects[0]?.id;
    const recommendations = knowledgeRecommendationsFromBundle(bundle, {
      limit: 4,
      focusObjectId: focus,
    });
    expect(recommendations.every((item) => item.object.id !== focus)).toBe(true);
    expect(recommendations.every((item) => item.reason.length > 0)).toBe(true);
  });
});
