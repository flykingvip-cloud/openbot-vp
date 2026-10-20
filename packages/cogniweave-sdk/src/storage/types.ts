import type {
  AtomStatus,
  DistillationResult,
  EntityRecord,
  EventSkeleton,
  EvidenceRecord,
  MemoryAtom,
  MemorySubjectBinding,
  MemorySubjectOwnerType,
  ProblemRecord,
  RelationRecord,
  ScenarioRecord,
  Scope,
  SourceBinding,
  SourceLifecycleReceipt,
  SourceObjectLink,
  SourceObjectType,
  WriteJournal,
  WriteOperationRecord,
} from "../models.js";

/** CW2-P4-01 scope-aware metadata query (production retrieval must not use listAtoms). */
export type MetadataQueryFilter = {
  scope: Scope;
  /** Default excludes deprecated when unset. */
  excludeStatuses?: AtomStatus[];
  statuses?: AtomStatus[];
  atomTypes?: string[];
  limit?: number;
  offset?: number;
};

export interface MetadataBundle {
  events: EventSkeleton[];
  atoms: MemoryAtom[];
  entities: EntityRecord[];
  scenarios: ScenarioRecord[];
  problems: ProblemRecord[];
  evidence: EvidenceRecord[];
  relations: RelationRecord[];
}

/** Durable receipt row may carry reasonCode for audit; core receipt fields stay stable. */
export type PersistedSourceLifecycleReceipt = SourceLifecycleReceipt & {
  reasonCode?: string;
};

export interface MetadataStore {
  withTransaction?<T>(runner: () => Promise<T>): Promise<T>;

  saveIngestion(result: {
    ingestionId: string;
    ingestionChecksum: string;
    status: "RECEIVED";
  }): Promise<void>;
  upsertEvent(event: EventSkeleton): Promise<EventSkeleton>;
  getEvent(eventId: string): Promise<EventSkeleton | undefined>;
  findEventByKey(eventKey: string): Promise<EventSkeleton | undefined>;
  listEvents(): Promise<EventSkeleton[]>;
  /** Hard-delete event row (purge orphans with zero live links). */
  deleteEvent?(eventId: string): Promise<void>;

  getAtom(atomId: string): Promise<MemoryAtom | undefined>;
  /**
   * Full scan — migration/admin only. Production retrieval must use queryAtoms (CW2-P4-01).
   * @deprecated Prefer queryAtoms for retrieval paths.
   */
  listAtoms(): Promise<MemoryAtom[]>;
  /** Scope-indexed atom query (CW2-P4-01). */
  queryAtoms?(filter: MetadataQueryFilter): Promise<MemoryAtom[]>;
  findAtomsByDedupKey(dedupKey: string): Promise<MemoryAtom[]>;
  saveAtom(atom: MemoryAtom): Promise<void>;
  deleteAtom(atomId: string): Promise<void>;
  bindDedupKey(dedupKey: string, atomId: string): Promise<void>;

  saveEntity(entity: EntityRecord): Promise<void>;
  saveScenario(scenario: ScenarioRecord): Promise<void>;
  saveProblem(problem: ProblemRecord): Promise<void>;
  saveEvidence(evidence: EvidenceRecord): Promise<void>;
  saveRelation(relation: RelationRecord): Promise<void>;

  getEvidence(evidenceId: string): Promise<EvidenceRecord | undefined>;
  /**
   * Full scan — migration/admin only. Production retrieval must use queryEvidence (CW2-P4-01).
   * @deprecated Prefer queryEvidence for retrieval paths.
   */
  listEvidence(): Promise<EvidenceRecord[]>;
  /** Scope-indexed evidence query (CW2-P4-01). */
  queryEvidence?(filter: {
    scope: Scope;
    limit?: number;
    offset?: number;
  }): Promise<EvidenceRecord[]>;
  getEntity(entityId: string): Promise<EntityRecord | undefined>;
  listEntities(): Promise<EntityRecord[]>;
  /** Hard-delete entity row (purge orphans with zero live links). */
  deleteEntity?(entityId: string): Promise<void>;
  getScenario(scenarioId: string): Promise<ScenarioRecord | undefined>;
  listScenarios(): Promise<ScenarioRecord[]>;
  /** Hard-delete scenario row (purge orphans with zero live links). */
  deleteScenario?(scenarioId: string): Promise<void>;
  getProblem(problemId: string): Promise<ProblemRecord | undefined>;
  listProblems(): Promise<ProblemRecord[]>;
  /** Hard-delete problem row (purge orphans with zero live links). */
  deleteProblem?(problemId: string): Promise<void>;
  getRelation(relationId: string): Promise<RelationRecord | undefined>;
  listRelations(): Promise<RelationRecord[]>;
  /** CW2-P4-02 — 1-hop relations for a node within scope. */
  listRelationsByNode?(filter: {
    nodeId: string;
    scope: Scope;
    direction?: "out" | "in" | "both";
    status?: "active" | "deprecated";
  }): Promise<RelationRecord[]>;
  /** Hard-delete relation row (purge orphans with zero live links). */
  deleteRelation?(relationId: string): Promise<void>;

