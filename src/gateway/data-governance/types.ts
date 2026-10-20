/**
 * Data Governance v2 P1 — governance envelope + catalog contracts.
 * Architecture: docs/design/openbot-data-governance-architecture-v2-2026-08-10.md
 */

export const GOVERNANCE_ENVELOPE_SCHEMA_VERSION = 1 as const;
export const GOVERNANCE_ENVELOPE_SCHEMA_VERSION_V2 = 2 as const;
export type GovernanceEnvelopeSchemaVersion = 1 | 2;

export type FirstWaveResourceType = "workspace" | "agent" | "conversation_archive";

/** P1-2 second-wave Catalog resource types (Gate Accepted). */
export type SecondWaveResourceType = "knowledge" | "memory" | "operational_identity";

export type GovernedResourceType = FirstWaveResourceType | SecondWaveResourceType;

export type OwnershipPrincipal =
  | { kind: "user"; userId: string }
  | { kind: "position"; seatId: string }
  | { kind: "group"; groupId: string }
  | { kind: "system"; systemId: string };

export type ResourceScope =
  | { kind: "user"; userId: string }
  | { kind: "tenant"; tenantId: string }
  | { kind: "group"; groupId: string }
  | { kind: "system" };

export type LifecycleState =
  | "pending"
  | "active"
  | "read_only"
  | "archived"
  /** Compensate halted or physical quarantine incomplete — catalog row retained. */
  | "recovery_required"
  /** Physical quarantine succeeded; row retained (not hard-deleted). */
  | "quarantined"
  | "retired"
  /** Soft-delete requested; resolver denies normal access; survives restart. */
  | "deletion_pending"
  | "purged";

/** Lifecycle command actor (distinct from OwnershipPrincipal). */
export type ActorRef =
  | { kind: "user"; userId: string }
  | { kind: "operator"; operatorId: string }
  | { kind: "worker"; workerId: string }
  | { kind: "system"; systemId: string };

export type LifecycleCommand =
  | "archive"
  | "restore"
  | "retire"
  | "applyLegalHold"
  | "releaseLegalHold"
  | "requestPurge"
  | "cancelDeletion"
  | "forget"
  /** Internal worker continue — never opens a new active-op slot. */
  | "resumePurge";

/** Commands that may occupy `activeLifecycleOperation` at open. */
export type LongRunningLifecycleCommand =
  | "archive"
  | "restore"
  | "retire"
  | "requestPurge"
  | "forget";

export type LegalHold = {
  holdId: string;
  reason: string;
  appliedBy: ActorRef;
  appliedAt: string;
  releasedAt?: string;
};

/** Long-running in-flight op bound on Catalog (not projection). */
export type ActiveLifecycleOperation = {
  operationId: string;
  command: LongRunningLifecycleCommand;
  receiptId: string;
  previousLifecycleState: LifecycleState;
  startedAt: string;
};

export type LifecycleTransitionConflict =
  | "not_found"
  | "state_conflict"
  | "version_conflict"
  | "legal_hold_blocks"
  | "command_not_allowed"
  | "idempotent_mismatch"
  | "active_operation_mismatch";

export type LifecycleReceiptStageStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "not_applicable";

export type LifecycleReceiptStage = {
  stage: string;
  status: LifecycleReceiptStageStatus;
  attemptId: string;
  attempt: number;
  actor?: ActorRef;
  targetBindingIds: string[];
  startedAt?: string;
  completedAt?: string;
  errorCode?: string;
};

export type LifecycleReceiptStatus = "prepared" | "open" | "completed" | "failed" | "cancelled";

export type GovernanceLifecycleReceipt = {
  receiptId: string;
  operationId: string;
  requestFingerprint: string;
  command: LifecycleCommand;
  resourceId: string;
  resourceType: GovernedResourceType;
  tenantId: string | null;
  requestedBy: ActorRef;
  executedBy: ActorRef[];
  previousLifecycleState: LifecycleState;
  legalHoldSnapshot?: LegalHold | null;
  stages: LifecycleReceiptStage[];
  status: LifecycleReceiptStatus;
  createdAt: string;
  updatedAt: string;
};

/** Deletion authorization marker — logical validity is authoritative (≠ create marker). */
export type GovernanceDeletionAuthMarker = {
  markerId: string;
  operationId: string;
  attemptId: string;
  resourceId: string;
  bindingId: string;
  locator: string;
  objectKey?: string | null;
  governanceVersion: number;
  expiresAt: string;
  issuedAt: string;
  actor: ActorRef;
  tenantId: string | null;
  receiptId: string;
};

export type DataClassification = "public" | "internal" | "confidential" | "restricted";

export type StorageRole =
  | "canonical"
  | "replica"
  | "derived"
  | "archive"
  | "cache"
  | "compatibility";

/** Knowledge Asset content class (Catalog metadata only — never bodies). */
export type KnowledgeContentClass = "document_version" | "enterprise_projection";

export type CognitiveTier = "C0" | "C1" | "C2" | "C3" | "C4";

