export * from "./types.js";
export * from "./limits.js";
export * from "./envelope.js";
export * from "./envelope-cognitive.js";
export {
  recoverCognitiveMutation,
  supersedeCognitiveProvenanceRef,
  updateCognitiveGovernance,
} from "./cognitive-update.js";
export type {
  CognitiveUpdateResult,
  CognitiveWriteLockResult,
  SupersedeCognitiveProvenanceRefParams,
  UpdateCognitiveGovernanceParams,
} from "./cognitive-update.js";
export { isCognitiveWriteUnlocked } from "./cognitive-write-unlock.js";
export * from "./cognitive-mutation-store.js";
export {
  getCognitiveProvenanceBinding,
  hashCognitiveGenerationProvenance,
  listCognitiveProvenanceHistory,
} from "./cognitive-provenance-store.js";
export * from "./cognitive-patch.js";
export * from "./cognitive-score.js";
export {
  authenticateGovernanceCall,
  resolveCognitiveRecommendationAuth,
} from "./cognitive-recommendation-auth.js";
export type {
  CognitiveRecommendationAuth,
  GovernanceAuthenticatedCall,
} from "./cognitive-recommendation-auth.js";
export {
  cleanupExpiredCognitiveRecommendations,
  getCognitiveRecommendation,
  recordCognitiveRecommendation,
} from "./cognitive-recommendation.js";
export {
  isGovernanceApprovalAuth,
  resolveGovernanceApprovalAuth,
} from "./cognitive-approval-auth.js";
export type { GovernanceApprovalAuth } from "./cognitive-approval-auth.js";
export { openConflictEdgesTouching, readConflictGraphHead } from "./cognitive-conflict-graph.js";
export { recordOpenConflictEdge, resolveConflictEdge } from "./cognitive-conflict-edges.js";
export { applyCognitiveMerge } from "./cognitive-merge.js";
export type { ApplyCognitiveMergeParams, ApplyCognitiveMergeResult } from "./cognitive-merge.js";
export { hasCommitEvidence } from "./cognitive-merge-recovery.js";
export { reportCognitiveHealth } from "./cognitive-health.js";
export { evaluateCognitiveThresholds, loadThresholdContract } from "./cognitive-evaluator.js";
export { getCognitiveMergeReceipt } from "./cognitive-merge-receipt-store.js";
export {
  approveManifestSupersession,
  proposeManifestSupersession,
  readAgentAssetManifest,
  readAgentAssetManifestPointer,
} from "./agent-asset-manifest.js";
export type {
  ApproveManifestSupersessionParams,
  ManifestCommandResult,
  ProposeManifestSupersessionParams,
} from "./agent-asset-manifest.js";
export {
  activateAnchor,
  proposeAnchor,
  readActiveAnchor,
  readAnchorPointer,
  readDerivedAnchorStatus,
  revokeAnchor,
  supersedeAnchor,
} from "./cognitive-anchor.js";
export type {
  ActivateAnchorParams,
  AnchorCommandResult,
  ProposeAnchorParams,
  RevokeAnchorParams,
  SupersedeAnchorParams,
} from "./cognitive-anchor.js";
export { decideConstrainedRetrieval } from "./cognitive-retrieval.js";
export type {
  ConstrainedRetrievalDecision,
  DecideConstrainedRetrievalParams,
  RetrievalDenyCode,
  RetrievalMode,
  RetrievalPolicyEvaluation,
  RetrievalPolicyEvaluator,
} from "./cognitive-retrieval.js";
export type {
  CognitiveRecommendationDenied,
  CognitiveRecommendationResult,
  RecordCognitiveRecommendationParams,
} from "./cognitive-recommendation.js";
export {
  computeCognitiveRecommendationFingerprint,
  getCognitiveRecommendationReceipt,
} from "./cognitive-recommendation-store.js";
export * from "./bindings.js";
export type { CatalogCompareAndPutParams, DataGovernanceCatalogStore } from "./catalog-store.js";
export {
  assertCatalogPersistPreservesV2,
  createFileDataGovernanceCatalogStore,
  getOrCreateFileDataGovernanceCatalogStore,
  isCatalogRecordValid,
  resetCatalogStoreSingletonsForTests,
} from "./catalog-store.js";
export * from "./diagnostics.js";
export * from "./catalog-cache.js";
export * from "./inventory-api.js";
export * from "./migration-inventory.js";
export * from "./migration-identity-plan.js";
export * from "./migration-apply.js";
export * from "./migration-verify.js";
export * from "./migration-closure.js";
export * from "./later-wave-production-gate.js";
export * from "./later-wave-cutover-gate.js";
export * from "./paths.js";
export * from "./runtime-catalog.js";
export * from "./recovery-receipt.js";
export * from "./knowledge-register.js";
export * from "./memory-register.js";
export * from "./operational-identity-register.js";
export * from "./write-gate.js";
export * from "./ownership-proof.js";
export * from "./managed-create-txn.js";
export * from "./second-wave-migrate.js";
export * from "./logical-compensate.js";
export * from "./operation-marker.js";
export * from "./lifecycle-receipt-store.js";
export * from "./deletion-auth-marker.js";
export * from "./lifecycle-transition.js";
export * from "./lifecycle-purge.js";
export * from "./lifecycle-purge-adapters.js";
export * from "./lifecycle-adapter-matrix.js";
export * from "./lifecycle-access.js";
export * from "./lifecycle-conversation.js";
export * from "./lifecycle-conversation-adapter.js";
export * from "./lifecycle-memory.js";
export * from "./lifecycle-memory-staging.js";
export * from "./lifecycle-memory-adapter.js";
export {
  PLACEMENT_DENY_REASONS,
  isTrustedRegionDefault,
  resolvePlacement,
  trustedRegionDefaultFromReceipt,
} from "./placement-resolve.js";
export {
  reverifySubjectConsent,
  verifyPlatformDeploymentRegionReceipt,
  verifyResourceConsentScope,
  verifySubjectConsent,
} from "./placement-platform-verify.js";
export type { SignedPlatformDeploymentRegionReceipt } from "./placement-platform-verify.js";
export {
  getCognitivePromotionReceipt,
  prepareCognitivePromotionApply,
} from "./cognitive-promotion.js";
export {
  applyCognitivePromotion,
  serveCloudProjection,
  tombstoneCognitiveProjection,
} from "./cognitive-promotion-apply.js";
export type {
  ApplyCognitivePromotionParams,
  ApplyCognitivePromotionResult,
  PromotionApplyDenyCode,
  TombstoneCognitiveProjectionParams,
  TombstoneCognitiveProjectionResult,
} from "./cognitive-promotion-apply.js";
export {
  laterWaveAdapterAvailability,
  laterWaveAdapterUnavailable,
} from "./cognitive-promotion-adapters.js";
export { exportPlacement, restorePlacement } from "./placement-export.js";
export type {
  ExportPlacementParams,
  PlacementExportBundle,
  PlacementExportDenyCode,
  PlacementExportResult,
  PlacementRestoreResult,
  RestorePlacementParams,
} from "./placement-export.js";
export type {
  PrepareCognitivePromotionParams,
  PrepareCognitivePromotionResult,
  PromotionPrepareDenyCode,
} from "./cognitive-promotion.js";
export type {
  PlacementDenyReason,
  PlacementPolicy,
  PlacementResolverInput,
  PlacementResolverOutput,
  PlatformDeploymentRegionReceipt,
  ResourceConsentScope,
  SubjectConsentProof,
  SyncClassification,
  TrustedRegionDefault,
  UntrustedRegionSource,
} from "./placement-resolve.js";
export {
  PORTABLE_READER_ID,
  PORTABLE_READER_VERSION,
  SCHEMA_TRANSFORM_MEDIA_TYPE,
  applySchemaTransformOps,
  parseSchemaTransformDocument,
} from "./schema-ladder-reader.js";
export {
  assertProducerMatrixShape,
  lookupProducerClaimSupport,
  parseProducerModelMatrix,
} from "./producer-model-matrix.js";
export {
  applySchemaLadderStep,
  defaultPortableReaderManifest,
  denyMergedLadder,
  envelopeV1ToV2LadderEntry,
  envelopeV1ToV2TransformBytes,
  parsePortableReaderManifest,
  parseSchemaLadder,
  refuseMtimeAsTruth,
  refuseRedistillationAsLadder,
  resolveLadderPath,
} from "./schema-ladder.js";
export type {
  ContentFormatMigrationReceipt,
  DeletionClosureProof,
  IntegrityScanReceipt,
  KeyGenerationRecord,
  KeyGenerationState,
  KeyRetireReceipt,
  KeyRotationReceipt,
  PortableReaderManifest,
  ProducerModelMatrixEntry,
  RedistillationReceipt,
  RestoreDrillReceipt,
  RewrapReceipt,
  SchemaLadderEntry,
  SchemaMigrationReceipt,
} from "./types.js";
export { isTenantKeyManagementAuth, resolveTenantKeyManagementAuth } from "./key-rotation-auth.js";
export type { TenantKeyManagementAuth } from "./key-rotation-auth.js";
export {
  assertSingleWritableCanonical,
  bootstrapTenantKeyService,
  commitActiveKeyGeneration,
  decryptCoveredObject,
  encryptCanonicalWrite,
  generateNextKeyGeneration,
  reactivateRetiredKey,
  readableKeyGenerations,
  reclaimOrphanWraps,
  retireKeyGeneration,
  rewriteCiphertextForAlgorithmRetirement,
  rewrapCoveredObjects,
  selectWriteKeyGeneration,
} from "./key-rotation.js";
export {
  merkleRootFromLeaves,
  readBackupRestoreObservability,
  refuseRestoreMtimeAsTruth,
  runRestoreDrill,
  validateLongevityBundle,
} from "./restore-drill.js";
export type { PortableLongevityBundle } from "./restore-drill.js";
export {
  migrateContentFormat,
  refuseIntegrityMtimeAsTruth,
  refusePlacementFromIntegrityReceipt,
  refusePurgeFromFormatReceipt,
  scanTenantIntegrity,
} from "./integrity-format.js";
export {
  destResourceIdForImport,
  refuseExitMtimeAsTruth,
  refusePlacementFromMappingReceipt,
  runExitImportDrill,
  validateExitLongevityBundle,
} from "./exit-export.js";
export type { ExitLongevityBundle, ExitLongevityMode } from "./exit-export.js";
export {
  checkpointChecksum,
  refuseAnchorAutoActivationFromReview,
  refuseContinuityDomainMerge,
  refuseContinuityMtimeAsTruth,
  refusePlacementFromContinuityReview,
  runContinuityRestoreDrill,
  runHumanAnchorReview,
  validateContinuityCheckpoint,
} from "./continuity-longevity.js";
export {
  DEFAULT_MAX_BACKUP_AGE_DAYS,
  DEFAULT_MAX_BACKUP_AGE_MS,
  FIRST_WAVE_GOVERNED_RESOURCE_CLASSES,
  MS_PER_DAY,
  checkpointTenantStorageGrowthBaseline,
  evaluateBackupObservability,
  refuseLongevityMtimeAsTruth,
  refusePlacementFromLongevityReport,
  refusePurgeFromLongevityReport,
  resolveMaxBackupAgeMsFromPolicy,
  runTenantLongevityReport,
} from "./longevity-report.js";
