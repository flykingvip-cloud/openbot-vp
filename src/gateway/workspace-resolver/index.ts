export {
  GROUP_WORKSPACE_MANIFEST_RELATIVE_PATH,
  readGroupWorkspaceFileContent,
  readGroupWorkspaceManifestContent,
  listGroupWorkspaceRelativeDir,
  resolveGroupWorkspaceFileAccess,
  resolveWorkspaceActorTenantId,
  writeGroupWorkspaceRelativeFile,
  writeGroupWorkspaceManifestContent,
  upsertGroupWorkspaceDeliverableCanonical,
  upsertGroupWorkspaceDeliverableDraft,
  ensureGroupWorkspaceWriteRoot,
  pruneGroupWorkspaceExpiredDrafts,
  type GroupWorkspaceDraftUpsertResult,
  type PruneGroupWorkspaceExpiredDraftsParams,
  type PruneGroupWorkspaceExpiredDraftsResult,
  type UpsertGroupWorkspaceDeliverableDraftParams,
  type GroupWorkspaceFileAccessResult,
  type GroupWorkspaceListResult,
  type GroupWorkspaceManifestReadResult,
  type GroupWorkspaceWriteResult,
  type ResolveGroupWorkspaceFileAccessParams,
  type UpsertGroupWorkspaceDeliverableCanonicalParams,
  type WriteGroupWorkspaceManifestParams,
  type WriteGroupWorkspaceRelativeFileParams,
} from "./group-read.js";
export {
  readStewardWorkspaceFileContent,
  buildWorkspaceRelativePathCandidates,
  type ReadStewardWorkspaceFileParams,
  type StewardWorkspaceFileReadResult,
  type StewardWorkspaceRootCandidate,
} from "./steward-read.js";
export {
  STEWARD_BUILTIN_AGENT_ASSET_ID,
  buildEmployeeStewardCutoverCatalog,
  digestWorkspaceTree,
  resolveEmployeeStewardSourceWorkspaceDir,
  resolveEmployeeStewardTargetWorkspaceDir,
  resolveEmployeeStewardWritableWorkspaceDir,
  verifiedCopyStewardWorkspace,
  type StewardWritableWorkspaceResult,
} from "./steward-write.js";
export {
  provisionEmployeeStewardCutoverWorkspace,
  type StewardCutoverProvisionReceipt,
  type StewardCutoverProvisionRequest,
  type StewardCutoverProvisionResult,
} from "./provision-steward-cutover.js";
// NOTE: the @internal test-only steward cutover pilot is intentionally NOT
// re-exported from this barrel; production code must not import it. The
// pilot-test-only-boundary.test.ts machine gate enforces this (fails on any
// production import/re-export/call). Tests import it directly from
// "./provision-steward-cutover.js".
export {
  readLocalIndexDocumentContent,
  type LocalIndexDocumentReadResult,
  type ReadLocalIndexDocumentParams,
} from "./local-index-read.js";
export {
  resolveAuthorizedAgentToolWorkspaceCwd,
  type AuthorizedAgentToolWorkspaceCwdResult,
  type ResolveAuthorizedAgentToolWorkspaceCwdParams,
} from "./tool-cwd.js";
export { WorkspaceResourceAccess } from "./access.js";
export {
  buildEmployeeStewardCutoverCatalogEntries,
  buildGroupWorkspaceCatalogEntry,
  buildUserOwnedWorkspaceCatalogEntry,
  buildLocalFolderIndexCatalogEntry,
  buildWorkspaceResourceId,
} from "./builders.js";
export {
  createEmptyWorkspaceCatalog,
  InMemoryWorkspaceResourceCatalog,
  withCatalogEntries,
  type WorkspaceResourceCatalog,
} from "./catalog.js";
export { WorkspaceResolverCache } from "./cache.js";
export {
  getGatewayWorkspaceCutoverStore,
  resetGatewayWorkspaceCutoverStoreForTests,
} from "../workspace-cutover/runtime.js";
export {
  invalidateWorkspaceResourceCacheAfterWrite,
  openWorkspaceResourceAccess,
  resolveWorkspaceResource,
  type ResolveWorkspaceResourceParams,
} from "./resolve.js";
export {
  denyLegacyLocatorCaller,
  ITEM7_LOCATOR_DELETE_CALL_SITES,
  ITEM7_LOCATOR_DEPLOY_AUTHORIZED,
  ITEM7_LOCATOR_EXECUTION_BLOCKED,
  ITEM7_LOCATOR_ITEM7,
  ITEM7_LOCATOR_LIVE,
  ITEM7_LOCATOR_LIVE_WRITE_WATCH_INDEX,
  ITEM7_LOCATOR_PHASE1B_UNLOCK,
  ITEM7_LOCATOR_PRODUCTION_CATALOG_WRITE,
  ITEM7_LOCATOR_RETIRED_THIS_CHANGE,
  ITEM7_LOCATOR_SCHEMA_V2_WRITE,
  ITEM7_LOCATOR_WIRED_TO_PRODUCTION,
  LEGACY_LOCATOR_CALLER_MATRIX,
  resolveWorkspaceLocator,
  resolveWorkspaceTargetBinding,
  type LegacyLocatorCallerShape,
  type WorkspaceLocatorFailure,
  type WorkspaceLocatorGrant,
  type WorkspaceLocatorHandle,
  type WorkspaceLocatorQueryAttempt,
  type WorkspaceLocatorReasonCode,
  type WorkspaceLocatorResult,
  type WorkspaceLocatorSuccess,
} from "./strict-locator.js";
export {
  resolveMemoryWorkspaceHandle,
  U1_DARK_HANDLE_PERMISSIONS,
  type MemoryWorkspaceResolvePorts,
  type ResolveMemoryWorkspaceHandleParams,
} from "./memory-workspace-resolve.js";
export {
  type WorkspaceBindingRecord,
  type WorkspaceBindingRole,
  type WorkspaceBindingState,
  type WorkspaceCatalogStatus,
  type WorkspaceLifecycleState,
  type WorkspaceResolveActor,
  type WorkspaceResolveAudit,
  type WorkspaceResolveDenyReason,
  type WorkspaceResolveFailure,
  type WorkspaceResolveResult,
  type WorkspaceResolveSuccess,
  type WorkspaceResourceCatalogSnapshot,
  type WorkspaceResourceOperation,
  type WorkspaceResourceRecord,
} from "./types.js";

export {
  resolveCanonicalRobotWriteRoot,
  loadCanonicalWriteOwnership,
  mergeCanonicalWriteOwnership,
  seatOwnedWriteOwnership,
  inferSeatOwnershipFromAgentConfig,
  extractWorkspaceHostUserIdFromLocator,
  isStickySeatFilesystemLocator,
  type CanonicalWriteOwnership,
} from "./canonical-write-root.js";

export {
  resolveFormalDeliverableRoot,
  alignFormalRootForManagedAddressing,
  formalAddressingEnv,
  listFormalRootSkewSiblings,
  resolveFormalAgentWorkspace,
  buildFormalFileRef,
  resolveFormalPreviewAbsolutePath,
  type FormalResourceKind,
  type FormalResourceIdentity,
  type FormalDeliverableRootResult,
  type FormalDeliverableRootSuccess,
  type FormalDeliverableRootFailure,
} from "./formal-deliverable-root.js";
