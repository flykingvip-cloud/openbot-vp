import { StorageConsistencyError } from "../errors.js";
import type { DistillationResult } from "../models.js";
import type { MetadataBundle, VectorStore } from "../storage/types.js";
import type { AdapterDescriptor, BackendAdapterConfig } from "./contracts.js";
import type {
  PostgresQueryResult,
  PostgresSqlClient,
  PostgresSqlTransaction,
} from "./postgres-metadata.js";

export interface PgVectorStoreConfig extends BackendAdapterConfig {
  client?: PostgresSqlClient;
  schema?: string;
  embeddingDimension?: number;
}

export interface PgVectorTables {
  seedDocuments: string;
}

export interface PgVectorBootstrapResult {
  schema: string;
  statementsExecuted: number;
}

export const PGVECTOR_TABLES: PgVectorTables = {
  seedDocuments: "cogniweave_seed_documents",
};

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function encodePayload(value: unknown): string {
  return JSON.stringify(value);
}

function requireResult<Row>(
  result: PostgresQueryResult<Row>,
  method: string,
): PostgresQueryResult<Row> {
  if (!Array.isArray(result.rows)) {
    throw new StorageConsistencyError(`PgVector adapter returned malformed rows for ${method}`);
  }
  return result;
}

export function buildPgVectorSchema(schema = "public", embeddingDimension = 1536): string[] {
  const s = quoteIdentifier(schema);
  const t = (name: string) => `${s}.${quoteIdentifier(name)}`;

  return [
    `create extension if not exists vector;`,
    `create table if not exists ${t(PGVECTOR_TABLES.seedDocuments)} (
      id text primary key,
      workspace_id text not null,
      project_id text not null,
      agent_id text not null,
      source_type text not null,
      content text not null,
      embedding vector(${embeddingDimension}),
      payload jsonb not null,
      updated_at timestamptz not null default now()
    );`,
    `create index if not exists ${quoteIdentifier(`${PGVECTOR_TABLES.seedDocuments}_scope_idx`)} on ${t(PGVECTOR_TABLES.seedDocuments)} (workspace_id, project_id, agent_id);`,
  ];
}

export class PgVectorStore implements VectorStore {
  readonly descriptor: AdapterDescriptor;
  readonly schema: string;
  readonly tables: PgVectorTables;
  readonly embeddingDimension: number;

  private readonly client?: PostgresSqlClient;

  constructor(config: PgVectorStoreConfig) {
    this.schema = config.schema ?? "public";
    this.client = config.client;
    this.embeddingDimension = config.embeddingDimension ?? 1536;
    this.tables = PGVECTOR_TABLES;
    this.descriptor = {
      kind: "vector",
      backend: config.backend,
      environment: config.environment,
      capabilities: ["seed-sync", "seed-rebuild", "similarity-search", "schema-bootstrap"],
    };
  }

  getSchemaStatements(): string[] {
    return buildPgVectorSchema(this.schema, this.embeddingDimension);
  }

