import { beforeEach, describe, expect, it } from "vitest";
import type { KnowledgeObject } from "../types.js";
import {
  buildIntelligentRelationshipGraph,
  clearRelationshipRuntimeCache,
} from "./relationship-runtime.js";

function sampleObjects(now: number): KnowledgeObject[] {
  return [
    {
      id: "obj:personal:a",
      title: "退款政策",
      source: "personal",
      kind: "document",
      summary: "企业退款 24 小时内升级",
      tags: ["退款", "政策"],
      updatedAt: now,
    },
    {
      id: "obj:enterprise:b",
      title: "客户手册",
      source: "enterprise",
      kind: "document",
      summary: "客户服务标准手册",
      tags: ["客户", "手册"],
      updatedAt: now,
    },
  ];
}

describe("relationship runtime memoization", () => {
  beforeEach(() => {
    clearRelationshipRuntimeCache();
  });

  it("returns the cached result for an unchanged knowledge set", () => {
    const objects = sampleObjects(1_000);
    const first = buildIntelligentRelationshipGraph({ objects });
    const second = buildIntelligentRelationshipGraph({ objects: sampleObjects(1_000) });
    // Same signature → same memoized reference (no rebuild).
    expect(second).toBe(first);
    expect(first.graph.nodes.length).toBeGreaterThan(0);
  });

  it("recomputes when the knowledge set changes", () => {
    const first = buildIntelligentRelationshipGraph({ objects: sampleObjects(1_000) });
    const changed = sampleObjects(2_000); // bumped updatedAt → different signature
    const second = buildIntelligentRelationshipGraph({ objects: changed });
    expect(second).not.toBe(first);
  });

  it("rebuilds after the cache is cleared", () => {
    const first = buildIntelligentRelationshipGraph({ objects: sampleObjects(1_000) });
    clearRelationshipRuntimeCache();
    const second = buildIntelligentRelationshipGraph({ objects: sampleObjects(1_000) });
    expect(second).not.toBe(first);
    // Equivalent graph shape after a clean rebuild.
    expect(second.graph.nodes.length).toBe(first.graph.nodes.length);
    expect(second.graph.edges.length).toBe(first.graph.edges.length);
  });
});
