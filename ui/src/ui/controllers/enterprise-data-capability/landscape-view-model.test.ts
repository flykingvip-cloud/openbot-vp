import { describe, expect, it } from "vitest";
import type { AssetLandscapeGraph } from "../../capability/enterprise-data-capability/types.ts";
import {
  buildLandscapeViewModel,
  landscapeNodeTone,
  resolveLandscapeNeighbors,
} from "./landscape-view-model.ts";

const graph: AssetLandscapeGraph = {
  nodes: [
    { id: "source:s1", kind: "source", label: "CRM" },
    { id: "capability:c1", kind: "capability", label: "销售分析能力" },
    { id: "knowledge:k1", kind: "knowledge", label: "客户画像" },
    { id: "department:d1", kind: "department", label: "sales-mgr:华东销售" },
  ],
  edges: [
    { from: "source:s1", to: "capability:c1", relation: "source" },
    { from: "capability:c1", to: "knowledge:k1", relation: "generate" },
    { from: "source:s1", to: "department:d1", relation: "open" },
  ],
  truncated: false,
};

describe("landscape-view-model", () => {
  it("places nodes into four columns by kind", () => {
    const vm = buildLandscapeViewModel(graph);
    const byId = new Map(vm.nodes.map((node) => [node.id, node] as const));
    expect(byId.get("source:s1")?.column).toBe(0);
    expect(byId.get("capability:c1")?.column).toBe(1);
    expect(byId.get("knowledge:k1")?.column).toBe(2);
    expect(byId.get("department:d1")?.column).toBe(3);
    // columns increase in x
    expect(byId.get("source:s1")!.x).toBeLessThan(byId.get("capability:c1")!.x);
    expect(byId.get("capability:c1")!.x).toBeLessThan(byId.get("knowledge:k1")!.x);
    expect(byId.get("knowledge:k1")!.x).toBeLessThan(byId.get("department:d1")!.x);
  });

  it("maps each kind to its tone color", () => {
    expect(landscapeNodeTone("source")).toBe("blue");
    expect(landscapeNodeTone("capability")).toBe("green");
    expect(landscapeNodeTone("knowledge")).toBe("purple");
    expect(landscapeNodeTone("department")).toBe("amber");
    expect(landscapeNodeTone("seat")).toBe("amber");
    expect(landscapeNodeTone("role")).toBe("amber");
  });

  it("computes positioned edges with endpoints resolved to node coordinates", () => {
    const vm = buildLandscapeViewModel(graph);
    expect(vm.edges).toHaveLength(3);
    for (const edge of vm.edges) {
      expect(Number.isFinite(edge.x1)).toBe(true);
      expect(Number.isFinite(edge.y2)).toBe(true);
    }
  });

  it("resolves neighbors of a node from the in-memory graph", () => {
    const neighbors = resolveLandscapeNeighbors(graph, "capability:c1");
    expect(neighbors).not.toBeNull();
    expect(neighbors!.incoming.some((entry) => entry.node.id === "source:s1")).toBe(true);
    expect(
      neighbors!.outgoing.some(
        (entry) => entry.node.id === "knowledge:k1" && entry.relation === "generate",
      ),
    ).toBe(true);
  });

  it("returns null for an unknown node id", () => {
    expect(resolveLandscapeNeighbors(graph, "nope")).toBeNull();
  });
});
