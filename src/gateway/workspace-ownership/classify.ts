import {
  classifyAgentAssetInRegistry,
  isRegistryStoreEmpty,
  rejectClaimedTenantMismatch,
  rejectClaimedUserMismatch,
  resolveLegacyAgentAssetId,
  unknownOwnership,
} from "./classify-registry.js";
import type {
  ClassifyAgentAssetInput,
  ClassifyGroupWorkspaceInput,
  ClassifyLegacyAgentInput,
  ExplicitUserBinding,
  GroupAclEvidence,
  TrustedWorkspaceClassificationContext,
  WorkspaceOwnerScope,
} from "./types.js";
import { UNKNOWN_OWNERSHIP_REASONS } from "./types.js";

function findExplicitBinding(
  bindings: ExplicitUserBinding[] | undefined,
  params: { tenantId: string; userId: string; agentAssetId: string },
): ExplicitUserBinding | undefined {
  return bindings?.find(
    (binding) =>
      binding.tenantId === params.tenantId &&
      binding.userId === params.userId &&
      binding.agentAssetId === params.agentAssetId,
  );
}

function classifyExplicitUserBinding(params: {
  context: TrustedWorkspaceClassificationContext;
  binding: ExplicitUserBinding;
}): WorkspaceOwnerScope {
  const tenantMismatch = rejectClaimedTenantMismatch({
    trustedTenantId: params.context.trusted.tenantId,
    claimedTenantId: params.context.claimedTenantId,
  });
  if (tenantMismatch) {
    return tenantMismatch;
  }
  if (params.binding.tenantId !== params.context.trusted.tenantId) {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.ASSET_NOT_IN_TENANT);
  }
  if (params.binding.userId !== params.context.trusted.userId) {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.CALLER_USER_MISMATCH);
  }
  return {
    kind: "user_owned",
    userId: params.binding.userId,
    agentAssetId: params.binding.agentAssetId,
    proof: {
      source: "explicit_binding",
      ownerType: "user",
      ownerId: params.binding.userId,
      agentAssetId: params.binding.agentAssetId,
    },
  };
}

function validateGroupAclEvidence(params: {
  context: TrustedWorkspaceClassificationContext;
  groupId: string;
  acl: GroupAclEvidence;
}): WorkspaceOwnerScope | null {
  if (!params.acl.available) {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.GROUP_ACL_UNAVAILABLE);
  }
  if (params.acl.tenantId !== params.context.trusted.tenantId) {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.GROUP_TENANT_MISMATCH);
  }
  if (params.acl.groupId !== params.groupId) {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.GROUP_ID_MISMATCH);
  }
  if (params.acl.memberUserIds.length === 0) {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.GROUP_ACL_EMPTY);
  }
  return null;
}

/**
 * Pure fail-closed workspace ownership classifier (P0-b).
 * Uses trusted tenant context plus authoritative evidence only.
 */
export function classifyWorkspaceAgentAsset(input: ClassifyAgentAssetInput): WorkspaceOwnerScope {
  const { context, agentAssetId } = input;
  const tenantMismatch = rejectClaimedTenantMismatch({
    trustedTenantId: context.trusted.tenantId,
    claimedTenantId: context.claimedTenantId,
  });
  if (tenantMismatch) {
    return tenantMismatch;
  }
  const userMismatch = rejectClaimedUserMismatch({
    trustedUserId: context.trusted.userId,
    claimedUserId: context.claimedUserId,
  });
  if (userMismatch) {
    return userMismatch;
  }

  if (context.registryStatus === "unavailable") {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.REGISTRY_UNAVAILABLE);
  }

  const explicit = findExplicitBinding(context.explicitBindings, {
    tenantId: context.trusted.tenantId,
    userId: context.trusted.userId,
    agentAssetId,
  });
  if (explicit) {
    return classifyExplicitUserBinding({ context, binding: explicit });
  }

  if (context.registryStatus === "empty" || isRegistryStoreEmpty(context.registry)) {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.EMPTY_REGISTRY);
  }

  return classifyAgentAssetInRegistry({
    store: context.registry,
    tenantId: context.trusted.tenantId,
    agentAssetId,
    trustedUserId: context.trusted.userId,
  });
}

export function classifyWorkspaceLegacyAgent(input: ClassifyLegacyAgentInput): WorkspaceOwnerScope {
  const { context, agentId } = input;
  const tenantMismatch = rejectClaimedTenantMismatch({
    trustedTenantId: context.trusted.tenantId,
    claimedTenantId: context.claimedTenantId,
  });
  if (tenantMismatch) {
    return tenantMismatch;
  }

  if (context.registryStatus === "unavailable") {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.REGISTRY_UNAVAILABLE);
  }
  if (context.registryStatus === "empty" || isRegistryStoreEmpty(context.registry)) {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.EMPTY_REGISTRY);
  }

  const mapped = resolveLegacyAgentAssetId({
    store: context.registry,
    tenantId: context.trusted.tenantId,
    agentId,
  });
  if (mapped.kind === "unknown") {
    return unknownOwnership(mapped.reason);
  }

  return classifyWorkspaceAgentAsset({
    context,
    agentAssetId: mapped.agentAssetId,
  });
}

export function classifyWorkspaceGroup(input: ClassifyGroupWorkspaceInput): WorkspaceOwnerScope {
  const { context, groupId } = input;
  const tenantMismatch = rejectClaimedTenantMismatch({
    trustedTenantId: context.trusted.tenantId,
    claimedTenantId: context.claimedTenantId,
  });
  if (tenantMismatch) {
    return tenantMismatch;
  }

  const acl = context.groupAcl;
  if (!acl) {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.GROUP_ACL_UNAVAILABLE);
  }

  const invalid = validateGroupAclEvidence({ context, groupId, acl });
  if (invalid) {
    return invalid;
  }

  return { kind: "group_owned", groupId };
}

/** Cross-tenant isolation check for stable ids reused across tenants. */
export function assertTenantScopedAgentAsset(params: {
  store: import("../agent-registry/types.js").AgentRegistryStore;
  tenantId: string;
  agentAssetId: string;
}): WorkspaceOwnerScope | null {
  const asset = params.store.assets[params.agentAssetId];
  if (!asset) {
    return null;
  }
  if (asset.enterpriseId !== params.tenantId) {
    return unknownOwnership(UNKNOWN_OWNERSHIP_REASONS.ASSET_NOT_IN_TENANT);
  }
  return null;
}
