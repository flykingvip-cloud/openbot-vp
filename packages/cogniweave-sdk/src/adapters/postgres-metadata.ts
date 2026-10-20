import { AsyncLocalStorage } from "node:async_hooks";
import { StorageConsistencyError } from "../errors.js";
import { createDataPlaneId } from "../keys.js";
import type {
  EntityRecord,
  EventSkeleton,
  EvidenceRecord,
  MemoryAtom,
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
import type {
  MetadataBundle,
  MetadataStore,
  PersistedSourceLifecycleReceipt,
} from "../storage/types.js";
import type { AdapterDescriptor, BackendAdapterConfig } from "./contracts.js";

interface PayloadRow {
  payload: unknown;
}

export interface PostgresQueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount: number;
}

export interface PostgresSqlTransaction {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>;
}

export interface PostgresSqlClient {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>;
  transaction?<T>(runner: (transaction: PostgresSqlTransaction) => Promise<T>): Promise<T>;
}

export interface PostgresMetadataStoreConfig extends BackendAdapterConfig {
  client?: PostgresSqlClient;
  schema?: string;
}

export interface PostgresSchemaBootstrapResult {
  schema: string;
  statementsExecuted: number;
}

export interface PostgresMetadataTables {
  meta: string;
  ingestions: string;
  events: string;
  atoms: string;
  atomDedupBindings: string;
  entities: string;
  scenarios: string;
  problems: string;
  evidence: string;
  relations: string;
  journals: string;
  sourceBindings: string;
  sourceLifecycleOperations: string;
  sourceObjectLinks: string;
  writeOperations: string;
}

export const POSTGRES_METADATA_TABLES: PostgresMetadataTables = {
  meta: "cogniweave_meta",
  ingestions: "cogniweave_ingestions",
  events: "cogniweave_events",
  atoms: "cogniweave_atoms",
  atomDedupBindings: "cogniweave_atom_dedup_bindings",
  entities: "cogniweave_entities",
  scenarios: "cogniweave_scenarios",
  problems: "cogniweave_problems",
  evidence: "cogniweave_evidence",
  relations: "cogniweave_relations",
  journals: "cogniweave_journals",
  sourceBindings: "cogniweave_source_bindings",
  sourceLifecycleOperations: "cogniweave_source_lifecycle_operations",
  sourceObjectLinks: "cogniweave_source_object_links",
  writeOperations: "cogniweave_write_operations",
};

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function encodePayload(value: unknown): string {
  return JSON.stringify(value);
}

function decodePayload<T>(row?: PayloadRow): T | undefined {
  if (!row) {
    return undefined;
  }
  if (typeof row.payload === "string") {
    return JSON.parse(row.payload) as T;
  }
  return row.payload as T;
}

function requireResult<Row>(
  result: PostgresQueryResult<Row>,
  method: string,
): PostgresQueryResult<Row> {
  if (!Array.isArray(result.rows)) {
    throw new StorageConsistencyError(
      `Postgres metadata adapter returned malformed rows for ${method}`,
    );
  }
  return result;
}

