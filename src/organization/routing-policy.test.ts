import { describe, expect, it } from "vitest";
import {
  buildOrganizationShadowPlan,
  isInFlightTask,
  nextRoutingPolicy,
  routingPolicyVersion,
  type OrganizationRoutingPolicy,
} from "./routing-policy.js";

const current: OrganizationRoutingPolicy = {
  groupId: "group-1",
  revision: 3,
  strategyId: "discussion_driven",
  defaultOwnerAgentId: "bot-a",
  memberIds: ["bot-a", "bot-b"],
};

describe("organization routing policy", () => {
  it("treats pending accepted and running as in-flight", () => {
    expect(isInFlightTask({ status: "pending" })).toBe(true);
    expect(isInFlightTask({ status: "accepted" })).toBe(true);
    expect(isInFlightTask({ status: "running" })).toBe(true);
    expect(isInFlightTask({ status: "completed" })).toBe(false);
    expect(isInFlightTask({ status: "rejected" })).toBe(false);
  });

  it("builds a shadow plan that never claims to mutate in-flight tasks", () => {
    const candidate = nextRoutingPolicy(current, {
      strategyId: "task_driven",
      defaultOwnerAgentId: "bot-b",
    });
    const plan = buildOrganizationShadowPlan({
      current,
      candidate,
      tasks: [
        { id: "t-run", status: "running" },
        { id: "t-done", status: "completed" },
      ],
      sampleNewTaskTitles: ["Triage inbox"],
    });
    expect(candidate.revision).toBe(4);
    expect(plan.mutatesInFlightTasks).toBe(false);
    expect(plan.inFlightTaskIds).toEqual(["t-run"]);
    expect(plan.newTaskProjections).toEqual([
      { title: "Triage inbox", proposedOwnerAgentId: "bot-b" },
    ]);
    expect(routingPolicyVersion(candidate)).toContain("task_driven");
  });
});
