export { classifyInventoryRecord, mapInventoryOwnershipStatus } from "./inventory-bridge.js";
export {
  assertTenantScopedAgentAsset,
  classifyWorkspaceAgentAsset,
  classifyWorkspaceGroup,
  classifyWorkspaceLegacyAgent,
} from "./classify.js";
export {
  classifyAgentAssetInRegistry,
  isRegistryStoreEmpty,
  rejectClaimedTenantMismatch,
  rejectClaimedUserMismatch,
  resolveLegacyAgentAssetId,
  unknownOwnership,
} from "./classify-registry.js";
export {
  gateWorkspaceWrite,
  isWritableOwnerScope,
  requireProvedOwnerScopeForWrite,
  WorkspaceOwnershipRejectedError,
} from "./write-guard.js";
export {
  UNKNOWN_OWNERSHIP_REASONS,
  type ClassifyAgentAssetInput,
  type ClassifyGroupWorkspaceInput,
  type ClassifyLegacyAgentInput,
  type ExplicitUserBinding,
  type GroupAclEvidence,
  type OwnershipProof,
  type RegistryEvidenceStatus,
  type TrustedWorkspaceClassificationContext,
  type WorkspaceOwnerScope,
  type WritableWorkspaceOwnerScope,
} from "./types.js";
