import { listEnterpriseKnowledgeProjectionBindings } from "./enterprise-knowledge-projection-binding-store.js";
import { listKnowledgeFeedItems, computeFreshnessStatus } from "./knowledge-feed-item-store.js";
import { listKnowledgeLineageRecords } from "./knowledge-lineage-store.js";
import { listKnowledgeVisibilityPolicies } from "./knowledge-visibility-policy-store.js";
import { listEnterpriseKnowledgeProjectionSpecs } from "./projection-spec-store.js";
import type { EnterpriseDataStore } from "./types.js";

export type KnowledgeSupplyOverview = {
  projectionCount: number;
  activeProjectionCount: number;
  enabledBindingCount: number;
  visibilityPolicyCount: number;
  feedItemCount: number;
  freshness: {
    fresh: number;
    stale: number;
    expired: number;
  };
  lineageRecordCount: number;
  recentFeedItems: ReturnType<typeof listKnowledgeFeedItems>;
};

export function resolveKnowledgeSupplyOverview(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): KnowledgeSupplyOverview {
  const specs = listEnterpriseKnowledgeProjectionSpecs({
    store: params.store,
    tenantId: params.tenantId,
  });
  const bindings = listEnterpriseKnowledgeProjectionBindings({
    store: params.store,
    tenantId: params.tenantId,
    enabled: true,
  });
  const policies = listKnowledgeVisibilityPolicies({
    store: params.store,
    tenantId: params.tenantId,
  });
  const feedItems = listKnowledgeFeedItems({ store: params.store, tenantId: params.tenantId });
  const lineage = listKnowledgeLineageRecords({ store: params.store, tenantId: params.tenantId });

  const freshness = { fresh: 0, stale: 0, expired: 0 };
  for (const item of feedItems) {
    const binding = bindings.find((entry) => entry.projectionId === item.projectionId);
    const status = computeFreshnessStatus({
      generatedAt: item.generatedAt,
      nowIso: params.nowIso,
      freshnessSlaMinutes: binding?.freshnessSlaMinutes,
    });
    freshness[status] += 1;
  }

  return {
    projectionCount: specs.length,
    activeProjectionCount: specs.filter((spec) => spec.lifecycle === "active").length,
    enabledBindingCount: bindings.length,
    visibilityPolicyCount: policies.length,
    feedItemCount: feedItems.length,
    freshness,
    lineageRecordCount: lineage.length,
    recentFeedItems: feedItems.slice(0, 5),
  };
}
