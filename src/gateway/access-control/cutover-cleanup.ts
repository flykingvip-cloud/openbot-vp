// Feature: shared-agent-identity-access-control-plane

import { isUniversalBuiltinAgentId } from "../agent-registry/legacy-resolver.js";
import { releasePrimaryOwner } from "../agent-registry/ownership.js";
import type { AgentRegistryStore } from "../agent-registry/types.js";
import { type AccessPolicyStore, revokeAccessPolicy } from "./policy-store.js";

/**
 * Retires the two classes of data that make an enforcement cutover misreport, both found
 * by comparing the live granted surface against the evaluator in a real tenant.
 *
 * Everything here plans first and mutates only when asked, because both classes touch
 * stores that serve live traffic. Planning is pure so it can be tested and shown to an
 * operator before anything is written.
 */

// ---------------------------------------------------------------------------
// Universal builtin artifacts (ADR amendment 2)
// ---------------------------------------------------------------------------

export type BuiltinArtifactPlan = {
  /** Assets that must never have existed: a universal builtin is not an asset. */
  assetIds: string[];
  /** Open owner bindings on those assets, which claim ownership of a per-user agent. */
  ownerBindingIds: string[];
  /** Active V2 policies naming those assets, which govern nothing at runtime. */
  policyIds: string[];
};

function isBuiltinAsset(asset: { legacyAgentId?: string; agentSlug?: string }): boolean {
  return (
    isUniversalBuiltinAgentId(asset.legacyAgentId) || isUniversalBuiltinAgentId(asset.agentSlug)
  );
}

/**
 * Finds the Registry and policy rows created for a universal builtin before the model
 * decision. Matches on both `legacyAgentId` and `agentSlug`, because a backfill keys on
 * the legacy id while `agents.create` would key on the slug.
 */
export function planBuiltinArtifactRetirement(params: {
  registry: AgentRegistryStore;
  policyStore: AccessPolicyStore;
  enterpriseId: string;
}): BuiltinArtifactPlan {
  const assetIds = Object.values(params.registry.assets)
    .filter(
      (asset) =>
        asset.enterpriseId === params.enterpriseId &&
        asset.status !== "archived" &&
        isBuiltinAsset(asset),
    )
    .map((asset) => asset.agentAssetId)
    .toSorted();
  const assetIdSet = new Set(assetIds);

  const ownerBindingIds = Object.values(params.registry.ownerBindings)
    .filter(
      (binding) =>
        binding.enterpriseId === params.enterpriseId &&
        assetIdSet.has(binding.agentAssetId) &&
        !binding.endedAt,
    )
    .map((binding) => binding.bindingId)
    .toSorted();

  const policyIds = Object.values(params.policyStore.policies)
    .filter(
      (policy) =>
        policy.enterpriseId === params.enterpriseId &&
        !policy.revokedAt &&
        policy.resourceType === "agent_asset" &&
        assetIdSet.has(policy.resourceId),
    )
    .map((policy) => policy.policyId)
    .toSorted();

  return { assetIds, ownerBindingIds, policyIds };
}

/**
 * Applies a plan in place. The asset is archived rather than deleted and the policies are
 * soft revoked, so the history of what existed survives; deleting would erase the record
 * that these artifacts were ever created.
 */
export function applyBuiltinArtifactRetirement(params: {
  registry: AgentRegistryStore;
  policyStore: AccessPolicyStore;
  plan: BuiltinArtifactPlan;
  nowIso: string;
}): { archivedAssets: number; closedBindings: number; revokedPolicies: number } {
  let closedBindings = 0;
  for (const agentAssetId of params.plan.assetIds) {
    const asset = params.registry.assets[agentAssetId];
    if (!asset) {
      continue;
    }
    // Archiving and closing ownership are one operation, so the asset never sits active
    // and unowned.
    closedBindings += releasePrimaryOwner({
      store: params.registry,
      ref: { enterpriseId: asset.enterpriseId, agentAssetId },
      nowIso: params.nowIso,
      reason: "asset_archived",
      assetStatus: "archived",
    }).length;
  }

  let revokedPolicies = 0;
  for (const policyId of params.plan.policyIds) {
    if (revokeAccessPolicy(params.policyStore, policyId, params.nowIso)) {
      revokedPolicies += 1;
    }
  }

  return {
    archivedAssets: params.plan.assetIds.length,
    closedBindings,
    revokedPolicies,
  };
}

