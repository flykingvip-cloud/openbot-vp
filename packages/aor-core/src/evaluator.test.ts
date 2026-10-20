import { describe, expect, it } from "vitest";
import {
  compressionRatioProbe,
  createBuiltinEvaluators,
  structuredFindingsProbe,
} from "./evaluator.js";
import type { EvalInput } from "./evaluator.js";

const baseUsage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 };

function input(text: string, extra?: Partial<EvalInput>): EvalInput {
  return {
    task: { goal: "x" },
    output: { text },
    usage: baseUsage,
    ...extra,
  };
}

describe("structuredFindingsProbe", () => {
  it("rewards bulleted findings with concern keywords", () => {
    const text = "- bug in parser\n- risk: missing validation\n- suggest adding tests";
    expect(structuredFindingsProbe.run(input(text))).toBeGreaterThan(0.8);
  });

  it("scores prose without structure low", () => {
    expect(structuredFindingsProbe.run(input("looks fine"))).toBeLessThan(0.3);
  });
});

describe("compressionRatioProbe", () => {
  const probe = compressionRatioProbe();
  it("rewards summaries inside the target band", () => {
    const source = "x".repeat(1000);
    const summary = "y".repeat(200); // 20% ratio
    expect(probe.run(input(summary, { referenceInput: source }))).toBe(1);
  });

  it("returns neutral when no source is provided", () => {
    expect(probe.run(input("anything"))).toBe(0.5);
  });
});

describe("createBuiltinEvaluators", () => {
  it("scores a good code review highly", async () => {
    const evaluators = createBuiltinEvaluators();
    const evaluator = evaluators.get("coding.review")!;
    const result = await evaluator.evaluate(
      input(
        "- bug: null deref in handler.ts\n- suggest: add input validation\n- refactor: extract helper",
      ),
    );
    expect(result.score).toBeGreaterThan(0.7);
    expect(result.signals.nonEmptyOutput).toBe(1);
  });

  it("penalizes empty output", async () => {
    const evaluators = createBuiltinEvaluators();
    const evaluator = evaluators.get("summarization")!;
    const result = await evaluator.evaluate(input("  "));
    expect(result.score).toBeLessThan(0.5);
  });
});
