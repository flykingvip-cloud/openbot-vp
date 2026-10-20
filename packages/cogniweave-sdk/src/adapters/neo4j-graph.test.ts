import { describe, expect, it } from "vitest";
import {
  type DistillationResult,
  type MetadataBundle,
  type Neo4jCypherClient,
  type Neo4jGraphBootstrapResult,
  type Neo4jGraphStoreConfig,
  type Neo4jQueryResult,
  Neo4jGraphStore,
  buildNeo4jGraphSchema,
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
    scenarios: [
      {
        id: "scn_1",
        name: "high_latency_environment",
        tags: ["latency"],
        summary: "External latency is elevated.",
        scope,
        provenance: { sourceEventIds: ["evt_1"], evidenceRefs: ["evd_1"] },
        scenarioKey: "scenario_key_1",
      },
    ],
    problems: [
      {
        id: "prb_1",
        statement: "throughput drop",
        normalizedStatement: "throughput_drop",
        tags: ["throughput"],
        scope,
        provenance: { sourceEventIds: ["evt_1"], evidenceRefs: ["evd_1"] },
        problemKey: "problem_key_1",
      },
    ],
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
    relations: [
      {
        id: "rel_1",
        fromId: "atm_1",
        fromNodeType: "MemoryAtom",
        relationType: "MITIGATES",
        toId: "atm_1",
        toNodeType: "MemoryAtom",
        scope,
        confidence: 0.7,
        status: "active",
        provenance: { sourceEventIds: ["evt_1"], evidenceRefs: ["evd_1"] },
      },
    ],
    keys: {
      ingestionChecksum: "checksum_1",
      eventKey: "event_key_1",
      atomDedupKeys: ["dedup_1"],
      entityKeys: ["entity_key_1"],
      scenarioKeys: ["scenario_key_1"],
      problemKeys: ["problem_key_1"],
    },
    writePlan: {
      canonicalObjectTypes: [
        "EventSkeleton",
        "MemoryAtom",
        "Entity",
        "Scenario",
        "Problem",
        "Evidence",
      ],
      relationIds: ["rel_1"],
      graphNodeIds: ["evt_1", "atm_1", "ent_1", "scn_1", "prb_1", "evd_1"],
      graphEdgeIds: ["rel_1"],
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

describe("Neo4jGraphStore", () => {
  it("exposes canonical graph schema statements", () => {
    const statements = buildNeo4jGraphSchema();

    expect(statements).toContain(
      "CREATE CONSTRAINT memory_atom_id IF NOT EXISTS FOR (n:MemoryAtom) REQUIRE n.id IS UNIQUE",
    );
    expect(statements).toContain(
      "CREATE CONSTRAINT evidence_id IF NOT EXISTS FOR (n:Evidence) REQUIRE n.id IS UNIQUE",
    );
  });

  it("bootstraps schema through transaction support", async () => {
    const cypher: string[] = [];
    const client: Neo4jCypherClient = {
      async run<Row = Record<string, unknown>>(
        statement: string,
        params?: Record<string, unknown>,
      ): Promise<Neo4jQueryResult<Row>> {
        cypher.push(statement);
        return { records: [] };
      },
      async transaction<T>(
        runner: (transaction: { run: Neo4jCypherClient["run"] }) => Promise<T>,
      ): Promise<T> {
        return runner({
          run: async (statement: string, params?: Record<string, unknown>) => {
            cypher.push(statement);
            return { records: [] };
          },
        });
      },
    };

    const store = new Neo4jGraphStore({
      backend: "neo4j",
      environment: "service",
      client,
      database: "neo4j",
    } satisfies Neo4jGraphStoreConfig);

    const result = await store.bootstrapSchema();

    expect(result).toEqual({
      database: "neo4j",
      statementsExecuted: buildNeo4jGraphSchema().length,
    } satisfies Neo4jGraphBootstrapResult);
    expect(cypher).toHaveLength(result.statementsExecuted);
  });

  it("syncs and rebuilds graph documents and relations", async () => {
    const cypher: string[] = [];
    const client: Neo4jCypherClient = {
      async run<Row = Record<string, unknown>>(
        statement: string,
        params?: Record<string, unknown>,
      ): Promise<Neo4jQueryResult<Row>> {
        cypher.push(statement);
        return { records: [] };
      },
    };

    const store = new Neo4jGraphStore({
      backend: "neo4j",
      environment: "service",
      client,
    });

    const distillation = makeDistillationResult();
    const sync = await store.syncFromDistillation(distillation);
    const bundle: MetadataBundle = {
      events: [distillation.event],
      atoms: distillation.atoms,
      entities: distillation.entities,
      scenarios: distillation.scenarios,
      problems: distillation.problems,
      evidence: distillation.evidence,
      relations: distillation.relations,
    };
    const rebuild = await store.rebuildFromBundle(bundle);

    expect(sync.nodeCount).toBe(6);
    expect(sync.edgeCount).toBe(1);
    expect(rebuild.nodeCount).toBe(6);
    expect(rebuild.edgeCount).toBe(1);
    expect(cypher.filter((statement) => statement.includes("MERGE (n:"))).toHaveLength(12);
  });

  it("executes sync and rebuild inside Neo4j transactions when available", async () => {
    let transactionCalls = 0;
    const cypher: string[] = [];
    const client: Neo4jCypherClient = {
      async run<Row = Record<string, unknown>>(
        statement: string,
        params?: Record<string, unknown>,
      ): Promise<Neo4jQueryResult<Row>> {
        cypher.push(statement);
        return { records: [] };
      },
      async transaction<T>(
        runner: (transaction: { run: Neo4jCypherClient["run"] }) => Promise<T>,
      ): Promise<T> {
        transactionCalls += 1;
        return runner({
          run: async (statement: string, params?: Record<string, unknown>) => {
            cypher.push(statement);
            return { records: [] };
          },
        });
      },
    };

    const store = new Neo4jGraphStore({
      backend: "neo4j",
      environment: "service",
      client,
    });

    const distillation = makeDistillationResult();
    await store.syncFromDistillation(distillation);
    const bundle: MetadataBundle = {
      events: [distillation.event],
      atoms: distillation.atoms,
      entities: distillation.entities,
      scenarios: distillation.scenarios,
      problems: distillation.problems,
      evidence: distillation.evidence,
      relations: distillation.relations,
    };
    await store.rebuildFromBundle(bundle);

    expect(transactionCalls).toBe(2);
    expect(cypher.some((statement) => statement.includes("MERGE (n:MemoryAtom"))).toBe(true);
    expect(cypher.some((statement) => statement.includes("MERGE (from)-[r:"))).toBe(true);
  });

  it("does not commit staged graph operations when transaction aborts", async () => {
    let committedRuns = 0;
    const client: Neo4jCypherClient = {
      async run<Row = Record<string, unknown>>(
        statement: string,
        params?: Record<string, unknown>,
      ): Promise<Neo4jQueryResult<Row>> {
        committedRuns += 1;
        return { records: [] };
      },
      async transaction<T>(
        runner: (transaction: { run: Neo4jCypherClient["run"] }) => Promise<T>,
      ): Promise<T> {
        let stagedRuns = 0;
        try {
          const result = await runner({
            run: async (statement: string, params?: Record<string, unknown>) => {
              stagedRuns += 1;
              if (stagedRuns === 3) {
                throw new Error("abort transaction");
              }
              return { records: [] };
            },
          });
          committedRuns += stagedRuns;
          return result;
        } catch (error) {
          return Promise.reject(error);
        }
      },
    };

    const store = new Neo4jGraphStore({
      backend: "neo4j",
      environment: "service",
      client,
    });

    await expect(store.syncFromDistillation(makeDistillationResult())).rejects.toThrow(
      "abort transaction",
    );
    expect(committedRuns).toBe(0);
  });
});
