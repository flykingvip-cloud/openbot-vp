export type AtomClaimType = "causal" | "procedural" | "heuristic" | "policy" | "preference";

export type AtomStatus = "active" | "tentative" | "conflicted" | "deprecated";

export type ScopeVisibility = "private" | "shared";

export type EngineEnvironment = "local" | "service" | "cloud";

export type SourceType = "chat" | "tool_log" | "document" | "diff" | "agent_run" | "external";

export type LlmDistillationProfile = "single_call" | "multi_call";

export type TaskType =
  | "debugging"
  | "planning"
  | "research"
  | "negotiation"
  | "writing"
  | "support"
  | "operations"
  | (string & {});

export type RelationType =
  | "APPLIES_TO"
  | "TRIGGERED_BY"
  | "SOLVES"
  | "MITIGATES"
  | "CONSTRAINED_BY"
  | "CAUSED_BY"
  | "SUPPORTED_BY"
  | "CONFLICTS_WITH"
  | "SUPERSEDES"
  | "INSTANTIATED_IN"
  | "RELATED_TO";

export type NodeType =
  | "MemoryAtom"
  | "EventSkeleton"
  | "Entity"
  | "Scenario"
  | "Problem"
  | "Evidence";

export type DerivedStatus = "SYNCED" | "DERIVED_OUT_OF_SYNC" | "NOT_APPLICABLE";

export type CanonicalStatus = "METADATA_COMMITTED" | "FAILED";

export type WriteBackStatus = "COMPLETED" | "PARTIAL_SUCCESS" | "FAILED";

export type UpsertDecisionAction =
  | "merged"
  | "kept_separate"
  | "linked_related"
  | "candidate_review";

export interface Scope {
  workspaceId: string;
  projectId: string;
  agentId: string;
  visibility: ScopeVisibility;
}

export interface ScopeInput {
  workspaceId?: string;
  projectId?: string;
  agentId?: string;
  visibility?: ScopeVisibility;
}

export interface EngineConfig {
  environment: EngineEnvironment;
  metadataBackend: string;
  metadataStorePath?: string;
  /** Injected Postgres SQL client / schema (CW2 real-PG drill + managed runtime). */
  postgres?: {
    client?: {
      query<Row = Record<string, unknown>>(
        sql: string,
        params?: readonly unknown[],
      ): Promise<{ rows: Row[]; rowCount: number }>;
      transaction?<T>(
        runner: (transaction: {
          query: <Row = Record<string, unknown>>(
            sql: string,
            params?: readonly unknown[],
          ) => Promise<{ rows: Row[]; rowCount: number }>;
        }) => Promise<T>,
      ): Promise<T>;
    };
    schema?: string;
    connectionString?: string;
  };
  graphBackend: string;
  evidenceBackend: string;
  vectorBackend?: string;
  enableLlmTaskFraming?: boolean;
  enableLlmDistillation?: boolean;
  enableVectorSeedRetrieval?: boolean;
  llmTaskFramingEndpoint?: string;
  llmTaskFramingApiKey?: string;
  llmTaskFramingModel?: string;
  llmDistillationEndpoint?: string;
  llmDistillationApiKey?: string;
  llmDistillationModel?: string;
  llmDistillationProfile?: LlmDistillationProfile;
  llmDistillationStages?: string[];
  llmRequestTimeoutMs?: number;
  defaultScope?: ScopeInput;
  reasoningTimeoutMs?: number;
  evidenceLazyLoading?: boolean;
}

export interface TaskProvenance {
  sourceType?: SourceType;
  sourceSessionId?: string;
  sourceTurnRange?: [number, number];
  hintsApplied?: string[];
}

export interface EventProvenance {
  sourceType?: SourceType;
  sourceSessionId?: string;
  sourceTurnRange?: [number, number];
  ingestionChecksum?: string;
}

export interface MemoryAtomClaim {
  type: AtomClaimType;
  statement: string;
}

export interface MemoryAtomTrigger {
  conditions: string[];
  contextTags: string[];
}