  putJournal(journal: WriteJournal): Promise<void>;
  getJournal(journalId: string): Promise<WriteJournal | undefined>;
  listJournals(): Promise<WriteJournal[]>;
  updateJournal(journalId: string, patch: Partial<WriteJournal>): Promise<WriteJournal | undefined>;

  getBundleForJournal(journal: WriteJournal): Promise<MetadataBundle>;

  /** Source lifecycle durability (CW2). Optional on stub/legacy stores. */
  saveSourceBinding?(binding: SourceBinding): Promise<void>;
  getSourceBinding?(id: string): Promise<SourceBinding | undefined>;
  listSourceBindings?(scope?: Scope): Promise<SourceBinding[]>;
  findSourceBindingByIdentity?(sourceIdentityId: string): Promise<SourceBinding | undefined>;
  findSourceBindingByLocator?(sourceLocator: string): Promise<SourceBinding | undefined>;
  putSourceLifecycleReceipt?(receipt: PersistedSourceLifecycleReceipt): Promise<void>;
  getSourceLifecycleReceipt?(
    operationId: string,
  ): Promise<PersistedSourceLifecycleReceipt | undefined>;
  listSourceLifecycleReceipts?(): Promise<PersistedSourceLifecycleReceipt[]>;

  /** Multi-source membership (CW2-P1-00). Optional on stub/legacy stores. */
  saveSourceObjectLink?(link: SourceObjectLink): Promise<void>;
  getSourceObjectLink?(id: string): Promise<SourceObjectLink | undefined>;
  listSourceObjectLinks?(filter?: {
    sourceBindingId?: string;
    objectType?: SourceObjectType;
    objectId?: string;
    liveOnly?: boolean;
  }): Promise<SourceObjectLink[]>;
  deleteSourceObjectLink?(id: string): Promise<void>;
  /** Hard-delete evidence row (purge orphans with zero live links). */
  deleteEvidence?(evidenceId: string): Promise<void>;

  /** Durable dataPlaneId for MemoryPartitionKeyV1 (CW2-P0-00). */
  ensureDataPlaneId?(): Promise<string>;
  getDataPlaneId?(): Promise<string | undefined>;

  /** writeOperationKey uniqueness + short-circuit (CW2-P0-01). */
  getWriteOperation?(writeOperationKey: string): Promise<WriteOperationRecord | undefined>;
  putWriteOperation?(record: WriteOperationRecord): Promise<void>;
  listWriteOperations?(): Promise<WriteOperationRecord[]>;

  /** Partition ↔ MemorySubject mapping (CW2-P3-01). Does not alter op-keys. */
  saveMemorySubjectBinding?(binding: MemorySubjectBinding): Promise<void>;
  getMemorySubjectBinding?(id: string): Promise<MemorySubjectBinding | undefined>;
  listMemorySubjectBindings?(filter?: {
    scope?: Scope;
    tenantId?: string;
    ownerType?: MemorySubjectOwnerType;
    ownerId?: string;
    dataPlaneId?: string;
    scopeFingerprint?: string;
    liveOnly?: boolean;
  }): Promise<MemorySubjectBinding[]>;
  deleteMemorySubjectBinding?(id: string): Promise<void>;

  /** Journal maintenance (CW2-P0-03). */
  deleteJournal?(journalId: string): Promise<void>;
}

export interface GraphStore {
  syncFromDistillation(
    result: DistillationResult,
  ): Promise<{ nodeCount: number; edgeCount: number }>;
  rebuildFromBundle(bundle: MetadataBundle): Promise<{ nodeCount: number; edgeCount: number }>;
}

export type VectorSearchHit = {
  id: string;
  score: number;
  sourceType: string;
};

export interface VectorStore {
  syncFromDistillation(result: DistillationResult): Promise<{ documentCount: number }>;
  rebuildFromBundle(bundle: MetadataBundle): Promise<{ documentCount: number }>;
  /** CW2-P4-02 — optional; lexical stub OK until embeddings land. */
  search?(params: { query: string; scope?: Scope; limit?: number }): Promise<VectorSearchHit[]>;
  delete?(ids: string[]): Promise<number>;
}
