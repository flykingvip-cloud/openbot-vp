import { listEnterpriseKnowledgeProjectionBindings } from "./enterprise-knowledge-projection-binding-store.js";
import { listKnowledgeFeedItems } from "./knowledge-feed-item-store.js";
import { isImplementedMaterializationMode } from "./knowledge-publication.js";
import { resolveVisibilityForFeedItem } from "./knowledge-visibility-policy-store.js";
import { getProcessControlledSarProvider } from "./controlled-sar-provider.js";
import { runProjectionMaterialization } from "./projection-materializer.js";
import { findEnterpriseKnowledgeProjectionSpec } from "./projection-spec-store.js";
import type { EnterpriseDataStore, KnowledgeAgentType } from "./types.js";

const MAX_ON_DEMAND_PER_LOAD = 3;

/**
 * Supply-side context for on-demand materialization.
 * Structurally compatible with the knowledge source context, but owned here so
 * the knowledge consumption plane does not host this Gateway-calling helper.
 */
export type OnDemandProjectionContext = {
  tenantId: string | null;
  seatId: string | null;
  hasEnterpriseScope: boolean;
  teamLabel?: string | null;
  departmentId?: string | null;
  roleCode?: string | null;
  agentType?: KnowledgeAgentType | null;
};

/**
 * Supply helper for enabled `on_demand` bindings that have no feed record yet.
 * Knowledge Universe load must not call this. Consumption only reads FeedItems.
 * Supply calls `runProjectionMaterialization` from this helper, the admin
 * materializer RPC, or the scheduled maintenance tick.
 */
export async function ensureOnDemandProjectionsMaterialized(params: {
  store: EnterpriseDataStore;
  context: OnDemandProjectionContext;
  nowIso: string;
}): Promise<boolean> {
  const tenantId = params.context.tenantId;
  if (!tenantId || !params.context.seatId || !params.context.hasEnterpriseScope) {
    return false;
  }

  const bindings = listEnterpriseKnowledgeProjectionBindings({
    store: params.store,
    tenantId,
    enabled: true,
  }).filter(
    (binding) =>
      binding.materializationMode === "on_demand" &&
      isImplementedMaterializationMode(binding.materializationMode),
  );

  if (bindings.length === 0) {
    return false;
  }

  const feedRecords = listKnowledgeFeedItems({ store: params.store, tenantId });
  const feedProjectionIds = new Set(feedRecords.map((record) => record.projectionId));

  let mutated = false;
  let attempted = 0;

  for (const binding of bindings) {
    if (attempted >= MAX_ON_DEMAND_PER_LOAD) {
      break;
    }
    if (feedProjectionIds.has(binding.projectionId)) {
      continue;
    }
    const spec = findEnterpriseKnowledgeProjectionSpec(
      params.store,
      tenantId,
      binding.projectionId,
    );
    if (!spec || spec.lifecycle !== "active") {
      continue;
    }
    if (
      !isOnDemandBindingVisible({
        store: params.store,
        tenantId,
        projectionId: binding.projectionId,
        visibilityPolicyId: binding.visibilityPolicyId,
        context: params.context,
      })
    ) {
      continue;
    }
    attempted += 1;
    try {
      await runProjectionMaterialization({
        store: params.store,
        tenantId,
        bindingId: binding.bindingId,
        sarProvider: getProcessControlledSarProvider(),
        nowIso: params.nowIso,
      });
      feedProjectionIds.add(binding.projectionId);
      mutated = true;
    } catch {
      // Best-effort: one binding failure must not block the rest of the supply tick.
    }
  }

  return mutated;
}

function isOnDemandBindingVisible(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  projectionId: string;
  visibilityPolicyId?: string;
  context: OnDemandProjectionContext;
}): boolean {
  if (!params.visibilityPolicyId) {
    return true;
  }
  if (!params.context.seatId) {
    return false;
  }
  return resolveVisibilityForFeedItem({
    store: params.store,
    tenantId: params.tenantId,
    projectionId: params.projectionId,
    visibilityPolicyId: params.visibilityPolicyId,
    context: {
      seatId: params.context.seatId,
      teamLabel: params.context.teamLabel ?? undefined,
      departmentId: params.context.departmentId ?? undefined,
      roleCode: params.context.roleCode ?? undefined,
      agentType: params.context.agentType ?? undefined,
    },
  }).visible;
}