export interface MemoryAtomApplicability {
  include: string[];
  exclude: string[];
}

export interface MemoryProvenance {
  sourceEventIds: string[];
  evidenceRefs: string[];
}

export interface MemoryVersioning {
  version: number;
  parentVersion?: string;
}

export interface MemoryState {
  status: AtomStatus;
  conflictsWith: string[];
}

export interface MemoryMetrics {
  confidence: number;
  reuseCount: number;
}

/** Additive CW2-P2 privacy block (defaults applied via withAtomV2Defaults). */
export type MemoryPrivacyMetadata = {
  privacyLevel: "private" | "shared" | "org" | "public";
  syncEligibility: "blocked" | "eligible" | "promoted";
  consentRequired?: boolean;
};

/** Additive CW2-P2 lifecycle block. */
export type MemoryLifecycleMetadata = {
  admittedAt?: string;
  lastRetrievedAt?: string;
  deprecatedAt?: string;
  tombstonedAt?: string;
  retentionClass?: "ephemeral" | "standard" | "durable" | "legal_hold";
};

/**
 * Additive CW2-P2 governance metrics.
 * admission / retrieval / promotion are independent channels.
 */
export type MemoryGovernanceMetrics = {
  admissionScore?: number;
  retrievalScore?: number;
  promotionScore?: number;
  coverageContribution?: number;
  lastScoredAt?: string;
  scoreVersion?: 1;
};

export interface MemoryAtom {
  id: string;
  atomType: string;
  scope: Scope;
  claim: MemoryAtomClaim;
  trigger: MemoryAtomTrigger;
  action?: Record<string, string | number | boolean>;
  applicability: MemoryAtomApplicability;
  provenance: MemoryProvenance;
  versioning: MemoryVersioning;
  state: MemoryState;
  metrics: MemoryMetrics;
  dedupKey?: string;
  /** CW2-P2 additive — optional on legacy rows. */
  privacy?: MemoryPrivacyMetadata;
  lifecycle?: MemoryLifecycleMetadata;
  governance?: MemoryGovernanceMetrics;
}

export interface EventSkeleton {
  id: string;
  scope: Scope;
  goal: string;
  context: string;
  constraints: string[];
  decisions: string[];
  turningPoints: string[];
  outcome?: string;
  linkedAtoms: string[];
  evidenceRefs: string[];
  eventKey?: string;
  provenance: EventProvenance;
}

export interface TaskFrame {
  id: string;
  scope: Scope;
  taskType: TaskType;
  goals: string[];
  problems: string[];
  scenarioTags: string[];
  constraints: string[];
  entities: string[];
  requiredAtomTypes: string[];
  riskLevel?: string;
  priority?: string;
  timeHorizon?: string;
  provenance?: TaskProvenance;
}

export interface EntityRecord {
  id: string;
  entityType: string;
  name: string;
  aliases: string[];
  tags: string[];
  scope: Scope;
  provenance: MemoryProvenance;
  entityKey?: string;
}

export interface ScenarioRecord {
  id: string;
  name: string;
  tags: string[];
  summary: string;
  scope: Scope;
  provenance: MemoryProvenance;
  scenarioKey?: string;
}

export interface ProblemRecord {
  id: string;
  statement: string;
  normalizedStatement: string;
  tags: string[];
  scope: Scope;
  provenance: MemoryProvenance;
  problemKey?: string;
}

export interface EvidenceLocator {
  turnRange?: [number, number];
  messageIds: string[];
  toolCallIds: string[];
  documentOffsets?: [number, number];
}

export interface EvidenceRecord {
  id: string;
  type: string;
  uri: string;
  snippet: string;
  timestamp?: string;
  trustScore: number;
  scope: Scope;
  checksum?: string;
  locator: EvidenceLocator;
}

export interface EvidenceSearchResult {
  evidence: EvidenceRecord;
  score: number;
  matchedTokens: string[];
  exactPhraseMatch: boolean;
}