  async bootstrapSchema(): Promise<PgVectorBootstrapResult> {
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

  async syncFromDistillation(result: DistillationResult): Promise<{ documentCount: number }> {
    const documents = this.buildSeedDocuments(result);
    await this.runInTransaction(async (client) => {
      for (const document of documents) {
        await this.queryWith(
          client,
          `insert into ${this.table(this.tables.seedDocuments)}
            (id, workspace_id, project_id, agent_id, source_type, content, embedding, payload)
           values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
           on conflict (id) do update
           set workspace_id = excluded.workspace_id,
               project_id = excluded.project_id,
               agent_id = excluded.agent_id,
               source_type = excluded.source_type,
               content = excluded.content,
               embedding = excluded.embedding,
               payload = excluded.payload,
               updated_at = now()`,
          [
            document.id,
            document.scope.workspaceId,
            document.scope.projectId,
            document.scope.agentId,
            document.sourceType,
            document.content,
            null,
            encodePayload(document),
          ],
          "syncFromDistillation",
        );
      }
    });
    return { documentCount: documents.length };
  }

  async rebuildFromBundle(bundle: MetadataBundle): Promise<{ documentCount: number }> {
    const documents = this.buildSeedDocumentsFromBundle(bundle);
    await this.runInTransaction(async (client) => {
      for (const document of documents) {
        await this.queryWith(
          client,
          `insert into ${this.table(this.tables.seedDocuments)}
            (id, workspace_id, project_id, agent_id, source_type, content, embedding, payload)
           values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
           on conflict (id) do update
           set workspace_id = excluded.workspace_id,
               project_id = excluded.project_id,
               agent_id = excluded.agent_id,
               source_type = excluded.source_type,
               content = excluded.content,
               embedding = excluded.embedding,
               payload = excluded.payload,
               updated_at = now()`,
          [
            document.id,
            document.scope.workspaceId,
            document.scope.projectId,
            document.scope.agentId,
            document.sourceType,
            document.content,
            null,
            encodePayload(document),
          ],
          "rebuildFromBundle",
        );
      }
    });
    return { documentCount: documents.length };
  }

  private buildSeedDocuments(result: DistillationResult): Array<{
    id: string;
    workspaceId: string;
    projectId: string;
    agentId: string;
    sourceType: string;
    content: string;
    scope: { workspaceId: string; projectId: string; agentId: string };
    payload: unknown;
  }> {
    const base = (
      id: string,
      sourceType: string,
      content: string,
      scope: { workspaceId: string; projectId: string; agentId: string },
    ) => ({
      id,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      agentId: scope.agentId,
      sourceType,
      content,
      scope,
      payload: {
        id,
        sourceType,
        content,
        scope,
      },
    });

    const documents = [
      base(
        result.event.id,
        "event",
        `${result.event.goal}\n${result.event.context}`,
        result.event.scope,
      ),
      ...result.atoms.map((atom) => base(atom.id, "atom", atom.claim.statement, atom.scope)),
      ...result.entities.map((entity) =>
        base(
          entity.id,
          "entity",
          `${entity.name} ${entity.aliases.join(" ")}`.trim(),
          entity.scope,
        ),
      ),
    ];
    return documents;
  }

  private buildSeedDocumentsFromBundle(bundle: MetadataBundle): Array<{
    id: string;
    workspaceId: string;
    projectId: string;
    agentId: string;
    sourceType: string;
    content: string;
    scope: { workspaceId: string; projectId: string; agentId: string };
    payload: unknown;
  }> {
    const documents = [
      ...bundle.events.map((event) => ({
        id: event.id,
        workspaceId: event.scope.workspaceId,
        projectId: event.scope.projectId,
        agentId: event.scope.agentId,
        sourceType: "event",
        content: `${event.goal}\n${event.context}`,
        scope: event.scope,
        payload: event,
      })),
      ...bundle.atoms.map((atom) => ({
        id: atom.id,
        workspaceId: atom.scope.workspaceId,
        projectId: atom.scope.projectId,
        agentId: atom.scope.agentId,
        sourceType: "atom",
        content: atom.claim.statement,
        scope: atom.scope,
        payload: atom,
      })),
      ...bundle.entities.map((entity) => ({
        id: entity.id,
        workspaceId: entity.scope.workspaceId,
        projectId: entity.scope.projectId,
        agentId: entity.scope.agentId,
        sourceType: "entity",
        content: `${entity.name} ${entity.aliases.join(" ")}`.trim(),
        scope: entity.scope,
        payload: entity,
      })),
    ];
    return documents;
  }

  private table(name: string): string {
    return `${quoteIdentifier(this.schema)}.${quoteIdentifier(name)}`;
  }

  private getClient(method: string): PostgresSqlClient {
    if (!this.client) {
      throw new StorageConsistencyError(
        `PgVector backend does not implement ${method}: no SQL client configured`,
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
    const client = this.getClient(method);
    return requireResult(await client.query<Row>(sql, params), method);
  }

  private async queryWith<Row = Record<string, unknown>>(
    client: PostgresSqlTransaction,
    sql: string,
    params: readonly unknown[],
    method: string,
  ): Promise<PostgresQueryResult<Row>> {
    return requireResult(await client.query<Row>(sql, params), method);
  }
}