export type PreservationPriority = "rebuildable" | "standard" | "important" | "critical";

export type RetrievalEligibility = "blocked" | "eligible" | "retired";

export type RetrievalGovernance = {
  eligibility: RetrievalEligibility;
  basePriority: number;
  freshnessPolicyId: string;
  applicabilityPolicyId: string;
};

export type CognitiveProvenanceNodeType =
  | "MemoryAtom"
  | "EventSkeleton"
  | "Entity"
  | "Scenario"
  | "Problem"
  | "Evidence";

export type CognitiveProvenanceRef = {
  schemaPackage: "cogniweave-sdk";
  nodeType: CognitiveProvenanceNodeType;
  objectId: string;
  version: number;
  provenanceHash: string;
};

/** Append-only history row. Envelope stores current ref + head id only. */
export type CognitiveProvenanceBinding = {
  bindingId: string;
  resourceId: string;
  tenantId: string | null;
  ref: CognitiveProvenanceRef;
  previousBindingId: string | null;
  createdAt: string;
  actor: ActorRef;
};

/**
 * In-flight merge attach marker (Gate B B29). At most one per resource; cleared on any
 * terminal outcome. `expiresAt` is liveness only — fencing is enforced by the CAS predicate.
 */
export type ActiveCognitiveMergeOp = {
  mergeId: string;
  fencingToken: number;
  derivedMemoryResourceId: string;
  /** Conflict-graph generation this merge was authorized against (B39). */
  conflictGraphEpoch: number;
  state: "attaching";
  expiresAt: string;
};

/** Retrievability gate for merge products (B35). */
export type MergeFinalizationState = "pending_finalization" | "finalized";

/**
 * Strong merge fields on a cognitive envelope (Gate B B29/B34/B35/B39).
 * Never projection keys: the merge state machine and the CAS fencing predicate read them.
 */
export type CognitiveMergeEnvelopeFields = {
  activeCognitiveMergeOp?: ActiveCognitiveMergeOp | null;
  /** Authoritative per-resource fencing generation. Monotonic non-decreasing (B34). */
  lastAcceptedFencingToken?: number;
  /** Conflict-graph generation last accepted for this resource (B39). */
  lastAcceptedConflictGraphEpoch?: number;
  mergeFinalizationState?: MergeFinalizationState;
  /** Terminal refs; written only by the commit CAS (S6). */
  lastMergeReceiptId?: string;
  mergedDerivedMemoryResourceId?: string;
};

export type CognitiveEnvelopeFields = {
  cognitiveTier?: CognitiveTier;
  preservationPriority?: PreservationPriority;
  retrievalGovernance?: RetrievalGovernance;
  cognitiveProvenanceRef?: CognitiveProvenanceRef;
  cognitiveProvenanceBindingId?: string;
  lastCognitiveMutationId?: string;
} & CognitiveMergeEnvelopeFields;

/**
 * Memory Asset canonical kind (frozen):
 * - Managed Enterprise: cogniweave only
 * - Personal Local: cogniweave when present, else markdown_root
 */
export type MemoryCanonicalKind = "cogniweave" | "markdown_root";

/** MVP required-tier envelope (architecture §6.3). */
export type DataGovernanceEnvelope = {
  resourceId: string;
  resourceType: GovernedResourceType;
  schemaVersion: GovernanceEnvelopeSchemaVersion;
  tenantId: string | null;
  owner: OwnershipPrincipal;
  scope: ResourceScope;
  lifecycleState: LifecycleState;
  classification: DataClassification;
  governanceVersion: number;
  /** Canonical storage binding id — required for managed writes. */
  canonicalBindingId: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Optional second-wave projection metadata (never bodies / embeddings / secrets).
   * Knowledge: kbId, docId, versionId, projectionId, contentClass, sourceBindingRef
   * Memory: atomId, memoryTier, sourceWorkspaceResourceId
   * OI: identityId, provider, credentialHandleId, agentAssetId
   * Must never carry legalHold / activeLifecycleOperation / deletion authority.
   */
  projection?: Record<string, string | null>;
  /** Strong field (H2) — not projection. */
  legalHold?: LegalHold | null;
  /** Strong field — at most one long-running op per resource. */
  activeLifecycleOperation?: ActiveLifecycleOperation | null;
} & CognitiveEnvelopeFields;

export type StorageBinding = {
  bindingId: string;
  resourceId: string;
  role: StorageRole;
  storageKind: "filesystem" | "sqlite" | "postgres" | "object-store" | "byos";
  locator: string;
  state: "active" | "read_only" | "retired";
  contentVersion: string;
  /**
   * Logical member key inside a shared physical aggregate (SQLite/JSON).
   * Canonical uniqueness is (locator + objectKey). Omit only for exclusive physical objects.
   */
  objectKey?: string | null;
};

export type CatalogRecord = {
  envelope: DataGovernanceEnvelope;
  bindings: StorageBinding[];
};

