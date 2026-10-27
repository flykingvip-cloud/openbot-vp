import type {
  AtomUpsertDecision,
  CognitivePackage,
  DistillationResult,
  EngineConfig,
  EventSkeleton,
  EvidenceRecord,
  EvidenceSearchResult,
  MemoryAtom,
  MemoryProvenance,
  MemorySubject,
  MemoryTrace,
  ReasonDebugPayload,
  Scope,
  ScopeInput,
  SourceLifecycleInput,
  SourceLifecycleReceipt,
  SourceLifecycleMode,
  SourceType,
  TaskFrame,
  TracePackageResult,
  TraceReasoningSessionResult,
  WriteBackResult,
  WriteJournal,
} from "./models.js";

export interface IngestInput {
  rawInput: string | Record<string, unknown>;
  scope: Scope;
  sourceType: SourceType;
  sourceSessionId?: string;
  sourceTurnRange?: [number, number];
  metadata?: Record<string, string>;
}

export interface IngestResult {
  ingestionId: string;
  ingestionChecksum: string;
  status: "RECEIVED";
}

export interface FrameTaskOptions {
  scope?: ScopeInput;
  hints?: Record<string, string | string[]>;
  forceLlm?: boolean;
}

export interface ReasonOptions {
  maxPaths?: number;
  includeExplainability?: boolean;
  includeOptionalEvidenceRefs?: boolean;
}

export interface UpsertAtomsOptions {
  mergeStrategy?: "default";
}

export interface TraceOptions {
  includeOptionalEvidenceRefs?: boolean;
  scope?: ScopeInput;
}

export interface ResolveEvidenceOptions {
  atomId?: string;
  evidenceId?: string;
  includeContent?: boolean;
  scope?: ScopeInput;
}

export interface SearchEvidenceOptions {
  scope?: ScopeInput;
  maxResults?: number;
  minScore?: number;
  /** When set, ACL authorize runs before candidates are returned (CW2-P4-01). */
  caller?: MemorySubject;
}

export type QueryAtomsOptions = {
  scope: ScopeInput;
  caller: MemorySubject;
  filter?: {
    atomTypes?: string[];
    includeTentative?: boolean;
    includeConflicted?: boolean;
    limit?: number;
  };
};

export type AtomQueryHit = {
  atom: MemoryAtom;
  explain: {
    bindingId: string;
    acl: "allowed";
    lifecycle: "retrievable";
    evidenceRefCount: number;
  };
};

export type QueryAtomsHybridOptions = QueryAtomsOptions & {
  query: string;
  maxResults?: number;
  minScore?: number;
  /** Default true — skipped automatically when VectorStore.search is absent. */
  enableVector?: boolean;
  /** Default true — 1-hop relation boost from top FTS seeds. */
  enableGraphBoost?: boolean;
};

export type AtomHybridHit = AtomQueryHit & {
  score: number;
  explain: AtomQueryHit["explain"] & {
    channels: { fts: number; vector?: number; graphBoost?: number };
    matchedTokens: string[];
  };
};

export interface RepairIndexesOptions {
  journalId?: string;
  scope?: Scope;
}

export interface RebuildFromTruthOptions {
  objectType: string;
  objectId: string;
}

export interface RecoverFromCanonicalOptions {
  scope?: Scope;
}

export interface RecoverFromCanonicalResult {
  status: "RECOVERED";
  journalsRebuilt: number;
  writeOperationCount: number;
  journalCount: number;
  orphanSourceBindingIds: string[];
}

export interface CompactJournalsOptions {
  /** Retain this many newest COMPLETED journals (default 20). */
  keepCompleted?: number;
  dryRun?: boolean;
}

export interface CompactJournalsResult {
  status: "COMPACTED" | "DRY_RUN";
  deletedJournalIds: string[];
  retainedJournalIds: string[];
}

export interface CogniWeaveEngine {
  readonly config: EngineConfig;

  frameTask(
    rawInput: string | Record<string, unknown>,
    options?: FrameTaskOptions,
  ): Promise<TaskFrame>;
  validateTaskFrame(taskFrame: TaskFrame): void;
  normalizeTaskFrame(taskFrame: TaskFrame): TaskFrame;

  reason(taskFrame: TaskFrame, options?: ReasonOptions): Promise<CognitivePackage>;
  reasonWithDebug(
    taskFrame: TaskFrame,
    options?: Pick<ReasonOptions, "maxPaths">,
  ): Promise<[CognitivePackage, ReasonDebugPayload]>;

