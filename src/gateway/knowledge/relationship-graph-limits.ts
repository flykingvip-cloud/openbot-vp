import type { RelationshipGraph, RelationshipNode } from "./types.js";

/**
 * Caps for relationship graphs returned on the knowledge-universe home path.
 *
 * The shared source bundle may still hold the full in-memory object set and
 * graph used by search / recommendations / actions. These limits apply to the
 * `knowledge.relationships` *response* so the default home view does not ship
 * an unbounded library panorama to the client.
 *
 * - Unfocused home: keep space / hub nodes first, then high-degree nodes.
 * - Selected space (library panorama) and document ego: hard caps (pagination
 *   is a follow-up; see t317 P2).
 */
export const KNOWLEDGE_RELATIONSHIPS_SUMMARY_MAX_NODES = 80;
export const KNOWLEDGE_RELATIONSHIPS_SUMMARY_MAX_EDGES = 160;

export const KNOWLEDGE_LIBRARY_GRAPH_MAX_NODES = 200;
export const KNOWLEDGE_LIBRARY_GRAPH_MAX_EDGES = 400;

export const KNOWLEDGE_DOCUMENT_EGO_GRAPH_MAX_NODES = 200;
export const KNOWLEDGE_DOCUMENT_EGO_GRAPH_MAX_EDGES = 400;

export type RelationshipGraphLimitKind = "summary" | "library" | "document-ego";

const LIMITS: Record<RelationshipGraphLimitKind, { maxNodes: number; maxEdges: number }> = {
  summary: {
    maxNodes: KNOWLEDGE_RELATIONSHIPS_SUMMARY_MAX_NODES,
    maxEdges: KNOWLEDGE_RELATIONSHIPS_SUMMARY_MAX_EDGES,
  },
  library: {
    maxNodes: KNOWLEDGE_LIBRARY_GRAPH_MAX_NODES,
    maxEdges: KNOWLEDGE_LIBRARY_GRAPH_MAX_EDGES,
  },
  "document-ego": {
    maxNodes: KNOWLEDGE_DOCUMENT_EGO_GRAPH_MAX_NODES,
    maxEdges: KNOWLEDGE_DOCUMENT_EGO_GRAPH_MAX_EDGES,
  },
};

function isHubOrSpaceNode(node: RelationshipNode): boolean {
  if (node.kind === "knowledge-base" || node.kind === "owner") {
    return true;
  }
  if (node.id === "node:me" || node.id.startsWith("node:hub:")) {
    return true;
  }
  return false;
}

function degreeByNodeId(graph: RelationshipGraph): Map<string, number> {
  const degrees = new Map<string, number>();
  for (const node of graph.nodes) {
    degrees.set(node.id, 0);
  }
  for (const edge of graph.edges) {
    degrees.set(edge.sourceId, (degrees.get(edge.sourceId) ?? 0) + 1);
    degrees.set(edge.targetId, (degrees.get(edge.targetId) ?? 0) + 1);
  }
  return degrees;
}

export function capRelationshipGraph(
  graph: RelationshipGraph,
  kind: RelationshipGraphLimitKind,
): RelationshipGraph {
  const { maxNodes, maxEdges } = LIMITS[kind];
  if (graph.nodes.length <= maxNodes && graph.edges.length <= maxEdges) {
    return graph;
  }

  const degrees = degreeByNodeId(graph);
  const ranked = [...graph.nodes].toSorted((left, right) => {
    const hubDelta = Number(isHubOrSpaceNode(right)) - Number(isHubOrSpaceNode(left));
    if (hubDelta !== 0) {
      return hubDelta;
    }
    const usageDelta = (right.governance?.usageCount ?? 0) - (left.governance?.usageCount ?? 0);
    if (usageDelta !== 0) {
      return usageDelta;
    }
    return (degrees.get(right.id) ?? 0) - (degrees.get(left.id) ?? 0);
  });

  const keptIds = new Set(ranked.slice(0, maxNodes).map((node) => node.id));
  // Always keep hubs/spaces even if that evicts a lower-priority tail.
  for (const node of graph.nodes) {
    if (isHubOrSpaceNode(node)) {
      keptIds.add(node.id);
    }
  }
  if (keptIds.size > maxNodes) {
    const extras = [...keptIds].filter((id) => {
      const node = graph.nodes.find((item) => item.id === id);
      return !node || !isHubOrSpaceNode(node);
    });
    const overflow = keptIds.size - maxNodes;
    for (const id of extras.slice(-overflow)) {
      keptIds.delete(id);
    }
  }

  const nodes = graph.nodes.filter((node) => keptIds.has(node.id));
  const edges = graph.edges
    .filter((edge) => keptIds.has(edge.sourceId) && keptIds.has(edge.targetId))
    .toSorted((left, right) => right.score - left.score)
    .slice(0, maxEdges);

  if (edges.length === graph.edges.length && nodes.length === graph.nodes.length) {
    return graph;
  }
  return { nodes, edges };
}
