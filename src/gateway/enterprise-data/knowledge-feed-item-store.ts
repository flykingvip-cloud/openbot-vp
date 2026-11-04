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

export function isActiveKnowledgeFeedItem(item: EnterpriseKnowledgeObjectFeedItem): boolean {
  return !item.deletedAt;
}

export function listKnowledgeFeedItems(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  projectionId?: string;
  freshnessStatus?: EnterpriseKnowledgeObjectFeedItem["freshnessStatus"];
  /** When true, include soft-deleted items. Default hides them from search/supply. */
  includeDeleted?: boolean;
}): EnterpriseKnowledgeObjectFeedItem[] {
  return Object.values(params.store.knowledgeFeedItems)
    .filter((item) => {
      if (item.tenantId !== params.tenantId) {
        return false;
      }
      if (!params.includeDeleted && item.deletedAt) {
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
  if (!item || item.tenantId !== tenantId || item.deletedAt) {
    return null;
  }
  return item;
}

/** True when this active item is the newest feed for an enabled projection binding. */
export function isCurrentSuppliedFeedItem(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  objectId: string;
}): boolean {
  const item = findKnowledgeFeedItem(params.store, params.tenantId, params.objectId);
  if (!item) {
    return false;
  }
  const hasEnabledBinding = Object.values(params.store.enterpriseKnowledgeProjectionBindings).some(
    (binding) =>
      binding.tenantId === params.tenantId &&
      binding.projectionId === item.projectionId &&
      binding.enabled,
  );
  if (!hasEnabledBinding) {
    return false;
  }
  const newest = listKnowledgeFeedItems({
    store: params.store,
    tenantId: params.tenantId,
    projectionId: item.projectionId,
  })[0];
  return newest?.objectId === item.objectId;
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
  const objectId = params.item.objectId ?? randomUUID();
  // Re-upsert replaces the record without deletedAt, clearing any prior soft-delete.
  const record: EnterpriseKnowledgeObjectFeedItem = {
    objectId,
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

export function deleteKnowledgeFeedItem(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  objectId: string;
  nowIso: string;
  force?: boolean;
}): EnterpriseKnowledgeObjectFeedItem {
  const item = params.store.knowledgeFeedItems[params.objectId];
  if (!item || item.tenantId !== params.tenantId || item.deletedAt) {
    throw new EnterpriseDataStoreError("FEED_ITEM_NOT_FOUND", "Knowledge feed item not found.");
  }
  if (
    isCurrentSuppliedFeedItem({
      store: params.store,
      tenantId: params.tenantId,
      objectId: params.objectId,
    }) &&
    !params.force
  ) {
    throw new EnterpriseDataStoreError(
      "FEED_ITEM_CURRENT_SUPPLIED",
      "该知识对象是已启用供给绑定的当前投影对象。删除后知识宇宙与检索将失去该投影最新供给。请确认后传入 force=true 强制删除。",
    );
  }
  item.deletedAt = params.nowIso;
  return item;
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
