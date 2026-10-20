import { describe, expect, it } from "vitest";
import { buildDefaultRelationshipGraph } from "../../../../../src/gateway/knowledge/mock-graph.ts";
import {
  buildHomeGraphViewModel,
  buildRadialGraphLayout,
  formatGraphNodeLabelLines,
} from "./graph-layout.ts";
import type { RelationshipGraph } from "./types.ts";

describe("knowledge universe graph layout", () => {
  it("positions the center node and renders all graph nodes", () => {
    const graph = buildDefaultRelationshipGraph();
    const layout = buildRadialGraphLayout(graph);
    const center = layout.nodes.find((node) => node.id === "node:me");
    expect(center).toBeTruthy();
    expect(layout.nodes.length).toBe(graph.nodes.length);
    expect(layout.edges.length).toBe(graph.edges.length);
  });

  it("keeps node bodies above the two-line label reserve", () => {
    const graph = buildDefaultRelationshipGraph();
    const layout = buildRadialGraphLayout(graph);
    const labelReserve = 40;
    for (const node of layout.nodes) {
      expect(node.y + node.radius).toBeLessThanOrEqual(layout.height - labelReserve);
    }
  });

  it("wraps long titles into at most two label lines", () => {
    expect(formatGraphNodeLabelLines("短标题")).toEqual(["短标题"]);
    const lines = formatGraphNodeLabelLines(
      "Agent Design Patterns (Anthropic) 完整实践手册与落地清单",
    );
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines.join("").includes("…") || lines.reduce((n, l) => n + l.length, 0) > 14).toBe(true);
    expect(lines.every((line) => line.length <= 14)).toBe(true);
  });

  it("adapts relationship graph into a view model", () => {
    const graph = buildDefaultRelationshipGraph();
    const viewModel = buildHomeGraphViewModel(graph);
    expect(viewModel.width).toBeGreaterThan(0);
    expect(viewModel.height).toBeGreaterThan(0);
    expect(viewModel.nodes.every((node) => node.label.length > 0)).toBe(true);
  });

  it("maps knowledge-base and deliverable node kinds to distinct categories", () => {
    const graph: RelationshipGraph = {
      nodes: [
        { id: "node:me", kind: "owner", title: "我" },
        {
          id: "node:obj:kb:kb-1",
          kind: "knowledge-base",
          title: "知识库",
          objectId: "obj:kb:kb-1",
        },
        {
          id: "node:obj:deliverable:d-1",
          kind: "deliverable",
          title: "成果",
          objectId: "obj:deliverable:d-1",
        },
      ],
      edges: [],
    };
    const layout = buildRadialGraphLayout(graph);
    expect(layout.nodes.find((node) => node.id === "node:obj:kb:kb-1")?.category).toBe(
      "knowledge-base",
    );
    expect(layout.nodes.find((node) => node.id === "node:obj:deliverable:d-1")?.category).toBe(
      "deliverable",
    );
  });
});
