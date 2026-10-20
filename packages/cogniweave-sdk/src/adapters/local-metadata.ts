import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { StorageConsistencyError } from "../errors.js";
import { createDataPlaneId } from "../keys.js";
import type {
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
import { DEFAULT_QUERY_EXCLUDE_STATUSES } from "../retrieval/lifecycle-gate.js";
import type {
  MetadataBundle,
  MetadataQueryFilter,
  MetadataStore,
  PersistedSourceLifecycleReceipt,
} from "../storage/types.js";
import type { AdapterDescriptor, BackendAdapterConfig } from "./contracts.js";

const require = createRequire(import.meta.url);

interface PayloadRow {
  payload: string;
}

interface LocalMetadataRow {
  payload: string;
}

export interface LocalMetadataStoreConfig extends BackendAdapterConfig {
  path: string;
}

export interface LocalMetadataBootstrapResult {
  path: string;
  statementsExecuted: number;
}

export interface LocalMetadataTables {
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
  memorySubjectBindings: string;
}

export const LOCAL_METADATA_TABLES: LocalMetadataTables = {
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
  memorySubjectBindings: "cogniweave_memory_subject_bindings",
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
  return JSON.parse(row.payload) as T;
}

function asPayloadRows(rows: unknown[], method: string): LocalMetadataRow[] {
  for (const row of rows) {
    if (
      typeof row !== "object" ||
      row === null ||
      typeof (row as { payload?: unknown }).payload !== "string"
    ) {
      throw new StorageConsistencyError(
        `Local metadata adapter returned malformed payload rows for ${method}`,
      );
    }
  }
  return rows as LocalMetadataRow[];
}

function requireNodeSqlite(): typeof import("node:sqlite") {
  try {
    return require("node:sqlite") as typeof import("node:sqlite");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new StorageConsistencyError(
      `Local metadata backend requires Node SQLite support (node:sqlite): ${message}`,
    );
  }
}

export function buildLocalMetadataSchema(): string[] {
  const t = (name: string) => quoteIdentifier(name);
  return [
    `create table if not exists ${t(LOCAL_METADATA_TABLES.meta)} (
      key text primary key,
      value text not null
    );`,
    `create table if not exists ${t(LOCAL_METADATA_TABLES.ingestions)} (
      ingestion_id text primary key,
      ingestion_checksum text not null,
      status text not null,
      payload text not null,
      created_at integer not null
    );`,
    `create table if not exists ${t(LOCAL_METADATA_TABLES.events)} (
      id text primary key,
      event_key text unique,
      workspace_id text not null,
      project_id text not null,
      agent_id text not null,
      visibility text not null,
      payload text not null,
      updated_at integer not null
    );`,
    `create table if not exists ${t(LOCAL_METADATA_TABLES.atoms)} (
      id text primary key,
      dedup_key text,
      workspace_id text not null,
      project_id text not null,
      agent_id text not null,
      visibility text not null,
      status text not null,
      version integer not null,
      payload text not null,
      updated_at integer not null
    );`,
    `create table if not exists ${t(LOCAL_METADATA_TABLES.atomDedupBindings)} (
      dedup_key text not null,
      atom_id text not null,
      created_at integer not null,
      primary key (dedup_key, atom_id),
      foreign key (atom_id) references ${t(LOCAL_METADATA_TABLES.atoms)}(id) on delete cascade
    );`,
    `create table if not exists ${t(LOCAL_METADATA_TABLES.entities)} (
      id text primary key,
      entity_key text,
      workspace_id text not null,
      project_id text not null,
      agent_id text not null,
      visibility text not null,
      payload text not null,
      updated_at integer not null
    );`,
    `create table if not exists ${t(LOCAL_METADATA_TABLES.scenarios)} (
      id text primary key,
      scenario_key text,
      workspace_id text not null,
      project_id text not null,
      agent_id text not null,
      visibility text not null,
      payload text not null,
      updated_at integer not null
    );`,
    `create table if not exists ${t(LOCAL_METADATA_TABLES.problems)} (
      id text primary key,
      problem_key text,
      workspace_id text not null,
      project_id text not null,
      agent_id text not null,
      visibility text not null,
      payload text not null,
      updated_at integer not null
    );`,
    `create table if not exists ${t(LOCAL_METADATA_TABLES.evidence)} (
      id text primary key,
      checksum text,
      type text not null,
      uri text not null,
      workspace_id text not null,
      project_id text not null,
      agent_id text not null,
      visibility text not null,
      payload text not null,
      updated_at integer not null
    );`,
    `create table if not exists ${t(LOCAL_METADATA_TABLES.relations)} (
      id text primary key,
      relation_type text not null,
      from_id text not null,
      to_id text not null,
      workspace_id text not null,
      project_id text not null,
      agent_id text not null,
      visibility text not null,
      payload text not null,
      updated_at integer not null
    );`,
    `create table if not exists ${t(LOCAL_METADATA_TABLES.journals)} (
      id text primary key,
      event_key text not null,
      status text not null,
      phase text not null,
      payload text not null,
      updated_at integer not null
    );`,
    `create table if not exists ${t(LOCAL_METADATA_TABLES.sourceBindings)} (
      id text primary key,
      source_identity_id text not null,
      source_locator text not null,
      status text not null,
      workspace_id text not null,
      project_id text not null,
      agent_id text not null,
      visibility text not null,
      payload text not null,
      created_at text not null,
      updated_at text not null
    );`,
    `create table if not exists ${t(LOCAL_METADATA_TABLES.sourceLifecycleOperations)} (
      operation_id text primary key,
      source_binding_id text not null,
      source_identity_id text not null,
      previous_status text not null,
      current_status text not null,
      affected_object_count integer not null,
      payload text not null,
      completed_at text not null
    );`,
    `create table if not exists ${t(LOCAL_METADATA_TABLES.sourceObjectLinks)} (
      id text primary key,
      source_binding_id text not null,
      object_type text not null,
      object_id text not null,
      link_role text not null,
      unlinked_at text,
      payload text not null,
      created_at text not null,
      unique (source_binding_id, object_type, object_id)
    );`,
    `create index if not exists idx_cogniweave_events_key on ${t(LOCAL_METADATA_TABLES.events)}(event_key);`,
    `create index if not exists idx_cogniweave_atoms_dedup on ${t(LOCAL_METADATA_TABLES.atoms)}(dedup_key);`,
    `create index if not exists idx_cogniweave_atoms_scope on ${t(LOCAL_METADATA_TABLES.atoms)}(workspace_id, project_id, agent_id, visibility);`,
    `create index if not exists idx_cogniweave_evidence_scope on ${t(LOCAL_METADATA_TABLES.evidence)}(workspace_id, project_id, agent_id, visibility);`,
    `create index if not exists idx_cogniweave_journals_status on ${t(LOCAL_METADATA_TABLES.journals)}(status, phase);`,
    `create index if not exists idx_cogniweave_source_bindings_identity on ${t(LOCAL_METADATA_TABLES.sourceBindings)}(source_identity_id);`,
    `create index if not exists idx_cogniweave_source_bindings_locator on ${t(LOCAL_METADATA_TABLES.sourceBindings)}(source_locator);`,
    `create table if not exists ${t(LOCAL_METADATA_TABLES.writeOperations)} (
      write_operation_key text primary key,
      kind text not null,
      payload text not null,
      completed_at text not null
    );`,
    `create table if not exists ${t(LOCAL_METADATA_TABLES.memorySubjectBindings)} (
      id text primary key,
      data_plane_id text not null,
      scope_fingerprint text not null,
      tenant_id text not null,
      owner_type text not null,
      owner_id text not null,
      workspace_id text not null,
      project_id text not null,
      agent_id text not null,
      visibility text not null,
      unbound_at text,
      payload text not null,
      created_at text not null,
      updated_at text not null
    );`,
    `create index if not exists idx_cogniweave_source_object_links_binding on ${t(LOCAL_METADATA_TABLES.sourceObjectLinks)}(source_binding_id);`,
    `create index if not exists idx_cogniweave_source_object_links_object on ${t(LOCAL_METADATA_TABLES.sourceObjectLinks)}(object_type, object_id);`,
    `create index if not exists idx_cogniweave_subject_bindings_partition on ${t(LOCAL_METADATA_TABLES.memorySubjectBindings)}(data_plane_id, scope_fingerprint);`,
    `create index if not exists idx_cogniweave_subject_bindings_subject on ${t(LOCAL_METADATA_TABLES.memorySubjectBindings)}(tenant_id, owner_type, owner_id);`,
  ];
}

export class LocalMetadataStore implements MetadataStore {
  readonly descriptor: AdapterDescriptor;
  readonly path: string;
  readonly tables = LOCAL_METADATA_TABLES;

  private readonly db: DatabaseSync;
  private transactionDepth = 0;

  constructor(config: LocalMetadataStoreConfig) {
    this.path = config.path;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const { DatabaseSync } = requireNodeSqlite();
    this.db = new DatabaseSync(this.path);
    this.db.exec("pragma foreign_keys = on;");
    this.db.exec("pragma journal_mode = wal;");
    this.db.exec("pragma busy_timeout = 5000;");
    this.bootstrapSchemaSync();
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

  async withTransaction<T>(runner: () => Promise<T>): Promise<T> {
    if (this.transactionDepth > 0) {
      return runner();
    }
    this.transactionDepth += 1;
    this.db.exec("begin immediate;");
    try {
      const result = await runner();
      this.db.exec("commit;");
      return result;
    } catch (error) {
      this.db.exec("rollback;");
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  async bootstrapSchema(): Promise<LocalMetadataBootstrapResult> {
    const statementsExecuted = this.bootstrapSchemaSync();
    return { path: this.path, statementsExecuted };
  }

  async saveIngestion(result: {
    ingestionId: string;
    ingestionChecksum: string;
    status: "RECEIVED";
  }): Promise<void> {
    this.db
      .prepare(
        `insert into ${this.table(this.tables.ingestions)}
          (ingestion_id, ingestion_checksum, status, payload, created_at)
         values (?, ?, ?, ?, ?)
         on conflict (ingestion_id) do update
         set ingestion_checksum = excluded.ingestion_checksum,
             status = excluded.status,
             payload = excluded.payload`,
      )
      .run(
        result.ingestionId,
        result.ingestionChecksum,
        result.status,
        encodePayload(result),
        Date.now(),
      );
  }

  async upsertEvent(event: EventSkeleton): Promise<EventSkeleton> {
    this.db
      .prepare(
        `insert into ${this.table(this.tables.events)}
          (id, event_key, workspace_id, project_id, agent_id, visibility, payload, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (id) do update
         set event_key = excluded.event_key,
             workspace_id = excluded.workspace_id,
             project_id = excluded.project_id,
             agent_id = excluded.agent_id,
             visibility = excluded.visibility,
             payload = excluded.payload,
             updated_at = excluded.updated_at`,
      )
      .run(
        event.id,
        event.eventKey ?? null,
        event.scope.workspaceId,
        event.scope.projectId,
        event.scope.agentId,
        event.scope.visibility,
        encodePayload(event),
        Date.now(),
      );
    return event;
  }

  async getEvent(eventId: string): Promise<EventSkeleton | undefined> {
    return this.getPayloadById<EventSkeleton>(this.tables.events, eventId);
  }

  async findEventByKey(eventKey: string): Promise<EventSkeleton | undefined> {
    const row = this.db
      .prepare(`select payload from ${this.table(this.tables.events)} where event_key = ? limit 1`)
      .get(eventKey) as LocalMetadataRow | undefined;
    return decodePayload<EventSkeleton>(row);
  }

  async listEvents(): Promise<EventSkeleton[]> {
    return this.listPayloads<EventSkeleton>(this.tables.events);
  }

  async deleteEvent(eventId: string): Promise<void> {
    this.db.prepare(`delete from ${this.table(this.tables.events)} where id = ?`).run(eventId);
  }

  async getAtom(atomId: string): Promise<MemoryAtom | undefined> {
    return this.getPayloadById<MemoryAtom>(this.tables.atoms, atomId);
  }

  async listAtoms(): Promise<MemoryAtom[]> {
    return this.listPayloads<MemoryAtom>(this.tables.atoms);
  }

  async findAtomsByDedupKey(dedupKey: string): Promise<MemoryAtom[]> {
    const rawRows = this.db
      .prepare(
        `select a.payload
         from ${this.table(this.tables.atomDedupBindings)} b
         join ${this.table(this.tables.atoms)} a on a.id = b.atom_id
         where b.dedup_key = ?`,
      )
      .all(dedupKey);
    const rows = asPayloadRows(rawRows, "findAtomsByDedupKey");
    return rows.flatMap((row) => {
      const atom = decodePayload<MemoryAtom>(row);
      return atom ? [atom] : [];
    });
  }

  async saveAtom(atom: MemoryAtom): Promise<void> {
    this.db
      .prepare(
        `insert into ${this.table(this.tables.atoms)}
          (id, dedup_key, workspace_id, project_id, agent_id, visibility, status, version, payload, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (id) do update
         set dedup_key = excluded.dedup_key,
             workspace_id = excluded.workspace_id,
             project_id = excluded.project_id,
             agent_id = excluded.agent_id,
             visibility = excluded.visibility,
             status = excluded.status,
             version = excluded.version,
             payload = excluded.payload,
             updated_at = excluded.updated_at`,
      )
      .run(
        atom.id,
        atom.dedupKey ?? null,
        atom.scope.workspaceId,
        atom.scope.projectId,
        atom.scope.agentId,
        atom.scope.visibility,
        atom.state.status,
        atom.versioning.version,
        encodePayload(atom),
        Date.now(),
      );
  }

  async deleteAtom(atomId: string): Promise<void> {
    this.db.prepare(`delete from ${this.table(this.tables.atoms)} where id = ?`).run(atomId);
  }

  async queryAtoms(filter: MetadataQueryFilter): Promise<MemoryAtom[]> {
    const clauses = ["workspace_id = ?", "project_id = ?", "agent_id = ?", "visibility = ?"];
    const params: Array<string | number> = [
      filter.scope.workspaceId,
      filter.scope.projectId,
      filter.scope.agentId,
      filter.scope.visibility,
    ];
    if (filter.statuses && filter.statuses.length > 0) {
      clauses.push(`status in (${filter.statuses.map(() => "?").join(", ")})`);
      params.push(...filter.statuses);
    } else {
      const exclude = filter.excludeStatuses ?? DEFAULT_QUERY_EXCLUDE_STATUSES;
      if (exclude.length > 0) {
        clauses.push(`status not in (${exclude.map(() => "?").join(", ")})`);
        params.push(...exclude);
      }
    }
    if (filter.atomTypes && filter.atomTypes.length > 0) {
      // atom_type is only inside payload — filter after decode when types requested.
    }
    const limit = filter.limit ?? 1000;
    const offset = filter.offset ?? 0;
    params.push(limit, offset);
    const rawRows = this.db
      .prepare(
        `select payload from ${this.table(this.tables.atoms)}
         where ${clauses.join(" and ")}
         order by updated_at desc, rowid desc
         limit ? offset ?`,
      )
      .all(...params);
    const rows = asPayloadRows(rawRows, "queryAtoms");
    let atoms = rows.flatMap((row) => {
      const payload = decodePayload<MemoryAtom>(row);
      return payload ? [payload] : [];
    });
    if (filter.atomTypes && filter.atomTypes.length > 0) {
      const types = new Set(filter.atomTypes);
      atoms = atoms.filter((atom) => types.has(atom.atomType));
    }
    return atoms;
  }

  async bindDedupKey(dedupKey: string, atomId: string): Promise<void> {
    this.db
      .prepare(
        `insert into ${this.table(this.tables.atomDedupBindings)}
          (dedup_key, atom_id, created_at)
         values (?, ?, ?)
         on conflict (dedup_key, atom_id) do nothing`,
      )
      .run(dedupKey, atomId, Date.now());
  }

  async saveEntity(entity: EntityRecord): Promise<void> {
    this.upsertScopedPayload(
      this.tables.entities,
      "entity_key",
      entity.id,
      entity.entityKey ?? null,
      entity,
    );
  }

  async saveScenario(scenario: ScenarioRecord): Promise<void> {
    this.upsertScopedPayload(
      this.tables.scenarios,
      "scenario_key",
      scenario.id,
      scenario.scenarioKey ?? null,
      scenario,
    );
  }

  async saveProblem(problem: ProblemRecord): Promise<void> {
    this.upsertScopedPayload(
      this.tables.problems,
      "problem_key",
      problem.id,
      problem.problemKey ?? null,
      problem,
    );
  }

  async saveEvidence(evidence: EvidenceRecord): Promise<void> {
    this.db
      .prepare(
        `insert into ${this.table(this.tables.evidence)}
          (id, checksum, type, uri, workspace_id, project_id, agent_id, visibility, payload, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (id) do update
         set checksum = excluded.checksum,
             type = excluded.type,
             uri = excluded.uri,
             workspace_id = excluded.workspace_id,
             project_id = excluded.project_id,
             agent_id = excluded.agent_id,
             visibility = excluded.visibility,
             payload = excluded.payload,
             updated_at = excluded.updated_at`,
      )
      .run(
        evidence.id,
        evidence.checksum ?? null,
        evidence.type,
        evidence.uri,
        evidence.scope.workspaceId,
        evidence.scope.projectId,
        evidence.scope.agentId,
        evidence.scope.visibility,
        encodePayload(evidence),
        Date.now(),
      );
  }

  async saveRelation(relation: RelationRecord): Promise<void> {
    this.db
      .prepare(
        `insert into ${this.table(this.tables.relations)}
          (id, relation_type, from_id, to_id, workspace_id, project_id, agent_id, visibility, payload, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (id) do update
         set relation_type = excluded.relation_type,
             from_id = excluded.from_id,
             to_id = excluded.to_id,
             workspace_id = excluded.workspace_id,
             project_id = excluded.project_id,
             agent_id = excluded.agent_id,
             visibility = excluded.visibility,
             payload = excluded.payload,
             updated_at = excluded.updated_at`,
      )
      .run(
        relation.id,
        relation.relationType,
        relation.fromId,
        relation.toId,
        relation.scope.workspaceId,
        relation.scope.projectId,
        relation.scope.agentId,
        relation.scope.visibility,
        encodePayload(relation),
        Date.now(),
      );
  }

  async getEvidence(evidenceId: string): Promise<EvidenceRecord | undefined> {
    return this.getPayloadById<EvidenceRecord>(this.tables.evidence, evidenceId);
  }

  async listEvidence(): Promise<EvidenceRecord[]> {
    return this.listPayloads<EvidenceRecord>(this.tables.evidence);
  }

  async queryEvidence(filter: {
    scope: Scope;
    limit?: number;
    offset?: number;
  }): Promise<EvidenceRecord[]> {
    const limit = filter.limit ?? 1000;
    const offset = filter.offset ?? 0;
    const rawRows = this.db
      .prepare(
        `select payload from ${this.table(this.tables.evidence)}
         where workspace_id = ? and project_id = ? and agent_id = ? and visibility = ?
         order by updated_at desc, rowid desc
         limit ? offset ?`,
      )
      .all(
        filter.scope.workspaceId,
        filter.scope.projectId,
        filter.scope.agentId,
        filter.scope.visibility,
        limit,
        offset,
      );
    const rows = asPayloadRows(rawRows, "queryEvidence");
    return rows.flatMap((row) => {
      const payload = decodePayload<EvidenceRecord>(row);
      return payload ? [payload] : [];
    });
  }

  async getEntity(entityId: string): Promise<EntityRecord | undefined> {
    return this.getPayloadById<EntityRecord>(this.tables.entities, entityId);
  }

  async listEntities(): Promise<EntityRecord[]> {
    return this.listPayloads<EntityRecord>(this.tables.entities);
  }

  async deleteEntity(entityId: string): Promise<void> {
    this.db.prepare(`delete from ${this.table(this.tables.entities)} where id = ?`).run(entityId);
  }

  async getScenario(scenarioId: string): Promise<ScenarioRecord | undefined> {
    return this.getPayloadById<ScenarioRecord>(this.tables.scenarios, scenarioId);
  }

  async listScenarios(): Promise<ScenarioRecord[]> {
    return this.listPayloads<ScenarioRecord>(this.tables.scenarios);
  }

  async deleteScenario(scenarioId: string): Promise<void> {
    this.db
      .prepare(`delete from ${this.table(this.tables.scenarios)} where id = ?`)
      .run(scenarioId);
  }

  async getProblem(problemId: string): Promise<ProblemRecord | undefined> {
    return this.getPayloadById<ProblemRecord>(this.tables.problems, problemId);
  }

  async listProblems(): Promise<ProblemRecord[]> {
    return this.listPayloads<ProblemRecord>(this.tables.problems);
  }

  async deleteProblem(problemId: string): Promise<void> {
    this.db.prepare(`delete from ${this.table(this.tables.problems)} where id = ?`).run(problemId);
  }

  async getRelation(relationId: string): Promise<RelationRecord | undefined> {
    return this.getPayloadById<RelationRecord>(this.tables.relations, relationId);
  }

  async listRelations(): Promise<RelationRecord[]> {
    return this.listPayloads<RelationRecord>(this.tables.relations);
  }

  async listRelationsByNode(filter: {
    nodeId: string;
    scope: Scope;
    direction?: "out" | "in" | "both";
    status?: "active" | "deprecated";
  }): Promise<RelationRecord[]> {
    const direction = filter.direction ?? "both";
    const nodeClauses =
      direction === "out"
        ? "from_id = ?"
        : direction === "in"
          ? "to_id = ?"
          : "(from_id = ? or to_id = ?)";
    const params: string[] = [
      filter.scope.workspaceId,
      filter.scope.projectId,
      filter.scope.agentId,
      filter.scope.visibility,
    ];
    if (direction === "both") {
      params.push(filter.nodeId, filter.nodeId);
    } else {
      params.push(filter.nodeId);
    }
    const rawRows = this.db
      .prepare(
        `select payload from ${this.table(this.tables.relations)}
         where workspace_id = ? and project_id = ? and agent_id = ? and visibility = ?
           and ${nodeClauses}
         order by updated_at desc, rowid desc`,
      )
      .all(...params);
    const rows = asPayloadRows(rawRows, "listRelationsByNode");
    return rows.flatMap((row) => {
      const payload = decodePayload<RelationRecord>(row);
      if (!payload) {
        return [];
      }
      if (filter.status && payload.status !== filter.status) {
        return [];
      }
      return [payload];
    });
  }

  async putJournal(journal: WriteJournal): Promise<void> {
    this.db
      .prepare(
        `insert into ${this.table(this.tables.journals)}
          (id, event_key, status, phase, payload, updated_at)
         values (?, ?, ?, ?, ?, ?)
         on conflict (id) do update
         set event_key = excluded.event_key,
             status = excluded.status,
             phase = excluded.phase,
             payload = excluded.payload,
             updated_at = excluded.updated_at`,
      )
      .run(
        journal.id,
        journal.eventKey,
        journal.status,
        journal.phase,
        encodePayload(journal),
        Date.now(),
      );
  }

  async getJournal(journalId: string): Promise<WriteJournal | undefined> {
    return this.getPayloadById<WriteJournal>(this.tables.journals, journalId);
  }

  async listJournals(): Promise<WriteJournal[]> {
    return this.listPayloads<WriteJournal>(this.tables.journals);
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
      ),
      atoms: await this.getPayloadsByIds<MemoryAtom>(this.tables.atoms, journal.objectIds.atomIds),
      entities: await this.getPayloadsByIds<EntityRecord>(
        this.tables.entities,
        journal.objectIds.entityIds,
      ),
      scenarios: await this.getPayloadsByIds<ScenarioRecord>(
        this.tables.scenarios,
        journal.objectIds.scenarioIds,
      ),
      problems: await this.getPayloadsByIds<ProblemRecord>(
        this.tables.problems,
        journal.objectIds.problemIds,
      ),
      evidence: await this.getPayloadsByIds<EvidenceRecord>(
        this.tables.evidence,
        journal.objectIds.evidenceIds,
      ),
      relations: await this.getPayloadsByIds<RelationRecord>(
        this.tables.relations,
        journal.objectIds.relationIds,
      ),
    };
  }

  async saveSourceBinding(binding: SourceBinding): Promise<void> {
    this.db
      .prepare(
        `insert into ${this.table(this.tables.sourceBindings)}
          (id, source_identity_id, source_locator, status, workspace_id, project_id, agent_id, visibility, payload, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      )
      .run(
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
      );
  }

  async getSourceBinding(id: string): Promise<SourceBinding | undefined> {
    return this.getPayloadById<SourceBinding>(this.tables.sourceBindings, id);
  }

  async listSourceBindings(scope?: Scope): Promise<SourceBinding[]> {
    if (!scope) {
      return this.listPayloads<SourceBinding>(this.tables.sourceBindings);
    }
    const rawRows = this.db
      .prepare(
        `select payload from ${this.table(this.tables.sourceBindings)}
         where workspace_id = ? and project_id = ? and agent_id = ? and visibility = ?
         order by updated_at asc, rowid asc`,
      )
      .all(scope.workspaceId, scope.projectId, scope.agentId, scope.visibility);
    const rows = asPayloadRows(rawRows, "listSourceBindings");
    return rows.flatMap((row) => {
      const payload = decodePayload<SourceBinding>(row);
      return payload ? [payload] : [];
    });
  }

  async findSourceBindingByIdentity(sourceIdentityId: string): Promise<SourceBinding | undefined> {
    const row = this.db
      .prepare(
        `select payload from ${this.table(this.tables.sourceBindings)}
         where source_identity_id = ? limit 1`,
      )
      .get(sourceIdentityId) as LocalMetadataRow | undefined;
    return decodePayload<SourceBinding>(row);
  }

  async findSourceBindingByLocator(sourceLocator: string): Promise<SourceBinding | undefined> {
    const row = this.db
      .prepare(
        `select payload from ${this.table(this.tables.sourceBindings)}
         where source_locator = ? limit 1`,
      )
      .get(sourceLocator) as LocalMetadataRow | undefined;
    return decodePayload<SourceBinding>(row);
  }

  async putSourceLifecycleReceipt(receipt: PersistedSourceLifecycleReceipt): Promise<void> {
    this.db
      .prepare(
        `insert into ${this.table(this.tables.sourceLifecycleOperations)}
          (operation_id, source_binding_id, source_identity_id, previous_status, current_status, affected_object_count, payload, completed_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (operation_id) do update
         set source_binding_id = excluded.source_binding_id,
             source_identity_id = excluded.source_identity_id,
             previous_status = excluded.previous_status,
             current_status = excluded.current_status,
             affected_object_count = excluded.affected_object_count,
             payload = excluded.payload,
             completed_at = excluded.completed_at`,
      )
      .run(
        receipt.operationId,
        receipt.sourceBindingId,
        receipt.sourceIdentityId,
        receipt.previousStatus,
        receipt.currentStatus,
        receipt.affectedObjectCount,
        encodePayload(receipt),
        receipt.completedAt,
      );
  }

  async getSourceLifecycleReceipt(
    operationId: string,
  ): Promise<PersistedSourceLifecycleReceipt | undefined> {
    const row = this.db
      .prepare(
        `select payload from ${this.table(this.tables.sourceLifecycleOperations)}
         where operation_id = ? limit 1`,
      )
      .get(operationId) as LocalMetadataRow | undefined;
    return decodePayload<PersistedSourceLifecycleReceipt>(row);
  }

  async listSourceLifecycleReceipts(): Promise<PersistedSourceLifecycleReceipt[]> {
    const rawRows = this.db
      .prepare(
        `select payload from ${this.table(this.tables.sourceLifecycleOperations)}
         order by completed_at asc, operation_id asc`,
      )
      .all();
    const rows = asPayloadRows(rawRows, "listSourceLifecycleReceipts");
    return rows.flatMap((row) => {
      const payload = decodePayload<PersistedSourceLifecycleReceipt>(row);
      return payload ? [payload] : [];
    });
  }

  async saveSourceObjectLink(link: SourceObjectLink): Promise<void> {
    this.db
      .prepare(
        `insert into ${this.table(this.tables.sourceObjectLinks)}
          (id, source_binding_id, object_type, object_id, link_role, unlinked_at, payload, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (id) do update
         set source_binding_id = excluded.source_binding_id,
             object_type = excluded.object_type,
             object_id = excluded.object_id,
             link_role = excluded.link_role,
             unlinked_at = excluded.unlinked_at,
             payload = excluded.payload`,
      )
      .run(
        link.id,
        link.sourceBindingId,
        link.objectType,
        link.objectId,
        link.linkRole,
        link.unlinkedAt ?? null,
        encodePayload(link),
        link.createdAt,
      );
  }

  async getSourceObjectLink(id: string): Promise<SourceObjectLink | undefined> {
    return this.getPayloadById<SourceObjectLink>(this.tables.sourceObjectLinks, id);
  }

  async listSourceObjectLinks(filter?: {
    sourceBindingId?: string;
    objectType?: SourceObjectType;
    objectId?: string;
    liveOnly?: boolean;
  }): Promise<SourceObjectLink[]> {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter?.sourceBindingId) {
      clauses.push("source_binding_id = ?");
      params.push(filter.sourceBindingId);
    }
    if (filter?.objectType) {
      clauses.push("object_type = ?");
      params.push(filter.objectType);
    }
    if (filter?.objectId) {
      clauses.push("object_id = ?");
      params.push(filter.objectId);
    }
    if (filter?.liveOnly) {
      clauses.push("unlinked_at is null");
    }
    const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
    const rawRows = this.db
      .prepare(
        `select payload from ${this.table(this.tables.sourceObjectLinks)}
         ${where}
         order by created_at asc, rowid asc`,
      )
      .all(...params);
    const rows = asPayloadRows(rawRows, "listSourceObjectLinks");
    return rows.flatMap((row) => {
      const payload = decodePayload<SourceObjectLink>(row);
      return payload ? [payload] : [];
    });
  }

  async deleteSourceObjectLink(id: string): Promise<void> {
    this.db
      .prepare(`delete from ${this.table(this.tables.sourceObjectLinks)} where id = ?`)
      .run(id);
  }

  async deleteEvidence(evidenceId: string): Promise<void> {
    this.db.prepare(`delete from ${this.table(this.tables.evidence)} where id = ?`).run(evidenceId);
  }

  async deleteRelation(relationId: string): Promise<void> {
    this.db
      .prepare(`delete from ${this.table(this.tables.relations)} where id = ?`)
      .run(relationId);
  }

  async ensureDataPlaneId(): Promise<string> {
    const existing = await this.getDataPlaneId();
    if (existing) {
      return existing;
    }
    const created = createDataPlaneId();
    this.db
      .prepare(
        `insert into ${this.table(this.tables.meta)} (key, value)
         values ('data_plane_id', ?)
         on conflict (key) do nothing`,
      )
      .run(created);
    const after = await this.getDataPlaneId();
    return after ?? created;
  }

  async getDataPlaneId(): Promise<string | undefined> {
    const row = this.db
      .prepare(
        `select value from ${this.table(this.tables.meta)}
         where key = 'data_plane_id' limit 1`,
      )
      .get() as { value?: string } | undefined;
    const value = row?.value?.trim();
    return value ? value : undefined;
  }

  async getWriteOperation(writeOperationKey: string): Promise<WriteOperationRecord | undefined> {
    const row = this.db
      .prepare(
        `select payload from ${this.table(this.tables.writeOperations)}
         where write_operation_key = ? limit 1`,
      )
      .get(writeOperationKey) as LocalMetadataRow | undefined;
    return decodePayload<WriteOperationRecord>(row);
  }

  async putWriteOperation(record: WriteOperationRecord): Promise<void> {
    this.db
      .prepare(
        `insert into ${this.table(this.tables.writeOperations)}
          (write_operation_key, kind, payload, completed_at)
         values (?, ?, ?, ?)
         on conflict (write_operation_key) do update
         set kind = excluded.kind,
             payload = excluded.payload,
             completed_at = excluded.completed_at`,
      )
      .run(record.writeOperationKey, record.kind, encodePayload(record), record.completedAt);
  }

  async listWriteOperations(): Promise<WriteOperationRecord[]> {
    const rawRows = this.db
      .prepare(
        `select payload from ${this.table(this.tables.writeOperations)}
         order by completed_at asc, rowid asc`,
      )
      .all();
    const rows = asPayloadRows(rawRows, "listWriteOperations");
    return rows.flatMap((row) => {
      const payload = decodePayload<WriteOperationRecord>(row);
      return payload ? [payload] : [];
    });
  }

  async deleteJournal(journalId: string): Promise<void> {
    this.db.prepare(`delete from ${this.table(this.tables.journals)} where id = ?`).run(journalId);
  }

  async saveMemorySubjectBinding(binding: MemorySubjectBinding): Promise<void> {
    this.db
      .prepare(
        `insert into ${this.table(this.tables.memorySubjectBindings)}
          (id, data_plane_id, scope_fingerprint, tenant_id, owner_type, owner_id,
           workspace_id, project_id, agent_id, visibility, unbound_at, payload, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (id) do update
         set data_plane_id = excluded.data_plane_id,
             scope_fingerprint = excluded.scope_fingerprint,
             tenant_id = excluded.tenant_id,
             owner_type = excluded.owner_type,
             owner_id = excluded.owner_id,
             workspace_id = excluded.workspace_id,
             project_id = excluded.project_id,
             agent_id = excluded.agent_id,
             visibility = excluded.visibility,
             unbound_at = excluded.unbound_at,
             payload = excluded.payload,
             updated_at = excluded.updated_at`,
      )
      .run(
        binding.id,
        binding.partition.dataPlaneId,
        binding.partition.scopeFingerprint,
        binding.subject.tenantId,
        binding.subject.ownerType,
        binding.subject.ownerId,
        binding.scope.workspaceId,
        binding.scope.projectId,
        binding.scope.agentId,
        binding.scope.visibility,
        binding.unboundAt ?? null,
        encodePayload(binding),
        binding.createdAt,
        binding.updatedAt,
      );
  }

  async getMemorySubjectBinding(id: string): Promise<MemorySubjectBinding | undefined> {
    return this.getPayloadById<MemorySubjectBinding>(this.tables.memorySubjectBindings, id);
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
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (filter?.scope) {
      clauses.push("workspace_id = ? and project_id = ? and agent_id = ? and visibility = ?");
      params.push(
        filter.scope.workspaceId,
        filter.scope.projectId,
        filter.scope.agentId,
        filter.scope.visibility,
      );
    }
    if (filter?.tenantId) {
      clauses.push("tenant_id = ?");
      params.push(filter.tenantId);
    }
    if (filter?.ownerType) {
      clauses.push("owner_type = ?");
      params.push(filter.ownerType);
    }
    if (filter?.ownerId) {
      clauses.push("owner_id = ?");
      params.push(filter.ownerId);
    }
    if (filter?.dataPlaneId) {
      clauses.push("data_plane_id = ?");
      params.push(filter.dataPlaneId);
    }
    if (filter?.scopeFingerprint) {
      clauses.push("scope_fingerprint = ?");
      params.push(filter.scopeFingerprint);
    }
    if (filter?.liveOnly) {
      clauses.push("unbound_at is null");
    }
    const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
    const rawRows = this.db
      .prepare(
        `select payload from ${this.table(this.tables.memorySubjectBindings)}
         ${where}
         order by updated_at asc, rowid asc`,
      )
      .all(...params);
    const rows = asPayloadRows(rawRows, "listMemorySubjectBindings");
    return rows.flatMap((row) => {
      const payload = decodePayload<MemorySubjectBinding>(row);
      return payload ? [payload] : [];
    });
  }

  async deleteMemorySubjectBinding(id: string): Promise<void> {
    this.db
      .prepare(`delete from ${this.table(this.tables.memorySubjectBindings)} where id = ?`)
      .run(id);
  }

  close(): void {
    this.db.close();
  }

  private bootstrapSchemaSync(): number {
    const statements = buildLocalMetadataSchema();
    for (const statement of statements) {
      this.db.exec(statement);
    }
    this.db
      .prepare(
        `insert into ${this.table(this.tables.meta)} (key, value)
         values ('schema_version', '5')
         on conflict (key) do update set value = excluded.value`,
      )
      .run();
    return statements.length;
  }

  private table(name: string): string {
    return quoteIdentifier(name);
  }

  private getPayloadById<T>(table: string, id: string): T | undefined {
    const row = this.db
      .prepare(`select payload from ${this.table(table)} where id = ? limit 1`)
      .get(id) as LocalMetadataRow | undefined;
    return decodePayload<T>(row);
  }

  private getPayloadsByIds<T>(table: string, ids: string[]): T[] {
    return ids.flatMap((id) => {
      const payload = this.getPayloadById<T>(table, id);
      return payload ? [payload] : [];
    });
  }

  private listPayloads<T>(table: string): T[] {
    const rawRows = this.db
      .prepare(`select payload from ${this.table(table)} order by updated_at asc, rowid asc`)
      .all();
    const rows = asPayloadRows(rawRows, `listPayloads:${table}`);
    return rows.flatMap((row) => {
      const payload = decodePayload<T>(row);
      return payload ? [payload] : [];
    });
  }

  private upsertScopedPayload<
    T extends {
      scope: { workspaceId: string; projectId: string; agentId: string; visibility: string };
    },
  >(table: string, keyColumn: string, id: string, naturalKey: string | null, payload: T): void {
    this.db
      .prepare(
        `insert into ${this.table(table)}
          (id, ${keyColumn}, workspace_id, project_id, agent_id, visibility, payload, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (id) do update
         set ${keyColumn} = excluded.${keyColumn},
             workspace_id = excluded.workspace_id,
             project_id = excluded.project_id,
             agent_id = excluded.agent_id,
             visibility = excluded.visibility,
             payload = excluded.payload,
             updated_at = excluded.updated_at`,
      )
      .run(
        id,
        naturalKey,
        payload.scope.workspaceId,
        payload.scope.projectId,
        payload.scope.agentId,
        payload.scope.visibility,
        encodePayload(payload),
        Date.now(),
      );
  }
}
