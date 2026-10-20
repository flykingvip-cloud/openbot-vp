import { describe, expect, it } from "vitest";
import { buildExecutionRecord, type FabricExecutionRecord } from "./audit.js";
import type { PolicyDecision, ToolExecutionResult, ToolRequest } from "./contract.js";
import { deriveFeedback } from "./feedback.js";

const ALLOW: PolicyDecision = { decision: "ALLOW", matchedRules: [], decisionTrace: [] };

function failingRecord(tool: string, n: number): FabricExecutionRecord {
  const request: ToolRequest = {
    id: `req-${tool}-${n}`,
    source: { type: "cursor" },
    tool: { name: tool },
    input: {},
    context: {},
    trace: { sessionId: "s1", correlationId: `c-${tool}-${n}` },
  };
  const result: ToolExecutionResult = {
    id: request.id,
    status: "failed",
    output: { stderr: "boom" },
    timing: { start: 1, end: 2 },
    trace: { policyDecisionId: request.id, executionId: `e-${n}` },
  };
  return buildExecutionRecord({ request, decision: ALLOW, result });
}

describe("feedback — deriveFeedback (R19, human-gated)", () => {
  it("raises a failure-pattern signal after repeated failures, with evidence", () => {
    const records = [failingRecord("git", 1), failingRecord("git", 2), failingRecord("git", 3)];
    const signals = deriveFeedback(records);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.kind).toBe("failure-pattern");
    expect(signals[0]?.evidence).toHaveLength(3);
    expect(signals[0]?.proposedConstraints?.sandboxMode).toBe("strict");
  });

  it("never auto-applies: every signal is a proposal (autoApplied === false)", () => {
    const records = [failingRecord("git", 1), failingRecord("git", 2), failingRecord("git", 3)];
    for (const s of deriveFeedback(records)) {
      expect(s.autoApplied).toBe(false);
    }
  });

  it("below threshold raises no signal", () => {
    const records = [failingRecord("git", 1), failingRecord("git", 2)];
    expect(deriveFeedback(records)).toEqual([]);
  });
});
