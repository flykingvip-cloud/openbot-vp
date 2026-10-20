import type { EvalInput } from "@openbot/aor-core";
import { describe, expect, it } from "vitest";
import { createObjectiveCodingEvaluator } from "./coding-evaluator.js";

// These tests use the DEFAULT runner, i.e. real `node` child processes, so the
// score is genuinely driven by process exit codes / stdout — not a stub.
const evalInput: EvalInput = {
  task: { goal: "x", type: "coding.review" },
  output: { text: "some output" },
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
};

describe("createObjectiveCodingEvaluator (real processes)", () => {
  it("scores 1 when the test command exits 0", async () => {
    const evaluator = createObjectiveCodingEvaluator({
      taskType: "coding.review",
      test: { command: "node", args: ["-e", "process.exit(0)"] },
    });
    const result = await evaluator.evaluate(evalInput);
    expect(result.signals.test).toBe(1);
    expect(result.score).toBe(1);
  });

  it("scores 0 when the test command exits non-zero", async () => {
    const evaluator = createObjectiveCodingEvaluator({
      taskType: "coding.review",
      test: { command: "node", args: ["-e", "process.exit(1)"] },
    });
    const result = await evaluator.evaluate(evalInput);
    expect(result.signals.test).toBe(0);
    expect(result.score).toBe(0);
  });

  it("combines build + test + coverage from real processes", async () => {
    const evaluator = createObjectiveCodingEvaluator({
      taskType: "coding.review",
      build: { command: "node", args: ["-e", "process.exit(0)"] },
      test: { command: "node", args: ["-e", "process.exit(0)"] },
      coverage: { command: "node", args: ["-e", "console.log('All files |   80 |')"] },
    });
    const result = await evaluator.evaluate(evalInput);
    expect(result.signals.build).toBe(1);
    expect(result.signals.test).toBe(1);
    expect(result.signals.coverage).toBeCloseTo(0.8, 2);
  });
});
