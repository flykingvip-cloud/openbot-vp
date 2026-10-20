import { describe, expect, it } from "vitest";
import type {
  BackendCapability,
  BackendEvent,
  BackendRunResult,
  ExecutionBackend,
  RunContext,
  RunHandle,
} from "./backend.js";
import { createBuiltinCapabilityRegistry } from "./capabilities.js";
import { defaultModelCatalog } from "./catalog.js";
import { createBuiltinEvaluators } from "./evaluator.js";
import { EmaFeedbackStore } from "./feedback.js";
import { Orchestrator } from "./orchestrator.js";
import { RuleBasedTaskParser } from "./parser.js";
import { StaticGraphPlanner, type TaskGraph } from "./planner.js";
import { createBuiltinTaskTypeRegistry } from "./task-types.js";
import type { PlannedStep } from "./types.js";

/** Records the model it was asked to run and echoes a canned response. */
class FakeBackend implements ExecutionBackend {
  readonly id = "fake";
  lastStep?: PlannedStep;
  lastSessionKey?: string;
  constructor(private readonly responseText: string) {}

  capabilities(): Promise<BackendCapability> {
    return Promise.resolve({ models: defaultModelCatalog().map((m) => m.ref) });
  }

  run(step: PlannedStep, ctx: RunContext): Promise<RunHandle> {
    this.lastStep = step;
    this.lastSessionKey = ctx.sessionKey;
    return Promise.resolve({ runId: "r1" });
  }

  async *stream(): AsyncIterable<BackendEvent> {
    yield { kind: "lifecycle", phase: "start" };
    yield { kind: "assistant", delta: this.responseText };
    yield { kind: "lifecycle", phase: "end" };
  }

  wait(): Promise<BackendRunResult> {
    return Promise.resolve({
      text: this.responseText,
      usage: { inputTokens: 1000, outputTokens: 300, totalTokens: 1300, costUsd: 0.01 },
    });
  }

  abort(): Promise<void> {
    return Promise.resolve();
  }
}

function makeOrchestrator(backend: ExecutionBackend, feedback?: EmaFeedbackStore) {
  const taskTypes = createBuiltinTaskTypeRegistry();
  return new Orchestrator({
    parser: new RuleBasedTaskParser(taskTypes, "coding.review"),
    taskTypes,
    capabilities: createBuiltinCapabilityRegistry(),
    backend,
    modelCatalog: defaultModelCatalog(),
    evaluators: createBuiltinEvaluators(),
    feedback,
    defaultStrategy: "balanced",
  });
}

describe("Orchestrator", () => {
  it("parses, selects, executes and evaluates a code review", async () => {
    const backend = new FakeBackend(
      "- bug: null deref\n- suggest: validate input\n- refactor: split function",
    );
    const orchestrator = makeOrchestrator(backend);
    const result = await orchestrator.run({
      goal: "review this codebase and suggest improvements",
    });

    expect(result.taskType).toBe("coding.review");
    expect(result.plan.steps).toHaveLength(1);
    expect(backend.lastStep?.skillId).toBe("coding.review");
    expect(result.evaluation?.score).toBeGreaterThan(0.6);
    expect(result.usage.costUsd).toBe(0.01);
  });

  it("routes cheapest strategy to the cheap model", async () => {
    const backend = new FakeBackend("short summary");
    const orchestrator = makeOrchestrator(backend);
    const result = await orchestrator.run(
      { goal: "summarize this document", constraints: {} },
      { strategy: "cheapest", referenceInput: "x".repeat(400) },
    );
    expect(result.selection.model.id).toBe("gpt-5.4-mini");
  });

  it("executes a multi-node DAG, passes upstream output downstream, and traces every step", async () => {
    // a (coding.review) -> b (summarization, consumes a's output)
    const graph: TaskGraph = {
      rootTaskType: "coding.review",
      nodes: [
        { id: "a", taskType: "coding.review", goal: "scan repo", dependsOn: [] },
        { id: "b", taskType: "summarization", goal: "summarize findings", dependsOn: ["a"] },
      ],
      terminalId: "b",
    };

    const prompts = new Map<string, string>();
    class RecordingBackend implements ExecutionBackend {
      readonly id = "rec";
      private lastId = "";
      capabilities(): Promise<BackendCapability> {
        return Promise.resolve({ models: defaultModelCatalog().map((m) => m.ref) });
      }
      run(step: PlannedStep): Promise<RunHandle> {
        this.lastId = step.id;
        prompts.set(step.id, step.prompt);
        return Promise.resolve({ runId: step.id });
      }
      async *stream(): AsyncIterable<BackendEvent> {
        yield { kind: "lifecycle", phase: "end" };
      }
      wait(): Promise<BackendRunResult> {
        return Promise.resolve({
          text: `OUT(${this.lastId})`,
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.01 },
        });
      }
      abort(): Promise<void> {
        return Promise.resolve();
      }
    }

    const taskTypes = createBuiltinTaskTypeRegistry();
    const orchestrator = new Orchestrator({
      parser: new RuleBasedTaskParser(taskTypes, "coding.review"),
      taskTypes,
      capabilities: createBuiltinCapabilityRegistry(),
      backend: new RecordingBackend(),
      modelCatalog: defaultModelCatalog(),
      evaluators: createBuiltinEvaluators(),
      planner: new StaticGraphPlanner(() => graph),
      defaultStrategy: "balanced",
    });

    const result = await orchestrator.run({ goal: "review and summarize", type: "coding.review" });

    expect(result.trace).toHaveLength(2);
    expect(result.plan.edges).toEqual([{ from: "a", to: "b" }]);
    // Aggregated usage across both nodes.
    expect(result.usage.totalTokens).toBe(300);
    // Terminal output is node b's.
    expect(result.output.text).toBe("OUT(b)");
    // Node b's prompt embedded node a's output (dependency data-passing).
    expect(prompts.get("b")).toContain("OUT(a)");
  });

  it("feeds evaluation back into model quality", async () => {
    const feedback = new EmaFeedbackStore(0.5);
    const backend = new FakeBackend("- issue: foo\n- fix: bar\n- suggest: baz");
    const orchestrator = makeOrchestrator(backend, feedback);
    await orchestrator.run({ goal: "review code", type: "coding.review" });
    const learned = feedback.quality(
      { provider: "anthropic", id: "claude-opus-4-6" },
      "coding.review",
    );
    // Quality may map to any selected model; ensure at least one score recorded.
    const anyRecorded =
      learned !== undefined ||
      feedback.quality({ provider: "openai", id: "gpt-5.4" }, "coding.review") !== undefined ||
      feedback.quality({ provider: "openai", id: "gpt-5.4-mini" }, "coding.review") !== undefined;
    expect(anyRecorded).toBe(true);
  });

  it("materializes tenant-prefixed session key when tenant is set without sessionKey", async () => {
    const backend = new FakeBackend("- issue: foo\n- fix: bar\n- suggest: baz");
    const orchestrator = makeOrchestrator(backend);
    const result = await orchestrator.run(
      { goal: "review code", type: "coding.review" },
      { tenant: { tenantId: "acme", userId: "u1" }, runId: "run-fixed" },
    );
    expect(result.runId).toBe("run-fixed");
    expect(backend.lastSessionKey).toBe("acme:aor:run-fixed");
  });
});
