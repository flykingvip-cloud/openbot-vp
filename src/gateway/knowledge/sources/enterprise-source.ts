import { listEnterpriseKnowledgeProjectionSpecs } from "../../enterprise-data/projection-spec-store.js";
import type { EnterpriseDataStore } from "../../enterprise-data/types.js";
import { loadEnterpriseKnowledgeFeed } from "../feed/enterprise-feed-adapter.js";
import type { KnowledgeFeedItem } from "../feed/types.js";
import type { KnowledgeObject } from "../types.js";
import type { KnowledgeSourceContext } from "./types.js";

export function loadEnterpriseKnowledgeBrowse(params: {
  store: EnterpriseDataStore;
  context: KnowledgeSourceContext;
}): { accessible: KnowledgeObject[]; restricted: KnowledgeObject[] } {
  const feed = loadEnterpriseKnowledgeFeed(params);
  return {
    accessible: feed.accessible,
    restricted: feed.restricted,
  };
}

export function loadEnterpriseKnowledgeObjects(params: {
  store: EnterpriseDataStore;
  context: KnowledgeSourceContext;
}): KnowledgeObject[] {
  return loadEnterpriseKnowledgeBrowse(params).accessible;
}

function parseProjectionId(objectId: string): string | null {
  if (!objectId.startsWith("obj:enterprise:") || objectId.startsWith("obj:enterprise:feed:")) {
    return null;
  }
  const projectionId = objectId.slice("obj:enterprise:".length).trim();
  return projectionId || null;
}

export { parseProjectionId };

export function buildEnterpriseSourceSummary(params: {
  store: EnterpriseDataStore;
  context: KnowledgeSourceContext;
  accessibleObjects: KnowledgeObject[];
}): { libraryCount: number; accessibleCount: number } {
  if (!params.context.tenantId) {
    return { libraryCount: 0, accessibleCount: 0 };
  }
  const libraryCount = listEnterpriseKnowledgeProjectionSpecs({
    store: params.store,
    tenantId: params.context.tenantId,
    lifecycle: "active",
  }).length;
  return {
    libraryCount,
    accessibleCount: params.accessibleObjects.length,
  };
}

export function projectionFeedItems(objects: KnowledgeObject[]): KnowledgeFeedItem[] {
  return objects
    .filter((item) => item.source === "enterprise")
    .map((item) => ({
      objectId: item.id,
      source: "enterprise",
      title: item.title,
      kind: item.kind,
      summary: item.summary,
      category: item.tags[0] ?? "enterprise",
      sourceSystems: item.sourceSystem ? [item.sourceSystem] : [],
      scopeLabel: item.scopeLabel ?? "企业知识库",
      maskingSummary: item.maskingSummary ?? "企业知识按可见性与脱敏策略展示",
      projectionId: item.projectionId,
      accessState: item.accessState ?? "accessible",
      generatedAt: item.updatedAt,
      traceRefs: item.traceRefs,
      lineageId: item.lineageId,
    }));
}

export function listEnterpriseKnowledgeFeedItems(params: {
  store: EnterpriseDataStore;
  context: KnowledgeSourceContext;
}): KnowledgeFeedItem[] {
  return loadEnterpriseKnowledgeFeed(params).feedItems;
}
