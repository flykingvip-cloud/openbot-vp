import { describe, expect, it } from "vitest";
import { formatCostReportMarkdown, summarizeTrace } from "./cost.js";
import type { AorRunResult, StepTrace } from "./orchestrator.js";

const trace: StepTrace[] = [
  {
    nodeId: "a",
    taskType: "coding.review",
    skillId: "coding.review",
    model: "anthropic/claude-opus-4-6",
    estimatedCostUsd: 0.2,
    usage: { inputTokens: 6000, outputTokens: 1500, totalTokens: 7500, costUsd: 0.18 },
    latencyMs: 4000,
  },
  {
    nodeId: "b",
    taskType: "summarization",
    skillId: "summarization",
    model: "openai/gpt-5.4-mini",
    estimatedCostUsd: 0.002,
    usage: { inputTokens: 3000, outputTokens: 400, totalTokens: 3400 },
    latencyMs: 1500,
  },
];

describe("summarizeTrace", () => {
  it("aggregates cost/tokens and prefers real usage cost over estimate", () => {
    const summary = summarizeTrace(trace);
    expect(summary.steps).toBe(2);
    expect(summary.totalTokens).toBe(10900);
    // a: real 0.18 ; b: no real cost -> estimate 0.002
    expect(summary.totalCostUsd).toBeCloseTo(0.182, 5);
    expect(summary.byModel["anthropic/claude-opus-4-6"].costUsd).toBeCloseTo(0.18, 5);
    expect(summary.byTaskType.summarization.costUsd).toBeCloseTo(0.002, 5);
  });
});

describe("formatCostReportMarkdown", () => {
  it("renders a per-step table", () => {
    const result = {
      taskType: "coding.review",
      trace,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 10900, costUsd: 0.182 },
    } as unknown as AorRunResult;
    const md = formatCostReportMarkdown(result);
    expect(md).toContain("| step | task type | model |");
    expect(md).toContain("anthropic/claude-opus-4-6");
    expect(md).toContain("Total: 2 step(s)");
  });
});
