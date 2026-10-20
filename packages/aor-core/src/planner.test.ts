import { describe, expect, it } from "vitest";
import {
  SingleNodePlanner,
  StaticGraphPlanner,
  type TaskGraph,
  executionLevels,
  topologicalOrder,
} from "./planner.js";

const diamond: TaskGraph = {
  rootTaskType: "coding.review",
  nodes: [
    { id: "a", taskType: "coding.review", goal: "scan", dependsOn: [] },
    { id: "b", taskType: "coding.review", goal: "deps", dependsOn: ["a"] },
    { id: "c", taskType: "coding.review", goal: "sec", dependsOn: ["a"] },
    { id: "d", taskType: "summarization", goal: "merge", dependsOn: ["b", "c"] },
  ],
  terminalId: "d",
};

describe("topologicalOrder", () => {
  it("orders dependencies before dependents", () => {
    const order = topologicalOrder(diamond).map((n) => n.id);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("d"));
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("d"));
  });

  it("detects cycles", () => {
    const cyclic: TaskGraph = {
      rootTaskType: "coding.review",
      nodes: [
        { id: "x", taskType: "coding.review", goal: "x", dependsOn: ["y"] },
        { id: "y", taskType: "coding.review", goal: "y", dependsOn: ["x"] },
      ],
    };
    expect(() => topologicalOrder(cyclic)).toThrow(/cycle/i);
  });

  it("rejects unknown dependencies", () => {
    const bad: TaskGraph = {
      rootTaskType: "coding.review",
      nodes: [{ id: "x", taskType: "coding.review", goal: "x", dependsOn: ["ghost"] }],
    };
    expect(() => topologicalOrder(bad)).toThrow(/unknown/i);
  });
});

describe("executionLevels", () => {
  it("groups parallelizable nodes into levels", () => {
    const levels = executionLevels(diamond).map((lvl) => lvl.map((n) => n.id).sort());
    expect(levels[0]).toEqual(["a"]);
    expect(levels[1]).toEqual(["b", "c"]); // parallel
    expect(levels[2]).toEqual(["d"]);
  });
});

describe("planners", () => {
  it("SingleNodePlanner emits one node", async () => {
    const graph = await new SingleNodePlanner().plan({ goal: "x", type: "summarization" });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.terminalId).toBe("n0");
  });

  it("StaticGraphPlanner uses the template then falls back", async () => {
    const planner = new StaticGraphPlanner((task) =>
      task.type === "coding.review" ? diamond : undefined,
    );
    expect((await planner.plan({ goal: "x", type: "coding.review" })).nodes).toHaveLength(4);
    expect((await planner.plan({ goal: "x", type: "summarization" })).nodes).toHaveLength(1);
  });
});
