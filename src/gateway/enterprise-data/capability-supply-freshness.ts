import { listEnterpriseKnowledgeProjectionBindings } from "./enterprise-knowledge-projection-binding-store.js";
import { listKnowledgeFeedItems } from "./knowledge-feed-item-store.js";
import type { EnterpriseDataStore } from "./types.js";

export type CapabilitySupplyFreshness = "fresh" | "stale" | "unknown";

/**
 * Freshness for a data capability as already written by supply.
 * Reads persisted FeedItem metadata for bindings of this capability.
 * Does not inspect live DataSource connection state.
 * No materialized feed item => unknown (do not invent a status).
 */
export function resolveCapabilitySupplyFreshness(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  capabilityId: string;
}): CapabilitySupplyFreshness {
  const bindings = listEnterpriseKnowledgeProjectionBindings({
    store: params.store,
    tenantId: params.tenantId,
    capabilityId: params.capabilityId,
    enabled: true,
  });
  if (bindings.length === 0) {
    return "unknown";
  }
  const projectionIds = new Set(bindings.map((binding) => binding.projectionId));
  const items = listKnowledgeFeedItems({
    store: params.store,
    tenantId: params.tenantId,
  }).filter((item) => projectionIds.has(item.projectionId));
  if (items.length === 0) {
    return "unknown";
  }
  if (
    items.some((item) => item.freshnessStatus === "stale" || item.freshnessStatus === "expired")
  ) {
    return "stale";
  }
  return "fresh";
}
