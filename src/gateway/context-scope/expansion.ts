import type { KnowledgeBaseVisibility } from "../knowledge/knowledge-base-store.js";
import { filterCatalogForConfidentiality } from "./authorize.js";
import type { ContextScopeCatalogItem } from "./catalog.js";
import type { ContextMode, ContextScopePlan, ContextSource } from "./types.js";

export type ContextExpansionReason = "empty" | "degraded" | "narrow_focus";

export type ContextExpansionSource = {
  type: "knowledge" | "file" | "folder" | "api";
  id: string;
  label: string;
};

export type ContextExpansionSuggestion = {
  reason: ContextExpansionReason;
  proposedSources: ContextExpansionSource[];
};

export const CONTEXT_EXPANSION_LIMIT = 3;

function optionalSourceKey(source: ContextSource): string | null {
  switch (source.type) {
    case "knowledge":
      return source.knowledgeBaseId === "authorized" ? null : `knowledge:${source.knowledgeBaseId}`;
    case "file":
      return `file:${source.fileId}`;
    case "folder":
      return `folder:${source.path}`;
    case "api":
      return `api:${source.connectorId}`;
    default:
      return null;
  }
}

function catalogKey(item: Pick<ContextScopeCatalogItem, "type" | "id">): string {
  return `${item.type}:${item.id}`;
}

function hasFocusedOptionalSource(plan: ContextScopePlan): boolean {
  return plan.sources.some((source) => optionalSourceKey(source) !== null);
}

export function detectContextInsufficient(input: {
  mode?: ContextMode;
  knowledgeRetrieved: boolean;
  evidenceCount: number;
  degraded: boolean;
}): ContextExpansionReason | null {
  if (!input.knowledgeRetrieved || input.mode === "minimal" || !input.mode) {
    return null;
  }
  if (input.evidenceCount > 0) {
    return null;
  }
  if (input.degraded) {
    return "degraded";
  }
  return "empty";
}

function scoreCatalogItem(item: ContextScopeCatalogItem, parentKbIds: Set<string>): number {
  let score = 0;
  if (item.type === "knowledge" && parentKbIds.has(item.id)) {
    score += 100;
  }
  if (item.type === "knowledge") {
    score += 40;
  }
  if (item.type === "folder") {
    score += 30;
  }
  if (item.type === "api") {
    score += 20;
  }
  if (item.type === "file" && item.parentId && parentKbIds.has(item.parentId)) {
    score += 25;
  }
  if (item.type === "file") {
    score += 10;
  }
  return score;
}

export function proposeContextExpansion(input: {
  reason: ContextExpansionReason;
  currentSources: ContextSource[];
  catalog: ContextScopeCatalogItem[];
  maxProposals?: number;
  enforceConfidentiality?: boolean;
  visibilityByKnowledgeBase?: Record<string, KnowledgeBaseVisibility>;
  confidentialityMaxLevel?: ContextScopePlan["confidentiality"]["maxLevel"];
}): ContextExpansionSuggestion | null {
  const catalog = filterCatalogForConfidentiality({
    catalog: input.catalog,
    visibilityByKnowledgeBase: input.visibilityByKnowledgeBase,
    maxLevel: input.confidentialityMaxLevel ?? "internal",
    enforceConfidentiality: Boolean(input.enforceConfidentiality),
  });
  const limit = input.maxProposals ?? CONTEXT_EXPANSION_LIMIT;
  const excluded = new Set(
    input.currentSources
      .map((source) => optionalSourceKey(source))
      .filter((key): key is string => Boolean(key)),
  );
  const remaining = catalog.filter((item) => !excluded.has(catalogKey(item)));
  if (remaining.length === 0) {
    return null;
  }

  const selected = catalog.filter((item) => excluded.has(catalogKey(item)));
  const parentKbIds = new Set(
    selected.map((item) => item.parentId).filter((id): id is string => Boolean(id)),
  );
  const ranked = [...remaining].toSorted((left, right) => {
    const delta = scoreCatalogItem(right, parentKbIds) - scoreCatalogItem(left, parentKbIds);
    if (delta !== 0) {
      return delta;
    }
    return left.label.localeCompare(right.label);
  });
  const proposedSources = ranked.slice(0, limit).map((item) => ({
    type: item.type,
    id: item.id,
    label: item.label,
  }));
  if (proposedSources.length === 0) {
    return null;
  }
  const reason: ContextExpansionReason =
    input.reason === "empty" && selected.length > 0 ? "narrow_focus" : input.reason;
  return { reason, proposedSources };
}

export function resolveContextExpansionSuggestion(input: {
  plan?: ContextScopePlan;
  knowledgeRetrieved: boolean;
  evidenceCount: number;
  degraded: boolean;
  catalog: ContextScopeCatalogItem[];
  enforceConfidentiality?: boolean;
  visibilityByKnowledgeBase?: Record<string, KnowledgeBaseVisibility>;
}): ContextExpansionSuggestion | null {
  const reason = detectContextInsufficient({
    mode: input.plan?.mode,
    knowledgeRetrieved: input.knowledgeRetrieved,
    evidenceCount: input.evidenceCount,
    degraded: input.degraded,
  });
  if (!reason || !input.plan) {
    return null;
  }
  return proposeContextExpansion({
    reason: reason === "empty" && hasFocusedOptionalSource(input.plan) ? "narrow_focus" : reason,
    currentSources: input.plan.sources,
    catalog: input.catalog,
    enforceConfidentiality: input.enforceConfidentiality,
    visibilityByKnowledgeBase: input.visibilityByKnowledgeBase,
    confidentialityMaxLevel: input.plan.confidentiality.maxLevel,
  });
}
