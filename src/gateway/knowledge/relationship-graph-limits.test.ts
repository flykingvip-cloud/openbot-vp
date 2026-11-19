import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_LIBRARY_GRAPH_MAX_EDGES,
  KNOWLEDGE_LIBRARY_GRAPH_MAX_NODES,
  KNOWLEDGE_RELATIONSHIPS_SUMMARY_MAX_EDGES,
  KNOWLEDGE_RELATIONSHIPS_SUMMARY_MAX_NODES,
  capRelationshipGraph,
} from "./relationship-graph-limits.js";
import type { RelationshipGraph } from "./types.js";

function makeGraph(nodeCount: number, edgeCount: number, includeHubs = true): RelationshipGraph {
  const nodes = [];
  if (includeHubs) {
    nodes.push({ id: "node:me", kind: "owner" as const, title: "hub-me" });
    nodes.push({
      id: "node:obj:kb:1",
      kind: "knowledge-base" as const,
      title: "hub-kb",
      objectId: "obj:kb:1",
    });
  }
  const start = nodes.length;
  for (let index = 0; index < nodeCount - start; index += 1) {
    nodes.push({
      id: `node:obj:${index}`,
      kind: "knowledge-object" as const,
      title: `n-${index}`,
      objectId: `obj:${index}`,
      governance: { status: "healthy" as const, usageCount: index },
    });
  }
  const edges = [];
  for (let index = 0; index < edgeCount; index += 1) {
    const source = nodes[index % nodes.length];
    const target = nodes[(index + 1) % nodes.length];
    if (source.id === target.id) {
      continue;
    }
    edges.push({
      sourceId: source.id,
      targetId: target.id,
      relationType: "related" as const,
      score: 1 - index / Math.max(edgeCount, 1),
    });
  }
  return { nodes, edges };
}

describe("relationship graph limits", () => {
  it("leaves a small graph unchanged", () => {
    const graph = makeGraph(3, 2);
    expect(capRelationshipGraph(graph, "summary")).toBe(graph);
  });

  it("caps an unfocused summary and keeps space/hub nodes", () => {
    const graph = makeGraph(
      KNOWLEDGE_RELATIONSHIPS_SUMMARY_MAX_NODES + 40,
      KNOWLEDGE_RELATIONSHIPS_SUMMARY_MAX_EDGES + 80,
    );
    const capped = capRelationshipGraph(graph, "summary");
    expect(capped).not.toBe(graph);
    expect(capped.nodes.length).toBeLessThanOrEqual(KNOWLEDGE_RELATIONSHIPS_SUMMARY_MAX_NODES);
    expect(capped.edges.length).toBeLessThanOrEqual(KNOWLEDGE_RELATIONSHIPS_SUMMARY_MAX_EDGES);
    expect(capped.nodes.some((node) => node.id === "node:me")).toBe(true);
    expect(capped.nodes.some((node) => node.kind === "knowledge-base")).toBe(true);
  });

  it("caps a library panorama to the documented library limits", () => {
    const graph = makeGraph(
      KNOWLEDGE_LIBRARY_GRAPH_MAX_NODES + 20,
      KNOWLEDGE_LIBRARY_GRAPH_MAX_EDGES + 20,
      false,
    );
    const capped = capRelationshipGraph(graph, "library");
    expect(capped.nodes.length).toBeLessThanOrEqual(KNOWLEDGE_LIBRARY_GRAPH_MAX_NODES);
    expect(capped.edges.length).toBeLessThanOrEqual(KNOWLEDGE_LIBRARY_GRAPH_MAX_EDGES);
  });
});
