import { describe, expect, it } from "vitest";
import type { KnowledgeObject } from "../types.js";
import { buildKnowledgeRelatedGroups } from "./related-groups.js";
import { buildIntelligentRelationshipGraph } from "./relationship-runtime.js";

describe("buildKnowledgeRelatedGroups", () => {
  it("groups neighbors by knowledge, data, agents and owners", () => {
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
    const runtime = buildIntelligentRelationshipGraph({
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
    const groups = buildKnowledgeRelatedGroups({
      objectId: "obj:enterprise:projection-1",
      objects: runtime.objects,
      graph: runtime.graph,
    });
    expect(groups.object?.id).toBe("obj:enterprise:projection-1");
    expect(groups.dataCapabilities.length + groups.knowledge.length).toBeGreaterThan(0);
    expect(groups.graph.nodes.length).toBeGreaterThan(0);
  });
});
