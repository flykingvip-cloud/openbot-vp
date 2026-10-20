import type { KnowledgeBaseVisibility } from "../knowledge/knowledge-base-store.js";
import type { ContextScopeCatalogItem } from "./catalog.js";
import { exceedsConfidentialityCeiling, visibilityToConfidentiality } from "./confidentiality.js";
import type {
  ContextConfidentialityLevel,
  ContextScopeDeniedSource,
  ContextScopePlan,
  ContextSource,
  ContextSourceType,
} from "./types.js";

export type AuthorizeContextScopeInput = {
  plan: ContextScopePlan;
  catalog: ContextScopeCatalogItem[];
  visibilityByKnowledgeBase?: Record<string, KnowledgeBaseVisibility>;
  /**
   * L1-Hard confidentiality gate for Context Scope / Retrieval.
   * Effective context = requested scope ∩ group confidentiality ∩ agent ACL ∩ task need.
   * Group membership alone must not widen this round's retrieval.
   * Direct 1:1 stays ACL-only when this flag is false.
   */
  enforceConfidentiality: boolean;
};

export type AuthorizedContextScope = {
  plan: ContextScopePlan;
  denied: ContextScopeDeniedSource[];
};

type OptionalCatalogType = Extract<ContextSourceType, "knowledge" | "file" | "folder" | "api">;

function uniqueSources(sources: ContextSource[]): ContextSource[] {
  const seen = new Set<string>();
  const next: ContextSource[] = [];
  for (const source of sources) {
    const key = sourceAuditKey(source);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(source);
  }
  return next;
}

export function sourceAuditKey(source: ContextSource): string {
  switch (source.type) {
    case "conversation":
      return `conversation:${source.id}`;
    case "group":
      return `group:${source.groupId}`;
    case "knowledge":
      return `knowledge:${source.knowledgeBaseId}`;
    case "folder":
      return `folder:${source.parentId ?? ""}:${source.path}`;
    case "file":
      return `file:${source.parentId ?? ""}:${source.fileId}`;
    case "api":
      return `api:${source.parentId ?? ""}:${source.connectorId}`;
  }
}

function optionalIdentity(
  source: ContextSource,
): { type: OptionalCatalogType; id: string; parentId?: string } | null {
  switch (source.type) {
    case "knowledge":
      return { type: "knowledge", id: source.knowledgeBaseId };
    case "file":
      return {
        type: "file",
        id: source.fileId,
        ...(source.parentId ? { parentId: source.parentId } : {}),
      };
    case "folder":
      return {
        type: "folder",
        id: source.path,
        ...(source.parentId ? { parentId: source.parentId } : {}),
      };
    case "api":
      return {
        type: "api",
        id: source.connectorId,
        ...(source.parentId ? { parentId: source.parentId } : {}),
      };
    default:
      return null;
  }
}

function catalogKey(item: Pick<ContextScopeCatalogItem, "type" | "id" | "parentId">): string {
  return `${item.type}:${item.parentId ?? ""}:${item.id}`;
}

function sourceWithCatalogParent(
  source: ContextSource,
  item: ContextScopeCatalogItem,
): ContextSource {
  if (!item.parentId) {
    return source;
  }
  if (source.type === "file") {
    return { ...source, parentId: item.parentId };
  }
  if (source.type === "folder") {
    return { ...source, parentId: item.parentId };
  }
  if (source.type === "api") {
    return { ...source, parentId: item.parentId };
  }
  return source;
}

function knowledgeBaseIdForCatalogItem(item: ContextScopeCatalogItem): string | undefined {
  if (item.type === "knowledge") {
    return item.id;
  }
  return item.parentId;
}

export function filterCatalogForConfidentiality(params: {
  catalog: ContextScopeCatalogItem[];
  visibilityByKnowledgeBase?: Record<string, KnowledgeBaseVisibility>;
  maxLevel: ContextConfidentialityLevel;
  enforceConfidentiality: boolean;
}): ContextScopeCatalogItem[] {
  if (!params.enforceConfidentiality) {
    return params.catalog;
  }
  return params.catalog.filter((item) => {
    const kbId = knowledgeBaseIdForCatalogItem(item);
    const sourceLevel = visibilityToConfidentiality(
      kbId ? params.visibilityByKnowledgeBase?.[kbId] : undefined,
    );
    return !exceedsConfidentialityCeiling({ sourceLevel, maxLevel: params.maxLevel });
  });
}