export function buildPostgresMetadataSchema(schema = "public"): string[] {
  const s = quoteIdentifier(schema);
  const t = (name: string) => `${s}.${quoteIdentifier(name)}`;

  return [
    `create schema if not exists ${s};`,
    `create table if not exists ${t(POSTGRES_METADATA_TABLES.ingestions)} (
      ingestion_id text primary key,
      ingestion_checksum text not null,
      status text not null,
      payload jsonb not null,
      created_at timestamptz not null default now()
    );`,
    `create table if not exists ${t(POSTGRES_METADATA_TABLES.events)} (
      id text primary key,
      event_key text unique,
      workspace_id text not null,
      project_id text not null,
      agent_id text not null,
      payload jsonb not null,
      updated_at timestamptz not null default now()
    );`,
    `create table if not exists ${t(POSTGRES_METADATA_TABLES.atoms)} (
      id text primary key,
      dedup_key text,
      workspace_id text not null,
      project_id text not null,
      agent_id text not null,
      status text not null,
      version int not null,
      payload jsonb not null,
      updated_at timestamptz not null default now()
    );`,
    `create table if not exists ${t(POSTGRES_METADATA_TABLES.atomDedupBindings)} (
      dedup_key text not null,
      atom_id text not null references ${t(POSTGRES_METADATA_TABLES.atoms)}(id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (dedup_key, atom_id)
    );`,
    `create table if not exists ${t(POSTGRES_METADATA_TABLES.entities)} (
      id text primary key,
      entity_key text,
      workspace_id text not null,
      project_id text not null,
      agent_id text not null,
      payload jsonb not null,
      updated_at timestamptz not null default now()
    );`,
    `create table if not exists ${t(POSTGRES_METADATA_TABLES.scenarios)} (
      id text primary key,
      scenario_key text,
      workspace_id text not null,
      project_id text not null,
      agent_id text not null,
      payload jsonb not null,
      updated_at timestamptz not null default now()
    );`,
    `create table if not exists ${t(POSTGRES_METADATA_TABLES.problems)} (
      id text primary key,
      problem_key text,
      workspace_id text not null,
      project_id text not null,
      agent_id text not null,
      payload jsonb not null,
      updated_at timestamptz not null default now()
    );`,
    `create table if not exists ${t(POSTGRES_METADATA_TABLES.evidence)} (
      id text primary key,
      checksum text,
      workspace_id text not null,
      project_id text not null,
      agent_id text not null,
      payload jsonb not null,
      updated_at timestamptz not null default now()
    );`,
    `create table if not exists ${t(POSTGRES_METADATA_TABLES.relations)} (
      id text primary key,
      relation_type text not null,
      from_id text not null,
      to_id text not null,
      workspace_id text not null,
      project_id text not null,
      agent_id text not null,
      payload jsonb not null,
      updated_at timestamptz not null default now()
    );`,
    `create table if not exists ${t(POSTGRES_METADATA_TABLES.journals)} (
      id text primary key,
      event_key text not null,
      status text not null,
      phase text not null,
      payload jsonb not null,
      updated_at timestamptz not null default now()
    );`,
    `create table if not exists ${t(POSTGRES_METADATA_TABLES.meta)} (
      key text primary key,
      value text not null
    );`,
    `create table if not exists ${t(POSTGRES_METADATA_TABLES.sourceBindings)} (
      id text primary key,
      source_identity_id text not null,
      source_locator text not null,
      status text not null,
      workspace_id text not null,
      project_id text not null,
      agent_id text not null,
      visibility text not null,
      payload jsonb not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );`,
    `create table if not exists ${t(POSTGRES_METADATA_TABLES.sourceLifecycleOperations)} (
      operation_id text primary key,
      source_binding_id text not null,
      source_identity_id text not null,
      previous_status text not null,
      current_status text not null,
      affected_object_count integer not null,
      payload jsonb not null,
      completed_at timestamptz not null
    );`,
    `create table if not exists ${t(POSTGRES_METADATA_TABLES.sourceObjectLinks)} (
      id text primary key,
      source_binding_id text not null,
      object_type text not null,
      object_id text not null,
      link_role text not null,
      unlinked_at timestamptz,
      payload jsonb not null,
      created_at timestamptz not null,
      unique (source_binding_id, object_type, object_id)
    );`,
    `create table if not exists ${t(POSTGRES_METADATA_TABLES.writeOperations)} (
      write_operation_key text primary key,
      kind text not null,
      payload jsonb not null,
      completed_at timestamptz not null
    );`,
    `create index if not exists idx_cogniweave_source_bindings_identity
      on ${t(POSTGRES_METADATA_TABLES.sourceBindings)}(source_identity_id);`,
    `create index if not exists idx_cogniweave_source_bindings_locator
      on ${t(POSTGRES_METADATA_TABLES.sourceBindings)}(source_locator);`,
    `create index if not exists idx_cogniweave_source_object_links_binding
      on ${t(POSTGRES_METADATA_TABLES.sourceObjectLinks)}(source_binding_id);`,
    `create index if not exists idx_cogniweave_source_object_links_object
      on ${t(POSTGRES_METADATA_TABLES.sourceObjectLinks)}(object_type, object_id);`,
  ];
}

export class PostgresMetadataStore implements MetadataStore {
  readonly descriptor: AdapterDescriptor;
  readonly schema: string;
  readonly tables: PostgresMetadataTables;

  private readonly client?: PostgresSqlClient;
  private readonly transactionContext = new AsyncLocalStorage<PostgresSqlTransaction>();

