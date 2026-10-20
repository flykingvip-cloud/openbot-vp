import { describe, expect, it } from "vitest";
import {
  type DistillationResult,
  type MetadataBundle,
  type PgVectorBootstrapResult,
  type PgVectorStoreConfig,
  type PostgresQueryResult,
  type PostgresSqlClient,
  PgVectorStore,
  buildPgVectorSchema,
  createAdapterBundle,
} from "../index.js";

function makeScope() {
  return {
    workspaceId: "ws_1",
    projectId: "proj_1",
    agentId: "agent_main",
    visibility: "private" as const,
  };
}

function makeDistillationResult(): DistillationResult {
  const scope = makeScope();
  return {
    event: {
      id: "evt_1",
      scope,
      goal: "restore throughput",
      context: "throughput dropped",
      constraints: ["maintain_correctness"],
      decisions: [],
      turningPoints: [],
      outcome: undefined,
      linkedAtoms: ["atm_1"],
      evidenceRefs: ["evd_1"],
      eventKey: "event_key_1",
      provenance: { sourceType: "chat", ingestionChecksum: "checksum_1" },
    },
    atoms: [
      {
        id: "atm_1",
        atomType: "strategy",
        scope,
        claim: { type: "procedural", statement: "Use asynchronous buffering." },
        trigger: { conditions: ["high_latency"], contextTags: ["mitigation"] },
        action: { recommendation: "async_buffering" },
        applicability: { include: ["worker_pipeline"], exclude: [] },
        provenance: { sourceEventIds: ["evt_1"], evidenceRefs: ["evd_1"] },
        versioning: { version: 1 },
        state: { status: "active", conflictsWith: [] },
        metrics: { confidence: 0.8, reuseCount: 1 },
        dedupKey: "dedup_1",
      },
    ],
    entities: [
      {
        id: "ent_1",
        entityType: "service",
        name: "external_api",
        aliases: ["api"],
        tags: ["external"],
        scope,
        provenance: { sourceEventIds: ["evt_1"], evidenceRefs: ["evd_1"] },
        entityKey: "entity_key_1",
      },
    ],
    scenarios: [],
    problems: [],
    relations: [],
    evidence: [
      {
        id: "evd_1",
        type: "chat",
        uri: "chat://sess_1",
        snippet: "throughput dropped",
        trustScore: 0.5,
        scope,
        checksum: "checksum_1",
        locator: { messageIds: [], toolCallIds: [] },
        timestamp: "2026-04-08T00:00:00.000Z",
      },
    ],
    keys: {
      ingestionChecksum: "checksum_1",
      eventKey: "event_key_1",
      atomDedupKeys: ["dedup_1"],
      entityKeys: ["entity_key_1"],
      scenarioKeys: [],
      problemKeys: [],
    },
    writePlan: {
      canonicalObjectTypes: ["EventSkeleton", "MemoryAtom", "Entity", "Evidence"],
      relationIds: [],
      graphNodeIds: ["evt_1", "atm_1", "ent_1", "evd_1"],
      graphEdgeIds: [],
      vectorDocumentIds: ["evt_1", "atm_1", "ent_1"],
    },
    quality: {
      profile: "rule_based",
      stageCoverage: 1,
      stageFallbackRate: 0,
      stageDecisions: [
        {
          stage: "event",
          llmResponded: false,
          usedLlmOutput: false,
          fallbackToRule: false,
        },
      ],
    },
  };
}

