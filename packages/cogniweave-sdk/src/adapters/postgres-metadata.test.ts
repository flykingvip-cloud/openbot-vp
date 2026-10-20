import { describe, expect, it } from "vitest";
import {
  POSTGRES_METADATA_TABLES,
  PostgresMetadataStore,
  type PostgresQueryResult,
  type PostgresSqlClient,
  buildPostgresMetadataSchema,
} from "../index.js";

describe("PostgresMetadataStore", () => {
  it("exposes canonical metadata schema statements", () => {
    const statements = buildPostgresMetadataSchema("cogniweave");
    const ddl = statements.join("\n");

    expect(statements[0]).toContain('create schema if not exists "cogniweave"');
    expect(ddl).toContain(POSTGRES_METADATA_TABLES.events);
    expect(ddl).toContain(POSTGRES_METADATA_TABLES.journals);
    expect(ddl).toContain(POSTGRES_METADATA_TABLES.sourceBindings);
    expect(ddl).toContain(POSTGRES_METADATA_TABLES.sourceObjectLinks);
    expect(ddl).toContain(POSTGRES_METADATA_TABLES.writeOperations);
    expect(ddl).toContain(POSTGRES_METADATA_TABLES.meta);
  });

  it("fails fast when no SQL client is configured", async () => {
    const store = new PostgresMetadataStore({
      backend: "postgres",
      environment: "service",
    });

    await expect(store.listAtoms()).rejects.toThrow(
      "Postgres metadata backend does not implement listAtoms: no SQL client configured",
    );
  });

  it("advertises canonical metadata capabilities", () => {
    const store = new PostgresMetadataStore({
      backend: "postgres",
      environment: "service",
    });

    expect(store.descriptor.capabilities).toContain("canonical-write");
    expect(store.descriptor.capabilities).toContain("schema-bootstrap");
    expect(store.descriptor.capabilities).toContain("restart-safe");
  });

  it("bootstraps schema statements through the configured SQL client", async () => {
    const queries: Array<{ sql: string; params?: readonly unknown[] }> = [];
    const client: PostgresSqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        params?: readonly unknown[],
      ): Promise<PostgresQueryResult<Row>> {
        queries.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
    };

    const store = new PostgresMetadataStore({
      backend: "postgres",
      environment: "service",
      client,
      schema: "cogniweave",
    });

    const result = await store.bootstrapSchema();

    expect(result).toEqual({
      schema: "cogniweave",
      statementsExecuted: buildPostgresMetadataSchema("cogniweave").length,
    });
    expect(queries).toHaveLength(result.statementsExecuted);
    expect(queries[0]?.sql).toContain('create schema if not exists "cogniweave"');
  });

  it("uses client transaction support when bootstrapping schema", async () => {
    let transactionCalls = 0;
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
        transactionCalls += 1;
        return runner({
          query: async (sql: string, params?: readonly unknown[]) => {
            queries.push(sql);
            return { rows: [], rowCount: 0 };
          },
        });
      },
    };

    const store = new PostgresMetadataStore({
      backend: "postgres",
      environment: "service",
      client,
      schema: "cogniweave",
    });

    const result = await store.bootstrapSchema();

    expect(transactionCalls).toBe(1);
    expect(queries).toHaveLength(result.statementsExecuted);
    expect(result.statementsExecuted).toBeGreaterThan(0);
  });

  it("routes metadata writes through transaction context when withTransaction is used", async () => {
    let baseQueryCalls = 0;
    let transactionCalls = 0;
    let transactionQueryCalls = 0;
    const client: PostgresSqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        params?: readonly unknown[],
      ): Promise<PostgresQueryResult<Row>> {
        baseQueryCalls += 1;
        return { rows: [], rowCount: 0 };
      },
      async transaction<T>(
        runner: (transaction: { query: PostgresSqlClient["query"] }) => Promise<T>,
      ): Promise<T> {
        transactionCalls += 1;
        return runner({
          query: async (sql: string, params?: readonly unknown[]) => {
            transactionQueryCalls += 1;
            return { rows: [], rowCount: 1 };
          },
        });
      },
    };

    const store = new PostgresMetadataStore({
      backend: "postgres",
      environment: "service",
      client,
      schema: "cogniweave",
    });

    await store.withTransaction!(async () => {
      await store.saveEntity({
        id: "ent_1",
        entityType: "service",
        name: "external_api",
        aliases: ["api"],
        tags: ["external"],
        scope: {
          workspaceId: "ws_1",
          projectId: "proj_1",
          agentId: "agent_main",
          visibility: "private",
        },
        provenance: { sourceEventIds: ["evt_1"], evidenceRefs: ["evd_1"] },
        entityKey: "entity_key_1",
      });
      await store.saveProblem({
        id: "prb_1",
        statement: "throughput drop",
        normalizedStatement: "throughput_drop",
        tags: ["throughput"],
        scope: {
          workspaceId: "ws_1",
          projectId: "proj_1",
          agentId: "agent_main",
          visibility: "private",
        },
        provenance: { sourceEventIds: ["evt_1"], evidenceRefs: ["evd_1"] },
        problemKey: "problem_key_1",
      });
    });

    expect(transactionCalls).toBe(1);
    expect(transactionQueryCalls).toBe(2);
    expect(baseQueryCalls).toBe(0);
  });

  it("does not commit staged metadata writes when transaction aborts", async () => {
    const committedEntityPayloadById = new Map<string, unknown>();
    let committedWrites = 0;

    const client: PostgresSqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        params?: readonly unknown[],
      ): Promise<PostgresQueryResult<Row>> {
        if (
          sql.includes("from") &&
          sql.includes("cogniweave_entities") &&
          sql.includes("where id = $1")
        ) {
          const entity = committedEntityPayloadById.get(String(params?.[0]));
          return {
            rows: entity ? ([{ payload: entity }] as Row[]) : [],
            rowCount: entity ? 1 : 0,
          };
        }
        return { rows: [], rowCount: 0 };
      },
      async transaction<T>(
        runner: (transaction: { query: PostgresSqlClient["query"] }) => Promise<T>,
      ): Promise<T> {
        const stagedEntityPayloadById = new Map<string, unknown>();
        let stagedWrites = 0;
        try {
          const result = await runner({
            query: async (sql: string, params?: readonly unknown[]) => {
              if (sql.includes("insert into") && sql.includes("cogniweave_entities")) {
                const id = String(params?.[0]);
                const payload = params?.[5];
                stagedEntityPayloadById.set(id, payload);
                stagedWrites += 1;
              }
              return { rows: [], rowCount: 1 };
            },
          });
          for (const [id, payload] of stagedEntityPayloadById) {
            committedEntityPayloadById.set(id, payload);
          }
          committedWrites += stagedWrites;
          return result;
        } catch (error) {
          return Promise.reject(error);
        }
      },
    };

    const store = new PostgresMetadataStore({
      backend: "postgres",
      environment: "service",
      client,
      schema: "cogniweave",
    });

    await expect(
      store.withTransaction!(async () => {
        await store.saveEntity({
          id: "ent_abort",
          entityType: "service",
          name: "abort_service",
          aliases: [],
          tags: [],
          scope: {
            workspaceId: "ws_1",
            projectId: "proj_1",
            agentId: "agent_main",
            visibility: "private",
          },
          provenance: { sourceEventIds: ["evt_abort"], evidenceRefs: ["evd_abort"] },
          entityKey: "entity_abort",
        });
        throw new Error("abort transaction");
      }),
    ).rejects.toThrow("abort transaction");

    expect(committedWrites).toBe(0);
    const after = await store.getEntity("ent_abort");
    expect(after).toBeUndefined();
  });

  it("persists source bindings, object links, write ops, and dataPlaneId", async () => {
    const bindings = new Map<string, string>();
    const links = new Map<string, string>();
    const writeOps = new Map<string, string>();
    const meta = new Map<string, string>();
    const receipts = new Map<string, string>();

    const client: PostgresSqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        params?: readonly unknown[],
      ): Promise<PostgresQueryResult<Row>> {
        if (sql.includes("cogniweave_source_bindings") && sql.includes("insert into")) {
          bindings.set(String(params?.[0]), String(params?.[8]));
          return { rows: [], rowCount: 1 };
        }
        if (
          sql.includes("cogniweave_source_bindings") &&
          sql.includes("where id = $1") &&
          sql.includes("select payload")
        ) {
          const payload = bindings.get(String(params?.[0]));
          return {
            rows: payload ? ([{ payload }] as Row[]) : [],
            rowCount: payload ? 1 : 0,
          };
        }
        if (sql.includes("cogniweave_source_bindings") && sql.includes("source_identity_id = $1")) {
          const match = [...bindings.values()]
            .map((payload) => JSON.parse(payload) as { sourceIdentityId: string })
            .find((row) => row.sourceIdentityId === String(params?.[0]));
          return {
            rows: match ? ([{ payload: JSON.stringify(match) }] as Row[]) : [],
            rowCount: match ? 1 : 0,
          };
        }
        if (sql.includes("cogniweave_source_object_links") && sql.includes("insert into")) {
          links.set(String(params?.[0]), String(params?.[6]));
          return { rows: [], rowCount: 1 };
        }
        if (
          sql.includes("cogniweave_source_object_links") &&
          sql.includes("select payload") &&
          sql.includes("source_binding_id = $1")
        ) {
          const rows = [...links.values()]
            .map(
              (payload) => JSON.parse(payload) as { sourceBindingId: string; unlinkedAt?: string },
            )
            .filter((row) => row.sourceBindingId === String(params?.[0]))
            .filter((row) => (sql.includes("unlinked_at is null") ? !row.unlinkedAt : true))
            .map((row) => ({ payload: JSON.stringify(row) }));
          return { rows: rows as Row[], rowCount: rows.length };
        }
        if (sql.includes("cogniweave_source_lifecycle_operations") && sql.includes("insert into")) {
          receipts.set(String(params?.[0]), String(params?.[6]));
          return { rows: [], rowCount: 1 };
        }
        if (
          sql.includes("cogniweave_source_lifecycle_operations") &&
          sql.includes("operation_id = $1")
        ) {
          const payload = receipts.get(String(params?.[0]));
          return {
            rows: payload ? ([{ payload }] as Row[]) : [],
            rowCount: payload ? 1 : 0,
          };
        }
        if (sql.includes("cogniweave_write_operations") && sql.includes("insert into")) {
          writeOps.set(String(params?.[0]), String(params?.[2]));
          return { rows: [], rowCount: 1 };
        }
        if (
          sql.includes("cogniweave_write_operations") &&
          sql.includes("write_operation_key = $1")
        ) {
          const payload = writeOps.get(String(params?.[0]));
          return {
            rows: payload ? ([{ payload }] as Row[]) : [],
            rowCount: payload ? 1 : 0,
          };
        }
        if (sql.includes("cogniweave_meta") && sql.includes("insert into")) {
          if (!meta.has("data_plane_id")) {
            meta.set("data_plane_id", String(params?.[0]));
          }
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("cogniweave_meta") && sql.includes("data_plane_id")) {
          const value = meta.get("data_plane_id");
          return {
            rows: value ? ([{ value }] as Row[]) : [],
            rowCount: value ? 1 : 0,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const store = new PostgresMetadataStore({
      backend: "postgres",
      environment: "service",
      client,
      schema: "cogniweave",
    });

    const now = new Date().toISOString();
    const scope = {
      workspaceId: "ws_pg",
      projectId: "proj_pg",
      agentId: "agent_main",
      visibility: "private" as const,
    };
    const binding = {
      id: "sb_pg_1",
      sourceIdentityId: "sid_pg_1",
      sourceLocator: "msrc://sid_pg_1",
      status: "active" as const,
      scope,
      createdAt: now,
      updatedAt: now,
    };
    await store.saveSourceBinding(binding);
    expect(await store.getSourceBinding(binding.id)).toEqual(binding);
    expect(await store.findSourceBindingByIdentity("sid_pg_1")).toEqual(binding);

    const link = {
      id: "sol_pg_1",
      sourceBindingId: binding.id,
      objectType: "evidence" as const,
      objectId: "ev_pg_1",
      linkRole: "primary_evidence",
      createdAt: now,
    };
    await store.saveSourceObjectLink(link);
    expect(
      await store.listSourceObjectLinks({ sourceBindingId: binding.id, liveOnly: true }),
    ).toEqual([link]);

    await store.putSourceLifecycleReceipt({
      operationId: "op_pg_1",
      sourceBindingId: binding.id,
      sourceIdentityId: binding.sourceIdentityId,
      previousStatus: "active",
      currentStatus: "archived",
      affectedObjectCount: 1,
      completedAt: now,
    });
    expect((await store.getSourceLifecycleReceipt("op_pg_1"))?.currentStatus).toBe("archived");

    const dataPlaneId = await store.ensureDataPlaneId();
    expect(dataPlaneId.length).toBeGreaterThan(8);
    expect(await store.ensureDataPlaneId()).toBe(dataPlaneId);

    await store.putWriteOperation({
      writeOperationKey: "opk/1/test",
      kind: "WRITE",
      result: {
        eventId: "evt_1",
        atomIds: [],
        journalId: "j_1",
        canonicalStatus: "METADATA_COMMITTED",
        derivedStatus: "SYNCED",
        status: "COMPLETED",
      },
      completedAt: now,
    });
    expect((await store.getWriteOperation("opk/1/test"))?.kind).toBe("WRITE");
  });
});
