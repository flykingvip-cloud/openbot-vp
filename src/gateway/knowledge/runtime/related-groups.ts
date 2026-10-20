import type {
  KnowledgeObject,
  KnowledgeRelatedGroups,
  RelationshipGraph,
  RelationshipNode,
} from "../types.js";

function nodeIdForObject(objectId: string): string {
  return `node:${objectId}`;
}

export function buildKnowledgeRelatedGroups(params: {
  objectId: string;
  objects: KnowledgeObject[];
  graph: RelationshipGraph;
}): KnowledgeRelatedGroups {
  const object = params.objects.find((item) => item.id === params.objectId) ?? null;
  const focusNodeId = nodeIdForObject(params.objectId);
  const focusNode = params.graph.nodes.find((node) => node.id === focusNodeId) ?? null;
  if (!focusNode) {
    return {
      object,
      knowledge: [],
      dataCapabilities: [],
      agents: [],
      owners: [],
      conflicts: [],
      graph: { nodes: [], edges: [] },
    };
  }

  const neighborIds = new Set<string>([focusNodeId]);
  const conflictObjectIds = new Set<string>();
  for (const edge of params.graph.edges) {
    if (edge.sourceId === focusNodeId || edge.targetId === focusNodeId) {
      neighborIds.add(edge.sourceId);
      neighborIds.add(edge.targetId);
      if (edge.relationType === "conflicts") {
        const otherNodeId = edge.sourceId === focusNodeId ? edge.targetId : edge.sourceId;
        const otherObjectId = params.graph.nodes.find((node) => node.id === otherNodeId)?.objectId;
        if (otherObjectId) {
          conflictObjectIds.add(otherObjectId);
        }
      }
    }
  }

  const subgraph: RelationshipGraph = {
    nodes: params.graph.nodes.filter((node) => neighborIds.has(node.id)),
    edges: params.graph.edges.filter(
      (edge) => neighborIds.has(edge.sourceId) && neighborIds.has(edge.targetId),
    ),
  };

  const neighborNodes = subgraph.nodes.filter((node) => node.id !== focusNodeId);
  const knowledge: KnowledgeObject[] = [];
  const dataCapabilities: KnowledgeObject[] = [];
  const agents: RelationshipNode[] = [];
  const owners: RelationshipNode[] = [];
  const conflicts: KnowledgeObject[] = [];

  for (const node of neighborNodes) {
    if (node.kind === "agent") {
      agents.push(node);
      continue;
    }
    if (node.kind === "owner") {
      owners.push(node);
      continue;
    }
    if (!node.objectId || node.objectId === params.objectId) {
      continue;
    }
    const relatedObject = params.objects.find((item) => item.id === node.objectId);
    if (!relatedObject) {
      continue;
    }
    if (conflictObjectIds.has(relatedObject.id)) {
      conflicts.push(relatedObject);
      continue;
    }
    if (relatedObject.source === "data" || node.kind === "data-capability") {
      dataCapabilities.push(relatedObject);
    } else {
      knowledge.push(relatedObject);
    }
  }

  if (!owners.length && params.graph.nodes.some((node) => node.id === "node:me")) {
    const me = params.graph.nodes.find((node) => node.id === "node:me");
    if (me) {
      owners.push(me);
    }
  }

  return {
    object,
    knowledge,
    dataCapabilities,
    agents,
    owners,
    conflicts,
    graph: subgraph,
  };
}
