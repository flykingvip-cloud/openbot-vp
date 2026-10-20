import { createDataPlaneId } from "../keys.js";
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
  SourceObjectLink,
  SourceObjectType,
  WriteJournal,
  WriteOperationRecord,
} from "../models.js";
import { scoreDocumentLexical } from "../retrieval/hybrid.js";
import { DEFAULT_QUERY_EXCLUDE_STATUSES } from "../retrieval/lifecycle-gate.js";
import { matchesScope } from "../scope.js";
import type {
  GraphStore,
  MetadataBundle,
  MetadataQueryFilter,
  MetadataStore,
  PersistedSourceLifecycleReceipt,
  VectorSearchHit,
  VectorStore,
} from "./types.js";

function mergeDistinct(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export class InMemoryMetadataStore implements MetadataStore {
  private readonly ingestions = new Map<
    string,
    { ingestionId: string; ingestionChecksum: string; status: "RECEIVED" }
  >();
  private readonly events = new Map<string, EventSkeleton>();
  private readonly eventIdsByKey = new Map<string, string>();
  private readonly atoms = new Map<string, MemoryAtom>();
  private readonly atomIdsByDedupKey = new Map<string, string[]>();
  private readonly entities = new Map<string, EntityRecord>();
  private readonly scenarios = new Map<string, ScenarioRecord>();
  private readonly problems = new Map<string, ProblemRecord>();
  private readonly evidence = new Map<string, EvidenceRecord>();
  private readonly relations = new Map<string, RelationRecord>();
  private readonly journals = new Map<string, WriteJournal>();
  private readonly sourceBindings = new Map<string, SourceBinding>();
  private readonly sourceBindingsByIdentity = new Map<string, string>();
  private readonly sourceBindingsByLocator = new Map<string, string>();
  private readonly sourceLifecycleReceipts = new Map<string, PersistedSourceLifecycleReceipt>();
  private readonly sourceObjectLinks = new Map<string, SourceObjectLink>();
  private readonly writeOperations = new Map<string, WriteOperationRecord>();
  private readonly memorySubjectBindings = new Map<string, MemorySubjectBinding>();
  private dataPlaneId: string | undefined;

  async withTransaction<T>(runner: () => Promise<T>): Promise<T> {
    return runner();
  }

  async saveIngestion(result: {
    ingestionId: string;
    ingestionChecksum: string;
    status: "RECEIVED";
  }): Promise<void> {
    this.ingestions.set(result.ingestionId, result);
  }

  listIngestions(): Array<{ ingestionId: string; ingestionChecksum: string; status: "RECEIVED" }> {
    return [...this.ingestions.values()];
  }

  snapshotCounts(): {
    events: number;
    atoms: number;
    entities: number;
    scenarios: number;
    problems: number;
    evidence: number;
    relations: number;
    journals: number;
  } {
    return {
      events: this.events.size,
      atoms: this.atoms.size,
      entities: this.entities.size,
      scenarios: this.scenarios.size,
      problems: this.problems.size,
      evidence: this.evidence.size,
      relations: this.relations.size,
      journals: this.journals.size,
    };
  }

  async upsertEvent(event: EventSkeleton): Promise<EventSkeleton> {
    if (event.eventKey) {
      const existingId = this.eventIdsByKey.get(event.eventKey);
      if (existingId) {
        const merged = { ...this.events.get(existingId)!, ...event, id: existingId };
        this.events.set(existingId, merged);
        return merged;
      }
      this.eventIdsByKey.set(event.eventKey, event.id);
    }
    this.events.set(event.id, event);
    return event;
  }

  async getEvent(eventId: string): Promise<EventSkeleton | undefined> {
    return this.events.get(eventId);
  }

  async listEvents(): Promise<EventSkeleton[]> {
    return [...this.events.values()];
  }

  async deleteEvent(eventId: string): Promise<void> {
    const event = this.events.get(eventId);
    if (event?.eventKey) {
      this.eventIdsByKey.delete(event.eventKey);
    }
    this.events.delete(eventId);
  }

  async findEventByKey(eventKey: string): Promise<EventSkeleton | undefined> {
    const eventId = this.eventIdsByKey.get(eventKey);
    return eventId ? this.events.get(eventId) : undefined;
  }

  async getAtom(atomId: string): Promise<MemoryAtom | undefined> {
    return this.atoms.get(atomId);
  }

  async listAtoms(): Promise<MemoryAtom[]> {
    return [...this.atoms.values()];
  }

  async queryAtoms(filter: MetadataQueryFilter): Promise<MemoryAtom[]> {
    const exclude = new Set(filter.excludeStatuses ?? DEFAULT_QUERY_EXCLUDE_STATUSES);
    const allow = filter.statuses ? new Set(filter.statuses) : null;
    const types = filter.atomTypes ? new Set(filter.atomTypes) : null;
    let rows = [...this.atoms.values()].filter((atom) => matchesScope(atom.scope, filter.scope));
    rows = rows.filter((atom) => {
      const status = atom.state.status as AtomStatus;
      if (allow) {
        return allow.has(status);
      }
      return !exclude.has(status);
    });
    if (types) {
      rows = rows.filter((atom) => types.has(atom.atomType));
    }
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? rows.length;
    return rows.slice(offset, offset + limit);
  }

  async findAtomsByDedupKey(dedupKey: string): Promise<MemoryAtom[]> {
    return (this.atomIdsByDedupKey.get(dedupKey) ?? [])
      .map((atomId) => this.atoms.get(atomId))
      .filter((atom): atom is MemoryAtom => Boolean(atom));
  }

  async saveAtom(atom: MemoryAtom): Promise<void> {
    this.atoms.set(atom.id, atom);
  }

  async deleteAtom(atomId: string): Promise<void> {
    this.atoms.delete(atomId);
  }

  async bindDedupKey(dedupKey: string, atomId: string): Promise<void> {
    this.atomIdsByDedupKey.set(
      dedupKey,
      mergeDistinct([...(this.atomIdsByDedupKey.get(dedupKey) ?? []), atomId]),
    );
  }

  async saveEntity(entity: EntityRecord): Promise<void> {
    this.entities.set(entity.id, entity);
  }

  async saveScenario(scenario: ScenarioRecord): Promise<void> {
    this.scenarios.set(scenario.id, scenario);
  }

  async saveProblem(problem: ProblemRecord): Promise<void> {
    this.problems.set(problem.id, problem);
  }

  async saveEvidence(evidence: EvidenceRecord): Promise<void> {
    this.evidence.set(evidence.id, evidence);
  }

  async saveRelation(relation: RelationRecord): Promise<void> {
    this.relations.set(relation.id, relation);
  }

  async getEvidence(evidenceId: string): Promise<EvidenceRecord | undefined> {
    return this.evidence.get(evidenceId);
  }

  async listEvidence(): Promise<EvidenceRecord[]> {
    return [...this.evidence.values()];
  }

  async queryEvidence(filter: {
    scope: Scope;
    limit?: number;
    offset?: number;
  }): Promise<EvidenceRecord[]> {
    let rows = [...this.evidence.values()].filter((item) => matchesScope(item.scope, filter.scope));
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? rows.length;
    return rows.slice(offset, offset + limit);
  }

  async getEntity(entityId: string): Promise<EntityRecord | undefined> {
    return this.entities.get(entityId);
  }

  async listEntities(): Promise<EntityRecord[]> {
    return [...this.entities.values()];
  }

  async deleteEntity(entityId: string): Promise<void> {
    this.entities.delete(entityId);
  }

  async getScenario(scenarioId: string): Promise<ScenarioRecord | undefined> {
    return this.scenarios.get(scenarioId);
  }

  async listScenarios(): Promise<ScenarioRecord[]> {
    return [...this.scenarios.values()];
  }

  async deleteScenario(scenarioId: string): Promise<void> {
    this.scenarios.delete(scenarioId);
  }

  async getProblem(problemId: string): Promise<ProblemRecord | undefined> {
    return this.problems.get(problemId);
  }

  async listProblems(): Promise<ProblemRecord[]> {
    return [...this.problems.values()];
  }

  async deleteProblem(problemId: string): Promise<void> {
    this.problems.delete(problemId);
  }

  async getRelation(relationId: string): Promise<RelationRecord | undefined> {
    return this.relations.get(relationId);
  }

  async listRelations(): Promise<RelationRecord[]> {
    return [...this.relations.values()];
  }

  async listRelationsByNode(filter: {
    nodeId: string;
    scope: Scope;
    direction?: "out" | "in" | "both";
    status?: "active" | "deprecated";
  }): Promise<RelationRecord[]> {
    const direction = filter.direction ?? "both";
    return [...this.relations.values()].filter((relation) => {
      if (!matchesScope(relation.scope, filter.scope)) {
        return false;
      }
      if (filter.status && relation.status !== filter.status) {
        return false;
      }
      const out = relation.fromId === filter.nodeId;
      const inn = relation.toId === filter.nodeId;
      if (direction === "out") {
        return out;
      }
      if (direction === "in") {
        return inn;
      }
      return out || inn;
    });
  }

  async deleteRelation(relationId: string): Promise<void> {
    this.relations.delete(relationId);
  }

  async putJournal(journal: WriteJournal): Promise<void> {
    this.journals.set(journal.id, journal);
  }

  async getJournal(journalId: string): Promise<WriteJournal | undefined> {
    return this.journals.get(journalId);
  }

  async listJournals(): Promise<WriteJournal[]> {
    return [...this.journals.values()];
  }

  async updateJournal(
    journalId: string,
    patch: Partial<WriteJournal>,
  ): Promise<WriteJournal | undefined> {
    const current = this.journals.get(journalId);
    if (!current) {
      return undefined;
    }
    const next = { ...current, ...patch };
    this.journals.set(journalId, next);
    return next;
  }

  async getBundleForJournal(journal: WriteJournal): Promise<MetadataBundle> {
    return {
      events: journal.objectIds.eventIds
        .map((id) => this.events.get(id))
        .filter((v): v is EventSkeleton => Boolean(v)),
      atoms: journal.objectIds.atomIds
        .map((id) => this.atoms.get(id))
        .filter((v): v is MemoryAtom => Boolean(v)),
      entities: journal.objectIds.entityIds
        .map((id) => this.entities.get(id))
        .filter((v): v is EntityRecord => Boolean(v)),
      scenarios: journal.objectIds.scenarioIds
        .map((id) => this.scenarios.get(id))
        .filter((v): v is ScenarioRecord => Boolean(v)),
      problems: journal.objectIds.problemIds
        .map((id) => this.problems.get(id))
        .filter((v): v is ProblemRecord => Boolean(v)),
      evidence: journal.objectIds.evidenceIds
        .map((id) => this.evidence.get(id))
        .filter((v): v is EvidenceRecord => Boolean(v)),
      relations: journal.objectIds.relationIds
        .map((id) => this.relations.get(id))
        .filter((v): v is RelationRecord => Boolean(v)),
    };
  }

  async saveSourceBinding(binding: SourceBinding): Promise<void> {
    this.sourceBindings.set(binding.id, binding);
    this.sourceBindingsByIdentity.set(binding.sourceIdentityId, binding.id);
    this.sourceBindingsByLocator.set(binding.sourceLocator, binding.id);
  }

  async getSourceBinding(id: string): Promise<SourceBinding | undefined> {
    return this.sourceBindings.get(id);
  }

  async listSourceBindings(scope?: Scope): Promise<SourceBinding[]> {
    const all = [...this.sourceBindings.values()];
    if (!scope) {
      return all;
    }
    return all.filter(
      (binding) =>
        binding.scope.workspaceId === scope.workspaceId &&
        binding.scope.projectId === scope.projectId &&
        binding.scope.agentId === scope.agentId &&
        binding.scope.visibility === scope.visibility,
    );
  }

  async findSourceBindingByIdentity(sourceIdentityId: string): Promise<SourceBinding | undefined> {
    const id = this.sourceBindingsByIdentity.get(sourceIdentityId);
    return id ? this.sourceBindings.get(id) : undefined;
  }

  async findSourceBindingByLocator(sourceLocator: string): Promise<SourceBinding | undefined> {
    const id = this.sourceBindingsByLocator.get(sourceLocator);
    return id ? this.sourceBindings.get(id) : undefined;
  }

  async putSourceLifecycleReceipt(receipt: PersistedSourceLifecycleReceipt): Promise<void> {
    this.sourceLifecycleReceipts.set(receipt.operationId, receipt);
  }

  async getSourceLifecycleReceipt(
    operationId: string,
  ): Promise<PersistedSourceLifecycleReceipt | undefined> {
    return this.sourceLifecycleReceipts.get(operationId);
  }

  async saveSourceObjectLink(link: SourceObjectLink): Promise<void> {
    this.sourceObjectLinks.set(link.id, link);
  }

  async getSourceObjectLink(id: string): Promise<SourceObjectLink | undefined> {
    return this.sourceObjectLinks.get(id);
  }

  async listSourceObjectLinks(filter?: {
    sourceBindingId?: string;
    objectType?: SourceObjectType;
    objectId?: string;
    liveOnly?: boolean;
  }): Promise<SourceObjectLink[]> {
    let links = [...this.sourceObjectLinks.values()];
    if (filter?.sourceBindingId) {
      links = links.filter((link) => link.sourceBindingId === filter.sourceBindingId);
    }
    if (filter?.objectType) {
      links = links.filter((link) => link.objectType === filter.objectType);
    }
    if (filter?.objectId) {
      links = links.filter((link) => link.objectId === filter.objectId);
    }
    if (filter?.liveOnly) {
      links = links.filter((link) => !link.unlinkedAt);
    }
    return links;
  }

  async deleteSourceObjectLink(id: string): Promise<void> {
    this.sourceObjectLinks.delete(id);
  }

  async deleteEvidence(evidenceId: string): Promise<void> {
    this.evidence.delete(evidenceId);
  }

  async ensureDataPlaneId(): Promise<string> {
    if (!this.dataPlaneId) {
      this.dataPlaneId = createDataPlaneId();
    }
    return this.dataPlaneId;
  }

  async getDataPlaneId(): Promise<string | undefined> {
    return this.dataPlaneId;
  }

  async getWriteOperation(writeOperationKey: string): Promise<WriteOperationRecord | undefined> {
    return this.writeOperations.get(writeOperationKey);
  }

  async putWriteOperation(record: WriteOperationRecord): Promise<void> {
    this.writeOperations.set(record.writeOperationKey, record);
  }

  async listWriteOperations(): Promise<WriteOperationRecord[]> {
    return [...this.writeOperations.values()];
  }

  async saveMemorySubjectBinding(binding: MemorySubjectBinding): Promise<void> {
    this.memorySubjectBindings.set(binding.id, binding);
  }

  async getMemorySubjectBinding(id: string): Promise<MemorySubjectBinding | undefined> {
    return this.memorySubjectBindings.get(id);
  }

  async listMemorySubjectBindings(filter?: {
    scope?: Scope;
    tenantId?: string;
    ownerType?: MemorySubjectOwnerType;
    ownerId?: string;
    dataPlaneId?: string;
    scopeFingerprint?: string;
    liveOnly?: boolean;
  }): Promise<MemorySubjectBinding[]> {
    let rows = [...this.memorySubjectBindings.values()];
    if (filter?.scope) {
      const scope = filter.scope;
      rows = rows.filter(
        (row) =>
          row.scope.workspaceId === scope.workspaceId &&
          row.scope.projectId === scope.projectId &&
          row.scope.agentId === scope.agentId &&
          row.scope.visibility === scope.visibility,
      );
    }
    if (filter?.tenantId) {
      rows = rows.filter((row) => row.subject.tenantId === filter.tenantId);
    }
    if (filter?.ownerType) {
      rows = rows.filter((row) => row.subject.ownerType === filter.ownerType);
    }
    if (filter?.ownerId) {
      rows = rows.filter((row) => row.subject.ownerId === filter.ownerId);
    }
    if (filter?.dataPlaneId) {
      rows = rows.filter((row) => row.partition.dataPlaneId === filter.dataPlaneId);
    }
    if (filter?.scopeFingerprint) {
      rows = rows.filter((row) => row.partition.scopeFingerprint === filter.scopeFingerprint);
    }
    if (filter?.liveOnly) {
      rows = rows.filter((row) => !row.unboundAt);
    }
    return rows;
  }

  async deleteMemorySubjectBinding(id: string): Promise<void> {
    this.memorySubjectBindings.delete(id);
  }

  async deleteJournal(journalId: string): Promise<void> {
    this.journals.delete(journalId);
  }
}

export class InMemoryGraphStore implements GraphStore {
  private readonly nodes = new Map<string, { nodeType: string }>();
  private readonly edges = new Map<
    string,
    { fromId: string; toId: string; relationType: string }
  >();

  async syncFromDistillation(
    result: DistillationResult,
  ): Promise<{ nodeCount: number; edgeCount: number }> {
    for (const nodeId of result.writePlan.graphNodeIds) {
      this.nodes.set(nodeId, { nodeType: "derived" });
    }
    for (const relation of result.relations) {
      this.edges.set(relation.id, {
        fromId: relation.fromId,
        toId: relation.toId,
        relationType: relation.relationType,
      });
    }
    return { nodeCount: result.writePlan.graphNodeIds.length, edgeCount: result.relations.length };
  }

  async rebuildFromBundle(
    bundle: MetadataBundle,
  ): Promise<{ nodeCount: number; edgeCount: number }> {
    for (const event of bundle.events) {
      this.nodes.set(event.id, { nodeType: "EventSkeleton" });
    }
    for (const atom of bundle.atoms) {
      this.nodes.set(atom.id, { nodeType: "MemoryAtom" });
    }
    for (const entity of bundle.entities) {
      this.nodes.set(entity.id, { nodeType: "Entity" });
    }
    for (const scenario of bundle.scenarios) {
      this.nodes.set(scenario.id, { nodeType: "Scenario" });
    }
    for (const problem of bundle.problems) {
      this.nodes.set(problem.id, { nodeType: "Problem" });
    }
    for (const evidence of bundle.evidence) {
      this.nodes.set(evidence.id, { nodeType: "Evidence" });
    }
    for (const relation of bundle.relations) {
      this.edges.set(relation.id, {
        fromId: relation.fromId,
        toId: relation.toId,
        relationType: relation.relationType,
      });
    }
    return {
      nodeCount:
        bundle.events.length +
        bundle.atoms.length +
        bundle.entities.length +
        bundle.scenarios.length +
        bundle.problems.length +
        bundle.evidence.length,
      edgeCount: bundle.relations.length,
    };
  }
}

export class InMemoryVectorStore implements VectorStore {
  private readonly documents = new Map<string, string>();

  async syncFromDistillation(result: DistillationResult): Promise<{ documentCount: number }> {
    this.documents.set(result.event.id, `${result.event.goal}\n${result.event.context}`);
    for (const atom of result.atoms) {
      this.documents.set(atom.id, atom.claim.statement);
    }
    for (const entity of result.entities) {
      this.documents.set(entity.id, `${entity.name} ${entity.aliases.join(" ")}`.trim());
    }
    return { documentCount: result.writePlan.vectorDocumentIds.length };
  }

  async rebuildFromBundle(bundle: MetadataBundle): Promise<{ documentCount: number }> {
    for (const event of bundle.events) {
      this.documents.set(event.id, `${event.goal}\n${event.context}`);
    }
    for (const atom of bundle.atoms) {
      this.documents.set(atom.id, atom.claim.statement);
    }
    for (const entity of bundle.entities) {
      this.documents.set(entity.id, `${entity.name} ${entity.aliases.join(" ")}`.trim());
    }
    return { documentCount: bundle.events.length + bundle.atoms.length + bundle.entities.length };
  }

  /** CW2-P4-02 lexical stub until real embeddings are wired. */
  async search(params: {
    query: string;
    scope?: Scope;
    limit?: number;
  }): Promise<VectorSearchHit[]> {
    const limit = params.limit ?? 20;
    return [...this.documents.entries()]
      .map(([id, content]) => ({
        id,
        score: scoreDocumentLexical(params.query, content),
        sourceType: "atom",
      }))
      .filter((hit) => hit.score > 0)
      .toSorted((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  async delete(ids: string[]): Promise<number> {
    let removed = 0;
    for (const id of ids) {
      if (this.documents.delete(id)) {
        removed += 1;
      }
    }
    return removed;
  }
}
