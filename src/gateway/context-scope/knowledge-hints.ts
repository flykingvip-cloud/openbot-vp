import {
  normalizeKnowledgeConsumeRefs,
  type KnowledgeConsumeRef,
} from "../knowledge/consume-ref.js";
import type { KnowledgeSource } from "../knowledge/types.js";
import type { ContextScopePlan } from "./types.js";

export type KnowledgeTaskHintsFromScope = {
  knowledgeBaseId?: string;
  knowledgeBaseIds?: string[];
  requestedObjectIds?: string[];
  requestedSourceHints?: KnowledgeSource[];
};

export function knowledgeTaskHintsFromScopePlan(
  plan: ContextScopePlan | undefined,
): KnowledgeTaskHintsFromScope {
  if (!plan || plan.mode === "minimal") {
    return {};
  }

  const knowledgeIds = [
    ...new Set(
      plan.sources
        .filter((source) => source.type === "knowledge")
        .map((source) => source.knowledgeBaseId.trim())
        .filter((id) => id && id !== "authorized"),
    ),
  ];
  const requestedSourceHints: KnowledgeSource[] | undefined =
    plan.sources.some((source) => source.type === "api") && knowledgeIds.length === 0
      ? ["data"]
      : undefined;

  return {
    ...(knowledgeIds.length === 1 ? { knowledgeBaseId: knowledgeIds[0] } : {}),
    ...(knowledgeIds.length > 1 ? { knowledgeBaseIds: knowledgeIds } : {}),
    ...(requestedSourceHints ? { requestedSourceHints } : {}),
  };
}

export function knowledgeConsumeRefsFromScopePlan(
  plan: ContextScopePlan | undefined,
): KnowledgeConsumeRef[] {
  if (!plan || plan.mode === "minimal") {
    return [];
  }
  const refs: KnowledgeConsumeRef[] = [];
  for (const source of plan.sources) {
    if (source.type === "knowledge" && source.knowledgeBaseId !== "authorized") {
      refs.push({ type: "knowledge-base", id: source.knowledgeBaseId });
      continue;
    }
    if (source.type === "file") {
      refs.push({
        type: "knowledge-file",
        id: source.fileId,
        parentId: source.parentId || source.fileId,
      });
      continue;
    }
    if (source.type === "folder") {
      refs.push({
        type: "folder",
        id: source.path,
        ...(source.parentId ? { parentId: source.parentId } : {}),
      });
      continue;
    }
    if (source.type === "api") {
      refs.push({
        type: "api",
        id: source.connectorId,
        ...(source.parentId ? { parentId: source.parentId } : {}),
      });
    }
  }
  return normalizeKnowledgeConsumeRefs(refs);
}