  ingest(input: IngestInput): Promise<IngestResult>;
  distill(input: IngestInput & { forceRebuild?: boolean }): Promise<DistillationResult>;
  writeBack(input: IngestInput & { package?: CognitivePackage | null }): Promise<WriteBackResult>;

  computeEventKey(input: IngestInput): string;
  computeDedupKey(atom: MemoryAtom): string;
  computeIngestionChecksum(
    rawInput: string | Record<string, unknown>,
    metadata?: Record<string, string>,
  ): string;
  upsertEvent(event: EventSkeleton): Promise<EventSkeleton>;
  upsertAtoms(atoms: MemoryAtom[], options?: UpsertAtomsOptions): Promise<AtomUpsertDecision[]>;

  trace(atomId: string, options?: TraceOptions): Promise<MemoryTrace>;
  tracePackage(packageId: string, options?: TraceOptions): Promise<TracePackageResult>;
  traceReasoningSession(
    sessionId: string,
    options?: TraceOptions,
  ): Promise<TraceReasoningSessionResult>;
  getProvenance(atomId: string): Promise<MemoryProvenance>;
  getConflicts(atomId: string): Promise<string[]>;
  getVersionHistory(atomId: string): Promise<MemoryAtom[]>;

  resolveEvidence(options: ResolveEvidenceOptions): Promise<EvidenceRecord | EvidenceRecord[]>;
  getEvidenceRefs(atomId: string, scope?: ScopeInput): Promise<string[]>;
  searchEvidence(query: string, options?: SearchEvidenceOptions): Promise<EvidenceSearchResult[]>;
  /** CW2-P4-01: ACL + lifecycle gated scope query (no listAtoms full scan). */
  queryAtoms(options: QueryAtomsOptions): Promise<AtomQueryHit[]>;
  /** CW2-P4-02: hybrid FTS + optional vector + relation boost after ACL/lifecycle. */
  queryAtomsHybrid(options: QueryAtomsHybridOptions): Promise<AtomHybridHit[]>;
  /**
   * Ensure a live MemorySubjectBinding for the caller on scope (idempotent).
   * Used by OpenBot manager Memory Center before queryAtoms.
   */
  ensureMemorySubjectBinding?(input: {
    scope: ScopeInput;
    caller: MemorySubject;
    scopeType?: "personal" | "agent" | "seat";
  }): Promise<{ bindingId: string; created: boolean }>;

  detectConflicts(params: { atomIds?: string[]; scope?: Scope }): Promise<Record<string, unknown>>;
  recomputeConfidence(
    atomId: string,
    signal?: Record<string, string | number | boolean>,
  ): Promise<number>;
  deprecateAtom(atomId: string, reason: string): Promise<void>;
  supersedeAtom(oldAtomId: string, newAtomId: string): Promise<void>;
  mergeAtoms(atomIds: string[], targetAtomId?: string): Promise<string>;

  repairIndexes(options?: RepairIndexesOptions): Promise<Record<string, unknown>>;
  rebuildFromTruth(options: RebuildFromTruthOptions): Promise<Record<string, unknown>>;
  getWriteJournal(journalId: string, scope?: ScopeInput): Promise<WriteJournal>;

  /**
   * CW2-P0-02: rebuild derived indexes from canonical metadata after restart.
   * Must not create new WRITE journals / write_operations.
   */
  recoverFromCanonical(options?: RecoverFromCanonicalOptions): Promise<RecoverFromCanonicalResult>;

  /** CW2-P0-03: compact COMPLETED journals while retaining pinned / recent rows. */
  compactJournals(options?: CompactJournalsOptions): Promise<CompactJournalsResult>;

  /** Conversation lifecycle source ops (archive / restore / forget / purge). */
  archiveSource(input: SourceLifecycleInput): Promise<SourceLifecycleReceipt>;
  restoreSource(input: SourceLifecycleInput): Promise<SourceLifecycleReceipt>;
  forgetSource(input: SourceLifecycleInput): Promise<SourceLifecycleReceipt>;
  purgeSource(input: SourceLifecycleInput): Promise<SourceLifecycleReceipt>;

  /**
   * Fact-level forget enumeration: live source bindings linked to an atom
   * via atom and/or evidence source_object_links (no text-scan deletes).
   */
  listLiveSourcesForAtom(atomId: string): Promise<
    Array<{
      sourceBindingId: string;
      sourceIdentityId: string;
      sourceLocator: string;
      status: SourceLifecycleMode;
    }>
  >;
}

export type MemoryEngine = CogniWeaveEngine;
