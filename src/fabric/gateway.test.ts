import { describe, expect, it, vi } from "vitest";
import type { PolicyDecision, RuntimeNode, ToolExecutionResult, ToolRequest } from "./contract.js";
import {
  compileAndRun,
  compileAndRunSingle,
  compileGraph,
  normalize,
  type PipelineDeps,
  runGraph,
} from "./gateway.js";
import { type GraphContext, graphFromToolRequests, singleToolGraph } from "./plan-adapter.js";

const ctx: GraphContext = { graphId: "g1", sessionId: "s1", correlationId: "c1" };

function req(id: string, name = "exec"): ToolRequest {
  return {
    id,
    source: { type: "cursor" },
    tool: { name },
    input: {},
    context: {},
    trace: { sessionId: "s1", correlationId: "c1" },
  };
}

const ALLOW: PolicyDecision = { decision: "ALLOW", matchedRules: [], decisionTrace: [] };
const DENY: PolicyDecision = {
  decision: "DENY",
  reason: "blocked",
  matchedRules: [],
  decisionTrace: [],
};

/** A fake executor that records calls and returns success. */
function fakeExecutor() {
  const calls: string[] = [];
  const executeNode = vi.fn(async (node: RuntimeNode): Promise<ToolExecutionResult> => {
    calls.push(node.id);
    const now = Date.now();
    return {
      id: node.id,
      status: "success",
      output: { stdout: "ok" },
      exitCode: 0,
      timing: { start: now, end: now },
      trace: { policyDecisionId: node.id, executionId: `e-${node.id}` },
    };
  });
  return { calls, executeNode };
}

describe("gateway — normalize", () => {
  it("default normalizer validates raw payload as a ToolRequest", () => {
    const r = normalize("cursor", req("n1"));
    expect(r.id).toBe("n1");
  });
  it("rejects malformed payloads", () => {
    expect(() => normalize("cursor", { id: "x" })).toThrow();
  });
});

describe("gateway — compileAndRun ALLOW/DENY/MODIFY", () => {
  it("ALLOW executes the node", async () => {
    const exec = fakeExecutor();
    const deps: PipelineDeps = { decideFor: () => ALLOW, executeNode: exec.executeNode };
    const [res] = await compileAndRun(singleToolGraph(req("n1"), ctx), deps);
    expect(res?.status).toBe("success");
    expect(exec.calls).toEqual(["n1"]);
  });

  it("DENY short-circuits — node never executes, status denied", async () => {
    const exec = fakeExecutor();
    const deps: PipelineDeps = { decideFor: () => DENY, executeNode: exec.executeNode };
    const [res] = await compileAndRun(singleToolGraph(req("n1"), ctx), deps);
    expect(res?.status).toBe("denied");
    expect(res?.output?.stderr).toBe("blocked");
    expect(exec.executeNode).not.toHaveBeenCalled();
  });

  it("MODIFY executes with constraints carried on the decision", async () => {
    const exec = fakeExecutor();
    const MODIFY: PolicyDecision = {
      decision: "MODIFY",
      constraints: { sandboxMode: "strict" },
      matchedRules: [],
      decisionTrace: [],
    };
    let seen: PolicyDecision | undefined;
    const deps: PipelineDeps = {
      decideFor: () => MODIFY,
      executeNode: async (node, decision) => {
        seen = decision;
        return exec.executeNode(node);
      },
    };
    const [res] = await compileAndRun(singleToolGraph(req("n1"), ctx), deps);
    expect(res?.status).toBe("success");
    expect(seen?.decision === "MODIFY" && seen.constraints.sandboxMode).toBe("strict");
  });
});

describe("gateway — gate invariant (R21.3)", () => {
  it("a gateable node with no attached decision is denied, never executed", async () => {
    const exec = fakeExecutor();
    // Build a compiled-but-tampered state: skip compile so node has no policy.
    const state = singleToolGraph(req("n1"), ctx);
    const res = await runGraph(state, {
      decideFor: () => ALLOW,
      executeNode: exec.executeNode,
    });
    expect(res[0]?.status).toBe("denied");
    expect(res[0]?.output?.stderr).toBe("gate_invariant_no_decision");
    expect(exec.executeNode).not.toHaveBeenCalled();
  });
});

describe("gateway — multi-node order + non-gateable skip", () => {
  it("executes tool nodes in projection order", async () => {
    const exec = fakeExecutor();
    const deps: PipelineDeps = { decideFor: () => ALLOW, executeNode: exec.executeNode };
    const state = graphFromToolRequests([req("a"), req("b"), req("c")], ctx);
    await compileAndRun(state, deps);
    expect(exec.calls).toEqual(["a", "b", "c"]);
  });

  it("compileGraph attaches a decision to every gateable node", () => {
    const deps: PipelineDeps = { decideFor: () => ALLOW, executeNode: fakeExecutor().executeNode };
    const compiled = compileGraph(graphFromToolRequests([req("a"), req("b")], ctx), deps);
    for (const node of compiled.nodes) {
      if (node.type === "tool") {
        expect(node.policy?.decision).toBe("ALLOW");
      }
    }
  });
});

describe("gateway — compileAndRunSingle (v1 dominant path)", () => {
  it("runs one request end-to-end", async () => {
    const exec = fakeExecutor();
    const res = await compileAndRunSingle(req("n1"), ctx, {
      decideFor: () => ALLOW,
      executeNode: exec.executeNode,
    });
    expect(res.status).toBe("success");
  });
});
