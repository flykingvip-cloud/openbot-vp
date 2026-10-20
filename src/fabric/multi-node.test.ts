import type { ExecutionPlan, ToolInvoker } from "@openbot/aor-core";
/**
 * multi-node.test.ts — multi-node graph execution (Phase B 11.5).
 *
 * Closes the gaps the acceptance review flagged for task 4.4: multi-node /
 * fork-merge end-to-end and recompile-not-relax. v1 executes the projection
 * SEQUENTIALLY in node order; fork/merge are structural projection nodes that
 * are not executed (no parallel semantics in v1) — asserted explicitly.
 */
import { describe, expect, it, vi } from "vitest";
import { AdapterRegistry } from "./adapter-registry.js";
import type { PolicyDecision, RuntimeNode } from "./contract.js";
import { buildExecuteNode, createToolInvokerRunner } from "./execution.js";
import { compileAndRun, type PipelineDeps } from "./gateway.js";
import { createGraphState } from "./graph/state.js";
import { createKernelAgentRunner } from "./kernel.js";
import { type GraphContext, projectAorPlan } from "./plan-adapter.js";

const ctx: GraphContext = { graphId: "g1", sessionId: "s1", correlationId: "c1" };
const ALLOW: PolicyDecision = { decision: "ALLOW", matchedRules: [], decisionTrace: [] };
const DENY: PolicyDecision = {
  decision: "DENY",
  reason: "blocked",
  matchedRules: [],
  decisionTrace: [],
};

const chainPlan: ExecutionPlan = {
  taskType: "coding.review",
  steps: [
    {
      id: "s1",
      taskType: "coding.review",
      skillId: "fetch",
      prompt: "p1",
      model: { provider: "x", id: "m" },
    },
    {
      id: "s2",
      taskType: "coding.review",
      skillId: "analyze",
      prompt: "p2",
      model: { provider: "x", id: "m" },
    },
    {
      id: "s3",
      taskType: "coding.review",
      skillId: "report",
      prompt: "p3",
      model: { provider: "x", id: "m" },
    },
  ],
  edges: [
    { from: "s1", to: "s2" },
    { from: "s2", to: "s3" },
  ],
};

function fakeOrchestrator() {
  const calls: string[] = [];
  const run = vi.fn(async (task: { goal: string }) => {
    calls.push(task.goal);
    return { runId: `r-${calls.length}`, output: { text: `out:${task.goal}` } };
  });
  return { orchestrator: { run }, calls };
}

const idleInvoker: ToolInvoker = { invoke: async () => ({ ok: true, result: null }) };

function depsWith(
  decideFor: (n: RuntimeNode) => PolicyDecision,
  orchestrator: { run: (...a: never[]) => unknown },
): PipelineDeps {
  return {
    decideFor,
    executeNode: buildExecuteNode(new AdapterRegistry([]), createToolInvokerRunner(idleInvoker), {
      agentRunner: createKernelAgentRunner(orchestrator as never),
    }),
  };
}

describe("multi-node — sequential agent chain (projected AOR plan)", () => {
  it("executes all agent nodes in projection order via the Kernel", async () => {
    const { orchestrator, calls } = fakeOrchestrator();
    const state = projectAorPlan(chainPlan, ctx);
    const results = await compileAndRun(
      state,
      depsWith(() => ALLOW, orchestrator),
    );
    expect(results.map((r) => r.status)).toEqual(["success", "success", "success"]);
    expect(calls).toEqual(["agent:fetch", "agent:analyze", "agent:report"]);
  });

  it("DENY on the middle node short-circuits only that node; order preserved", async () => {
    const { orchestrator } = fakeOrchestrator();
    const decideFor = (n: RuntimeNode) => (n.id === "s2" ? DENY : ALLOW);
    const state = projectAorPlan(chainPlan, ctx);
    const results = await compileAndRun(state, depsWith(decideFor, orchestrator));
    expect(results.map((r) => `${r.id}:${r.status}`)).toEqual([
      "s1:success",
      "s2:denied",
      "s3:success",
    ]);
  });
});

describe("multi-node — recompile does not relax", () => {
  it("recompiling with a stricter decideFor yields denied (never weaker)", async () => {
    const { orchestrator } = fakeOrchestrator();
    const state = projectAorPlan(chainPlan, ctx);
    // First compile: lenient (ALLOW) → all succeed.
    const lenient = await compileAndRun(
      state,
      depsWith(() => ALLOW, orchestrator),
    );
    expect(lenient.every((r) => r.status === "success")).toBe(true);
    // Recompile: stricter (DENY all) → all denied, nothing executed.
    const strict = await compileAndRun(
      state,
      depsWith(() => DENY, orchestrator),
    );
    expect(strict.every((r) => r.status === "denied")).toBe(true);
  });
});

describe("multi-node — fork/merge are structural (v1: not executed)", () => {
  it("a graph with fork/merge runs gateable nodes and skips fork/merge", async () => {
    const { orchestrator, calls } = fakeOrchestrator();
    const state = createGraphState({
      graphId: "g2",
      nodes: [
        { id: "f1", type: "fork", branches: ["a"] },
        {
          id: "a",
          type: "agent",
          request: {
            id: "a",
            source: { type: "kiro" },
            tool: { name: "agent:do" },
            input: { args: ["work"] },
            trace: { sessionId: "s1", correlationId: "c1" },
          },
        },
        { id: "m1", type: "merge", strategy: "all" },
      ],
      context: { sessionId: "s1", correlationId: "c1" },
    });
    const results = await compileAndRun(
      state,
      depsWith(() => ALLOW, orchestrator),
    );
    // Only the agent node executed; fork/merge are skipped (structural).
    expect(results.map((r) => r.id)).toEqual(["a"]);
    expect(calls).toEqual(["work"]);
  });
});
