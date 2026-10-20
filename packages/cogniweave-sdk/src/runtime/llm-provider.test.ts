import { afterEach, describe, expect, it, vi } from "vitest";
import type { Scope } from "../models.js";
import {
  createHttpDistillationProvider,
  createHttpTaskFramingProvider,
  HttpDistillationProvider,
  HttpTaskFramingProvider,
  MultiCallHttpDistillationProvider,
} from "./llm-provider.js";

const scope: Scope = {
  workspaceId: "ws_1",
  projectId: "proj_1",
  agentId: "agent_main",
  visibility: "private",
};

function createDistillationFixture(eventId: string, overrides?: Record<string, unknown>) {
  return {
    distillationResult: {
      event: {
        id: eventId,
        scope,
        goal: "goal",
        context: "context",
        constraints: [],
        decisions: [],
        turningPoints: [],
        linkedAtoms: [],
        evidenceRefs: [],
        eventKey: `event_key_${eventId}`,
        provenance: { sourceType: "chat" },
      },
      atoms: [],
      entities: [],
      scenarios: [],
      problems: [],
      relations: [],
      evidence: [],
      keys: {
        ingestionChecksum: `ing_${eventId}`,
        eventKey: `event_key_${eventId}`,
        atomDedupKeys: [],
        entityKeys: [],
        scenarioKeys: [],
        problemKeys: [],
      },
      writePlan: {
        canonicalObjectTypes: ["EventSkeleton"],
        relationIds: [],
        graphNodeIds: [eventId],
        graphEdgeIds: [],
        vectorDocumentIds: [eventId],
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
      ...(overrides ?? {}),
    },
  };
}

describe("HTTP LLM task framing provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns undefined when endpoint is not configured", () => {
    const provider = createHttpTaskFramingProvider({
      environment: "local",
      metadataBackend: "memory",
      graphBackend: "memory",
      evidenceBackend: "memory",
      vectorBackend: "memory",
    });
    expect(provider).toBeUndefined();
  });

  it("returns task frame when remote endpoint returns valid payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          taskFrame: {
            id: "tf_remote_1",
            taskType: "planning",
            scope,
            goals: ["plan rollout"],
            problems: [],
            scenarioTags: ["release"],
            constraints: [],
            entities: [],
            requiredAtomTypes: ["strategy"],
          },
        }),
      })),
    );

    const provider = new HttpTaskFramingProvider({
      endpoint: "https://llm.local/frame",
      apiKey: "test",
      model: "gpt-test",
      timeoutMs: 500,
    });
    const result = await provider.frame({
      rawInput: "plan this release",
      scope,
    });

    expect(result?.taskType).toBe("planning");
    expect(result?.requiredAtomTypes).toContain("strategy");
  });

  it("returns null on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: "bad request" }),
      })),
    );

    const provider = new HttpTaskFramingProvider({
      endpoint: "https://llm.local/frame",
      timeoutMs: 500,
    });
    const result = await provider.frame({
      rawInput: "hello",
      scope,
    });
    expect(result).toBeNull();
  });

  it("returns undefined distillation provider when endpoint is not configured", () => {
    const provider = createHttpDistillationProvider({
      environment: "local",
      metadataBackend: "memory",
      graphBackend: "memory",
      evidenceBackend: "memory",
      vectorBackend: "memory",
    });
    expect(provider).toBeUndefined();
  });

  it("returns distillation result when remote payload is valid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => createDistillationFixture("evt_remote"),
      })),
    );

    const provider = new HttpDistillationProvider({
      endpoint: "https://llm.local/distill",
      timeoutMs: 500,
    });
    const result = await provider.distill({
      rawInput: "raw input",
      config: {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      scope,
      sourceType: "chat",
    });

    expect(result?.event.id).toBe("evt_remote");
    expect(result?.keys.eventKey).toBe("event_key_evt_remote");
    expect(result?.quality.profile).toBe("llm_single_call");
  });

  it("fills single-call quality when the payload omits it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => createDistillationFixture("evt_missing_quality", { quality: undefined }),
      })),
    );

    const provider = new HttpDistillationProvider({
      endpoint: "https://llm.local/distill",
      timeoutMs: 500,
    });
    const result = await provider.distill({
      rawInput: "raw input",
      config: {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      scope,
      sourceType: "chat",
    });

    expect(result?.quality).toEqual({
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
    });
  });

  it("treats an array quality payload as an empty quality object", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => createDistillationFixture("evt_array_quality", { quality: [] }),
      })),
    );

    const provider = new HttpDistillationProvider({
      endpoint: "https://llm.local/distill",
      timeoutMs: 500,
    });
    const result = await provider.distill({
      rawInput: "raw input",
      config: {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      scope,
      sourceType: "chat",
    });

    expect(result?.quality.profile).toBe("llm_single_call");
    expect(result?.quality.stageDecisions).toEqual([]);
    expect(result?.quality.stageCoverage).toBe(0);
    expect(result?.quality.stageFallbackRate).toBe(0);
  });

  it("creates multi-call provider when configured", () => {
    const provider = createHttpDistillationProvider({
      environment: "local",
      metadataBackend: "memory",
      graphBackend: "memory",
      evidenceBackend: "memory",
      vectorBackend: "memory",
      llmDistillationEndpoint: "https://llm.local/distill",
      llmDistillationProfile: "multi_call",
    });
    expect(provider).toBeInstanceOf(MultiCallHttpDistillationProvider);
  });

  it("runs staged multi-call distillation and merges stage outputs", async () => {
    const seenStages: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        const metadata = (body.metadata ?? {}) as Record<string, string>;
        const stage = metadata.__distill_stage ?? "unknown";
        seenStages.push(stage);

        if (stage === "event") {
          return {
            ok: true,
            json: async () =>
              createDistillationFixture("evt_stage", {
                event: {
                  id: "evt_stage",
                  scope,
                  goal: "event_goal",
                  context: "context",
                  constraints: [],
                  decisions: ["event_decision"],
                  turningPoints: [],
                  linkedAtoms: [],
                  evidenceRefs: ["evd_1"],
                  eventKey: "event_key_stage",
                  provenance: { sourceType: "chat" },
                },
              }),
          };
        }
        if (stage === "atoms") {
          return {
            ok: true,
            json: async () =>
              createDistillationFixture("evt_stage", {
                event: {
                  id: "evt_stage",
                  scope,
                  goal: "",
                  context: "",
                  constraints: [],
                  decisions: [],
                  turningPoints: [],
                  linkedAtoms: ["atm_1"],
                  evidenceRefs: ["evd_1"],
                  eventKey: "event_key_stage",
                  provenance: { sourceType: "chat" },
                },
                atoms: [
                  {
                    id: "atm_1",
                    atomType: "strategy",
                    scope,
                    claim: { type: "procedural", statement: "Use async buffering" },
                    trigger: { conditions: ["high_latency"], contextTags: ["performance"] },
                    applicability: { include: ["worker_pipeline"], exclude: [] },
                    provenance: { sourceEventIds: ["evt_stage"], evidenceRefs: ["evd_1"] },
                    versioning: { version: 1 },
                    state: { status: "active", conflictsWith: [] },
                    metrics: { confidence: 0.7, reuseCount: 0 },
                    dedupKey: "dedup_atm_1",
                  },
                ],
                keys: {
                  ingestionChecksum: "ing_stage",
                  eventKey: "event_key_stage",
                  atomDedupKeys: ["dedup_atm_1"],
                  entityKeys: [],
                  scenarioKeys: [],
                  problemKeys: [],
                },
                writePlan: {
                  canonicalObjectTypes: ["EventSkeleton", "MemoryAtom"],
                  relationIds: [],
                  graphNodeIds: ["evt_stage", "atm_1"],
                  graphEdgeIds: [],
                  vectorDocumentIds: ["evt_stage", "atm_1"],
                },
              }),
          };
        }

        return {
          ok: true,
          json: async () => createDistillationFixture("evt_stage"),
        };
      }),
    );

    const provider = createHttpDistillationProvider({
      environment: "local",
      metadataBackend: "memory",
      graphBackend: "memory",
      evidenceBackend: "memory",
      vectorBackend: "memory",
      llmDistillationEndpoint: "https://llm.local/distill",
      llmDistillationProfile: "multi_call",
      llmDistillationStages: ["event", "atoms"],
    });
    const result = await provider?.distill({
      rawInput: "input",
      config: {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      scope,
      sourceType: "chat",
      metadata: { trace: "1" },
    });

    expect(seenStages).toEqual(["event", "atoms"]);
    expect(result?.event.id).toBe("evt_stage");
    expect(result?.event.goal).toBe("event_goal");
    expect(result?.atoms.length).toBe(1);
    expect(result?.atoms[0]?.dedupKey).toBe("dedup_atm_1");
    expect(result?.quality.profile).toBe("llm_multi_call");
    expect(result?.quality.stageCoverage).toBe(1);
    expect(result?.quality.stageFallbackRate).toBe(0);
    expect(result?.quality.stageDecisions.map((decision) => decision.stage)).toEqual([
      "event",
      "atoms",
    ]);
  });

  it("tracks stage fallback metrics when a multi-call stage has no llm response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        const metadata = (body.metadata ?? {}) as Record<string, string>;
        const stage = metadata.__distill_stage ?? "unknown";

        if (stage === "atoms") {
          return {
            ok: false,
            json: async () => ({ error: "timeout" }),
          };
        }

        return {
          ok: true,
          json: async () => createDistillationFixture("evt_stage_fallback"),
        };
      }),
    );

    const provider = new MultiCallHttpDistillationProvider({
      endpoint: "https://llm.local/distill",
      stages: ["event", "atoms", "relations"],
      timeoutMs: 500,
    });
    const result = await provider.distill({
      rawInput: "input",
      config: {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      scope,
      sourceType: "chat",
    });

    expect(result?.quality.profile).toBe("llm_multi_call");
    expect(result?.quality.stageCoverage).toBeCloseTo(2 / 3, 6);
    expect(result?.quality.stageFallbackRate).toBeCloseTo(1 / 3, 6);
    expect(result?.quality.stageDecisions).toEqual([
      {
        stage: "event",
        llmResponded: true,
        usedLlmOutput: true,
        fallbackToRule: false,
      },
      {
        stage: "atoms",
        llmResponded: false,
        usedLlmOutput: false,
        fallbackToRule: true,
      },
      {
        stage: "relations",
        llmResponded: true,
        usedLlmOutput: true,
        fallbackToRule: false,
      },
    ]);
  });
});
