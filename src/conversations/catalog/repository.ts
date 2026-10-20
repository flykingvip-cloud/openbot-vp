/**
 * Conversation Catalog repository contract (CL-P0-02).
 * Local SQLite and managed tenant stores must implement this interface.
 */
import type {
  ConversationLegalHoldRecord,
  ConversationLifecycleJob,
  ConversationPurgeJob,
  ConversationRecord,
  ConversationSessionBinding,
  ConversationLifecycleStatus,
  MemorySourceIdentity,
  MemorySourceLocatorAlias,
} from "../types.js";

export type ConversationListFilter = {
  dataPlaneId: string;
  tenantId?: string | null;
  ownershipScopeId?: string;
  agentId?: string;
  groupId?: string;
  lifecycleStatus?: ConversationLifecycleStatus | ConversationLifecycleStatus[];
  /** Inclusive lower bound on updatedAt (ISO). */
  updatedAfter?: string;
  /** Inclusive upper bound on updatedAt (ISO). */
  updatedBefore?: string;
  limit?: number;
  /** Opaque cursor from previous page (not a file path). */
  cursor?: string | null;
};

export type ConversationListPage = {
  rows: ConversationRecord[];
  nextCursor: string | null;
};

export type ConversationCatalogRepository = {
  createConversation(
    record: ConversationRecord,
    binding: ConversationSessionBinding,
  ): Promise<ConversationRecord>;

  getConversation(dataPlaneId: string, conversationId: string): Promise<ConversationRecord | null>;

  updateConversation(record: ConversationRecord, expectedEtag: string): Promise<ConversationRecord>;

  listConversations(filter: ConversationListFilter): Promise<ConversationListPage>;

  getBinding(dataPlaneId: string, bindingId: string): Promise<ConversationSessionBinding | null>;

  listBindings(dataPlaneId: string, conversationId: string): Promise<ConversationSessionBinding[]>;

  findBindingBySessionId(
    dataPlaneId: string,
    sessionId: string,
  ): Promise<ConversationSessionBinding | null>;

  findBindingByMigrationKey(
    dataPlaneId: string,
    migrationKey: string,
  ): Promise<ConversationSessionBinding | null>;

  saveBinding(binding: ConversationSessionBinding): Promise<void>;

  putMigrationKey(dataPlaneId: string, migrationKey: string, bindingId: string): Promise<void>;

  // Governance
  saveLegalHold(hold: ConversationLegalHoldRecord): Promise<void>;
  listActiveLegalHolds(
    dataPlaneId: string,
    conversationId: string,
  ): Promise<ConversationLegalHoldRecord[]>;

  savePurgeJob(job: ConversationPurgeJob): Promise<void>;
  getPurgeJob(dataPlaneId: string, purgeJobId: string): Promise<ConversationPurgeJob | null>;
  findPurgeJobByRequestId(
    dataPlaneId: string,
    conversationId: string,
    requestId: string,
  ): Promise<ConversationPurgeJob | null>;

  saveLifecycleJob(job: ConversationLifecycleJob): Promise<void>;
  getLifecycleJob(dataPlaneId: string, jobId: string): Promise<ConversationLifecycleJob | null>;
  findLifecycleJobByRequestId(
    dataPlaneId: string,
    conversationId: string,
    requestId: string,
  ): Promise<ConversationLifecycleJob | null>;
  /**
   * Atomic claim to run a lifecycle job.
   * Succeeds only when status is PENDING|FAILED_RETRYABLE, or RUNNING with expired lease.
   * Returns claimed job with RUNNING + new lease, or null if another owner holds the lease.
   */
  claimLifecycleJob(params: {
    dataPlaneId: string;
    jobId: string;
    leaseOwner: string;
    leaseExpiresAt: string;
    now: string;
    /** Full job payload after claim (status RUNNING, lease fields set). */
    nextJob: ConversationLifecycleJob;
  }): Promise<ConversationLifecycleJob | null>;
  /**
   * Fenced terminal/progress write: only succeeds while still RUNNING under this
   * lease owner + claim generation (prevents expired worker from overwriting).
   */
  completeLifecycleJobFenced(params: {
    dataPlaneId: string;
    jobId: string;
    expectedLeaseOwner: string;
    expectedClaimGeneration: number;
    nextJob: ConversationLifecycleJob;
  }): Promise<ConversationLifecycleJob | null>;
  /** Extend lease while still the owner (heartbeat). */
  renewLifecycleLease(params: {
    dataPlaneId: string;
    jobId: string;
    expectedLeaseOwner: string;
    expectedClaimGeneration: number;
    leaseExpiresAt: string;
    now: string;
    nextJob: ConversationLifecycleJob;
  }): Promise<ConversationLifecycleJob | null>;

  // Source identity + locator aliases (canonical metadata; not message body)
  saveSourceIdentity(identity: MemorySourceIdentity): Promise<void>;
  getSourceIdentity(
    dataPlaneId: string,
    sourceIdentityId: string,
  ): Promise<MemorySourceIdentity | null>;
  saveLocatorAlias(dataPlaneId: string, alias: MemorySourceLocatorAlias): Promise<void>;
  listLocatorAliases(
    dataPlaneId: string,
    sourceIdentityId: string,
  ): Promise<MemorySourceLocatorAlias[]>;

  close?(): void;
};

export class CatalogConcurrencyError extends Error {
  readonly code = "ETAG_MISMATCH";
  constructor(message = "conversation etag mismatch") {
    super(message);
    this.name = "CatalogConcurrencyError";
  }
}

export class CatalogNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  constructor(message = "conversation not found") {
    super(message);
    this.name = "CatalogNotFoundError";
  }
}
