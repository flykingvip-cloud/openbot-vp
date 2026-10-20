// Feature: shared-agent-identity-access-control-plane

import { randomUUID } from "node:crypto";
import { findAgentAsset } from "./registry.js";
import {
  type AgentOwnerBinding,
  type AgentOwnerType,
  AgentRegistryError,
  type AgentRef,
  type AgentRegistryStore,
} from "./types.js";

/** Open bindings for one asset. More than one open row is a data defect. */
function openBindingsFor(store: AgentRegistryStore, ref: AgentRef): AgentOwnerBinding[] {
  return Object.values(store.ownerBindings).filter(
    (binding) =>
      binding.enterpriseId === ref.enterpriseId &&
      binding.agentAssetId === ref.agentAssetId &&
      !binding.endedAt,
  );
}

/**
 * Current primary owner, or undefined when the asset is unowned. Returns
 * undefined when more than one binding is open, because an ambiguous owner must
 * fail closed rather than pick one.
 */
export function findPrimaryOwnerBinding(
  store: AgentRegistryStore,
  ref: AgentRef,
): AgentOwnerBinding | undefined {
  const open = openBindingsFor(store, ref);
  return open.length === 1 ? open[0] : undefined;
}

export function listOwnerBindingHistory(
  store: AgentRegistryStore,
  ref: AgentRef,
): AgentOwnerBinding[] {
  return Object.values(store.ownerBindings)
    .filter(
      (binding) =>
        binding.enterpriseId === ref.enterpriseId && binding.agentAssetId === ref.agentAssetId,
    )
    .toSorted((left, right) => left.effectiveAt.localeCompare(right.effectiveAt));
}

/**
 * Assigns or transfers the single primary owner.
 *
 * The previous binding is closed rather than mutated, so history stays complete
 * and an ownership transfer is always reconstructable for audit.
 */
export function setPrimaryOwner(params: {
  store: AgentRegistryStore;
  ref: AgentRef;
  ownerType: AgentOwnerType;
  ownerId: string;
  nowIso: string;
}): AgentOwnerBinding {
  const asset = findAgentAsset(params.store, params.ref);
  if (!asset) {
    throw new AgentRegistryError("ASSET_NOT_FOUND", "Agent asset not found in this enterprise.");
  }
  const ownerId = params.ownerId?.trim();
  if (!ownerId) {
    throw new AgentRegistryError("OWNER_REQUIRED", "ownerId is required.");
  }

  const open = openBindingsFor(params.store, params.ref);
  const unchanged = open.find(
    (binding) => binding.ownerType === params.ownerType && binding.ownerId === ownerId,
  );
  if (unchanged && open.length === 1) {
    return unchanged;
  }
  for (const binding of open) {
    binding.endedAt = params.nowIso;
    binding.endedReason = "transferred";
  }

  const binding: AgentOwnerBinding = {
    bindingId: randomUUID(),
    enterpriseId: params.ref.enterpriseId,
    agentAssetId: params.ref.agentAssetId,
    ownerType: params.ownerType,
    ownerId,
    isPrimary: true,
    effectiveAt: params.nowIso,
  };
  params.store.ownerBindings[binding.bindingId] = binding;
  return binding;
}

/**
 * Retires an asset and closes its ownership in one step.
 *
 * The ADR requires an active asset to have exactly one primary owner, so releasing the
 * owner while leaving the asset active would produce a state the model forbids. Callers
 * therefore have to say which non-active status the asset moves to, and both changes are
 * applied together rather than left to a second call that might not happen.
 */
export function releasePrimaryOwner(params: {
  store: AgentRegistryStore;
  ref: AgentRef;
  nowIso: string;
  reason: NonNullable<AgentOwnerBinding["endedReason"]>;
  assetStatus: "suspended" | "archived";
}): AgentOwnerBinding[] {
  const asset = findAgentAsset(params.store, params.ref);
  if (!asset) {
    throw new AgentRegistryError("ASSET_NOT_FOUND", "Agent asset not found in this enterprise.");
  }
  const open = openBindingsFor(params.store, params.ref);
  for (const binding of open) {
    binding.endedAt = params.nowIso;
    binding.endedReason = params.reason;
  }
  asset.status = params.assetStatus;
  asset.updatedAt = params.nowIso;
  return open;
}

/**
 * Enforces the canonical ownership invariant: every active asset has exactly one open
 * primary owner binding.
 *
 * Checked at the persistence boundary rather than on every in-memory mutation, because a
 * create-then-bind sequence is one transaction for this store and only the persisted state
 * has to be consistent. An unowned active asset is not a privilege escalation on its own
 * (`requireOwnerBinding` is simply unsatisfied and the owner baseline yields nothing), but
 * it is a state the ADR forbids and it makes ownership unauditable.
 */
export function assertAgentOwnershipInvariant(store: AgentRegistryStore): void {
  const openCounts = new Map<string, number>();
  for (const binding of Object.values(store.ownerBindings)) {
    if (binding.endedAt) {
      continue;
    }
    const key = `${binding.enterpriseId}|${binding.agentAssetId}`;
    openCounts.set(key, (openCounts.get(key) ?? 0) + 1);
  }
  for (const asset of Object.values(store.assets)) {
    if (asset.status !== "active") {
      continue;
    }
    const open = openCounts.get(`${asset.enterpriseId}|${asset.agentAssetId}`) ?? 0;
    if (open !== 1) {
      throw new AgentRegistryError(
        "OWNERSHIP_INVARIANT",
        `Active agent asset "${asset.agentAssetId}" in enterprise "${asset.enterpriseId}" has ` +
          `${open} open primary owner bindings; exactly one is required.`,
      );
    }
  }
}

/**
 * Owner baseline permissions are materialized as explicit policies elsewhere; an
 * owner never bypasses the evaluator. This helper only answers "is this subject
 * the current primary owner", and fails closed for an ambiguous owner.
 */
export function isPrimaryOwner(params: {
  store: AgentRegistryStore;
  ref: AgentRef;
  ownerType: AgentOwnerType;
  ownerId: string;
}): boolean {
  const binding = findPrimaryOwnerBinding(params.store, params.ref);
  return Boolean(
    binding && binding.ownerType === params.ownerType && binding.ownerId === params.ownerId,
  );
}