  constructor(config: PostgresMetadataStoreConfig) {
    this.schema = config.schema ?? "public";
    this.client = config.client;
    this.tables = POSTGRES_METADATA_TABLES;
    this.descriptor = {
      kind: "metadata",
      backend: config.backend,
      environment: config.environment,
      capabilities: [
        "canonical-read",
        "canonical-write",
        "journal",
        "schema-bootstrap",
        "restart-safe",
      ],
    };
  }

  getSchemaStatements(): string[] {
    return buildPostgresMetadataSchema(this.schema);
  }

  async withTransaction<T>(runner: () => Promise<T>): Promise<T> {
    const current = this.transactionContext.getStore();
    if (current) {
      return runner();
    }
    if (this.client?.transaction) {
      return this.client.transaction((transaction) =>
        this.transactionContext.run(transaction, runner),
      );
    }
    return runner();
  }

  async bootstrapSchema(): Promise<PostgresSchemaBootstrapResult> {
    const statements = this.getSchemaStatements();
    await this.runInTransaction(async (client) => {
      for (const statement of statements) {
        await client.query(statement, []);
      }
    });
    return {
      schema: this.schema,
      statementsExecuted: statements.length,
    };
  }

  async saveIngestion(result: {
    ingestionId: string;
    ingestionChecksum: string;
    status: "RECEIVED";
  }): Promise<void> {
    await this.query(
      `insert into ${this.table(this.tables.ingestions)} (ingestion_id, ingestion_checksum, status, payload)
       values ($1, $2, $3, $4::jsonb)
       on conflict (ingestion_id) do update
       set ingestion_checksum = excluded.ingestion_checksum,
           status = excluded.status,
           payload = excluded.payload`,
      [result.ingestionId, result.ingestionChecksum, result.status, encodePayload(result)],
      "saveIngestion",
    );
  }

  async upsertEvent(event: EventSkeleton): Promise<EventSkeleton> {
    await this.query(
      `insert into ${this.table(this.tables.events)}
        (id, event_key, workspace_id, project_id, agent_id, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb)
       on conflict (id) do update
       set event_key = excluded.event_key,
           workspace_id = excluded.workspace_id,
           project_id = excluded.project_id,
           agent_id = excluded.agent_id,
           payload = excluded.payload,
           updated_at = now()`,
      [
        event.id,
        event.eventKey ?? null,
        event.scope.workspaceId,
        event.scope.projectId,
        event.scope.agentId,
        encodePayload(event),
      ],
      "upsertEvent",
    );
    return event;
  }

  async getEvent(eventId: string): Promise<EventSkeleton | undefined> {
    return this.getPayloadById<EventSkeleton>(this.tables.events, eventId, "getEvent");
  }

  async findEventByKey(eventKey: string): Promise<EventSkeleton | undefined> {
    const result = await this.query<PayloadRow>(
      `select payload
       from ${this.table(this.tables.events)}
       where event_key = $1
       limit 1`,
      [eventKey],
      "findEventByKey",
    );
    return decodePayload<EventSkeleton>(result.rows[0]);
  }

  async listEvents(): Promise<EventSkeleton[]> {
    return this.listPayloads<EventSkeleton>(this.tables.events, "listEvents");
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.query(
      `delete from ${this.table(this.tables.events)} where id = $1`,
      [eventId],
      "deleteEvent",
    );
  }

  async getAtom(atomId: string): Promise<MemoryAtom | undefined> {
    return this.getPayloadById<MemoryAtom>(this.tables.atoms, atomId, "getAtom");
  }

  async listAtoms(): Promise<MemoryAtom[]> {
    return this.listPayloads<MemoryAtom>(this.tables.atoms, "listAtoms");
  }

  async findAtomsByDedupKey(dedupKey: string): Promise<MemoryAtom[]> {
    const result = await this.query<PayloadRow>(
      `select a.payload
       from ${this.table(this.tables.atomDedupBindings)} b
       join ${this.table(this.tables.atoms)} a on a.id = b.atom_id
       where b.dedup_key = $1`,
      [dedupKey],
      "findAtomsByDedupKey",
    );
    return result.rows.flatMap((row) => {
      const atom = decodePayload<MemoryAtom>(row);
      return atom ? [atom] : [];
    });
  }

