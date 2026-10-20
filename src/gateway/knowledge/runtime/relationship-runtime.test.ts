import { describe, expect, it } from "vitest";
import type { KnowledgeObject } from "../types.js";
import { buildRelationshipRecommendations } from "./relationship-recommendation.js";
import { buildIntelligentRelationshipGraph } from "./relationship-runtime.js";

describe("buildIntelligentRelationshipGraph", () => {
  it("enriches objects with relationship summaries", () => {
    const objects: KnowledgeObject[] = [
      {
        id: "obj:enterprise:projection-1",
        title: "客户画像",
        source: "enterprise",
        kind: "document",
        summary: "enterprise projection",
        tags: ["customer", "客户画像"],
        updatedAt: 1,
        relatedObjectIds: ["obj:data:cap-1"],
      },
      {
        id: "obj:data:cap-1",
        title: "客户画像能力",
        source: "data",
        kind: "metric",
        summary: "data capability",
        tags: ["客户画像"],
        updatedAt: 1,
      },
    ];
    const result = buildIntelligentRelationshipGraph({
      objects,
      dataCapabilities: [
        {
          id: "cap-1",
          title: "客户画像能力",
          summary: "data capability",
          sourceSystems: ["CRM"],
          scenarios: ["客户画像"],
          visibleAgents: ["sales-bot"],
          accessState: "granted",
        },
      ],
    });
    expect(result.graph.edges.length).toBeGreaterThan(0);
    expect(result.objects.every((item) => item.relationshipSummary)).toBe(true);
    expect(result.objects.some((item) => item.id === "obj:agent:sales-bot")).toBe(true);
    const recommendations = buildRelationshipRecommendations({
      objects: result.objects,
      graph: result.graph,
      focusObjectId: "obj:enterprise:projection-1",
      limit: 4,
    });
    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations.every((item) => item.object.id !== "obj:enterprise:projection-1")).toBe(
      true,
    );
    expect(recommendations[0]?.reason).toBeTruthy();
  });

  it("carries candidate reason tokens on scored-candidate edges", () => {
    const objects: KnowledgeObject[] = [
      {
        id: "obj:personal:a",
        title: "HR 制度 A",
        source: "personal",
        kind: "policy",
        summary: "policy a",
        tags: ["HR", "制度"],
        updatedAt: Date.now(),
      },
      {
        id: "obj:personal:b",
        title: "HR 制度 B",
        source: "personal",
        kind: "policy",
        summary: "policy b",
        tags: ["HR", "制度"],
        updatedAt: Date.now(),
      },
    ];
    const result = buildIntelligentRelationshipGraph({ objects });
    const withReasons = result.graph.edges.filter((edge) => edge.reasons && edge.reasons.length);
    expect(withReasons.length).toBeGreaterThan(0);
    // The two policies share tags → a related edge whose reason explains the shared tags.
    const sharedTagEdge = withReasons.find((edge) =>
      edge.reasons?.some((reason) => reason.startsWith("shared-tags:")),
    );
    expect(sharedTagEdge).toBeTruthy();
    expect(sharedTagEdge?.reasons?.some((reason) => reason.includes("制度"))).toBe(true);
  });

  it("attaches usageCount to object-backed nodes when citation totals are supplied", () => {
    const objects: KnowledgeObject[] = [
      {
        id: "obj:kb:kb-hr",
        title: "HR 知识库",
        source: "enterprise",
        kind: "document",
        summary: "kb space",
        tags: ["知识库"],
        updatedAt: 1,
      },
    ];
    const result = buildIntelligentRelationshipGraph({
      objects,
      usageCountByObjectId: { "obj:kb:kb-hr": 12 },
    });
    const kbNode = result.graph.nodes.find((node) => node.objectId === "obj:kb:kb-hr");
    expect(kbNode?.governance?.usageCount).toBe(12);
  });
});