export type EnvelopeValidationError = {
  code:
    | "missing_field"
    | "invalid_schema_version"
    | "invalid_resource_type"
    | "invalid_owner"
    | "invalid_scope"
    | "invalid_lifecycle"
    | "invalid_classification"
    | "missing_canonical_binding"
    | "inconsistent_tenant"
    | "inconsistent_owner_scope"
    | "invalid_timestamp"
    | "invalid_governance_version"
    | "unknown_field"
    | "field_too_long"
    | "invalid_projection"
    | "invalid_legal_hold"
    | "invalid_active_lifecycle_operation"
    | "invalid_actor_ref"
    | "schema_unsupported"
    | "schema_downgrade_denied"
    | "schema_write_locked"
    | "catalog_schema_downgrade_blocked"
    | "invalid_cognitive_field";
  field?: string;
  message: string;
};

export type RetrievalPatch = {
  eligibility?: RetrievalEligibility;
  basePriority?: number;
  freshnessPolicyId?: string;
  applicabilityPolicyId?: string;
};

export type CognitiveMutationReceiptStatus = "prepared" | "applied" | "conflicted" | "failed";

export type CognitiveGovernanceMutationReceipt = {
  mutationId: string;
  status: CognitiveMutationReceiptStatus;
  resourceId: string;
  resourceType: "memory";
  tenantId: string | null;
  command: "updateCognitiveGovernance" | "supersedeCognitiveProvenanceRef";
  requestFingerprint: string;
  expectedGovernanceVersion: number;
  resultingGovernanceVersion?: number;
  requestedBy: ActorRef;
  executedBy: ActorRef;
  patchedFields: Array<
    "cognitiveTier" | "preservationPriority" | "retrievalPatch" | "cognitiveProvenanceRef"
  >;
  createdAt: string;
  updatedAt: string;
};

/** IEEE-754 binary64 bits; receipt and fingerprint share this encoding. */
export type CanonicalUnitIntervalScore = {
  ieee754Hex: string;
};

export type CognitiveRecommendationDecision =
  | "recommend_admit"
  | "recommend_deny"
  | "recommend_defer"
  | "propose_archive"
  | "propose_forget"
  | "propose_purge";

export type CognitiveRecommendationReceiptStatus = "open" | "expired" | "superseded";

export type CognitiveRecommendationReceipt = {
  recommendationId: string;
  candidateId: string;
  tenantId: string | null;
  owner: OwnershipPrincipal;
  sourceResourceIds: string[];
  policyVersion: string;
  scoreInputs: {
    admissionScore: CanonicalUnitIntervalScore;
    retrievalScore: CanonicalUnitIntervalScore;
    promotionScore: CanonicalUnitIntervalScore;
    scoreAlgorithmVersion: string;
    producerModelRef: string;
  };
  decision: CognitiveRecommendationDecision;
  reasonCode: string;
  requestedBy: ActorRef;
  executedBy: ActorRef;
  requestFingerprint: string;
  provenanceRef?: CognitiveProvenanceRef;
  createdAt: string;
  expiresAt: string;
  status: CognitiveRecommendationReceiptStatus;
};

export type CognitiveFleetNodeEvidence = {
  nodeId: string;
  buildId: string;
  buildSequence: number;
};

export type CognitiveFleetOpsAttestor = {
  kind: "deploy_ops";
  opsId: string;
};

export type CognitiveFleetOpsAuthority = {
  kind: "cognitive_fleet_ops_authority";
  opsId: string;
  tokenHash: string;
  minBuildSequence: number;
  nodeIds: string[];
};

export type EnvelopeV2ReadCompatReceipt = {
  receiptId: string;
  kind: "envelope_v2_dual_read_r0";
  minBuildSequence: number;
  nodeIds: string[];
  nodeEvidence: CognitiveFleetNodeEvidence[];
  acceptsSchemaVersions: [1, 2];
  cognitiveWrites: "locked";
  evidenceHash: string;
  createdAt: string;
};