export interface RelationRecord {
  id: string;
  fromId: string;
  fromNodeType: NodeType;
  relationType: RelationType;
  toId: string;
  toNodeType: NodeType;
  scope: Scope;
  confidence: number;
  status: "active" | "deprecated";
  provenance: MemoryProvenance;
}

export interface DistillationKeys {
  ingestionChecksum: string;
  eventKey: string;
  atomDedupKeys: string[];
  entityKeys: string[];
  scenarioKeys: string[];
  problemKeys: string[];
}

export type DistillationQualityProfile = "rule_based" | "llm_single_call" | "llm_multi_call";

export interface DistillationStageDecision {
  stage: string;
  llmResponded: boolean;
  usedLlmOutput: boolean;
  fallbackToRule: boolean;
}

export interface DistillationQuality {
  profile: DistillationQualityProfile;
  stageCoverage: number;
  stageFallbackRate: number;
  stageDecisions: DistillationStageDecision[];
}

export interface WritePlan {
  canonicalObjectTypes: NodeType[];
  relationIds: string[];
  graphNodeIds: string[];
  graphEdgeIds: string[];
  vectorDocumentIds: string[];
}

export interface DistillationResult {
  event: EventSkeleton;
  atoms: MemoryAtom[];
  entities: EntityRecord[];
  scenarios: ScenarioRecord[];
  problems: ProblemRecord[];
  relations: RelationRecord[];
  evidence: EvidenceRecord[];
  keys: DistillationKeys;
  writePlan: WritePlan;
  quality: DistillationQuality;
}

export interface PackageWhy {
  summary: string;
  matchedPatterns: string[];
}

export interface PackageAnswer {
  summary: string;
  recommendations: string[];
  nextSteps: string[];
}

export interface PackageRiskMarker {
  atomId: string;
  status: Extract<AtomStatus, "tentative" | "conflicted">;
  explanation: string;
}

export interface ReasoningPath {
  pathId: string;
  nodeIds: string[];
  relationChain: RelationType[];
  score: number;
  summary: string;
}

export interface CognitivePackage {
  packageId: string;
  taskFrameId: string;
  answer: PackageAnswer;
  why: PackageWhy;
  supportingAtoms: string[];
  reasoningPath: ReasoningPath[];
  confidence: number;
  risks: string[];
  constraints: string[];
  conflicts: PackageRiskMarker[];
  evidenceRefs: string[];
  sessionId?: string;
}

export interface SeedCandidate {
  nodeId: string;
  nodeType: NodeType;
  score: number;
  reason: string;
}

export interface DroppedPath {
  pathId: string;
  reason: string;
}

export interface ReasonDebugPayload {
  seedCandidates: SeedCandidate[];
  selectedTemplate: string;
  candidatePaths: ReasoningPath[];
  droppedPaths: DroppedPath[];
  scoringDetails: Record<string, number>;
}

export interface AtomUpsertDecision {
  atomId: string;
  dedupKey: string;
  action: UpsertDecisionAction;
  targetAtomId?: string;
  reason?: string;
}

export interface WriteBackResult {
  eventId: string;
  atomIds: string[];
  journalId: string;
  canonicalStatus: CanonicalStatus;
  derivedStatus: DerivedStatus;
  status: WriteBackStatus;
}

export interface TracePackageResult {
  package: CognitivePackage;
  taskFrame: TaskFrame;
  selectedTemplate: string;
  candidatePaths: ReasoningPath[];
  selectedPathIds: string[];
  droppedPaths: DroppedPath[];
  supportingAtoms: MemoryAtom[];
  conflicts: PackageRiskMarker[];
  evidenceRefs: string[];
}

export interface TraceReasoningSessionResult {
  sessionId: string;
  taskFrame: TaskFrame;
  package?: CognitivePackage;
  selectedTemplate: string;
  candidatePaths: ReasoningPath[];
  droppedPaths: DroppedPath[];
  debug: ReasonDebugPayload;
}

export interface MemoryTrace {
  atom: MemoryAtom;
  eventIds: string[];
  evidenceRefs: string[];
}

