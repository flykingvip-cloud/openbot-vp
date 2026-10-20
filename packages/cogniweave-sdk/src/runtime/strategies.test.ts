import { describe, expect, it } from "vitest";
import type { DistillationResult, Scope, TaskFrame } from "../models.js";
import {
  LlmFallbackDistillationStrategy,
  LlmFallbackTaskFramingStrategy,
  RuleBasedDistillationStrategy,
} from "./strategies.js";

const scope: Scope = {
  workspaceId: "ws_1",
  projectId: "proj_1",
  agentId: "agent_main",
  visibility: "private",
};

function createTaskFrame(taskType: string): TaskFrame {
  return {
    id: "tf_llm",
    scope,
    taskType,
    goals: ["goal"],
    problems: [],
    scenarioTags: [],
    constraints: [],
    entities: [],
    requiredAtomTypes: [],
    provenance: { sourceType: "external" },
  };
}

function createDistillationResult(eventId: string): DistillationResult {
  return {
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
      profile: "llm_multi_call",
      stageCoverage: 1,
      stageFallbackRate: 0,
      stageDecisions: [
        {
          stage: "event",
          llmResponded: true,
          usedLlmOutput: true,
          fallbackToRule: false,
        },
        {
          stage: "context",
          llmResponded: true,
          usedLlmOutput: true,
          fallbackToRule: false,
        },
        {
          stage: "atoms",
          llmResponded: true,
          usedLlmOutput: true,
          fallbackToRule: false,
        },
        {
          stage: "relations",
          llmResponded: true,
          usedLlmOutput: true,
          fallbackToRule: false,
        },
      ],
    },
  };
}

describe("runtime strategies", () => {
  it("uses llm provider for low-confidence task framing", async () => {
    const strategy = new LlmFallbackTaskFramingStrategy({
      llmProvider: {
        frame: async () => createTaskFrame("planning"),
      },
    });

    const result = await strategy.frame({
      rawInput: "hello",
      config: {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      scope,
    });

    expect(result.source).toBe("llm");
    expect(result.taskFrame.taskType).toBe("planning");
  });

  it("uses llm provider when forceLlm is true", async () => {
    const strategy = new LlmFallbackTaskFramingStrategy({
      llmProvider: {
        frame: async () => createTaskFrame("support"),
      },
    });

    const result = await strategy.frame({
      rawInput: "throughput dropped due to sync retries",
      config: {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      scope,
      forceLlm: true,
    });

    expect(result.source).toBe("llm");
    expect(result.taskFrame.taskType).toBe("support");
  });

  it("falls back to rule distillation when llm returns null", async () => {
    const strategy = new LlmFallbackDistillationStrategy({
      llmProvider: {
        distill: async () => null,
      },
    });
    const ruleStrategy = new RuleBasedDistillationStrategy();

    const input = {
      rawInput: "Throughput dropped and external API is slow. Should we use async batching?",
      config: {
        environment: "local" as const,
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      scope,
      sourceType: "chat" as const,
    };

    const [actual, expected] = await Promise.all([
      strategy.distill(input),
      ruleStrategy.distill(input),
    ]);

    expect(actual.event.eventKey).toBe(expected.event.eventKey);
    expect(actual.keys.eventKey).toBe(expected.keys.eventKey);
  });

  it("uses llm distillation result when available", async () => {
    const llmResult = createDistillationResult("evt_llm_distill");
    const strategy = new LlmFallbackDistillationStrategy({
      llmProvider: {
        distill: async () => llmResult,
      },
    });

    const result = await strategy.distill({
      rawInput: "anything",
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

    expect(result.event.id).toBe("evt_llm_distill");
    expect(result.keys.eventKey).toBe("event_key_evt_llm_distill");
  });

  it("uses llm event stage and rule atom stage when llm atoms are incomplete", async () => {
    const llmResult = createDistillationResult("evt_llm_stage");
    const strategy = new LlmFallbackDistillationStrategy({
      llmProvider: {
        distill: async () => llmResult,
      },
    });

    const result = await strategy.distill({
      rawInput: "Throughput dropped with sync retry under high latency.",
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

    expect(result.event.id).toBe("evt_llm_stage");
    expect(result.atoms.length).toBeGreaterThan(0);
    expect(result.event.linkedAtoms.length).toBe(result.atoms.length);
    expect(result.quality.profile).toBe("llm_multi_call");
    expect(result.quality.stageCoverage).toBe(1);
    expect(result.quality.stageFallbackRate).toBeGreaterThan(0);
    expect(
      result.quality.stageDecisions.some(
        (decision) => decision.stage === "atoms" && decision.fallbackToRule,
      ),
    ).toBe(true);
    expect(
      result.atoms.every((atom) =>
        atom.provenance.sourceEventIds.every((eventId) => eventId === "evt_llm_stage"),
      ),
    ).toBe(true);
  });

  it("falls back to rule keys when llm keys are incomplete", async () => {
    const llmResult = createDistillationResult("evt_llm_bad_keys");
    llmResult.keys.ingestionChecksum = "";
    llmResult.keys.eventKey = "";

    const strategy = new LlmFallbackDistillationStrategy({
      llmProvider: {
        distill: async () => llmResult,
      },
    });
    const ruleStrategy = new RuleBasedDistillationStrategy();

    const input = {
      rawInput: "External API is slow and sync retries are blocking queue throughput.",
      config: {
        environment: "local" as const,
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      scope,
      sourceType: "chat" as const,
    };

    const [actual, expected] = await Promise.all([
      strategy.distill(input),
      ruleStrategy.distill(input),
    ]);
    expect(actual.event.id).toBe("evt_llm_bad_keys");
    expect(actual.keys.eventKey).toBe(expected.keys.eventKey);
    expect(actual.keys.ingestionChecksum).toBe(expected.keys.ingestionChecksum);
  });
});