  async saveAtom(atom: MemoryAtom): Promise<void> {
    await this.query(
      `insert into ${this.table(this.tables.atoms)}
        (id, dedup_key, workspace_id, project_id, agent_id, status, version, payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       on conflict (id) do update
       set dedup_key = excluded.dedup_key,
           workspace_id = excluded.workspace_id,
           project_id = excluded.project_id,
           agent_id = excluded.agent_id,
           status = excluded.status,
           version = excluded.version,
           payload = excluded.payload,
           updated_at = now()`,
      [
        atom.id,
        atom.dedupKey ?? null,
        atom.scope.workspaceId,
        atom.scope.projectId,
        atom.scope.agentId,
        atom.state.status,
        atom.versioning.version,
        encodePayload(atom),
      ],
      "saveAtom",
    );
  }

  async deleteAtom(atomId: string): Promise<void> {
    await this.query(
      `delete from ${this.table(this.tables.atoms)}
       where id = $1`,
      [atomId],
      "deleteAtom",
    );
  }

  async bindDedupKey(dedupKey: string, atomId: string): Promise<void> {
    await this.query(
      `insert into ${this.table(this.tables.atomDedupBindings)} (dedup_key, atom_id)
       values ($1, $2)
       on conflict (dedup_key, atom_id) do nothing`,
      [dedupKey, atomId],
      "bindDedupKey",
    );
  }

  async saveEntity(entity: EntityRecord): Promise<void> {
    await this.upsertScopedPayload(
      this.tables.entities,
      entity.id,
      entity,
      entity.entityKey ?? null,
      "saveEntity",
    );
  }

  async saveScenario(scenario: ScenarioRecord): Promise<void> {
    await this.upsertScopedPayload(
      this.tables.scenarios,
      scenario.id,
      scenario,
      scenario.scenarioKey ?? null,
      "saveScenario",
    );
  }

  async saveProblem(problem: ProblemRecord): Promise<void> {
    await this.upsertScopedPayload(
      this.tables.problems,
      problem.id,
      problem,
      problem.problemKey ?? null,
      "saveProblem",
    );
  }

  async saveEvidence(evidence: EvidenceRecord): Promise<void> {
    await this.query(
      `insert into ${this.table(this.tables.evidence)}
        (id, checksum, workspace_id, project_id, agent_id, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb)
       on conflict (id) do update
       set checksum = excluded.checksum,
           workspace_id = excluded.workspace_id,
           project_id = excluded.project_id,
           agent_id = excluded.agent_id,
           payload = excluded.payload,
           updated_at = now()`,
      [
        evidence.id,
        evidence.checksum ?? null,
        evidence.scope.workspaceId,
        evidence.scope.projectId,
        evidence.scope.agentId,
        encodePayload(evidence),
      ],
      "saveEvidence",
    );
  }

  async saveRelation(relation: RelationRecord): Promise<void> {
    await this.query(
      `insert into ${this.table(this.tables.relations)}
        (id, relation_type, from_id, to_id, workspace_id, project_id, agent_id, payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       on conflict (id) do update
       set relation_type = excluded.relation_type,
           from_id = excluded.from_id,
           to_id = excluded.to_id,
           workspace_id = excluded.workspace_id,
           project_id = excluded.project_id,
           agent_id = excluded.agent_id,
           payload = excluded.payload,
           updated_at = now()`,
      [
        relation.id,
        relation.relationType,
        relation.fromId,
        relation.toId,
        relation.scope.workspaceId,
        relation.scope.projectId,
        relation.scope.agentId,
        encodePayload(relation),
      ],
      "saveRelation",
    );
  }

  async getEvidence(evidenceId: string): Promise<EvidenceRecord | undefined> {
    return this.getPayloadById<EvidenceRecord>(this.tables.evidence, evidenceId, "getEvidence");
  }

  async listEvidence(): Promise<EvidenceRecord[]> {
    return this.listPayloads<EvidenceRecord>(this.tables.evidence, "listEvidence");
  }

  async getEntity(entityId: string): Promise<EntityRecord | undefined> {
    return this.getPayloadById<EntityRecord>(this.tables.entities, entityId, "getEntity");
  }

  async listEntities(): Promise<EntityRecord[]> {
    return this.listPayloads<EntityRecord>(this.tables.entities, "listEntities");
  }

