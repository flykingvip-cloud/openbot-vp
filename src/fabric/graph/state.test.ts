import { describe, expect, it } from "vitest";
import type { PolicyDecision, ToolExecutionRun } from "../contract.js";
import {
  assertSameOrder,
  attachPolicy,
  createGraphState,
  GraphStateError,
  nodeOrder,
  upsertRun,
} from "./state.js";

function toolNode(id: string) {
  return {
    id,
    type: "tool" as const,
    request: {
      id: `req-${id}`,
      source: { type: "kiro" },
      tool: { name: "exec" },
      trace: { sessionId: "s1", correlationId: "c1" },
    },
  };
}

function baseState() {
  return createGraphState({
    graphId: "g1",
    nodes: [toolNode("n1"), toolNode("n2"), { id: "m1", type: "merge", strategy: "all" }],
    edges: [
      { from: "n1", to: "m1" },
      { from: "n2", to: "m1" },
    ],
    context: { sessionId: "s1", correlationId: "c1" },
  });
}

const allow: PolicyDecision = { decision: "ALLOW", matchedRules: [], decisionTrace: [] };

describe("Trace Layer — ExecutionGraphState projection", () => {
  it("preserves node order from the projected plan", () => {
    expect(nodeOrder(baseState())).toEqual(["n1", "n2", "m1"]);
  });

  it("attachPolicy overlays a decision on a tool node without reordering", () => {
    const s = attachPolicy(baseState(), "n1", allow);
    const n1 = s.nodes.find((n) => n.id === "n1");
    expect(n1?.type === "tool" && n1.policy?.decision).toBe("ALLOW");
    assertSameOrder(["n1", "n2", "m1"], s); // structure unchanged
  });

  it("attachPolicy rejects non-gateable nodes (e.g. merge)", () => {
    expect(() => attachPolicy(baseState(), "m1", allow)).toThrow(GraphStateError);
  });

  it("attachPolicy throws on unknown node", () => {
    expect(() => attachPolicy(baseState(), "ghost", allow)).toThrow(GraphStateError);
  });

  it("upsertRun adds then replaces a run by id", () => {
    const run: ToolExecutionRun = {
      id: "run-1",
      nodeId: "n1",
      phase: "scheduled",
      policyDecisionId: "pd-1",
      attempts: 0,
      metadata: {},
    };
    let s = upsertRun(baseState(), run);
    expect(s.runs).toHaveLength(1);
    s = upsertRun(s, { ...run, phase: "executing" });
    expect(s.runs).toHaveLength(1);
    expect(s.runs[0]?.phase).toBe("executing");
  });

  it("assertSameOrder detects a reordering", () => {
    expect(() => assertSameOrder(["n2", "n1", "m1"], baseState())).toThrow(GraphStateError);
  });
});
