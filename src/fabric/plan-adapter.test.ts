import type { ExecutionPlan } from "@openbot/aor-core";
import { describe, expect, it } from "vitest";
import type { ToolRequest } from "./contract.js";
import {
  graphFromToolRequests,
  type GraphContext,
  projectAorPlan,
  singleToolGraph,
} from "./plan-adapter.js";

const ctx: GraphContext = { graphId: "g1", sessionId: "s1", correlationId: "c1", tenantId: "t1" };

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

describe("plan-adapter — singleToolGraph (dominant v1 path)", () => {
  it("builds a trivial 1-node graph, no edges, no planner", () => {
    const g = singleToolGraph(req("n1"), ctx);
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0]?.type).toBe("tool");
    expect(g.nodes[0]?.dependsOn).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(g.context.tenantId).toBe("t1");
  });
});

describe("plan-adapter — graphFromToolRequests (never fabricates edges)", () => {
  it("projects N independent tool nodes with no edges", () => {
    const g = graphFromToolRequests([req("a"), req("b"), req("c")], ctx);
    expect(g.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(g.edges).toEqual([]);
    expect(g.nodes.every((n) => n.dependsOn.length === 0)).toBe(true);
  });
});

describe("plan-adapter — projectAorPlan (faithful projection)", () => {
  const plan: ExecutionPlan = {
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

  it("preserves step order and copies edges verbatim", () => {
    const g = projectAorPlan(plan, ctx);
    expect(g.nodes.map((n) => n.id)).toEqual(["s1", "s2", "s3"]);
    expect(g.edges).toEqual([
      { from: "s1", to: "s2", kind: "control" },
      { from: "s2", to: "s3", kind: "control" },
    ]);
  });

  it("derives node.dependsOn straight from AOR edges (not Fabric-invented)", () => {
    const g = projectAorPlan(plan, ctx);
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
    expect(byId.s1?.dependsOn).toEqual([]);
    expect(byId.s2?.dependsOn).toEqual(["s1"]);
    expect(byId.s3?.dependsOn).toEqual(["s2"]);
  });

  it("projects steps to agent nodes wrapping the skill", () => {
    const g = projectAorPlan(plan, ctx);
    const s1 = g.nodes.find((n) => n.id === "s1");
    expect(s1?.type).toBe("agent");
    expect(s1?.type === "agent" && s1.request.tool.name).toBe("agent:fetch");
  });
});
