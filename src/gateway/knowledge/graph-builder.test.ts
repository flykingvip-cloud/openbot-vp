import { describe, expect, it } from "vitest";
import { buildRelationshipGraphFromObjects } from "./graph-builder.js";
import type { KnowledgeObject } from "./types.js";

describe("buildRelationshipGraphFromObjects", () => {
  it("links enterprise knowledge objects to related data capabilities", () => {
    const objects: KnowledgeObject[] = [
      {
        id: "obj:enterprise:projection-1",
        title: "客户画像",
        source: "enterprise",
        kind: "document",
        summary: "enterprise projection",
        tags: ["customer"],
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
    const graph = buildRelationshipGraphFromObjects({
      objects,
      dataCapabilities: [
        {
          id: "cap-1",
          title: "客户画像能力",
          summary: "data capability",
          sourceSystems: ["CRM"],
          scenarios: ["客户画像"],
          visibleAgents: [],
          accessState: "granted",
        },
      ],
    });
    expect(graph.nodes.some((node) => node.id === "node:obj:enterprise:projection-1")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "node:obj:data:cap-1")).toBe(true);
    expect(graph.edges.length).toBeGreaterThan(0);
  });
});
