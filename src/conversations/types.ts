/**
 * Conversation lifecycle domain model (CL-P0-01).
 * Spec: docs/design/openbot-conversation-lifecycle-implementation-plan-2026-07-16.md §5
 *
 * Canonical message body remains JSONL transcript. Catalog holds product metadata
 * and governance only — never message text.
 */

export type ConversationLifecycleStatus = "ACTIVE" | "CLOSED" | "ARCHIVED" | "DELETED";
export type ConversationStorageTier = "HOT" | "WARM" | "COLD";
export type ConversationRetentionState = "RETAIN" | "EXPIRING" | "LEGAL_HOLD" | "PURGE_PENDING";

export type ConversationOwnershipScopeType = "USER" | "SEAT" | "GROUP";
export type ConversationSurfaceType = "AGENT" | "COLLABORATION_GROUP";
export type ConversationTitleSource = "AUTO" | "USER" | "IMPORT";

export type ConversationSessionBindingRole =
  | "PRIMARY"
  | "GROUP_PUBLIC"
  | "AGENT_EXECUTION"
  | "LEGACY_ALIAS";

export type ConversationTranscriptState = "LIVE" | "READ_ONLY" | "ARCHIVED" | "PURGED";

export type ConversationRecord = {
  schemaVersion: 1;
  conversationId: string;
  dataPlaneId: string;
  tenantId: string | null;
  ownershipScopeType: ConversationOwnershipScopeType;
  ownershipScopeId: string;
  createdByUserId: string;
  surfaceType: ConversationSurfaceType;
  agentId: string | null;
  groupId: string | null;
  title: string;
  titleSource: ConversationTitleSource;
  lifecycleStatus: ConversationLifecycleStatus;
  /**
   * Snapshot of ACTIVE|CLOSED taken atomically when entering ARCHIVED.
   * Restore target is this value (default CLOSED when null/legacy).
   */
  lifecycleStatusBeforeArchive: "ACTIVE" | "CLOSED" | null;
  storageTier: ConversationStorageTier;
  retentionState: ConversationRetentionState;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  participantIds: string[];
  primaryBindingId: string | null;
  etag: string;
};

export type ConversationSessionBinding = {
  schemaVersion: 1;
  bindingId: string;
  dataPlaneId: string;
  conversationId: string;
  sessionKey: string;
  sessionId: string;
  agentId: string | null;
  role: ConversationSessionBindingRole;
  aliasTargetBindingId: string | null;
  transcriptState: ConversationTranscriptState;
  createdAt: string;
  endedAt: string | null;
};

/** Stable identity for an immutable transcript turn range (not a file path). */
export type MemorySourceIdentity = {
  schemaVersion: 1;
  sourceIdentityId: string;
  dataPlaneId: string;
  conversationId: string;
  bindingId: string;
  sessionId: string;
  firstTurnId: string;
  lastTurnId: string;
  /**
   * Dual encoding for SDK IngestInput.sourceTurnRange?: [number, number].
   * 0-based inclusive; must not alone be identity primary key.
   */
  turnIndexRange: [number, number];
  /** SHA-256 of normalized user/assistant texts in range (no paths, no syncReason). */
  contentChecksum: string;
  sourceType: "TRANSCRIPT_RANGE";
  createdAt: string;
};

/** Per-binding ingest cursor (watermark) — only seal after last sealed turn. */
export type TranscriptIngestWatermark = {
  schemaVersion: 1;
  dataPlaneId: string;
  bindingId: string;
  sessionId: string;
  lastSealedTurnId: string | null;
  lastSealedTurnIndex: number | null;
  lastContentChecksum: string | null;
  updatedAt: string;
};

/** Sync fail-closed gate so revoked ranges are not recalled before forgetSource finishes. */
export type MemoryRecallDenyWatermark = {
  schemaVersion: 1;
  denyId: string;
  dataPlaneId: string | null;
  sessionFile: string;
  sessionId: string | null;
  bindingId: string | null;
  conversationId: string | null;
  boundaryTurnId: string;
  boundaryTurnIndex: number | null;
  deniedSourceIdentityIds: string[];
  /** Message ids fully after boundary (from truncated tail). */
  deniedMessageIds: string[];
  reason: "CHECKPOINT_RESTORE" | "TRANSCRIPT_TRUNCATE";
  createdAt: string;
};

export type RevokeOutboxStatus = "PENDING" | "SUCCEEDED" | "FAILED";

