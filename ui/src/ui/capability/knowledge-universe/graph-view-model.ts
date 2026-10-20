import type { GraphViewModel, RelationshipGraph } from "./types.ts";

export function relationshipGraphToViewModel(
  graph: RelationshipGraph,
  layout: GraphViewModel,
): GraphViewModel {
  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));
  const edges = graph.edges
    .map((edge, index) => {
      if (!nodeById.has(edge.sourceId) || !nodeById.has(edge.targetId)) {
        return null;
      }
      return {
        id: `edge:${index}:${edge.sourceId}:${edge.targetId}`,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        score: edge.score,
        relationType: edge.relationType,
      };
    })
    .filter((edge): edge is GraphViewModel["edges"][number] => edge !== null);

  return {
    width: layout.width,
    height: layout.height,
    nodes: layout.nodes,
    edges,
  };
}

export function findNeighborNodeIds(graph: RelationshipGraph, nodeId: string | null): Set<string> {
  const neighbors = new Set<string>();
  if (!nodeId) {
    return neighbors;
  }
  neighbors.add(nodeId);
  for (const edge of graph.edges) {
    if (edge.sourceId === nodeId) {
      neighbors.add(edge.targetId);
    }
    if (edge.targetId === nodeId) {
      neighbors.add(edge.sourceId);
    }
  }
  return neighbors;
}