// ---------------------------------------------------------------------------
// Stale agent entries in a seat's defaults
// ---------------------------------------------------------------------------

export type SeatAgentDefaults = {
  seatId: string;
  tenantId: string;
  defaultAgentAssetIds: string[];
};

export type StaleSeatDefault = {
  seatId: string;
  legacyAgentId: string;
  /** True when the agent is absent from the runtime agent list. */
  missingFromConfig: boolean;
  /** True when no ownership record still states current ownership. */
  ownershipGone: boolean;
};

export type SeatDefaultsPlan = {
  /** Entries safe to drop: inert in the runtime and disowned. */
  remove: StaleSeatDefault[];
  /**
   * Entries that satisfy only one condition. Reported for a human rather than removed,
   * because either signal alone can be a temporary state (an agent list loaded from a
   * partial config, or ownership not yet recorded).
   */
  review: StaleSeatDefault[];
};

/**
 * Classifies each agent id a seat grants by default.
 *
 * A universal builtin is never stale: the runtime injects it for every employee, so its
 * presence in a seat default is redundant but harmless, and removing it here would imply
 * the seat controls access to it.
 */
export function planStaleSeatAgentDefaults(params: {
  seats: SeatAgentDefaults[];
  tenantId: string;
  /** Agent ids the runtime can actually surface, i.e. the configured agent list. */
  configuredAgentIds: ReadonlySet<string>;
  /** Agent ids with an ownership record that still states current ownership. */
  activelyOwnedAgentIds: ReadonlySet<string>;
}): SeatDefaultsPlan {
  const remove: StaleSeatDefault[] = [];
  const review: StaleSeatDefault[] = [];
  const normalize = (value: string): string => value.trim().toLowerCase();

  for (const seat of params.seats) {
    if (seat.tenantId !== params.tenantId) {
      continue;
    }
    for (const raw of seat.defaultAgentAssetIds) {
      const legacyAgentId = raw.trim();
      if (!legacyAgentId || isUniversalBuiltinAgentId(legacyAgentId)) {
        continue;
      }
      const key = normalize(legacyAgentId);
      const missingFromConfig = !params.configuredAgentIds.has(key);
      const ownershipGone = !params.activelyOwnedAgentIds.has(key);
      if (!missingFromConfig && !ownershipGone) {
        continue;
      }
      const entry: StaleSeatDefault = {
        seatId: seat.seatId,
        legacyAgentId,
        missingFromConfig,
        ownershipGone,
      };
      if (missingFromConfig && ownershipGone) {
        remove.push(entry);
      } else {
        review.push(entry);
      }
    }
  }
  return { remove, review };
}

/**
 * Removes the planned ids from each seat's defaults and returns the seats that changed.
 *
 * Binding revocation is deliberately **not** done here. `defaultAgentAssetIds` is the
 * desired state that `syncSeatManagedAssetBindings` reconciles against, so the caller runs
 * that reconciler afterwards and the bindings are revoked by the seat subsystem's own
 * rule. Editing bindings directly would fork that semantics.
 */
export function applyStaleSeatAgentDefaults(params: {
  seats: SeatAgentDefaults[];
  plan: SeatDefaultsPlan;
}): string[] {
  const bySeat = new Map<string, Set<string>>();
  for (const entry of params.plan.remove) {
    const existing = bySeat.get(entry.seatId) ?? new Set<string>();
    existing.add(entry.legacyAgentId);
    bySeat.set(entry.seatId, existing);
  }
  const changed: string[] = [];
  for (const seat of params.seats) {
    const drop = bySeat.get(seat.seatId);
    if (!drop) {
      continue;
    }
    const kept = seat.defaultAgentAssetIds.filter((id) => !drop.has(id.trim()));
    if (kept.length !== seat.defaultAgentAssetIds.length) {
      seat.defaultAgentAssetIds = kept;
      changed.push(seat.seatId);
    }
  }
  return changed.toSorted();
}