function isMandatorySource(source: ContextSource, plan: ContextScopePlan): boolean {
  const key = sourceAuditKey(source);
  return plan.mandatorySources.some((item) => sourceAuditKey(item) === key);
}

function hasOptionalRetrievalSource(sources: ContextSource[]): boolean {
  return sources.some((source) => source.type !== "conversation" && source.type !== "group");
}

export function authorizeContextScopePlan(
  input: AuthorizeContextScopeInput,
): AuthorizedContextScope {
  const allowedCatalog = filterCatalogForConfidentiality({
    catalog: input.catalog,
    visibilityByKnowledgeBase: input.visibilityByKnowledgeBase,
    maxLevel: input.plan.confidentiality.maxLevel,
    enforceConfidentiality: input.enforceConfidentiality,
  });
  const allowedCatalogKeys = new Set(allowedCatalog.map((item) => catalogKey(item)));
  const denied: ContextScopeDeniedSource[] = [];
  const kept: ContextSource[] = [];

  for (const source of input.plan.sources) {
    if (isMandatorySource(source, input.plan)) {
      kept.push(source);
      continue;
    }
    const identity = optionalIdentity(source);
    if (!identity) {
      kept.push(source);
      continue;
    }
    if (identity.type === "knowledge" && identity.id === "authorized") {
      continue;
    }
    const matchingItems = [
      ...new Map(
        input.catalog
          .filter(
            (item) =>
              item.type === identity.type &&
              item.id === identity.id &&
              (!identity.parentId || item.parentId === identity.parentId),
          )
          .map((item) => [catalogKey(item), item]),
      ).values(),
    ];
    if (matchingItems.length === 0) {
      denied.push({
        type: identity.type,
        id: identity.id,
        ...(identity.parentId ? { parentId: identity.parentId } : {}),
        reason: "unauthorized",
      });
      continue;
    }
    if (!identity.parentId && matchingItems.length > 1) {
      denied.push({ type: identity.type, id: identity.id, reason: "ambiguous_identity" });
      continue;
    }
    const catalogItem = matchingItems[0];
    if (!allowedCatalogKeys.has(catalogKey(catalogItem))) {
      // Explicit focused selections that already passed actor ACL consume the
      // same way in 1:1 and group turns. The group confidentiality ceiling
      // only narrows auto / authorized-wildcard expansion below.
      kept.push(sourceWithCatalogParent(source, catalogItem));
      continue;
    }
    kept.push(sourceWithCatalogParent(source, catalogItem));
  }

  const hadAuthorizedWildcard = input.plan.sources.some(
    (source) => source.type === "knowledge" && source.knowledgeBaseId === "authorized",
  );
  if (hadAuthorizedWildcard) {
    const allowedKnowledge = allowedCatalog.filter((item) => item.type === "knowledge");
    const catalogKnowledge = input.catalog.filter((item) => item.type === "knowledge");
    if (!input.enforceConfidentiality || allowedKnowledge.length === catalogKnowledge.length) {
      kept.push({ type: "knowledge", knowledgeBaseId: "authorized" });
    } else {
      for (const item of catalogKnowledge) {
        if (allowedCatalogKeys.has(catalogKey(item))) {
          continue;
        }
        denied.push({ type: "knowledge", id: item.id, reason: "confidentiality" });
      }
      const remainingSlots = Math.max(0, input.plan.budget.maxSources - uniqueSources(kept).length);
      for (const item of allowedKnowledge.slice(0, remainingSlots)) {
        kept.push({ type: "knowledge", knowledgeBaseId: item.id });
      }
    }
  }

  const sources = uniqueSources(kept).slice(0, input.plan.budget.maxSources);
  const reasons = [...input.plan.reasons];
  if (denied.some((item) => item.reason === "unauthorized")) {
    reasons.push("denied:unauthorized");
  }
  if (denied.some((item) => item.reason === "confidentiality")) {
    reasons.push("denied:confidentiality");
  }

  let retrievalStrategy = input.plan.retrievalStrategy;
  if (
    input.plan.mode !== "minimal" &&
    retrievalStrategy.allowKnowledgePrefetch &&
    !hasOptionalRetrievalSource(sources)
  ) {
    retrievalStrategy = { ...retrievalStrategy, allowKnowledgePrefetch: false };
    reasons.push("optional_blocked");
  }

  const planRest = { ...input.plan };
  delete planRest.deniedSources;
  return {
    denied,
    plan: {
      ...planRest,
      sources,
      retrievalStrategy,
      reasons,
      ...(denied.length > 0 ? { deniedSources: denied } : {}),
    },
  };
}
