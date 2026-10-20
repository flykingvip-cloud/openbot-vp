import type { RelationshipGraph, RelationshipNode } from "./types.ts";

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function documentKnowledgeObjectId(docId: string): string {
  return `obj:doc:${docId.trim()}`;
}

export function documentKnowledgeNodeId(docId: string): string {
  return `node:${documentKnowledgeObjectId(docId)}`;
}

/** Mirror gateway `nodeIdForObject` — relationship node ids are always `node:${objectId}`. */
export function nodeIdForKnowledgeObject(objectId: string): string {
  const trimmed = objectId.trim();
  if (!trimmed) {
    return "node:";
  }
  if (trimmed.startsWith("node:")) {
    return trimmed;
  }
  return `node:${trimmed}`;
}

export function buildKnowledgeObjectIdCandidates(id: string): string[] {
  const trimmed = id.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("obj:")) {
    return [trimmed];
  }
  return unique([
    trimmed,
    documentKnowledgeObjectId(trimmed),
    `obj:personal:${trimmed}`,
    `obj:enterprise:${trimmed}`,
    `obj:kb:${trimmed}`,
  ]);
}

export function resolvePreferredKnowledgeObjectId(id: string): string | null {
  const candidates = buildKnowledgeObjectIdCandidates(id);
  if (candidates.length === 0) {
    return null;
  }
  // Prefer library-document ids when focusing cockpit tree leaves.
  return (
    candidates.find((candidate) => candidate.startsWith("obj:doc:")) ??
    candidates.find((candidate) => candidate.startsWith("obj:")) ??
    candidates[0] ??
    null
  );
}

export function findRelationshipNodeByObjectIdCandidates(
  graph: RelationshipGraph | null | undefined,
  id: string,
): RelationshipNode | null {
  if (!graph) {
    return null;
  }
  const candidates = new Set(buildKnowledgeObjectIdCandidates(id));
  return (
    graph.nodes.find(
      (node) => candidates.has(node.id) || (node.objectId ? candidates.has(node.objectId) : false),
    ) ?? null
  );
}