  async deleteEntity(entityId: string): Promise<void> {
    await this.query(
      `delete from ${this.table(this.tables.entities)} where id = $1`,
      [entityId],
      "deleteEntity",
    );
  }

  async getScenario(scenarioId: string): Promise<ScenarioRecord | undefined> {
    return this.getPayloadById<ScenarioRecord>(this.tables.scenarios, scenarioId, "getScenario");
  }

  async listScenarios(): Promise<ScenarioRecord[]> {
    return this.listPayloads<ScenarioRecord>(this.tables.scenarios, "listScenarios");
  }

  async deleteScenario(scenarioId: string): Promise<void> {
    await this.query(
      `delete from ${this.table(this.tables.scenarios)} where id = $1`,
      [scenarioId],
      "deleteScenario",
    );
  }

  async getProblem(problemId: string): Promise<ProblemRecord | undefined> {
    return this.getPayloadById<ProblemRecord>(this.tables.problems, problemId, "getProblem");
  }

  async listProblems(): Promise<ProblemRecord[]> {
    return this.listPayloads<ProblemRecord>(this.tables.problems, "listProblems");
  }

  async deleteProblem(problemId: string): Promise<void> {
    await this.query(
      `delete from ${this.table(this.tables.problems)} where id = $1`,
      [problemId],
      "deleteProblem",
    );
  }

  async getRelation(relationId: string): Promise<RelationRecord | undefined> {
    return this.getPayloadById<RelationRecord>(this.tables.relations, relationId, "getRelation");
  }

  async listRelations(): Promise<RelationRecord[]> {
    return this.listPayloads<RelationRecord>(this.tables.relations, "listRelations");
  }

  async deleteRelation(relationId: string): Promise<void> {
    await this.query(
      `delete from ${this.table(this.tables.relations)} where id = $1`,
      [relationId],
      "deleteRelation",
    );
  }

  async putJournal(journal: WriteJournal): Promise<void> {
    await this.query(
      `insert into ${this.table(this.tables.journals)} (id, event_key, status, phase, payload)
       values ($1, $2, $3, $4, $5::jsonb)
       on conflict (id) do update
       set event_key = excluded.event_key,
           status = excluded.status,
           phase = excluded.phase,
           payload = excluded.payload,
           updated_at = now()`,
      [journal.id, journal.eventKey, journal.status, journal.phase, encodePayload(journal)],
      "putJournal",
    );
  }

  async getJournal(journalId: string): Promise<WriteJournal | undefined> {
    return this.getPayloadById<WriteJournal>(this.tables.journals, journalId, "getJournal");
  }

  async listJournals(): Promise<WriteJournal[]> {
    return this.listPayloads<WriteJournal>(this.tables.journals, "listJournals");
  }

  async updateJournal(
    journalId: string,
    patch: Partial<WriteJournal>,
  ): Promise<WriteJournal | undefined> {
    const current = await this.getJournal(journalId);
    if (!current) {
      return undefined;
    }
    const next = { ...current, ...patch };
    await this.putJournal(next);
    return next;
  }

  async getBundleForJournal(journal: WriteJournal): Promise<MetadataBundle> {
    return {
      events: await this.getPayloadsByIds<EventSkeleton>(
        this.tables.events,
        journal.objectIds.eventIds,
        "bundle.events",
      ),
      atoms: await this.getPayloadsByIds<MemoryAtom>(
        this.tables.atoms,
        journal.objectIds.atomIds,
        "bundle.atoms",
      ),
      entities: await this.getPayloadsByIds<EntityRecord>(
        this.tables.entities,
        journal.objectIds.entityIds,
        "bundle.entities",
      ),
      scenarios: await this.getPayloadsByIds<ScenarioRecord>(
        this.tables.scenarios,
        journal.objectIds.scenarioIds,
        "bundle.scenarios",
      ),
      problems: await this.getPayloadsByIds<ProblemRecord>(
        this.tables.problems,
        journal.objectIds.problemIds,
        "bundle.problems",
      ),
      evidence: await this.getPayloadsByIds<EvidenceRecord>(
        this.tables.evidence,
        journal.objectIds.evidenceIds,
        "bundle.evidence",
      ),
      relations: await this.getPayloadsByIds<RelationRecord>(
        this.tables.relations,
        journal.objectIds.relationIds,
        "bundle.relations",
      ),
    };
  }

