import type { KnowledgeObject, KnowledgeTaskContext, RelationshipGraph } from "../types.js";
import type { KnowledgeRecommendationItem } from "./types.js";

function nodeIdForObject(objectId: string): string {
  return `node:${objectId}`;
}

function recommendationReason(object: KnowledgeObject, score: number): string {
  if (object.source === "data") {
    return score >= 85 ? "高相关数据能力" : "任务相关数据能力";
  }
  if (object.kind === "project") {
    return "相关项目上下文";
  }
  if (object.source === "enterprise") {
    return "企业知识关联推荐";
  }
  return "个人知识关联推荐";
}

export function buildRelationshipRecommendations(params: {
  objects: KnowledgeObject[];
  graph: RelationshipGraph;
  taskContext?: KnowledgeTaskContext | null;
  focusObjectId?: string | null;
  limit?: number;
}): KnowledgeRecommendationItem[] {
  const limit = Math.min(Math.max(params.limit ?? 4, 1), 12);
  const scores = new Map<string, { score: number; object: KnowledgeObject }>();
  const focusNodeId = params.focusObjectId ? nodeIdForObject(params.focusObjectId) : null;

  for (const edge of params.graph.edges) {
    if (edge.relationType === "conflicts") {
      continue;
    }
    const linkedObjectIds = [edge.sourceId, edge.targetId]
      .map((nodeId) => params.graph.nodes.find((node) => node.id === nodeId)?.objectId)
      .filter((value): value is string => !!value);
    for (const objectId of linkedObjectIds) {
      if (params.focusObjectId && objectId === params.focusObjectId) {
        continue;
      }
      const object = params.objects.find((item) => item.id === objectId);
      if (!object) {
        continue;
      }
      let weight = edge.score;
      if (focusNodeId && (edge.sourceId === focusNodeId || edge.targetId === focusNodeId)) {
        weight += 12;
      }
      if (edge.relationType === "recommended-for") {
        weight += 10;
      }
      if (params.taskContext?.requestedSourceHints?.includes(object.source)) {
        weight += 8;
      }
      const current = scores.get(object.id);
      if (!current || weight > current.score) {
        scores.set(object.id, { score: weight, object });
      }
    }
  }

  if (params.focusObjectId) {
    scores.delete(params.focusObjectId);
  }

  return [...scores.values()]
    .toSorted((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => ({
      object: entry.object,
      score: entry.score,
      reason: recommendationReason(entry.object, entry.score),
    }));
}
