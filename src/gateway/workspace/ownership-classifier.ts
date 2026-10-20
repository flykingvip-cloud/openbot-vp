/**
 * P0-b fail-closed workspace ownership classifier.
 *
 * Inputs are trusted tenant context plus authoritative ownership evidence.
 * Caller-supplied owner/tenant fields are never accepted as proof.
 */

import { resolveLegacyAgentId } from "../agent-registry/legacy-resolver.js";
import { findPrimaryOwnerBinding } from "../agent-registry/ownership.js";
import type { AgentRegistryStore } from "../agent-registry/types.js";
import type { OwnershipProof, WorkspaceOwnerScope } from "./types.js";

export type TrustedWorkspaceActor = {
  /** Authoritative tenant / enterprise id from membership context. */
  tenantId: string;
  /** Authoritative user / membership id when known. */
  userId?: string | null;
  membershipId?: string | null;
};

export type ClassifyWorkspaceOwnershipInput = {
  actor: TrustedWorkspaceActor;
  registry: AgentRegistryStore | null;
  /** Registry load failed or returned a corrupt empty store unexpectedly. */
  registryUnavailable?: boolean;
  /** Runtime agent slug — never durable storage identity. */
  agentId?: string | null;
  /** Stable asset id when already known from an authoritative binding. */
  agentAssetId?: string | null;
  /** Collaboration group id when the request is group-scoped. */
  groupId?: string | null;
  /** True when group ACL membership was verified by an authoritative store. */
  groupAclVerified?: boolean;
  /**
   * Explicit user binding proof from an authoritative control-plane record
   * (not a client field).
   */
  explicitUserBinding?: {
    userId: string;
    agentAssetId: string;
  } | null;
  /**
   * Rejected if present — proves clients cannot steer classification.
   */
  clientOwnerHint?: string | null;
  clientTenantHint?: string | null;
};

function unknown(reason: string): WorkspaceOwnerScope {
  return { kind: "unknown", reason };
}

/**
 * Classify workspace ownership. Fail closed to `unknown` on missing, corrupt,
 * duplicate, cross-tenant, or contradictory evidence.
 */
export function classifyWorkspaceOwnership(
  input: ClassifyWorkspaceOwnershipInput,
): WorkspaceOwnerScope {
  if (input.clientOwnerHint != null && String(input.clientOwnerHint).trim() !== "") {
    return unknown("client_owner_hint_rejected");
  }
  if (input.clientTenantHint != null && String(input.clientTenantHint).trim() !== "") {
    return unknown("client_tenant_hint_rejected");
  }

  const tenantId = input.actor.tenantId?.trim();
  if (!tenantId) {
    return unknown("missing_trusted_tenant");
  }

  const groupId = input.groupId?.trim() || null;
  if (groupId) {
    if (!input.groupAclVerified) {
      return unknown("group_acl_unverified");
    }
    return { kind: "group_owned", groupId };
  }

  if (input.registryUnavailable) {
    return unknown("registry_unavailable");
  }
  if (!input.registry) {
    return unknown("registry_missing");
  }

  // Empty registry must not become user_owned.
  const assetCount = Object.keys(input.registry.assets).length;
  const bindingCount = Object.keys(input.registry.ownerBindings).length;
  if (assetCount === 0 && bindingCount === 0 && !input.explicitUserBinding) {
    // Still allow explicit binding path below; otherwise unknown.
    if (!input.agentAssetId?.trim() && !input.agentId?.trim()) {
      return unknown("empty_registry");
    }
  }

  let agentAssetId = input.agentAssetId?.trim() || null;

  if (!agentAssetId && input.agentId?.trim()) {
    const resolved = resolveLegacyAgentId({
      store: input.registry,
      enterpriseId: tenantId,
      legacyAgentId: input.agentId.trim(),
    });
    if (resolved.kind === "ambiguous") {
      return unknown("duplicate_agent_id_mapping");
    }
    if (resolved.kind === "builtin-universal") {
      return unknown("builtin_steward_exception_required");
    }
    if (resolved.kind === "not-found") {
      return unknown("agent_id_unmapped");
    }
    agentAssetId = resolved.ref.agentAssetId;
    if (resolved.ref.enterpriseId !== tenantId) {
      return unknown("cross_tenant_agent_asset");
    }
  }

  if (input.explicitUserBinding) {
    const boundUser = input.explicitUserBinding.userId.trim();
    const boundAsset = input.explicitUserBinding.agentAssetId.trim();
    if (!boundUser || !boundAsset) {
      return unknown("explicit_binding_incomplete");
    }
    if (agentAssetId && agentAssetId !== boundAsset) {
      return unknown("explicit_binding_asset_conflict");
    }
    const proof: OwnershipProof = {
      source: "explicit_binding",
      ownerType: "user",
      ownerId: boundUser,
      agentAssetId: boundAsset,
    };
    return {
      kind: "user_owned",
      userId: boundUser,
      agentAssetId: boundAsset,
      proof,
    };
  }

  if (!agentAssetId) {
    return unknown("missing_agent_asset_id");
  }

  const asset = input.registry.assets[agentAssetId];
  if (!asset) {
    return unknown("agent_asset_not_in_registry");
  }
  if (asset.enterpriseId !== tenantId) {
    return unknown("cross_tenant_agent_asset");
  }

  const primary = findPrimaryOwnerBinding(input.registry, {
    enterpriseId: tenantId,
    agentAssetId,
  });
  if (!primary) {
    // Missing seat / membership binding does NOT imply user_owned.
    return unknown("missing_primary_owner");
  }

  if (primary.ownerType === "seat") {
    return {
      kind: "position_owned",
      seatId: primary.ownerId,
      agentAssetId,
    };
  }

  if (primary.ownerType === "membership") {
    const userId =
      input.actor.userId?.trim() || input.actor.membershipId?.trim() || primary.ownerId;
    if (!userId) {
      return unknown("membership_owner_missing_user");
    }
    const proof: OwnershipProof = {
      source: "registry",
      ownerType: "membership",
      ownerId: primary.ownerId,
      agentAssetId,
    };
    return {
      kind: "user_owned",
      userId,
      agentAssetId,
      proof,
    };
  }

  return unknown("unsupported_owner_type");
}

/** True when write paths must reject before filesystem resolution. */
export function isWritableWorkspaceScope(scope: WorkspaceOwnerScope): boolean {
  return scope.kind !== "unknown";
}