  async saveSourceBinding(binding: SourceBinding): Promise<void> {
    await this.query(
      `insert into ${this.table(this.tables.sourceBindings)}
        (id, source_identity_id, source_locator, status, workspace_id, project_id, agent_id, visibility, payload, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz, $11::timestamptz)
       on conflict (id) do update
       set source_identity_id = excluded.source_identity_id,
           source_locator = excluded.source_locator,
           status = excluded.status,
           workspace_id = excluded.workspace_id,
           project_id = excluded.project_id,
           agent_id = excluded.agent_id,
           visibility = excluded.visibility,
           payload = excluded.payload,
           updated_at = excluded.updated_at`,
      [
        binding.id,
        binding.sourceIdentityId,
        binding.sourceLocator,
        binding.status,
        binding.scope.workspaceId,
        binding.scope.projectId,
        binding.scope.agentId,
        binding.scope.visibility,
        encodePayload(binding),
        binding.createdAt,
        binding.updatedAt,
      ],
      "saveSourceBinding",
    );
  }

  async getSourceBinding(id: string): Promise<SourceBinding | undefined> {
    return this.getPayloadById<SourceBinding>(this.tables.sourceBindings, id, "getSourceBinding");
  }

  async listSourceBindings(scope?: Scope): Promise<SourceBinding[]> {
    if (!scope) {
      return this.listPayloads<SourceBinding>(this.tables.sourceBindings, "listSourceBindings");
    }
    const result = await this.query<PayloadRow>(
      `select payload from ${this.table(this.tables.sourceBindings)}
       where workspace_id = $1 and project_id = $2 and agent_id = $3 and visibility = $4
       order by updated_at asc, id asc`,
      [scope.workspaceId, scope.projectId, scope.agentId, scope.visibility],
      "listSourceBindings",
    );
    return result.rows.flatMap((row) => {
      const payload = decodePayload<SourceBinding>(row);
      return payload ? [payload] : [];
    });
  }

  async findSourceBindingByIdentity(sourceIdentityId: string): Promise<SourceBinding | undefined> {
    const result = await this.query<PayloadRow>(
      `select payload from ${this.table(this.tables.sourceBindings)}
       where source_identity_id = $1
       limit 1`,
      [sourceIdentityId],
      "findSourceBindingByIdentity",
    );
    return decodePayload<SourceBinding>(result.rows[0]);
  }

  async findSourceBindingByLocator(sourceLocator: string): Promise<SourceBinding | undefined> {
    const result = await this.query<PayloadRow>(
      `select payload from ${this.table(this.tables.sourceBindings)}
       where source_locator = $1
       limit 1`,
      [sourceLocator],
      "findSourceBindingByLocator",
    );
    return decodePayload<SourceBinding>(result.rows[0]);
  }

  async putSourceLifecycleReceipt(receipt: PersistedSourceLifecycleReceipt): Promise<void> {
    await this.query(
      `insert into ${this.table(this.tables.sourceLifecycleOperations)}
        (operation_id, source_binding_id, source_identity_id, previous_status, current_status, affected_object_count, payload, completed_at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)
       on conflict (operation_id) do update
       set source_binding_id = excluded.source_binding_id,
           source_identity_id = excluded.source_identity_id,
           previous_status = excluded.previous_status,
           current_status = excluded.current_status,
           affected_object_count = excluded.affected_object_count,
           payload = excluded.payload,
           completed_at = excluded.completed_at`,
      [
        receipt.operationId,
        receipt.sourceBindingId,
        receipt.sourceIdentityId,
        receipt.previousStatus,
        receipt.currentStatus,
        receipt.affectedObjectCount,
        encodePayload(receipt),
        receipt.completedAt,
      ],
      "putSourceLifecycleReceipt",
    );
  }

  async getSourceLifecycleReceipt(
    operationId: string,
  ): Promise<PersistedSourceLifecycleReceipt | undefined> {
    const result = await this.query<PayloadRow>(
      `select payload from ${this.table(this.tables.sourceLifecycleOperations)}
       where operation_id = $1
       limit 1`,
      [operationId],
      "getSourceLifecycleReceipt",
    );
    return decodePayload<PersistedSourceLifecycleReceipt>(result.rows[0]);
  }