describe("PgVectorStore", () => {
  it("exposes canonical vector schema statements", () => {
    const statements = buildPgVectorSchema("cogniweave", 768);

    expect(statements[0]).toBe("create extension if not exists vector;");
    expect(statements.join("\n")).toContain("vector(768)");
    expect(statements.join("\n")).toContain("cogniweave_seed_documents");
  });

  it("bootstraps schema through transaction support", async () => {
    const queries: string[] = [];
    const client: PostgresSqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        params?: readonly unknown[],
      ): Promise<PostgresQueryResult<Row>> {
        queries.push(sql);
        return { rows: [], rowCount: 0 };
      },
      async transaction<T>(
        runner: (transaction: { query: PostgresSqlClient["query"] }) => Promise<T>,
      ): Promise<T> {
        return runner({
          query: async (sql: string, params?: readonly unknown[]) => {
            queries.push(sql);
            return { rows: [], rowCount: 0 };
          },
        });
      },
    };

    const store = new PgVectorStore({
      backend: "pgvector",
      environment: "service",
      client,
      schema: "cogniweave",
      embeddingDimension: 768,
    } satisfies PgVectorStoreConfig);

    const result = await store.bootstrapSchema();

    expect(result).toEqual({
      schema: "cogniweave",
      statementsExecuted: buildPgVectorSchema("cogniweave", 768).length,
    } satisfies PgVectorBootstrapResult);
    expect(queries).toHaveLength(result.statementsExecuted);
  });

  it("syncs and rebuilds canonical seed documents", async () => {
    const queries: string[] = [];
    const client: PostgresSqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        params?: readonly unknown[],
      ): Promise<PostgresQueryResult<Row>> {
        queries.push(sql);
        return { rows: [], rowCount: 1 };
      },
    };

    const store = new PgVectorStore({
      backend: "pgvector",
      environment: "service",
      client,
    });

    const distillation = makeDistillationResult();
    const sync = await store.syncFromDistillation(distillation);
    const bundle: MetadataBundle = {
      events: [distillation.event],
      atoms: distillation.atoms,
      entities: distillation.entities,
      scenarios: [],
      problems: [],
      evidence: distillation.evidence,
      relations: [],
    };
    const rebuild = await store.rebuildFromBundle(bundle);

    expect(sync.documentCount).toBe(3);
    expect(rebuild.documentCount).toBe(3);
    expect(queries.filter((sql) => sql.includes("cogniweave_seed_documents"))).toHaveLength(6);
  });

  it("executes sync and rebuild in SQL transactions when transaction support exists", async () => {
    let transactionCalls = 0;
    const queries: string[] = [];
    const client: PostgresSqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        params?: readonly unknown[],
      ): Promise<PostgresQueryResult<Row>> {
        queries.push(sql);
        return { rows: [], rowCount: 1 };
      },
      async transaction<T>(
        runner: (transaction: { query: PostgresSqlClient["query"] }) => Promise<T>,
      ): Promise<T> {
        transactionCalls += 1;
        return runner({
          query: async (sql: string, params?: readonly unknown[]) => {
            queries.push(sql);
            return { rows: [], rowCount: 1 };
          },
        });
      },
    };

    const store = new PgVectorStore({
      backend: "pgvector",
      environment: "service",
      client,
    });

    const distillation = makeDistillationResult();
    await store.syncFromDistillation(distillation);
    const bundle: MetadataBundle = {
      events: [distillation.event],
      atoms: distillation.atoms,
      entities: distillation.entities,
      scenarios: [],
      problems: [],
      evidence: distillation.evidence,
      relations: [],
    };
    await store.rebuildFromBundle(bundle);

    expect(transactionCalls).toBe(2);
    expect(queries.filter((sql) => sql.includes("insert into"))).toHaveLength(6);
  });

  it("does not commit staged seed documents when transaction aborts", async () => {
    let committedInserts = 0;
    const client: PostgresSqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        params?: readonly unknown[],
      ): Promise<PostgresQueryResult<Row>> {
        if (sql.includes("insert into")) {
          committedInserts += 1;
        }
        return { rows: [], rowCount: 1 };
      },
      async transaction<T>(
        runner: (transaction: { query: PostgresSqlClient["query"] }) => Promise<T>,
      ): Promise<T> {
        let stagedInserts = 0;
        try {
          const result = await runner({
            query: async (sql: string, params?: readonly unknown[]) => {
              if (sql.includes("insert into")) {
                stagedInserts += 1;
                if (stagedInserts === 2) {
                  throw new Error("abort transaction");
                }
              }
              return { rows: [], rowCount: 1 };
            },
          });
          committedInserts += stagedInserts;
          return result;
        } catch (error) {
          return Promise.reject(error);
        }
      },
    };

    const store = new PgVectorStore({
      backend: "pgvector",
      environment: "service",
      client,
    });

    const distillation = makeDistillationResult();
    await expect(store.syncFromDistillation(distillation)).rejects.toThrow("abort transaction");
    expect(committedInserts).toBe(0);
  });

  it("advertises sql-first vector resolution through the factory", () => {
    const bundle = createAdapterBundle({
      environment: "service",
      metadataBackend: "postgres",
      graphBackend: "neo4j",
      evidenceBackend: "s3",
      vectorBackend: "pgvector",
    });

    expect(bundle.resolutions[2]?.implementation).toBe("sql-first");
  });
});