export type EnvelopeV2WriteUnlockReceipt = {
  receiptId: string;
  kind: "envelope_v2_write_unlock_r1";
  minBuildSequence: number;
  requiredKind: "envelope_v2_dual_read_r0";
  r0ReceiptId: string;
  r0EvidenceHash: string;
  nodeIds: string[];
  attestedBy: CognitiveFleetOpsAttestor;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// P3-e cognitive merge / conflict graph (Gate B B24–B26, B30, B33–B44)
// ---------------------------------------------------------------------------

/** All kinds block a merge equally (B22/§3.3) — there is no "soft" conflict kind. */
export type CognitiveConflictKind = "policy" | "fact" | "temporal" | "scope";

export type CognitiveConflictEdgeStatus = "open" | "resolved" | "superseded";

/**
 * Undirected conflict between two cognitive resources. Only `open` edges block admission;
 * `resolved` requires an authorized `conflict_precedence_resolve` grant (§3.3).
 */
export type CognitiveConflictEdge = {
  edgeId: string;
  kind: "cognitive_conflict_edge";
  tenantId: string | null;
  /** Canonical pair: leftResourceId < rightResourceId. */
  leftResourceId: string;
  rightResourceId: string;
  conflictKind: CognitiveConflictKind;
  status: CognitiveConflictEdgeStatus;
  effectiveAt: string;
  precedencePolicyId?: string;
  detectedByAudit: { evaluatorId: string; detectedAt: string };
  resolvedAt?: string;
  resolutionGrantId?: string;
  resolutionNote?: string;
};

/**
 * Exclusive lease over the conflict graph for one merge operation.
 * `state: "fencing"` marks an in-progress takeover: edge writers stay blocked and the
 * recorded participants must all be fenced before the reservation may be cleared (B40).
 */
export type CognitiveMergeReservation = {
  reservationId: string;
  mergeId: string;
  fencingToken: number;
  reservedGraphEpoch: number;
  reservedGraphVersion: number;
  reservedGraphHash: string;
  targetResourceId: string;
  sourceResourceIds: string[];
  derivedMemoryResourceId: string;
  state: "held" | "fencing";
  takeoverToken?: number;
  takeoverEpoch?: number;
  acquiredAt: string;
  leaseExpiresAt: string;
  /** Set once `renewMergeReservation` extended the lease; a second renewal is refused. */
  renewed?: boolean;
  /**
   * Persistable S3 evidence (B40 T3). `false` at acquire; flipped only after derived
   * unique-create or an already-existing derived claim. Missing derived is skippable
   * only while this is explicitly false.
   */
  derivedCreated: boolean;
};

export type CognitiveConflictGraphHead = {
  kind: "cognitive_conflict_graph_head";
  tenantId: string | null;
  /** CAS field; monotonic. */
  graphVersion: number;
  /** sha256 over the canonical sorted open-edge id list. */
  graphHash: string;
  /** Advanced only by reservation acquire (S1) and takeover (T2). Propagated into resources. */
  graphEpoch: number;
  /** Monotonic, never reused, never decremented — source of fencing tokens. */
  lastFencingToken: number;
  reservation: CognitiveMergeReservation | null;
  updatedAt: string;
};

/** Audit copy of a consumed approval grant. Never an authorization input (§0.3). */
export type GovernanceApprovalAudit = {
  grantId: string;
  approverUserId: string;
  callerTenantId: string | null;
  approvedAt: string;
};

export type GovernanceApprovalGrantKind =
  | "cognitive_merge_apply"
  | "conflict_precedence_resolve"
  | "manifest_supersede"
  | "anchor_activate"
  | "anchor_supersede"
  | "anchor_revoke"
  | "cognitive_promotion_apply"
  | "cognitive_projection_tombstone"
  | "placement_export_restore";

export type GovernanceApprovalGrantScope =
  | { kind: "agentAsset"; agentAssetId: string }
  | { kind: "resource"; resourceId: string }
  | {
      kind: "conflict_edge_pair";
      leftResourceId: string;
      rightResourceId: string;
      precedencePolicyId: string;
    };

export type GovernanceApprovalGrantState = "unused" | "consumed" | "expired" | "revoked";

export type GovernanceApprovalGrant = {
  grantId: string;
  grantKind: GovernanceApprovalGrantKind;
  tenantId: string | null;
  scope: GovernanceApprovalGrantScope;
  approverUserId: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string;
  /** Persisted unused|consumed. expired/revoked are derived at verify time. */
  state?: "unused" | "consumed";
  consumedAt?: string;
  /** Replay that consumed this grant. Required to prove same-replay recovery. */
  consumedByReplayId?: string;
};

/**
 * Registry row under `data-governance/approval-grants/`. Issued only at the enterprise-ops /
 * tenant-admin deploy boundary (§0.2); production cognitive commands read, never self-issue.
 * P4-b may mark `state: "consumed"` after a prepared promotion receipt exists.
 */
export type GovernanceApprovalGrantRecord = GovernanceApprovalGrant & {
  kind: "governance_approval_grant";
  issuedBy: "enterprise_ops" | "tenant_admin";
  revokeReason?: string;
};

export type CognitivePromotionReceiptState =
  | "prepared"
  | "applied"
  | "conflicted"
  | "failed"
  | "aborted";

/**
 * Durable promotion receipt (P4-b). P4-b unique-creates `prepared` only and omits
 * `checksum` (canonical bytes are hashed at P4-c apply). Cloud receipts require
 * `keyRefId`; P4-b fail-closes without a P4-c key-service adapter.
 * `conflicted` / `aborted` are fail-closed recovery markers (also omit checksum)
 * and are not a successful replay. `aborted` is the unused-grant speculative
 * journal path: recovery must not consume. Later states are for P4-c adapter
 * commit / recovery.
 * Terminal: applied, conflicted, failed, aborted.
 * prepared → applied | conflicted | failed | aborted.
 */
export type CognitivePromotionReceipt = {
  kind: "cognitive_promotion_receipt";
  receiptId: string;
  replayId: string;
  grantId: string;
  recommendationId: string;
  resourceId: string;
  tenantId: string;
  decision: "recommend_admit";
  decisionReasonCode: string;
  placementMode:
    | "local-only"
    | "encrypted-cloud"
    | "tenant-cloud"
    | "dedicated"
    | "byos"
    | "cold-archive";
  canonicalHome:
    | "local"
    | "managed_encrypted_cloud"
    | "tenant_managed_cloud"
    | "dedicated_regional"
    | "byos"
    | "cold_archive";
  fromBindingId: string;
  toCanonicalBindingId: string;
  projectionBindingId?: string;
  keyRefId?: string;
  region?: string;
  contentVersion: string;
  /** sha256 of canonical resource bytes. Omitted on P4-b `prepared`; P4-c fills at apply. */
  checksum?: string;
  /** Verified subject-consent version from prepare. Apply reverifies; never taken from wire. */
  consentVersion?: string;
  /** Recommendation policy version captured at prepare. */
  policyVersion?: string;
  state: CognitivePromotionReceiptState;
  createdAt: string;
  updatedAt: string;
};

/**
 * Durable P4-c projection tombstone receipt. Not a promotion receipt and not an
 * in-memory success object. Bound to grantKind `cognitive_projection_tombstone`.
 */
export type CognitiveProjectionTombstoneReceipt = {
  kind: "cognitive_projection_tombstone_receipt";
  receiptId: string;
  replayId: string;
  grantId: string;
  resourceId: string;
  tenantId: string;
  tombstoneVersion: number;
  checksum?: string;
  state: "prepared" | "applied" | "failed";
  createdAt: string;
  updatedAt: string;
};

/** Governed Cloud Intelligence projection (§12.4 / design §7.3). Not a writable canonical. */
export type CloudProjectionEnvelope = {
  resourceId: string;
  atomId?: string | null;
  permittedClaims: readonly string[];
  scope: string;
  privacyLevel: string;
  contentVersion: string;
  checksum: string;
  provenanceRefs: readonly string[];
  consentVersion: string;
  policyVersion: string;
  tombstoneVersion: number;
};

/**
 * P4-d placement export receipt (D17). Binding image only. Not a promotion grant
 * and not a P5 longevity bundle.
 */
export type PlacementExportReceipt = {
  kind: "p4_placement_export_receipt";
  receiptId: string;
  replayId: string;
  grantId: string;
  resourceId: string;
  agentAssetId: string;
  tenantId: string;
  fromBindingId: string;
  toCanonicalBindingId: string;
  projectionBindingId: string | null;
  canonicalHome:
    | "local"
    | "managed_encrypted_cloud"
    | "tenant_managed_cloud"
    | "dedicated_regional"
    | "byos"
    | "cold_archive";
  mode: "local-only" | "encrypted-cloud" | "tenant-cloud" | "dedicated" | "byos" | "cold-archive";
  contentVersion: string;
  checksum: string;
  /** sha256 of the canonicalized binding image. Required for restore integrity. */
  bindingsChecksum: string;
  state: "prepared" | "applied" | "failed";
  createdAt: string;
  updatedAt: string;
};

/** `needs_recovery` is not terminal: it is resolved by the convergent recovery protocol (B36). */
export type CognitiveMergeReceiptStatus =
  | "proposed"
  | "prepared"
  | "applied"
  | "conflicted"
  | "rejected"
  | "failed"
  | "needs_recovery";

export type CognitiveMergeReceipt = {
  mergeId: string;
  kind: "cognitive_merge_receipt";
  status: CognitiveMergeReceiptStatus;
  tenantId: string | null;
  targetResourceId: string;
  sourceResourceIds: string[];
  /** Union of live source links; the Envelope never carries this set (§2). */
  preservedSourceLinkIds: string[];
  derivedMemoryResourceId?: string;
  /** Resolved / superseded edges consumed by this merge. Open edges are never listed. */
  conflictEdgeIds: string[];
  policyVersion: string;
  requestFingerprint: string;
  expectedConflictGraphVersion: number;
  expectedConflictGraphHash: string;
  /** Set at reservation acquire; threaded through every later step. */
  fencingToken?: number;
  /** Reserved graph generation this merge was admitted against (B39). */
  conflictGraphEpoch?: number;
  /** Target governanceVersion observed after the attach CAS (v4). */
  attachedTargetVersion?: number;
  /** Target version produced by the S6 commit CAS. Presence is commit evidence (B43). */
  committedTargetVersion?: number;
  /** Last completed merge step; used with `derivedCreated` to recover T3 skip evidence. */
  protocolPhase?: "S1" | "S1b" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8" | "S9";
  /** Persistable S3 evidence. Missing derived after this is true is fail-closed. */
  derivedCreated?: boolean;
  precedencePolicyId?: string;
  requestedByAudit: { actor: ActorRef; requestedAt: string };
  approvalAudit?: GovernanceApprovalAudit;
  reasonCode?: string;
  recoveryAttempts?: number;
  createdAt: string;
  updatedAt: string;
  /** Set with `status: "applied"`; ordered against edge detection for postCommitConflict (§4). */
  appliedAt?: string;
};

/** Why a merge could not be admitted or completed. Stable, testable codes. */
export type CognitiveMergeDenyCode =
  | "actor_not_authorized"
  | "schema_write_locked"
  | "not_found"
  | "command_denied_for_type"
  | "lifecycle_blocks_write"
  | "active_operation_blocks_write"
  | "version_conflict"
  | "idempotent_mismatch"
  | "conflict_graph_reserved"
  | "conflict_graph_stale"
  | "conflict_open_blocks_merge"
  | "fenced_stale_token"
  | "fenced_stale_graph_epoch"
  | "merge_in_flight"
  | "derived_create_failed"
  | "needs_recovery"
  | "invalid_merge_request"
  | "active_anchor_blocks_merge"
  | "conflicted"
  | "failed"
  | "rejected"
  | "graph_version_mismatch";

export type CognitiveHealthIndicatorSeverity = "info" | "warn" | "p0";

export type CognitiveHealthIndicator = {
  indicator:
    | "retiredInRecall"
    | "blockedInRecall"
    | "danglingProvenanceRef"
    | "staleMergeAttach"
    | "unpublishedMergeProduct"
    | "postCommitConflict"
    | "openConflictBacklog";
  severity: CognitiveHealthIndicatorSeverity;
  count: number;
  resourceIds: string[];
  detail?: string;
};

/** Read-only report. Health never remediates and never mutates the Catalog (B44/§4). */
export type CognitiveHealthReport = {
  kind: "cognitive_health_report";
  tenantId: string | null;
  generatedAt: string;
  indicators: CognitiveHealthIndicator[];
};

/** Refs-only AgentAsset continuity checkpoint (B9). No payload / credential copy. */
export type AgentAssetContinuityManifest = {
  manifestId: string;
  kind: "agent_asset_continuity_manifest";
  agentAssetId: string;
  ownerScope: "user_owned" | "position_owned" | "group_owned";
  personaVersionRef?: string;
  identityVersionRef: string;
  capabilitySetVersionRef: string;
  workingDnaVersionRef?: string;
  policyBaselineRef: string;
  experienceCheckpointRef?: string;
  operationalIdentityBindingRefs: string[];
  previousManifestId?: string;
  /** Content-address key; identical content reuses the same manifestId (B31). */
  contentKey: string;
  approvalAudit?: GovernanceApprovalAudit;
  reasonCode: string;
  effectiveAt: string;
  createdAt: string;
};

export type AgentAssetManifestPointer = {
  kind: "agent_asset_manifest_pointer";
  agentAssetId: string;
  activeManifestId: string;
  pointerVersion: number;
  lastMutationId: string;
  updatedAt: string;
};

export type PointerMutationReceiptStatus = "prepared" | "applied" | "conflicted" | "failed";

/** Generation primitive for manifest/anchor pointer CAS (B37). No fencing token. */
export type PointerMutationReceipt = {
  mutationId: string;
  kind: "agent_asset_manifest_mutation" | "anchor_mutation";
  operationId: string;
  resourceKey: string;
  historyRowId: string;
  expectedPointerVersion: number;
  resultingPointerVersion?: number;
  approvalAudit?: GovernanceApprovalAudit;
  status: PointerMutationReceiptStatus;
  createdAt: string;
  updatedAt?: string;
};

export type HumanVerifiedAnchorType = "identity" | "principle" | "commitment" | "major_decision";

export type HumanVerifiedAnchorRowKind = "proposal" | "activation" | "supersession" | "revocation";

/** Immutable anchor history row. Effective status is derived, never written back (B38). */
export type HumanVerifiedAnchor = {
  anchorId: string;
  kind: "human_verified_anchor";
  resourceId: string;
  anchorType: HumanVerifiedAnchorType;
  version: number;
  rowKind: HumanVerifiedAnchorRowKind;
  approvalAudit?: GovernanceApprovalAudit;
  evidenceRefs: string[];
  supersedesAnchorId?: string;
  effectiveAt: string;
  createdAt: string;
};

export type AnchorActivePointer = {
  kind: "anchor_active_pointer";
  resourceId: string;
  pointerState: "active" | "revoked";
  activeAnchorId?: string;
  revokedAnchorId?: string;
  revocationRowId?: string;
  anchorVersion: number;
  revokedAt?: string;
  revokeMutationId?: string;
  pointerVersion: number;
  lastMutationId: string;
  updatedAt: string;
};

export type DerivedAnchorStatus =
  | "active"
  | "revoked"
  | "revocation_record"
  | "superseded"
  | "proposed";

export type ManifestDenyCode =
  | "actor_not_authorized"
  | "schema_write_locked"
  | "invalid_manifest_request"
  | "embedded_payload_forbidden"
  | "version_conflict"
  | "idempotent_mismatch"
  | "not_found"
  | "mutation_conflicted"
  | "mutation_failed";

export type AnchorDenyCode =
  | "actor_not_authorized"
  | "schema_write_locked"
  | "invalid_anchor_request"
  | "version_conflict"
  | "idempotent_mismatch"
  | "not_found"
  | "anchor_not_active"
  | "mutation_conflicted"
  | "mutation_failed";

/** P5-a schema ladder entry (L15 / L16). Transform bytes live in the bundle; transformId is not executable. */
export type SchemaLadderEntry = {
  fromSchemaVersion: string;
  toSchemaVersion: string;
  transformId: string;
  transformMediaType: "application/vnd.openbot.schema-transform+json";
  transformMember: string;
  transformChecksum: string;
  losesCognitiveFields: boolean;
};

/** P5-a producer-model matrix (L16). Never merged into the schema ladder. */
export type ProducerModelMatrixEntry = {
  producerModelId: string;
  schemaVersion: string;
  claimSupport: "supported" | "unsupported" | "flagged";
};

export type PortableReaderManifest = {
  kind: "p5_portable_reference_importer";
  readerId: string;
  version: string;
  readerMember: string;
  readerChecksum: string;
  supportedTransformMediaTypes: readonly ["application/vnd.openbot.schema-transform+json"];
};

/** Representation schema migration (L5). Not a redistillation receipt and not a grant. */
export type SchemaMigrationReceipt = {
  kind: "p5_schema_migration_receipt";
  receiptId: string;
  fromSchemaVersion: string;
  toSchemaVersion: string;
  transformId: string;
  transformChecksum: string;
  contentChecksum: string;
  state: "prepared" | "applied" | "failed";
};

/** Semantic re-distillation (L5). Distinct kind; cannot authorize a ladder step. */
export type RedistillationReceipt = {
  kind: "p5_redistillation_receipt";
  receiptId: string;
  sourceSchemaVersion: string;
  producerModelId: string;
  state: "prepared" | "applied" | "failed";
};

/** P5-b key generation (L13). Exactly one `active` write generation. */
export type KeyGenerationState = "prepared" | "active" | "readable" | "retired";

export type KeyGenerationRecord = {
  generation: number;
  state: KeyGenerationState;
  wrapKeyId: string;
};

/** Pointer CAS is the sole commit. Not a placement/promotion/purge grant. */
export type KeyRotationReceipt = {
  kind: "p5_key_rotation_receipt";
  receiptId: string;
  replayId: string;
  tenantId: string;
  fromGeneration: number;
  toGeneration: number;
  state: "prepared" | "applied" | "failed";
};

/** Speculative rewrap of an existing DEK under G+1. Same resourceId. */
export type RewrapReceipt = {
  kind: "p5_rewrap_receipt";
  receiptId: string;
  tenantId: string;
  resourceId: string;
  fromGeneration: number;
  toGeneration: number;
  wrapChecksum: string;
  contentChecksum: string;
  state: "prepared" | "applied" | "failed";
};

/** Old-key retire. Lost G after retire is restore-from-backup, not silent re-activate. */
export type KeyRetireReceipt = {
  kind: "p5_key_retire_receipt";
  receiptId: string;
  tenantId: string;
  generation: number;
  retireNotBefore: string;
  retiredAt: string;
  state: "applied";
};

/** Deletion-closure integrity proof (L11). Member checksums alone are not enough. */
export type DeletionClosureProof = {
  snapshotEpoch: string;
  logWatermark: string;
  recordCounts: {
    canonical: number;
    tombstone: number;
    revocation: number;
    hold: number;
  };
  merkleRoot: string;
};

/** P5-c restore drill. Same-tenant DR only; not a P5-d exit exporter. */
export type RestoreDrillReceipt = {
  kind: "p5_restore_drill_receipt";
  receiptId: string;
  replayId: string;
  tenantId: string;
  bundleId: string;
  mode: "same_tenant_dr";
  snapshotEpoch: string;
  restoredResourceIds: readonly string[];
  backupCreatedAt: string;
  restoredAt: string;
  state: "prepared" | "applied" | "failed";
};

/** Integrity scan (L17). Not a placement, promotion, or purge grant. */
export type IntegrityScanReceipt = {
  kind: "p5_integrity_scan_receipt";
  receiptId: string;
  tenantId: string;
  scannedChecksum: string;
  findings: readonly { resourceId: string; code: string }[];
  state: "prepared" | "applied" | "failed";
};

/** Content format migration (L17). Distinct from integrity scan; not a grant. */
export type ContentFormatMigrationReceipt = {
  kind: "p5_content_format_migration_receipt";
  receiptId: string;
  resourceId: string;
  fromFormat: string;
  toFormat: string;
  transformId: string;
  fromContentVersion: string;
  contentVersion: string;
  sourceChecksum: string;
  checksum: string;
  state: "prepared" | "applied" | "failed";
};

/** P5-d ID mapping (L12). Not a promotion or purge grant. */
export type IdMappingReceipt = {
  kind: "p5_id_mapping_receipt";
  receiptId: string;
  mode: "cross_tenant_import" | "cross_platform_migration";
  sourceTenantId: string;
  destTenantId: string;
  entries: readonly { fromId: string; toId: string; idClass: string }[];
  checksum: string;
  signatureRef: string;
  inverseChecksum: string;
  expectedCatalogEpoch: string;
  expectedImportEpoch: string;
  fenceToken: string;
  state: "prepared" | "applied" | "rolled_back" | "failed";
};

/** P5-d exit import drill. Isolated Catalog only; not production cutover. */
export type ExitImportDrillReceipt = {
  kind: "p5_exit_import_drill_receipt";
  receiptId: string;
  replayId: string;
  sourceTenantId: string;
  destTenantId: string;
  bundleId: string;
  mode: IdMappingReceipt["mode"];
  mappingReceiptId: string;
  importedResourceIds: readonly string[];
  importedAt: string;
  state: "prepared" | "applied" | "failed";
};

/** P5-e continuity checkpoint package (refs-only; no Persona/Capability/OI merge). */
export type ContinuityCheckpointPackage = {
  kind: "p5_continuity_checkpoint";
  tenantId: string;
  agentAssetId: string;
  checkpointEpoch: string;
  effectiveManifest: AgentAssetContinuityManifest;
  anchorHistory: readonly HumanVerifiedAnchor[];
  anchorPointers: readonly AnchorActivePointer[];
  checksum: string;
};

/** P5-e continuity restore drill receipt. Isolated manifest namespace only. */
export type ContinuityRestoreReceipt = {
  kind: "p5_continuity_restore_receipt";
  receiptId: string;
  replayId: string;
  tenantId: string;
  agentAssetId: string;
  checkpointEpoch: string;
  restoredManifestId: string;
  restoredAt: string;
  state: "prepared" | "applied" | "failed";
};

/** P5-e human-anchor review (L4). Not an activation grant. */
export type HumanAnchorReviewReceipt = {
  kind: "p5_human_anchor_review_receipt";
  receiptId: string;
  tenantId: string;
  reviewedAt: string;
  anchorReviewDue: readonly { resourceId: string; anchorType: string; code: string }[];
  stalePolicyBaselines: readonly {
    agentAssetId: string;
    manifestPolicyRef: string;
    currentBaselineRef: string;
  }[];
  state: "applied";
};

/** Tenant policy baseline authority for P5-e stale detection. */
export type TenantPolicyBaselineRecord = {
  schemaVersion: 1;
  tenantId: string;
  currentBaselineRef: string;
  updatedAt: string;
};

/** P5-f storage growth row for one governed resource class. */
export type LongevityStorageGrowthEntry = {
  resourceClass: GovernedResourceType;
  status: "observed" | "not_applicable";
  activeResourceCount: number;
  governedResourceCount: number;
  baselineCapturedAt: string | null;
  baselineActiveResourceCount: number | null;
  baselineGovernedResourceCount: number | null;
  activeResourceCountDelta: number | null;
  governedResourceCountDelta: number | null;
  /** Active-resource delta per day since baseline; null when no prior baseline. */
  growthRatePerDay: number | null;
};

/** P5-f backup / restore observability (missing backup is a fail signal). */
export type LongevityBackupObservability = {
  lastBackupAt: string | null;
  lastProvenRestoreAt: string | null;
  backupMissing: boolean;
  backupAgeFail: boolean;
  /** Elapsed ms from lastBackupAt to report `now`; null when timestamp invalid or missing. */
  backupAgeMs: number | null;
  maxBackupAgeMs: number;
  backupTimestampInvalid: boolean;
};

/** Durable P5-f storage growth baseline (resource-count proxy; not byte volume). */
export type TenantStorageGrowthBaseline = {
  schemaVersion: 1;
  tenantId: string;
  capturedAt: string;
  countsByClass: Record<
    GovernedResourceType,
    { activeResourceCount: number; governedResourceCount: number }
  >;
};

/** P5-f tenant longevity SLO policy (deploy boundary; versioned). */
export type TenantLongevityPolicy = {
  schemaVersion: 1;
  tenantId: string;
  /** Maximum acceptable backup age in whole days (finite, positive, bounded). */
  maxBackupAgeDays: number;
  /** Minimum whole days between storage growth baseline checkpoints. */
  storageGrowthCheckpointMinDays: number;
  updatedAt: string;
};

/** P5-f memory-health aggregates (P3-e indicators; no promotion re-judge). */
export type LongevityMemoryHealthAggregates = {
  retiredRecallCount: number;
  pollutionCount: number;
  unsupportedClaimCount: number;
  indicators: readonly CognitiveHealthIndicator[];
};

/** P5-f tenant longevity report. Read-only; no placement or purge authority. */
export type TenantLongevityReport = {
  kind: "p5_tenant_longevity_report";
  tenantId: string;
  generatedAt: string;
  storageGrowthByClass: readonly LongevityStorageGrowthEntry[];
  backup: LongevityBackupObservability;
  memoryHealth: LongevityMemoryHealthAggregates;
};
