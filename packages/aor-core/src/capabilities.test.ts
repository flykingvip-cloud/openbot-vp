import { describe, expect, it } from "vitest";
import type {
  BackendCapability,
  BackendEvent,
  BackendRunResult,
  ExecutionBackend,
  RunHandle,
} from "./backend.js";
import { PipelineSkill } from "./capabilities.js";
import type { PlannedStep } from "./types.js";

class StageRecordingBackend implements ExecutionBackend {
  readonly id = "stage";
  steps: PlannedStep[] = [];
  private last = "";
  capabilities(): Promise<BackendCapability> {
    return Promise.resolve({ models: [] });
  }
  run(step: PlannedStep): Promise<RunHandle> {
    this.steps.push(step);
    this.last = step.id;
    return Promise.resolve({ runId: step.id });
  }
  async *stream(): AsyncIterable<BackendEvent> {
    yield { kind: "lifecycle", phase: "end" };
  }
  wait(): Promise<BackendRunResult> {
    return Promise.resolve({
      text: `out:${this.last}`,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.01 },
    });
  }
  abort(): Promise<void> {
    return Promise.resolve();
  }
}

describe("PipelineSkill", () => {
  it("runs stages in order, threads prior output, and sums usage", async () => {
    const skill = new PipelineSkill({
      id: "coding.deep-review",
      taskTypes: ["coding.review"],
      costProfile: { expectedInputTokens: 6000, expectedOutputTokens: 1500 },
      stages: [
        { name: "scan", template: (task) => `scan: ${task.goal}` },
        { name: "review", template: (_task, prior) => `review using: ${prior}` },
      ],
    });

    const backend = new StageRecordingBackend();
    const result = await skill.run({
      task: { goal: "module A", type: "coding.review" },
      model: { provider: "anthropic", id: "claude-opus-4-6" },
      backend,
      stepId: "n0",
    });

    expect(backend.steps.map((s) => s.id)).toEqual(["n0:scan", "n0:review"]);
    // Stage 2's prompt threads stage 1's output.
    expect(backend.steps[1].prompt).toBe("review using: out:n0:scan");
    // Final output is the last stage; usage summed across both stages.
    expect(result.output.text).toBe("out:n0:review");
    expect(result.usage.totalTokens).toBe(30);
    expect(result.usage.costUsd).toBeCloseTo(0.02, 5);
  });

  it("rejects empty pipelines", () => {
    expect(
      () =>
        new PipelineSkill({
          id: "bad",
          taskTypes: ["coding.review"],
          stages: [],
          costProfile: { expectedInputTokens: 1, expectedOutputTokens: 1 },
        }),
    ).toThrow(/at least one stage/);
  });
});
