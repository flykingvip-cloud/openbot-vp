import type { AgentRegistryStore } from "../agent-registry/types.js";
import type { TenantContext } from "../tenant-context.js";

export type OwnershipProof =
  | {
      source: "registry";
      ownerType: "user" | "membership";
      ownerId: string;
      agentAssetId: string;
    }
  | {
      source: "explicit_binding";
      ownerType: "user";
      ownerId: string;
      agentAssetId: string;
    };

export type WorkspaceOwnerScope =
  | { kind: "user_owned"; userId: string; agentAssetId: string; proof: OwnershipProof }
  | { kind: "position_owned"; seatId: string; agentAssetId: string }
  | { kind: "group_owned"; groupId: string }
  | { kind: "unknown"; reason: string };

export type RegistryEvidenceStatus = "available" | "empty" | "unavailable";

export type ExplicitUserBinding = {
  tenantId: string;
  userId: string;
  agentAssetId: string;
};

export type GroupAclEvidence = {
  tenantId: string;
  groupId: string;
  /** Authoritative member user ids from the group store. */
  memberUserIds: string[];
  available: boolean;
};

export type TrustedWorkspaceClassificationContext = {
  trusted: TenantContext;
  registry: AgentRegistryStore;
  registryStatus: RegistryEvidenceStatus;
  explicitBindings?: ExplicitUserBinding[];
  groupAcl?: GroupAclEvidence;
  /** Cross-check only — never used as authority. */
  claimedTenantId?: string | null;
  claimedUserId?: string | null;
};

export type ClassifyAgentAssetInput = {
  context: TrustedWorkspaceClassificationContext;
  agentAssetId: string;
};

export type ClassifyLegacyAgentInput = {
  context: TrustedWorkspaceClassificationContext;
  agentId: string;
};

export type ClassifyGroupWorkspaceInput = {
  context: TrustedWorkspaceClassificationContext;
  groupId: string;
};

export const UNKNOWN_OWNERSHIP_REASONS = {
  REGISTRY_UNAVAILABLE: "registry_unavailable",
  EMPTY_REGISTRY: "empty_registry",
  LEGACY_AGENT_NOT_MAPPED: "legacy_agent_not_mapped",
  DUPLICATE_LEGACY_AGENT_MAPPING: "duplicate_legacy_agent_mapping",
  LEGACY_AGENT_QUARANTINED: "legacy_agent_quarantined",
  ASSET_NOT_IN_TENANT: "asset_not_in_tenant",
  ASSET_NOT_ACTIVE: "asset_not_active",
  MISSING_PRIMARY_OWNER_BINDING: "missing_primary_owner_binding",
  AMBIGUOUS_PRIMARY_OWNER_BINDING: "ambiguous_primary_owner_binding",
  MEMBERSHIP_OWNER_REQUIRES_TRUSTED_USER: "membership_owner_requires_trusted_user",
  CALLER_TENANT_MISMATCH: "caller_tenant_mismatch",
  CALLER_USER_MISMATCH: "caller_user_mismatch",
  EXPLICIT_BINDING_NOT_FOUND: "explicit_binding_not_found",
  GROUP_ACL_UNAVAILABLE: "group_acl_unavailable",
  GROUP_TENANT_MISMATCH: "group_tenant_mismatch",
  GROUP_ID_MISMATCH: "group_id_mismatch",
  GROUP_ACL_EMPTY: "group_acl_empty",
} as const;

export type WritableWorkspaceOwnerScope = Exclude<WorkspaceOwnerScope, { kind: "unknown" }>;
