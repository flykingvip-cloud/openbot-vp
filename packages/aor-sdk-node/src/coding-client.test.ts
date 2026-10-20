import type {
  BackendCapability,
  BackendEvent,
  BackendRunResult,
  ExecutionBackend,
  PlannedStep,
  RunHandle,
} from "@openbot/aor-core";
import { defaultModelCatalog } from "@openbot/aor-core";
import { describe, expect, it } from "vitest";
import { AorClient } from "./client.js";
import { createObjectiveCodingEvaluator } from "./coding-evaluator.js";

class StubBackend implements ExecutionBackend {
  readonly id = "stub";
  constructor(private readonly text: string) {}
  capabilities(): Promise<BackendCapability> {
    return Promise.resolve({ models: defaultModelCatalog().map((m) => m.ref) });
  }
  run(_step: PlannedStep): Promise<RunHandle> {
    return Promise.resolve({ runId: "1" });
  }
  async *stream(): AsyncIterable<BackendEvent> {
    yield { kind: "lifecycle", phase: "end" };
  }
  wait(): Promise<BackendRunResult> {
    return Promise.resolve({
      text: this.text,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.01 },
    });
  }
  abort(): Promise<void> {
    return Promise.resolve();
  }
}

describe("objective coding evaluator wired as default coding.review evaluator", () => {
  it("scores coding.review via real build/test exit codes", async () => {
    const evaluators = new Map([
      [
        "coding.review",
        createObjectiveCodingEvaluator({
          taskType: "coding.review",
          test: { command: "node", args: ["-e", "process.exit(0)"] },
        }),
      ],
    ]);
    const client = new AorClient({
      backend: new StubBackend("- FIX: add validation"),
      evaluators,
    });
    const result = await client
      .agent({ goal: "review this repo", type: "coding.review" })
      .run({ strategy: "best_quality" });

    expect(result.evaluation?.taskType).toBe("coding.review");
    expect(result.evaluation?.signals.test).toBe(1);
    expect(result.evaluation?.score).toBe(1);
  });
});