  async listSourceLifecycleReceipts(): Promise<PersistedSourceLifecycleReceipt[]> {
    const result = await this.query<PayloadRow>(
      `select payload from ${this.table(this.tables.sourceLifecycleOperations)}
       order by completed_at asc, operation_id asc`,
      [],
      "listSourceLifecycleReceipts",
    );
    return result.rows.flatMap((row) => {
      const payload = decodePayload<PersistedSourceLifecycleReceipt>(row);
      return payload ? [payload] : [];
    });
  }

  async saveSourceObjectLink(link: SourceObjectLink): Promise<void> {
    await this.query(
      `insert into ${this.table(this.tables.sourceObjectLinks)}
        (id, source_binding_id, object_type, object_id, link_role, unlinked_at, payload, created_at)
       values ($1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb, $8::timestamptz)
       on conflict (id) do update
       set source_binding_id = excluded.source_binding_id,
           object_type = excluded.object_type,
           object_id = excluded.object_id,
           link_role = excluded.link_role,
           unlinked_at = excluded.unlinked_at,
           payload = excluded.payload`,
      [
        link.id,
        link.sourceBindingId,
        link.objectType,
        link.objectId,
        link.linkRole,
        link.unlinkedAt ?? null,
        encodePayload(link),
        link.createdAt,
      ],
      "saveSourceObjectLink",
    );
  }

  async getSourceObjectLink(id: string): Promise<SourceObjectLink | undefined> {
    return this.getPayloadById<SourceObjectLink>(
      this.tables.sourceObjectLinks,
      id,
      "getSourceObjectLink",
    );
  }