export interface WriteJournalObjectIds {
  eventIds: string[];
  atomIds: string[];
  entityIds: string[];
  scenarioIds: string[];
  problemIds: string[];
  evidenceIds: string[];
  relationIds: string[];
}

export interface WriteJournalDerivedPlan {
  graphNodeIds: string[];
  graphEdgeIds: string[];
  vectorDocIds: string[];
}

export interface WriteJournal {
  id: string;
  eventKey: string;
  objectIds: WriteJournalObjectIds;
  derivedPlan: WriteJournalDerivedPlan;
  status: "RECEIVED" | "METADATA_COMMITTED" | "DERIVED_OUT_OF_SYNC" | "COMPLETED" | "FAILED";
  phase:
    | "RECEIVED"
    | "EVENT_BUILT"
    | "OBJECTS_EXTRACTED"
    | "METADATA_COMMITTED"
    | "GRAPH_SYNCED"
    | "VECTOR_SYNCED"
    | "COMPLETED";
  retryCount: number;
  lastError?: string;
  updatedAt: string;
}

/** Exactly-one selector for archive/restore/forget/purge source ops (conversation lifecycle T2). */
export type SourceLifecycleSelector =
  | { mode: "identity"; sourceIdentityId: string }
  | { mode: "legacyLocator"; sourceLocator: string }
  | { mode: "binding"; sourceBindingId: string };

/** Retrieval / governance status for a bound memory source. */
export type SourceLifecycleMode = "active" | "archived" | "forgotten" | "purged";

export type CogniWeaveSubjectContext = {
  scope: Scope;
  principalId?: string;
  tenantId?: string | null;
};

export type SourceLifecycleInput = {
  operationId: string;
  selector: SourceLifecycleSelector;
  subject: CogniWeaveSubjectContext;
  reasonCode: string;
  expectedStatus?: SourceLifecycleMode;
};

export type SourceLifecycleReceipt = {
  operationId: string;
  sourceIdentityId: string;
  sourceBindingId: string;
  previousStatus: SourceLifecycleMode;
  currentStatus: SourceLifecycleMode;
  affectedObjectCount: number;
  completedAt: string;
};

/**
 * Stable partition of canonical data for write-operation identity (CW2-P0-00).
 * ACL-rich MemorySubject is P3 and MUST NOT be substituted into this key.
 */
export type MemoryPartitionKeyV1 = {
  partitionKeyVersion: 1;
  /** Local installation / data-root instance id (not SaaS tenantId). */
  dataPlaneId: string;
  /** Fingerprint of Scope fields only: workspace|project|agent|visibility. */
  scopeFingerprint: string;
};

/**
 * CW2-P3-01 authorization plane. Never written into MemoryPartitionKeyV1 / op-keys.
 * Unknown local tenant → LOCAL_TENANT_SENTINEL; never invent enterprise tenant ids.
 */
export type MemorySubjectOwnerType = "user" | "agent" | "seat" | "space" | "team" | "organization";

export type MemorySubject = {
  tenantId: string;
  ownerType: MemorySubjectOwnerType;
  ownerId: string;
};

/** OpenBot scopeType hint aligned with plan §8.2 mapping. */
export type MemorySubjectScopeType =
  | "personal"
  | "agent"
  | "seat"
  | "space"
  | "team"
  | "organization";

/**
 * Partition ↔ subject mapping table row. Binding/unbinding must not rewrite
 * writeOperationKey (op keys stay on MemoryPartitionKeyV1 only).
 */
export type MemorySubjectBinding = {
  id: string;
  partition: MemoryPartitionKeyV1;
  scope: Scope;
  subject: MemorySubject;
  scopeType?: MemorySubjectScopeType;
  createdAt: string;
  updatedAt: string;
  /** Soft unbind timestamp; live bindings omit this. */
  unboundAt?: string;
};

export type AuthorizeMemoryAccessInput = {
  partition: MemoryPartitionKeyV1;
  /** Caller from trusted gateway/session (or local sentinel). */
  caller: MemorySubject;
};

