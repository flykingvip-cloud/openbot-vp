import { buildRelationshipGraphCached } from "./runtime/relationship-runtime-cache.js";
import type { DataCapabilityDescriptor, KnowledgeObject, RelationshipGraph } from "./types.js";

export function buildRelationshipGraphFromObjects(params: {
  objects: KnowledgeObject[];
  dataCapabilities?: DataCapabilityDescriptor[];
}): RelationshipGraph {
  return buildRelationshipGraphCached({
    objects: params.objects,
    dataCapabilities: params.dataCapabilities,
  }).graph;
}

export function buildEnrichedKnowledgeObjects(params: {
  objects: KnowledgeObject[];
  dataCapabilities?: DataCapabilityDescriptor[];
}): KnowledgeObject[] {
  return buildRelationshipGraphCached({
    objects: params.objects,
    dataCapabilities: params.dataCapabilities,
  }).objects;
}

export function filterRelationshipGraph(params: {
  graph: RelationshipGraph;
  query?: string;
  focusNodeId?: string | null;
}): RelationshipGraph {
  const query = (params.query ?? "").trim().toLowerCase();
  if (!query && !params.focusNodeId) {
    return params.graph;
  }
  const nodeIds = new Set(
    params.graph.nodes
      .filter((node) => {
        if (params.focusNodeId && node.id !== params.focusNodeId) {
          const connected = params.graph.edges.some(
            (edge) =>
              (edge.sourceId === params.focusNodeId && edge.targetId === node.id) ||
              (edge.targetId === params.focusNodeId && edge.sourceId === node.id),
          );
          if (node.id !== params.focusNodeId && !connected) {
            return false;
          }
        }
        if (!query) {
          return true;
        }
        return `${node.title} ${node.kind} ${node.summary ?? ""}`.toLowerCase().includes(query);
      })
      .map((node) => node.id),
  );
  if (params.focusNodeId) {
    nodeIds.add(params.focusNodeId);
  }
  return {
    nodes: params.graph.nodes.filter((node) => nodeIds.has(node.id)),
    edges: params.graph.edges.filter(
      (edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId),
    ),
  };
}