export type RevokeOutboxEntry = {
  schemaVersion: 1;
  outboxId: string;
  denyId: string;
  status: RevokeOutboxStatus;
  payload: SessionTranscriptUpdatePayload;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Extended transcript change payload (plan §8.5). */
export type TranscriptChangeKind =
  | "APPENDED"
  | "TRANSCRIPT_RANGE_REVOKED"
  | "TRANSCRIPT_TRUNCATED"
  | "FILE_REMOVED"
  | "ARCHIVED"
  | "RESTORED";

export type SessionTranscriptUpdatePayload = {
  sessionFile: string;
  kind: TranscriptChangeKind;
  sessionId?: string;
  bindingId?: string;
  conversationId?: string;
  boundaryTurnId?: string;
  boundaryTurnIndex?: number;
  revokedSourceIdentityIds?: string[];
  revokedTailArchivePath?: string;
  occurredAt: string;
};

export type MemorySourceLocatorAlias = {
  sourceIdentityId: string;
  storageTier: ConversationStorageTier;
  locator: string;
  checksum: string;
  active: boolean;
  createdAt: string;
  retiredAt: string | null;
};

export type ConversationRetentionPolicy = {
  schemaVersion: 1;
  policyId: string;
  dataPlaneId: string;
  tenantId: string | null;
  activeIdleAfter: string;
  warmAfter: string;
  coldAfter: string;
  archiveAfter: string | null;
  purgeAfter: string | null;
  archiveEnabled: boolean;
  memoryExtractionEnabled: boolean;
  archiveSearchEnabled: boolean;
  userExportEnabled: boolean;
  userDeleteMode: "DISABLED" | "ARCHIVE_ONLY" | "PURGE_ALLOWED";
  legalHoldEnabled: boolean;
};

export type ConversationLegalHoldRecord = {
  schemaVersion: 1;
  holdId: string;
  dataPlaneId: string;
  conversationId: string;
  status: "ACTIVE" | "RELEASED";
  reasonCode: string;
  createdBy: string;
  createdAt: string;
  releasedBy: string | null;
  releasedAt: string | null;
};

export type ConversationPurgeStepName =
  | "FREEZE"
  | "MEMORY_REVOKE"
  | "DERIVED_DELETE"
  | "CONTENT_DELETE"
  | "VERIFY";

export type ConversationPurgeStepStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

export type ConversationPurgeStep = {
  name: ConversationPurgeStepName;
  status: ConversationPurgeStepStatus;
  attempts: number;
  lastErrorCode: string | null;
  updatedAt: string;
};

export type ConversationPurgeJobStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED_RETRYABLE"
  | "CANCELLED";

/** Immutable purge manifest snapshot stored with the job (not re-collected on resume). */
export type ConversationPurgeManifestObject = {
  kind:
    | "binding"
    | "source_identity"
    | "locator"
    | "attachment"
    | "projection"
    | "index"
    | "cogniweave_source";
  id: string;
  locator?: string;
  checksum?: string;
};

export type ConversationPurgeManifest = {
  schemaVersion: 1;
  conversationId: string;
  dataPlaneId: string;
  objects: ConversationPurgeManifestObject[];
  createdAt: string;
};

export type ConversationPurgeJob = {
  schemaVersion: 1;
  purgeJobId: string;
  dataPlaneId: string;
  conversationId: string;
  requestedBy: string;
  requestId: string;
  status: ConversationPurgeJobStatus;
  manifestDigest: string;
  /**
   * Immutable object list captured at job start. Resume/replay MUST use this
   * snapshot — never re-collect from live state (plan §5.7 / §8.4).
   */
  manifest: ConversationPurgeManifest | null;
  /**
   * Retention state before entering PURGE_PENDING. Cancel must restore this
   * (not always RETAIN) so EXPIRING/LEGAL_HOLD-adjacent paths stay correct.
   */
  prePurgeRetentionState: ConversationRetentionState | null;
  /** When catalog governance freeze (PURGE_PENDING) was committed. */
  governanceFrozenAt: string | null;
  irreversibleStartedAt: string | null;
  steps: ConversationPurgeStep[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

/**
 * Durable archive/restore job (plan §6.3 / CL-P1-01).
 * Survives process restart via Catalog; client re-posts same requestId to resume.
 */
export type ConversationLifecycleJobKind = "archive" | "restore";

export type ConversationLifecycleJobStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED_RETRYABLE";

export type ConversationLifecycleBindingStep = {
  bindingId: string;
  sessionId: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  /** Opaque artifact id (never absolute filesystem path). */
  artifactId?: string;
  checksum?: string;
  bytes?: number;
  error?: string;
  updatedAt: string;
};

export type ConversationLifecycleJob = {
  schemaVersion: 1;
  jobId: string;
  kind: ConversationLifecycleJobKind;
  dataPlaneId: string;
  conversationId: string;
  requestId: string;
  requestedBy: string;
  status: ConversationLifecycleJobStatus;
  etagAtStart: string | null;
  /** Frozen on first create; resume must not override (idempotency). */
  targetLifecycle: "ACTIVE" | "CLOSED" | null;
  bindingSteps: ConversationLifecycleBindingStep[];
  /** Primary binding checksum / artifact for client receipt. */
  resultChecksum: string | null;
  resultArtifactId: string | null;
  resultBytes: number | null;
  lastErrorCode: string | null;
  /**
   * Execution lease for concurrent claim (same requestId).
   * Active RUNNING with unexpired lease must not re-execute.
   */
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  /** Monotonic claim generation; CAS uses expected generation. */
  claimGeneration: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

/** Authenticated server-side context; never trust client-supplied tenant alone. */
export type ConversationTenantContext = {
  dataPlaneId: string;
  tenantId: string | null;
  principalId: string;
  seatId: string | null;
  groupIds: string[];
  roles: string[];
  /** local = personal/on-prem Data Root; managed = SaaS tenant plane */
  mode: "local" | "managed";
};

export type ConversationPermissionAction =
  | "read"
  | "write"
  | "rename"
  | "close"
  | "archive"
  | "restore"
  | "export"
  | "purge"
  | "legal_hold"
  | "read_execution_stream";

export const CONVERSATION_SCHEMA_VERSION = 1 as const;

export const LIFECYCLE_STATUSES: readonly ConversationLifecycleStatus[] = [
  "ACTIVE",
  "CLOSED",
  "ARCHIVED",
  "DELETED",
] as const;

export const STORAGE_TIERS: readonly ConversationStorageTier[] = ["HOT", "WARM", "COLD"] as const;

export const RETENTION_STATES: readonly ConversationRetentionState[] = [
  "RETAIN",
  "EXPIRING",
  "LEGAL_HOLD",
  "PURGE_PENDING",
] as const;