export type AuthorizeMemoryDenyReason =
  | "TENANT_MISMATCH"
  | "OWNER_MISMATCH"
  | "UNBOUND"
  | "LOCAL_SENTINEL_VIOLATION";

export type AuthorizeMemoryAccessResult =
  | { allowed: true; bindingId: string }
  | { allowed: false; reason: AuthorizeMemoryDenyReason };

/**
 * CW2-P3-02 seat succession transfer class.
 * Mirrors OpenBot `EnterpriseMemoryTransferClass` — no parallel ownership system.
 */
export type MemoryTransferClass = "inheritable" | "review_required" | "private";

export type SeatMemoryScopeTransfer = {
  scopeId: string;
  transferClass: MemoryTransferClass;
};

/** Durable claim row for writeOperationKey uniqueness (CW2-P0-01). */
export type WriteOperationRecord = {
  writeOperationKey: string;
  kind: "WRITE" | "REBUILD" | "REPAIR" | "DELETE" | "SYNC";
  result: WriteBackResult;
  completedAt: string;
};

/** Minimal durable binding between OpenBot source identity and CogniWeave retrieval. */
export type SourceBinding = {
  id: string;
  sourceIdentityId: string;
  sourceLocator: string;
  status: SourceLifecycleMode;
  scope: Scope;
  createdAt: string;
  updatedAt: string;
};

/** Object types that may be members of a source via source_object_links (CW2-P1-00). */
export type SourceObjectType =
  | "event"
  | "atom"
  | "evidence"
  | "relation"
  | "entity"
  | "scenario"
  | "problem";

/**
 * Normalized multi-source membership. Forget soft-unlinks; Purge may hard-delete
 * objects only when no live links remain.
 */
export type SourceObjectLink = {
  id: string;
  sourceBindingId: string;
  objectType: SourceObjectType;
  objectId: string;
  /** e.g. primary_evidence | supporting | derived_from */
  linkRole: string;
  createdAt: string;
  /** Soft unlink time; hard purge may remove the row after grace. */
  unlinkedAt?: string;
};

export type ResolveSourceLifecycleSelectorInput = {
  operationId?: string;
  reasonCode?: string;
  selector?: SourceLifecycleSelector;
  sourceIdentityId?: string;
  sourceLocator?: string;
  sourceBindingId?: string;
};

/**
 * Resolve a single SourceLifecycleSelector. Fail closed when zero or multiple
 * selectors are provided (including conflicts between `selector` and flat fields).
 */
export function resolveSourceLifecycleSelector(
  input: ResolveSourceLifecycleSelectorInput,
): SourceLifecycleSelector {
  const candidates: SourceLifecycleSelector[] = [];
  if (input.selector) {
    candidates.push(input.selector);
  }
  if (typeof input.sourceIdentityId === "string" && input.sourceIdentityId.trim()) {
    candidates.push({ mode: "identity", sourceIdentityId: input.sourceIdentityId.trim() });
  }
  if (typeof input.sourceLocator === "string" && input.sourceLocator.trim()) {
    candidates.push({ mode: "legacyLocator", sourceLocator: input.sourceLocator.trim() });
  }
  if (typeof input.sourceBindingId === "string" && input.sourceBindingId.trim()) {
    candidates.push({ mode: "binding", sourceBindingId: input.sourceBindingId.trim() });
  }

  // Deduplicate identical selectors (same mode + key).
  const uniq = new Map<string, SourceLifecycleSelector>();
  for (const c of candidates) {
    const key =
      c.mode === "identity"
        ? `identity:${c.sourceIdentityId}`
        : c.mode === "legacyLocator"
          ? `locator:${c.sourceLocator}`
          : `binding:${c.sourceBindingId}`;
    uniq.set(key, c);
  }

  if (uniq.size === 0) {
    throw new Error("SourceLifecycleSelector requires exactly one selector");
  }
  if (uniq.size > 1) {
    throw new Error("SourceLifecycleSelector rejects multiple selectors");
  }
  return [...uniq.values()][0]!;
}
