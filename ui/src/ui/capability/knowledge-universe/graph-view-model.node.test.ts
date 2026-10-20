import { describe, expect, it } from "vitest";
import { buildDefaultRelationshipGraph } from "../../../../../src/gateway/knowledge/mock-graph.ts";
import { buildRadialGraphLayout } from "./graph-layout.ts";
import { findNeighborNodeIds, relationshipGraphToViewModel } from "./graph-view-model.ts";

describe("knowledge universe graph view model", () => {
  it("filters edges to nodes present in the layout", () => {
    const graph = buildDefaultRelationshipGraph();
    const layout = buildRadialGraphLayout(graph);
    const viewModel = relationshipGraphToViewModel(graph, layout);
    expect(viewModel.edges.length).toBeGreaterThan(0);
    for (const edge of viewModel.edges) {
      expect(viewModel.nodes.some((node) => node.id === edge.sourceId)).toBe(true);
      expect(viewModel.nodes.some((node) => node.id === edge.targetId)).toBe(true);
    }
  });

  it("collects neighbor ids for focus highlighting", () => {
    const graph = buildDefaultRelationshipGraph();
    const neighbors = findNeighborNodeIds(graph, "node:me");
    expect(neighbors.has("node:me")).toBe(true);
    expect(neighbors.has("node:personal")).toBe(true);
    expect(neighbors.has("node:enterprise")).toBe(true);
    expect(neighbors.has("node:data")).toBe(true);
  });
});
