import path from "node:path";

/** Durable metadata catalog location under the OpenBot stateDir. */
export function resolveDataGovernanceCatalogPath(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "catalog.json");
}

/** Closure / lifecycle receipt store root. */
export function resolveLifecycleReceiptRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "lifecycle-receipts");
}

/** Deletion authorization markers (logical validity; cleanup-only unlink). */
export function resolveDeletionAuthMarkerRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "deletion-markers");
}

/** Durable domain staging for two-phase forget (payload + meta, not in-memory). */
export function resolveMemoryForgetStagingRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "lifecycle-staging", "memory-forget");
}

/** Cognitive mutation receipts (not P2 lifecycle receipts). */
export function resolveCognitiveMutationRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "cognitive-mutations");
}

/** R0 dual-read / R1 write-unlock fleet receipts. */
export function resolveCognitiveFleetReceiptRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "cognitive-fleet");
}

/** Shadow CognitiveRecommendationReceipt store (not Catalog, not P2 lifecycle receipts). */
export function resolveCognitiveRecommendationRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "cognitive-recommendations");
}

/** Append-only cognitive provenance bindings (not envelope, not lifecycle-receipts). */
export function resolveCognitiveProvenanceRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "cognitive-provenance");
}

/** Read-only approval-grant registry (issued at the ops/deploy boundary, never self-issued). */
export function resolveCognitiveApprovalGrantRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "approval-grants");
}

/** Conflict graph head + edge rows, per tenant partition. */
export function resolveCognitiveConflictRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "cognitive-conflicts");
}

/** Cognitive merge receipts (not cognitive mutation receipts). */
export function resolveCognitiveMergeReceiptRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "cognitive-merges");
}

/** Append-only recovery / reclamation records; never mutates the row it describes. */
export function resolveCognitiveRecoveryRecordRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "cognitive-recovery");
}

/** Immutable AgentAsset continuity manifest history rows (P3-f). */
export function resolveAgentAssetManifestHistoryRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "agent-asset-manifests");
}

/** Active manifest pointer per AgentAsset (P3-f). */
export function resolveAgentAssetManifestPointerRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "agent-assets");
}

/** Manifest pointer-mutation receipts (P3-f). */
export function resolveAgentAssetManifestMutationRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "agent-asset-manifest-mutations");
}

/** Immutable human-verified anchor history rows (P3-g). */
export function resolveCognitiveAnchorHistoryRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "anchors");
}

/** Durable P4-b cognitive promotion receipts, unique by replayId. */
export function resolveCognitivePromotionRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "cognitive-promotions");
}

/** P4-L-a tenant managed cloud object store (enterprise-owned keys; not platform managed-encrypted-cloud). */
export function resolveTenantManagedCloudRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "tenant-managed-cloud");
}

/** P4-L-d cold archive object store (not a live Cloud Intelligence projection). */
export function resolveColdArchiveRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "cold-archive");
}

/** P4-L-c customer-controlled BYOS object store (not platform / tenant-cloud / dedicated). */
export function resolveByosRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "byos");
}

/** P4-L-b dedicated regional object store (isolated cell; not platform managed-encrypted-cloud). */
export function resolveDedicatedRegionalRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "dedicated-regional");
}

/** P4-c managed encrypted cloud object stand-in (not BYOS / tenant-cloud). */
export function resolveManagedEncryptedCloudRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "managed-encrypted-cloud");
}

/** P4-d placement export receipts (binding image only; not P5 bundles). */
export function resolvePlacementExportRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "placement-exports");
}

/** P5-b key-service pointer, rotation receipts, and generation wraps. */
export function resolveKeyRotationRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "key-rotation");
}

/** Tenant-admin / platform key-service operator policy (deploy boundary; never self-issued). */
export function resolveTenantKeyManagementPolicyRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "key-management-policy");
}

