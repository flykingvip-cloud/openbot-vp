import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DistillationResult,
  MemoryAtom,
  PathTemplate,
  PostgresQueryResult,
  PostgresSqlClient,
  RelationRecord,
  Neo4jCypherClient,
} from "../index.js";
import {
  InMemoryCogniWeaveEngine,
  InMemoryGraphStore,
  InMemoryMetadataStore,
  ScopeViolationError,
  TemplateRegistry,
  InMemoryVectorStore,
  Neo4jGraphStore,
  PgVectorStore,
  createCogniWeaveRuntime,
} from "../index.js";

class FailingOnceGraphStore extends InMemoryGraphStore {
  private failed = false;

  override async syncFromDistillation(
    result: DistillationResult,
  ): Promise<{ nodeCount: number; edgeCount: number }> {
    if (!this.failed) {
      this.failed = true;
      throw new Error("simulated graph sync failure");
    }
    return super.syncFromDistillation(result);
  }
}

class CountingGraphStore extends InMemoryGraphStore {
  syncCalls = 0;

  override async syncFromDistillation(
    result: DistillationResult,
  ): Promise<{ nodeCount: number; edgeCount: number }> {
    this.syncCalls += 1;
    return super.syncFromDistillation(result);
  }
}

class CountingVectorStore extends InMemoryVectorStore {
  syncCalls = 0;

  override async syncFromDistillation(
    result: DistillationResult,
  ): Promise<{ documentCount: number }> {
    this.syncCalls += 1;
    return super.syncFromDistillation(result);
  }
}

class FailingTransactionMetadataStore extends InMemoryMetadataStore {
  override async withTransaction<T>(runner: () => Promise<T>): Promise<T> {
    throw new Error("simulated metadata transaction failure");
  }
}

class TrackingTransactionMetadataStore extends InMemoryMetadataStore {
  transactionCalls = 0;

  override async withTransaction<T>(runner: () => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return super.withTransaction(runner);
  }
}

function createAtom(input: {
  id: string;
  atomType: string;
  claim: string;
  scope: {
    workspaceId: string;
    projectId: string;
    agentId: string;
    visibility: "private";
  };
  confidence?: number;
  triggerConditions?: string[];
  contextTags?: string[];
}): MemoryAtom {
  return {
    id: input.id,
    atomType: input.atomType,
    scope: input.scope,
    claim: {
      type: "causal",
      statement: input.claim,
    },
    trigger: {
      conditions: input.triggerConditions ?? [],
      contextTags: input.contextTags ?? [],
    },
    applicability: {
      include: [],
      exclude: [],
    },
    provenance: {
      sourceEventIds: [],
      evidenceRefs: [],
    },
    versioning: {
      version: 1,
    },
    state: {
      status: "active",
      conflictsWith: [],
    },
    metrics: {
      confidence: input.confidence ?? 0.7,
      reuseCount: 0,
    },
  };
}

