import { randomUUID } from "node:crypto";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import type {
  EnterpriseDataStore,
  EnterpriseKnowledgeObjectFeedItem,
  EnterpriseKnowledgeObjectKind,
} from "./types.js";

export function computeFreshnessStatus(params: {
  generatedAt: string;
  nowIso: string;
  freshnessSlaMinutes?: number;
}): EnterpriseKnowledgeObjectFeedItem["freshnessStatus"] {
  if (!params.freshnessSlaMinutes || params.freshnessSlaMinutes <= 0) {
    return "fresh";
  }
  const ageMinutes = (Date.parse(params.nowIso) - Date.parse(params.generatedAt)) / 60_000;
  if (ageMinutes <= params.freshnessSlaMinutes) {
    return "fresh";
  }
  if (ageMinutes <= params.freshnessSlaMinutes * 2) {
    return "stale";
  }
  return "expired";
}

export function listKnowledgeFeedItems(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  projectionId?: string;
  freshnessStatus?: EnterpriseKnowledgeObjectFeedItem["freshnessStatus"];
}): EnterpriseKnowledgeObjectFeedItem[] {
  return Object.values(params.store.knowledgeFeedItems)
    .filter((item) => {
      if (item.tenantId !== params.tenantId) {
        return false;
      }
      if (params.projectionId && item.projectionId !== params.projectionId) {
        return false;
      }
      if (params.freshnessStatus && item.freshnessStatus !== params.freshnessStatus) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => right.generatedAt.localeCompare(left.generatedAt));
}

export function findKnowledgeFeedItem(
  store: EnterpriseDataStore,
  tenantId: string,
  objectId: string,
): EnterpriseKnowledgeObjectFeedItem | null {
  const item = store.knowledgeFeedItems[objectId];
  if (!item || item.tenantId !== tenantId) {
    return null;
  }
  return item;
}

export function upsertKnowledgeFeedItem(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  item: Omit<EnterpriseKnowledgeObjectFeedItem, "objectId" | "tenantId" | "freshnessStatus"> & {
    objectId?: string;
  };
  nowIso: string;
  freshnessSlaMinutes?: number;
}): EnterpriseKnowledgeObjectFeedItem {
  if (!params.item.projectionId?.trim()) {
    throw new EnterpriseDataStoreError(
      "FEED_ITEM_PROJECTION_REQUIRED",
      "projectionId is required.",
    );
  }
  if (!params.item.title?.trim()) {
    throw new EnterpriseDataStoreError("FEED_ITEM_TITLE_REQUIRED", "title is required.");
  }
  const record: EnterpriseKnowledgeObjectFeedItem = {
    objectId: params.item.objectId ?? randomUUID(),
    tenantId: params.tenantId,
    projectionId: params.item.projectionId,
    title: params.item.title,
    kind: params.item.kind,
    category: params.item.category,
    sourceSystems: [...params.item.sourceSystems],
    scopeApplied: params.item.scopeApplied,
    maskedFields: [...params.item.maskedFields],
    generatedAt: params.item.generatedAt,
    freshnessStatus: computeFreshnessStatus({
      generatedAt: params.item.generatedAt,
      nowIso: params.nowIso,
      freshnessSlaMinutes: params.freshnessSlaMinutes,
    }),
    traceRefs: [...params.item.traceRefs],
    payload: { ...params.item.payload },
    ...(params.item.publication ? { publication: params.item.publication } : {}),
  };
  params.store.knowledgeFeedItems[record.objectId] = record;
  return record;
}

export function refreshFeedItemFreshness(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  objectId: string;
  nowIso: string;
  freshnessSlaMinutes?: number;
}): EnterpriseKnowledgeObjectFeedItem | null {
  const item = findKnowledgeFeedItem(params.store, params.tenantId, params.objectId);
  if (!item) {
    return null;
  }
  item.freshnessStatus = computeFreshnessStatus({
    generatedAt: item.generatedAt,
    nowIso: params.nowIso,
    freshnessSlaMinutes: params.freshnessSlaMinutes,
  });
  return item;
}

export function assertFeedItemKind(kind: string): EnterpriseKnowledgeObjectKind {
  if (kind === "data" || kind === "metric" || kind === "insight") {
    return kind;
  }
  throw new EnterpriseDataStoreError("FEED_ITEM_KIND_INVALID", `Unknown feed item kind: ${kind}`);
}