  async listSourceObjectLinks(filter?: {
    sourceBindingId?: string;
    objectType?: SourceObjectType;
    objectId?: string;
    liveOnly?: boolean;
  }): Promise<SourceObjectLink[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter?.sourceBindingId) {
      params.push(filter.sourceBindingId);
      clauses.push(`source_binding_id = $${params.length}`);
    }
    if (filter?.objectType) {
      params.push(filter.objectType);
      clauses.push(`object_type = $${params.length}`);
    }
    if (filter?.objectId) {
      params.push(filter.objectId);
      clauses.push(`object_id = $${params.length}`);
    }
    if (filter?.liveOnly) {
      clauses.push("unlinked_at is null");
    }
    const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
    const result = await this.query<PayloadRow>(
      `select payload from ${this.table(this.tables.sourceObjectLinks)}
       ${where}
       order by created_at asc, id asc`,
      params,
      "listSourceObjectLinks",
    );
    return result.rows.flatMap((row) => {
      const payload = decodePayload<SourceObjectLink>(row);
      return payload ? [payload] : [];
    });
  }

  async deleteSourceObjectLink(id: string): Promise<void> {
    await this.query(
      `delete from ${this.table(this.tables.sourceObjectLinks)} where id = $1`,
      [id],
      "deleteSourceObjectLink",
    );
  }

  async deleteEvidence(evidenceId: string): Promise<void> {
    await this.query(
      `delete from ${this.table(this.tables.evidence)} where id = $1`,
      [evidenceId],
      "deleteEvidence",
    );
  }

  async ensureDataPlaneId(): Promise<string> {
    const existing = await this.getDataPlaneId();
    if (existing) {
      return existing;
    }
    const created = createDataPlaneId();
    await this.query(
      `insert into ${this.table(this.tables.meta)} (key, value)
       values ('data_plane_id', $1)
       on conflict (key) do nothing`,
      [created],
      "ensureDataPlaneId",
    );
    const after = await this.getDataPlaneId();
    return after ?? created;
  }

  async getDataPlaneId(): Promise<string | undefined> {
    const result = await this.query<{ value: string }>(
      `select value from ${this.table(this.tables.meta)}
       where key = 'data_plane_id'
       limit 1`,
      [],
      "getDataPlaneId",
    );
    const value = result.rows[0]?.value?.trim();
    return value ? value : undefined;
  }

  async getWriteOperation(writeOperationKey: string): Promise<WriteOperationRecord | undefined> {
    const result = await this.query<PayloadRow>(
      `select payload from ${this.table(this.tables.writeOperations)}
       where write_operation_key = $1
       limit 1`,
      [writeOperationKey],
      "getWriteOperation",
    );
    return decodePayload<WriteOperationRecord>(result.rows[0]);
  }

  async putWriteOperation(record: WriteOperationRecord): Promise<void> {
    await this.query(
      `insert into ${this.table(this.tables.writeOperations)}
        (write_operation_key, kind, payload, completed_at)
       values ($1, $2, $3::jsonb, $4::timestamptz)
       on conflict (write_operation_key) do update
       set kind = excluded.kind,
           payload = excluded.payload,
           completed_at = excluded.completed_at`,
      [record.writeOperationKey, record.kind, encodePayload(record), record.completedAt],
      "putWriteOperation",
    );
  }

  async listWriteOperations(): Promise<WriteOperationRecord[]> {
    const result = await this.query<PayloadRow>(
      `select payload from ${this.table(this.tables.writeOperations)}
       order by completed_at asc, write_operation_key asc`,
      [],
      "listWriteOperations",
    );
    return result.rows.flatMap((row) => {
      const payload = decodePayload<WriteOperationRecord>(row);
      return payload ? [payload] : [];
    });
  }

  async deleteJournal(journalId: string): Promise<void> {
    await this.query(
      `delete from ${this.table(this.tables.journals)} where id = $1`,
      [journalId],
      "deleteJournal",
    );
  }

  private table(name: string): string {
    return `${quoteIdentifier(this.schema)}.${quoteIdentifier(name)}`;
  }

  private getClient(method: string): PostgresSqlClient {
    if (!this.client) {
      throw new StorageConsistencyError(
        `Postgres metadata backend does not implement ${method}: no SQL client configured`,
      );
    }
    return this.client;
  }

  private async runInTransaction<T>(
    runner: (client: PostgresSqlTransaction) => Promise<T>,
  ): Promise<T> {
    if (this.client?.transaction) {
      return this.client.transaction(runner);
    }
    return runner({
      query: (sql, params) => this.query(sql, params ?? [], "transaction"),
    });
  }

  private async query<Row = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[],
    method: string,
  ): Promise<PostgresQueryResult<Row>> {
    const transaction = this.transactionContext.getStore();
    if (transaction) {
      return requireResult(await transaction.query<Row>(sql, params), method);
    }
    const client = this.getClient(method);
    return requireResult(await client.query<Row>(sql, params), method);
  }

  private async getPayloadById<T>(
    table: string,
    id: string,
    method: string,
  ): Promise<T | undefined> {
    const result = await this.query<PayloadRow>(
      `select payload
       from ${this.table(table)}
       where id = $1
       limit 1`,
      [id],
      method,
    );
    return decodePayload<T>(result.rows[0]);
  }

  private async getPayloadsByIds<T>(table: string, ids: string[], method: string): Promise<T[]> {
    if (ids.length === 0) {
      return [];
    }
    const result = await this.query<PayloadRow>(
      `select payload
       from ${this.table(table)}
       where id = any($1::text[])`,
      [ids],
      method,
    );
    return result.rows.flatMap((row) => {
      const payload = decodePayload<T>(row);
      return payload ? [payload] : [];
    });
  }

  private async listPayloads<T>(table: string, method: string): Promise<T[]> {
    const result = await this.query<PayloadRow>(
      `select payload
       from ${this.table(table)}`,
      [],
      method,
    );
    return result.rows.flatMap((row) => {
      const payload = decodePayload<T>(row);
      return payload ? [payload] : [];
    });
  }

  private async upsertScopedPayload<
    T extends { scope: { workspaceId: string; projectId: string; agentId: string } },
  >(
    table: string,
    id: string,
    payload: T,
    naturalKey: string | null,
    method: string,
  ): Promise<void> {
    const keyColumn =
      table === this.tables.entities
        ? "entity_key"
        : table === this.tables.scenarios
          ? "scenario_key"
          : "problem_key";
    await this.query(
      `insert into ${this.table(table)}
        (id, ${keyColumn}, workspace_id, project_id, agent_id, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb)
       on conflict (id) do update
       set ${keyColumn} = excluded.${keyColumn},
           workspace_id = excluded.workspace_id,
           project_id = excluded.project_id,
           agent_id = excluded.agent_id,
           payload = excluded.payload,
           updated_at = now()`,
      [
        id,
        naturalKey,
        payload.scope.workspaceId,
        payload.scope.projectId,
        payload.scope.agentId,
        encodePayload(payload),
      ],
      method,
    );
  }
}