describe("InMemoryCogniWeaveEngine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const scope = {
    workspaceId: "ws_1",
    projectId: "proj_1",
    agentId: "agent_main",
    visibility: "private" as const,
  };

  it("runs the minimal frame -> reason -> writeBack -> tracePackage loop", async () => {
    const metadataStore = new InMemoryMetadataStore();
    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      { metadataStore },
    );

    const rawInput =
      "Current throughput is dropping and the external API is slow. Should we use async batching instead of synchronous retries?";

    const task = await engine.frameTask(rawInput, { scope });
    const initialPackage = await engine.reason(task);
    const writeResult = await engine.writeBack({
      rawInput,
      scope,
      sourceType: "chat",
      sourceSessionId: "sess_minimal",
      package: initialPackage,
    });
    const packageAfterWrite = await engine.reason(task);
    const [debugPackage, debugPayload] = await engine.reasonWithDebug(task);
    const trace = await engine.tracePackage(packageAfterWrite.packageId, { scope });

    expect(task.scope).toEqual(scope);
    expect(initialPackage.answer.summary.length).toBeGreaterThan(0);
    expect(debugPayload.selectedTemplate).toBe("debug_v1");
    expect(
      debugPackage.reasoningPath.some((path) => path.relationChain.includes("MITIGATES")),
    ).toBe(true);
    expect(writeResult.status).toBe("COMPLETED");
    expect(trace.package.packageId).toBe(packageAfterWrite.packageId);
    expect(trace.supportingAtoms.length).toBeGreaterThan(0);
    expect(metadataStore.listIngestions()).toHaveLength(1);
  });

  it("surfaces partial success and supports repair", async () => {
    const metadataStore = new InMemoryMetadataStore();
    const graphStore = new FailingOnceGraphStore();
    const vectorStore = new InMemoryVectorStore();
    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      { metadataStore, graphStore, vectorStore },
    );

    const writeResult = await engine.writeBack({
      rawInput: "Throughput is dropping and the external API is slow. Should we add sync retries?",
      scope,
      sourceType: "chat",
      sourceSessionId: "sess_partial",
    });

    expect(writeResult.status).toBe("PARTIAL_SUCCESS");
    expect(writeResult.canonicalStatus).toBe("METADATA_COMMITTED");
    expect(writeResult.derivedStatus).toBe("DERIVED_OUT_OF_SYNC");

    const journalBefore = await engine.getWriteJournal(writeResult.journalId, scope);
    expect(journalBefore.status).toBe("DERIVED_OUT_OF_SYNC");

    const repair = await engine.repairIndexes({ journalId: writeResult.journalId });
    expect(repair.status).toBe("SYNCED");

    const journalAfter = await engine.getWriteJournal(writeResult.journalId, scope);
    expect(journalAfter.status).toBe("COMPLETED");
  });

  it("uses metadata transaction hook for canonical commit when available", async () => {
    const metadataStore = new TrackingTransactionMetadataStore();
    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      {
        metadataStore,
        graphStore: new InMemoryGraphStore(),
        vectorStore: new InMemoryVectorStore(),
      },
    );

    const writeResult = await engine.writeBack({
      rawInput: "Throughput dropped while external API latency increased.",
      scope,
      sourceType: "chat",
      sourceSessionId: "sess_tx_hook",
    });

    expect(writeResult.status).toBe("COMPLETED");
    expect(metadataStore.transactionCalls).toBe(1);
  });

  it("does not run derived sync when metadata transaction fails", async () => {
    const metadataStore = new FailingTransactionMetadataStore();
    const graphStore = new CountingGraphStore();
    const vectorStore = new CountingVectorStore();
    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      {
        metadataStore,
        graphStore,
        vectorStore,
      },
    );

    const writeResult = await engine.writeBack({
      rawInput: "Throughput dropped during high latency spike.",
      scope,
      sourceType: "chat",
      sourceSessionId: "sess_tx_fail",
    });

    expect(writeResult.status).toBe("FAILED");
    expect(writeResult.canonicalStatus).toBe("FAILED");
    expect(writeResult.derivedStatus).toBe("NOT_APPLICABLE");
    expect(graphStore.syncCalls).toBe(0);
    expect(vectorStore.syncCalls).toBe(0);

    const journal = await metadataStore.getJournal(writeResult.journalId);
    expect(journal?.status).toBe("FAILED");
    expect(journal?.lastError).toContain("simulated metadata transaction failure");
  });

  it("repairs derived indexes with sql-first graph/vector adapters after a derived failure", async () => {
    const metadataStore = new InMemoryMetadataStore();
    let neo4jTransactionCalls = 0;
    let pgvectorTransactionCalls = 0;
    let vectorSyncFailedOnce = false;

    const neo4jClient: Neo4jCypherClient = {
      async run<Row = Record<string, unknown>>(
        statement: string,
        params?: Record<string, unknown>,
      ) {
        return { records: [] as Row[] };
      },
      async transaction<T>(
        runner: (transaction: { run: Neo4jCypherClient["run"] }) => Promise<T>,
      ): Promise<T> {
        neo4jTransactionCalls += 1;
        return runner({
          run: async (statement: string, params?: Record<string, unknown>) => ({ records: [] }),
        });
      },
    };

    const pgvectorClient: PostgresSqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        params?: readonly unknown[],
      ): Promise<PostgresQueryResult<Row>> {
        if (!vectorSyncFailedOnce && sql.includes("insert into")) {
          vectorSyncFailedOnce = true;
          throw new Error("simulated pgvector sync failure");
        }
        return { rows: [] as Row[], rowCount: 1 };
      },
      async transaction<T>(
        runner: (transaction: { query: PostgresSqlClient["query"] }) => Promise<T>,
      ): Promise<T> {
        pgvectorTransactionCalls += 1;
        return runner({
          query: async (sql: string, params?: readonly unknown[]) => {
            if (!vectorSyncFailedOnce && sql.includes("insert into")) {
              vectorSyncFailedOnce = true;
              throw new Error("simulated pgvector sync failure");
            }
            return { rows: [], rowCount: 1 };
          },
        });
      },
    };

    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "service",
        metadataBackend: "postgres",
        graphBackend: "neo4j",
        evidenceBackend: "s3",
        vectorBackend: "pgvector",
      },
      {
        metadataStore,
        graphStore: new Neo4jGraphStore({
          backend: "neo4j",
          environment: "service",
          client: neo4jClient,
        }),
        vectorStore: new PgVectorStore({
          backend: "pgvector",
          environment: "service",
          client: pgvectorClient,
        }),
      },
    );

    const writeResult = await engine.writeBack({
      rawInput:
        "Throughput dropped and external API latency is high. Should we add synchronous retries?",
      scope,
      sourceType: "chat",
      sourceSessionId: "sess_sql_first_partial",
    });

    expect(writeResult.status).toBe("PARTIAL_SUCCESS");
    expect(writeResult.derivedStatus).toBe("DERIVED_OUT_OF_SYNC");

    const journalBefore = await engine.getWriteJournal(writeResult.journalId, scope);
    expect(journalBefore.status).toBe("DERIVED_OUT_OF_SYNC");

    const repair = await engine.repairIndexes({ journalId: writeResult.journalId });
    expect(repair.status).toBe("SYNCED");
    expect(repair.repairedCount).toBe(1);

    const journalAfter = await engine.getWriteJournal(writeResult.journalId, scope);
    expect(journalAfter.status).toBe("COMPLETED");
    expect(neo4jTransactionCalls).toBeGreaterThanOrEqual(2);
    expect(pgvectorTransactionCalls).toBeGreaterThanOrEqual(2);
  });

  it("canonicalizes repeated writeBack results before saving event and relations", async () => {
    const metadataStore = new InMemoryMetadataStore();
    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      {
        metadataStore,
        graphStore: new InMemoryGraphStore(),
        vectorStore: new InMemoryVectorStore(),
      },
    );

    const rawInput =
      "Current throughput is dropping and the external API is slow. Should we add synchronous retries?";

    const first = await engine.writeBack({
      rawInput,
      scope,
      sourceType: "chat",
      sourceSessionId: "sess_merge_1",
    });
    const countsAfterFirst = metadataStore.snapshotCounts();
    const second = await engine.writeBack({
      rawInput,
      scope,
      sourceType: "chat",
      sourceSessionId: "sess_merge_2",
    });

    expect(second.atomIds).toEqual(first.atomIds);

    const event = await metadataStore.getEvent(second.eventId);
    expect(event?.linkedAtoms.slice().sort()).toEqual(second.atomIds.slice().sort());

    const journal = await engine.getWriteJournal(second.journalId, scope);
    const bundle = await metadataStore.getBundleForJournal(journal);
    const nodeIds = new Set([
      ...bundle.events.map((item) => item.id),
      ...bundle.atoms.map((item) => item.id),
      ...bundle.entities.map((item) => item.id),
      ...bundle.scenarios.map((item) => item.id),
      ...bundle.problems.map((item) => item.id),
      ...bundle.evidence.map((item) => item.id),
    ]);

    expect(
      bundle.relations.every(
        (relation) => nodeIds.has(relation.fromId) && nodeIds.has(relation.toId),
      ),
    ).toBe(true);
    const countsAfterSecond = metadataStore.snapshotCounts();
    expect(countsAfterSecond.atoms).toBe(countsAfterFirst.atoms);
    expect(countsAfterSecond.entities).toBe(countsAfterFirst.entities);
    expect(countsAfterSecond.scenarios).toBe(countsAfterFirst.scenarios);
    expect(countsAfterSecond.problems).toBe(countsAfterFirst.problems);
    expect(countsAfterSecond.evidence).toBe(countsAfterFirst.evidence);
    expect(countsAfterSecond.relations).toBe(countsAfterFirst.relations);
  });

  it("enforces full scope matching in conflict queries", async () => {
    const metadataStore = new InMemoryMetadataStore();
    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      {
        metadataStore,
        graphStore: new InMemoryGraphStore(),
        vectorStore: new InMemoryVectorStore(),
      },
    );

    const otherScope = {
      ...scope,
      projectId: "proj_2",
    };

    const first = await engine.writeBack({
      rawInput: "External API is slow and throughput is dropping.",
      scope,
      sourceType: "chat",
      sourceSessionId: "sess_scope_1",
    });
    const second = await engine.writeBack({
      rawInput: "External API is slow and throughput is dropping.",
      scope: otherScope,
      sourceType: "chat",
      sourceSessionId: "sess_scope_2",
    });

    const result = await engine.detectConflicts({ scope });
    const conflicts = result.conflicts as Array<{ atomId: string }>;

    expect(conflicts.every((entry) => first.atomIds.includes(entry.atomId))).toBe(true);
    expect(conflicts.some((entry) => second.atomIds.includes(entry.atomId))).toBe(false);
  });

  it("uses fallback then cache path for low-confidence task framing", async () => {
    const engine = new InMemoryCogniWeaveEngine({
      environment: "local",
      metadataBackend: "memory",
      graphBackend: "memory",
      evidenceBackend: "memory",
      vectorBackend: "memory",
      enableLlmTaskFraming: true,
    });

    const first = await engine.frameTask("hello", { scope });
    const second = await engine.frameTask("hello", { scope });

    expect(first.provenance?.hintsApplied ?? []).toContain("llm_fallback");
    expect(second.provenance?.hintsApplied ?? []).toContain("cache_hit");
    expect(second.id).toBe(first.id);
  });

  it("supports forceLlm framing override", async () => {
    const engine = new InMemoryCogniWeaveEngine({
      environment: "local",
      metadataBackend: "memory",
      graphBackend: "memory",
      evidenceBackend: "memory",
      vectorBackend: "memory",
      enableLlmTaskFraming: true,
    });

    const forced = await engine.frameTask(
      "Current throughput is dropping and the external API is slow. Should we add synchronous retries?",
      { scope, forceLlm: true },
    );

    expect(forced.provenance?.hintsApplied ?? []).toContain("llm_fallback_forced");
  });

  it("uses configured HTTP LLM task framing provider when fallback is needed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          taskFrame: {
            id: "tf_http_provider",
            taskType: "support",
            scope,
            goals: ["respond"],
            problems: [],
            scenarioTags: [],
            constraints: [],
            entities: [],
            requiredAtomTypes: ["preference", "strategy"],
          },
        }),
      })),
    );

    const engine = new InMemoryCogniWeaveEngine({
      environment: "local",
      metadataBackend: "memory",
      graphBackend: "memory",
      evidenceBackend: "memory",
      vectorBackend: "memory",
      enableLlmTaskFraming: true,
      llmTaskFramingEndpoint: "https://llm.local/frame",
      llmRequestTimeoutMs: 500,
    });

    const framed = await engine.frameTask("hello", { scope });
    expect(framed.taskType).toBe("support");
    expect(framed.provenance?.hintsApplied ?? []).toContain("llm_fallback");
  });

  it("uses configured HTTP LLM distillation provider during writeBack", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        distillationResult: {
          event: {
            id: "evt_http_distill",
            scope,
            goal: "goal",
            context: "context",
            constraints: [],
            decisions: [],
            turningPoints: [],
            linkedAtoms: [],
            evidenceRefs: [],
            eventKey: "event_key_http_distill",
            provenance: { sourceType: "chat" },
          },
          atoms: [],
          entities: [],
          scenarios: [],
          problems: [],
          relations: [],
          evidence: [],
          keys: {
            ingestionChecksum: "ing_http_distill",
            eventKey: "event_key_http_distill",
            atomDedupKeys: [],
            entityKeys: [],
            scenarioKeys: [],
            problemKeys: [],
          },
          writePlan: {
            canonicalObjectTypes: ["EventSkeleton"],
            relationIds: [],
            graphNodeIds: ["evt_http_distill"],
            graphEdgeIds: [],
            vectorDocumentIds: ["evt_http_distill"],
          },
          quality: {
            profile: "llm_single_call",
            stageCoverage: 1,
            stageFallbackRate: 0,
            stageDecisions: [
              {
                stage: "single_call",
                llmResponded: true,
                usedLlmOutput: true,
                fallbackToRule: false,
              },
            ],
          },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const engine = new InMemoryCogniWeaveEngine({
      environment: "local",
      metadataBackend: "memory",
      graphBackend: "memory",
      evidenceBackend: "memory",
      vectorBackend: "memory",
      enableLlmDistillation: true,
      llmDistillationEndpoint: "https://llm.local/distill",
      llmRequestTimeoutMs: 500,
    });

    const write = await engine.writeBack({
      rawInput: "any input",
      scope,
      sourceType: "chat",
      sourceSessionId: "sess_http_distill",
    });

    expect(write.eventId).toBe("evt_http_distill");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("supports pluggable task framing and distillation strategies", async () => {
    const customDistillation: DistillationResult = {
      event: {
        id: "evt_custom_strategy",
        scope,
        goal: "custom goal",
        context: "custom context",
        constraints: [],
        decisions: [],
        turningPoints: [],
        linkedAtoms: [],
        evidenceRefs: [],
        eventKey: "event_key_custom",
        provenance: { sourceType: "chat" },
      },
      atoms: [],
      entities: [],
      scenarios: [],
      problems: [],
      relations: [],
      evidence: [],
      keys: {
        ingestionChecksum: "ing_custom",
        eventKey: "event_key_custom",
        atomDedupKeys: [],
        entityKeys: [],
        scenarioKeys: [],
        problemKeys: [],
      },
      writePlan: {
        canonicalObjectTypes: ["EventSkeleton"],
        relationIds: [],
        graphNodeIds: ["evt_custom_strategy"],
        graphEdgeIds: [],
        vectorDocumentIds: ["evt_custom_strategy"],
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

    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      {
        taskFramingStrategy: {
          frame: () => ({
            taskFrame: {
              id: "tf_custom_strategy",
              scope,
              taskType: "planning",
              goals: ["custom_plan_goal"],
              problems: [],
              scenarioTags: [],
              constraints: [],
              entities: [],
              requiredAtomTypes: ["strategy"],
              provenance: { sourceType: "external" },
            },
            confidence: 0.95,
            source: "rule",
          }),
        },
        distillationStrategy: {
          distill: () => customDistillation,
        },
      },
    );

    const framed = await engine.frameTask("any input", { scope });
    expect(framed.taskType).toBe("planning");
    expect(framed.provenance?.hintsApplied ?? []).toContain("rule_based");

    const distilled = await engine.distill({
      rawInput: "any input",
      scope,
      sourceType: "chat",
      sourceSessionId: "sess_custom_strategy",
    });
    expect(distilled.event.id).toBe("evt_custom_strategy");
  });

  it("expands multiple template-constrained paths from one seed", async () => {
    const metadataStore = new InMemoryMetadataStore();
    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      {
        metadataStore,
        graphStore: new InMemoryGraphStore(),
        vectorStore: new InMemoryVectorStore(),
      },
    );

    const failureAtom = createAtom({
      id: "atm_failure_seed",
      atomType: "failure_pattern",
      claim: "Synchronous retries under high latency reduce throughput.",
      triggerConditions: ["high_latency", "sync_retry"],
      contextTags: ["throughput_drop"],
      scope,
      confidence: 0.8,
    });
    const strategyA = createAtom({
      id: "atm_strategy_a",
      atomType: "strategy",
      claim: "Use async batching to isolate upstream latency.",
      triggerConditions: ["high_latency"],
      scope,
      confidence: 0.76,
    });
    const strategyB = createAtom({
      id: "atm_strategy_b",
      atomType: "strategy",
      claim: "Use queue buffering instead of synchronous retry loops.",
      triggerConditions: ["sync_retry", "high_latency"],
      scope,
      confidence: 0.72,
    });

    await metadataStore.saveAtom(failureAtom);
    await metadataStore.saveAtom(strategyA);
    await metadataStore.saveAtom(strategyB);

    const relationA: RelationRecord = {
      id: "rel_mitigates_a",
      fromId: strategyA.id,
      fromNodeType: "MemoryAtom",
      relationType: "MITIGATES",
      toId: failureAtom.id,
      toNodeType: "MemoryAtom",
      scope,
      confidence: 0.82,
      status: "active",
      provenance: { sourceEventIds: [], evidenceRefs: [] },
    };
    const relationB: RelationRecord = {
      id: "rel_mitigates_b",
      fromId: strategyB.id,
      fromNodeType: "MemoryAtom",
      relationType: "MITIGATES",
      toId: failureAtom.id,
      toNodeType: "MemoryAtom",
      scope,
      confidence: 0.77,
      status: "active",
      provenance: { sourceEventIds: [], evidenceRefs: [] },
    };
    await metadataStore.saveRelation(relationA);
    await metadataStore.saveRelation(relationB);

    const task = await engine.frameTask(
      "Throughput dropped during high latency and sync retry loops. Which async strategy should we use?",
      { scope },
    );
    const [pkg, debug] = await engine.reasonWithDebug(task, { maxPaths: 5 });

    expect(debug.selectedTemplate).toBe("debug_v1");
    expect(pkg.reasoningPath.length).toBeGreaterThanOrEqual(2);
    expect(pkg.reasoningPath.every((path) => path.relationChain.includes("MITIGATES"))).toBe(true);
  });

  it("uses injected template registry for selection", async () => {
    const supportTemplate: PathTemplate = {
      id: "support_v2",
      startNodeTypes: ["MemoryAtom"],
      startAtomTypes: ["preference"],
      steps: [],
    };
    const templateRegistry = new TemplateRegistry({
      templates: [
        {
          id: "generic_v1",
          startNodeTypes: ["MemoryAtom"],
          steps: [],
        },
        supportTemplate,
      ],
      taskBindings: {
        support: ["support_v2"],
      },
      defaultTemplateId: "generic_v1",
    });

    const metadataStore = new InMemoryMetadataStore();
    await metadataStore.saveAtom(
      createAtom({
        id: "atm_preference_support",
        atomType: "preference",
        claim: "Customer prefers reliability evidence before feature pitch.",
        triggerConditions: ["customer_update"],
        scope,
      }),
    );

    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      { metadataStore, templateRegistry },
    );

    const task = await engine.frameTask("客户偏好先看稳定性数据，请给沟通策略。", { scope });
    const [, debug] = await engine.reasonWithDebug(task);
    expect(debug.selectedTemplate).toBe("support_v2");
  });

  it("falls back to scored candidate atoms when debug template has no seed matches", async () => {
    const metadataStore = new InMemoryMetadataStore();
    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      {
        metadataStore,
        graphStore: new InMemoryGraphStore(),
        vectorStore: new InMemoryVectorStore(),
      },
    );

    const strategyAtom = createAtom({
      id: "atm_strategy_seedless",
      atomType: "strategy",
      claim: "Use asynchronous batching to reduce retry amplification risk.",
      triggerConditions: ["sync_call", "idempotency_risk"],
      scope,
      confidence: 0.78,
    });
    const constraintAtom = createAtom({
      id: "atm_constraint_seedless",
      atomType: "constraint",
      claim: "Require idempotency safeguards before enabling retry paths.",
      triggerConditions: ["retry_enabled"],
      scope,
      confidence: 0.8,
    });

    await metadataStore.saveAtom(strategyAtom);
    await metadataStore.saveAtom(constraintAtom);

    const task = await engine.frameTask("同步调用改成异步批处理，但担心重复执行，需要什么约束？", {
      scope,
    });
    const [pkg, debug] = await engine.reasonWithDebug(task, { maxPaths: 5 });

    expect(debug.selectedTemplate).toBe("debug_v1");
    expect(debug.seedCandidates).toHaveLength(0);
    expect(pkg.supportingAtoms.length).toBeGreaterThan(0);
    expect(pkg.reasoningPath.length).toBeGreaterThan(0);
    expect(pkg.why.summary.length).toBeGreaterThan(0);
  });

  it("searches evidence snippets within the requested scope", async () => {
    const engine = new InMemoryCogniWeaveEngine({
      environment: "local",
      metadataBackend: "memory",
      graphBackend: "memory",
      evidenceBackend: "memory",
      vectorBackend: "memory",
    });
    await engine.writeBack({
      rawInput:
        "CogniWeave durable Markdown memory is the primary curated memory path for stable facts.",
      scope,
      sourceType: "document",
      sourceSessionId: "memory-doc",
    });
    await engine.writeBack({
      rawInput: "Noisy session history about marketing briefs should not outrank direct memory.",
      scope: { ...scope, projectId: "other_project" },
      sourceType: "chat",
      sourceSessionId: "noisy-session",
    });

    const results = await engine.searchEvidence("CogniWeave durable Markdown memory", {
      scope,
      maxResults: 5,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.evidence.uri).toBe("document://memory-doc");
    expect(results[0]?.matchedTokens).toEqual(
      expect.arrayContaining(["cogniweave", "durable", "markdown", "memory"]),
    );
    expect(results[0]?.exactPhraseMatch).toBe(true);

    const otherScopeResults = await engine.searchEvidence("CogniWeave durable Markdown memory", {
      scope: { ...scope, projectId: "other_project" },
      maxResults: 5,
    });
    expect(otherScopeResults).toHaveLength(0);
  });

  it("recovers canonical evidence and write journals from local metadata after restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cogniweave-sdk-local-"));
    const metadataStorePath = join(dir, "canonical.sqlite");
    const firstRuntime = createCogniWeaveRuntime({
      environment: "local",
      metadataBackend: "local",
      metadataStorePath,
      graphBackend: "memory",
      evidenceBackend: "memory",
      vectorBackend: "memory",
      defaultScope: scope,
    });
    const write = await firstRuntime.engine.writeBack({
      rawInput:
        "Persistent CogniWeave local store keeps canonical atoms and evidence after restart.",
      scope,
      sourceType: "document",
      sourceSessionId: "persistent-memory-doc",
    });

    const secondRuntime = createCogniWeaveRuntime({
      environment: "local",
      metadataBackend: "local",
      metadataStorePath,
      graphBackend: "memory",
      evidenceBackend: "memory",
      vectorBackend: "memory",
      defaultScope: scope,
    });
    const results = await secondRuntime.engine.searchEvidence("canonical atoms evidence restart", {
      scope,
      maxResults: 5,
    });
    const journal = await secondRuntime.engine.getWriteJournal(write.journalId, scope);

    expect(results[0]?.evidence.uri).toBe("document://persistent-memory-doc");
    expect(journal.id).toBe(write.journalId);
    expect(journal.status).toBe("COMPLETED");
    expect(journal.objectIds.atomIds.length).toBeGreaterThan(0);
    expect(journal.objectIds.evidenceIds).toContain(results[0]?.evidence.id);
  });

  it("enforces scope for evidence and trace reads", async () => {
    const engine = new InMemoryCogniWeaveEngine({
      environment: "local",
      metadataBackend: "memory",
      graphBackend: "memory",
      evidenceBackend: "memory",
      vectorBackend: "memory",
    });

    const rawInput =
      "Current throughput is dropping and the external API is slow. Should we use async batching instead of synchronous retries?";
    const task = await engine.frameTask(rawInput, { scope });
    const write = await engine.writeBack({
      rawInput,
      scope,
      sourceType: "chat",
      sourceSessionId: "sess_scope_guard",
    });
    const pkg = await engine.reason(task);

    await expect(engine.tracePackage(pkg.packageId)).rejects.toBeInstanceOf(ScopeViolationError);
    await expect(engine.getWriteJournal(write.journalId)).rejects.toBeInstanceOf(
      ScopeViolationError,
    );
    await expect(engine.resolveEvidence({ atomId: write.atomIds[0] })).rejects.toBeInstanceOf(
      ScopeViolationError,
    );
  });

  it("uses latest atom versions in reasoning", async () => {
    const metadataStore = new InMemoryMetadataStore();
    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      { metadataStore },
    );

    const v1 = createAtom({
      id: "atm_version_v1",
      atomType: "failure_pattern",
      claim: "Synchronous retries under high latency reduce throughput.",
      triggerConditions: ["high_latency"],
      contextTags: ["throughput_drop"],
      scope,
      confidence: 0.6,
    });
    const v2 = {
      ...createAtom({
        id: "atm_version_v2",
        atomType: "failure_pattern",
        claim: "Sync retry amplification under high latency causes queue blocking.",
        triggerConditions: ["high_latency"],
        contextTags: ["throughput_drop"],
        scope,
        confidence: 0.8,
      }),
      versioning: {
        version: 2,
        parentVersion: v1.id,
      },
    };
    await metadataStore.saveAtom(v1);
    await metadataStore.saveAtom(v2);

    const task = await engine.frameTask(
      "Throughput dropped because upstream latency is high. Need async strategy.",
      {
        scope,
      },
    );
    const result = await engine.reason(task);
    expect(result.supportingAtoms).toContain(v2.id);
    expect(result.supportingAtoms).not.toContain(v1.id);
  });
});