/** P5-c restore-drill receipts and backup/restore observability (not P5-d exit packages). */
export function resolveRestoreDrillRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "restore-drills");
}

/**
 * Isolated drill Catalog. Must never equal `resolveDataGovernanceCatalogPath`.
 * Restored rows live here for verification, then the file is destroyed.
 */
export function resolveRestoreDrillCatalogPath(stateDir: string, tenantId: string): string {
  return path.join(resolveRestoreDrillRoot(stateDir), tenantId, "catalog.json");
}

/** Durable format-migration journal (P5-c). Not a grant and not the production Catalog. */
export function resolveFormatMigrationJournalPath(
  stateDir: string,
  tenantId: string,
  resourceId: string,
): string {
  return path.join(
    path.resolve(stateDir),
    "data-governance",
    "format-migrations",
    tenantId,
    `${resourceId}.journal.json`,
  );
}

/** P5-d exit-import drill receipts and isolated import Catalog (not production). */
export function resolveExitImportRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "exit-imports");
}

/** Isolated exit-import Catalog. Must never equal `resolveDataGovernanceCatalogPath`. */
export function resolveExitImportCatalogPath(stateDir: string, destTenantId: string): string {
  return path.join(resolveExitImportRoot(stateDir), destTenantId, "catalog.json");
}

/** P5-e continuity restore drill receipts (not production manifest store). */
export function resolveContinuityLongevityRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "continuity-longevity");
}

/** Isolated continuity restore manifest history (P5-e). */
export function resolveContinuityRestoreManifestPath(
  stateDir: string,
  tenantId: string,
  agentAssetId: string,
  manifestId: string,
): string {
  return path.join(
    resolveContinuityLongevityRoot(stateDir),
    tenantId,
    agentAssetId,
    "manifests",
    `${manifestId}.json`,
  );
}

/** Isolated continuity restore manifest pointer (P5-e). */
export function resolveContinuityRestorePointerPath(
  stateDir: string,
  tenantId: string,
  agentAssetId: string,
): string {
  return path.join(
    resolveContinuityLongevityRoot(stateDir),
    tenantId,
    agentAssetId,
    "active-manifest-pointer.json",
  );
}

/** Tenant policy baseline authority for stale detection (P5-e). */
export function resolveTenantPolicyBaselinePath(stateDir: string, tenantId: string): string {
  return path.join(resolveContinuityLongevityRoot(stateDir), tenantId, "policy-baseline.json");
}

/** P5-f longevity report durable baselines (not production Catalog). */
export function resolveLongevityReportRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "longevity-reports");
}

/** P5-f storage growth baseline snapshot for delta/rate (not fs mtime truth). */
export function resolveStorageGrowthBaselinePath(stateDir: string, tenantId: string): string {
  return path.join(resolveLongevityReportRoot(stateDir), tenantId, "storage-growth-baseline.json");
}

/** P5-f tenant longevity SLO policy (deploy boundary; never self-issued). */
export function resolveTenantLongevityPolicyPath(stateDir: string, tenantId: string): string {
  return path.join(resolveLongevityReportRoot(stateDir), tenantId, "longevity-policy.json");
}

/** P4-c Cloud Intelligence projection envelopes and tombstones. */
export function resolveCloudProjectionRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "cloud-projections");
}

/** Active / tombstone anchor pointer per resource (P3-g). */
export function resolveCognitiveAnchorPointerRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "anchor-pointers");
}

/** Anchor pointer-mutation receipts (P3-g). */
export function resolveCognitiveAnchorMutationRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "anchor-mutations");
}

/** Durable later-wave I4 enablement receipts (evaluation only; never LIVE cutover). */
export function resolveLaterWaveEnablementRoot(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "later-wave-enablement");
}

/** Durable subject-consent records for placement (P4-a). */
export function resolvePlacementConsentStorePath(stateDir: string): string {
  return path.join(path.resolve(stateDir), "data-governance", "placement-consents.json");
}
