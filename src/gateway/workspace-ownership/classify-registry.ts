import { findPrimaryOwnerBinding } from "../agent-registry/ownership.js";
import { findAgentAsset } from "../agent-registry/registry.js";
import type { AgentRegistryStore } from "../agent-registry/types.js";
import {
  UNKNOWN_OWNERSHIP_REASONS,
  type OwnershipProof,
  type WorkspaceOwnerScope,
} from "./types.js";

export function unknownOwnership(reason: string): WorkspaceOwnerScope {
  return { kind: "unknown", reason };
}

export function rejectClaimedTenantMismatch(params: {
  trustedTenantId: string;
  claimedTenantId?: string | null;
}): WorkspaceOwnerScope | null {
  const claimed = params.claimedTenantId?.trim();
  if (claimed && claimed !== params.trustedTenantId) {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.CALLER_TENANT_MISMATCH);
  }
  return null;
}

export function rejectClaimedUserMismatch(params: {
  trustedUserId: string;
  claimedUserId?: string | null;
}): WorkspaceOwnerScope | null {
  const claimed = params.claimedUserId?.trim();
  if (claimed && claimed !== params.trustedUserId) {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.CALLER_USER_MISMATCH);
  }
  return null;
}

export function resolveLegacyAgentAssetId(params: {
  store: AgentRegistryStore;
  tenantId: string;
  agentId: string;
}): { kind: "resolved"; agentAssetId: string } | { kind: "unknown"; reason: string } {
  const legacyAgentId = params.agentId.trim();
  if (!legacyAgentId) {
    return { kind: "unknown", reason: UNKNOWN_OWNERSHIP_REASONS.LEGACY_AGENT_NOT_MAPPED };
  }

  for (const entry of Object.values(params.store.quarantine)) {
    if (entry.enterpriseId === params.tenantId && entry.legacyAgentId === legacyAgentId) {
      return { kind: "unknown", reason: UNKNOWN_OWNERSHIP_REASONS.LEGACY_AGENT_QUARANTINED };
    }
  }

  const matches = Object.values(params.store.assets).filter(
    (asset) => asset.enterpriseId === params.tenantId && asset.legacyAgentId === legacyAgentId,
  );
  if (matches.length === 0) {
    return { kind: "unknown", reason: UNKNOWN_OWNERSHIP_REASONS.LEGACY_AGENT_NOT_MAPPED };
  }
  if (matches.length > 1) {
    return { kind: "unknown", reason: UNKNOWN_OWNERSHIP_REASONS.DUPLICATE_LEGACY_AGENT_MAPPING };
  }
  return { kind: "resolved", agentAssetId: matches[0].agentAssetId };
}

export function classifyAgentAssetInRegistry(params: {
  store: AgentRegistryStore;
  tenantId: string;
  agentAssetId: string;
  trustedUserId: string;
}): WorkspaceOwnerScope {
  const ref = { enterpriseId: params.tenantId, agentAssetId: params.agentAssetId };
  const asset = findAgentAsset(params.store, ref);
  if (!asset) {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.ASSET_NOT_IN_TENANT);
  }
  if (asset.enterpriseId !== params.tenantId) {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.ASSET_NOT_IN_TENANT);
  }
  if (asset.status !== "active") {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.ASSET_NOT_ACTIVE);
  }

  const openBindings = Object.values(params.store.ownerBindings).filter(
    (binding) =>
      binding.enterpriseId === params.tenantId &&
      binding.agentAssetId === params.agentAssetId &&
      !binding.endedAt,
  );
  if (openBindings.length === 0) {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.MISSING_PRIMARY_OWNER_BINDING);
  }
  if (openBindings.length > 1) {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.AMBIGUOUS_PRIMARY_OWNER_BINDING);
  }

  const binding = findPrimaryOwnerBinding(params.store, ref);
  if (!binding) {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.AMBIGUOUS_PRIMARY_OWNER_BINDING);
  }

  if (binding.ownerType === "seat") {
    return {
      kind: "position_owned",
      seatId: binding.ownerId,
      agentAssetId: params.agentAssetId,
    };
  }

  const proof: OwnershipProof = {
    source: "registry",
    ownerType: "membership",
    ownerId: binding.ownerId,
    agentAssetId: params.agentAssetId,
  };
  if (!params.trustedUserId.trim()) {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.MEMBERSHIP_OWNER_REQUIRES_TRUSTED_USER);
  }
  return {
    kind: "user_owned",
    userId: params.trustedUserId,
    agentAssetId: params.agentAssetId,
    proof,
  };
}

export function isRegistryStoreEmpty(store: AgentRegistryStore): boolean {
  return (
    Object.keys(store.assets).length === 0 &&
    Object.keys(store.ownerBindings).length === 0 &&
    Object.keys(store.quarantine).length === 0
  );
}
