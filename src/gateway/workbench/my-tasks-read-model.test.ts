// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { TaskAssignment } from "../../organization/task-assignment.js";
import type { SupervisedTask } from "../supervisor/types.js";
import {
  buildWorkbenchMyTasks,
  type WorkbenchMyTasksCronJob,
  type WorkbenchMyTasksDeps,
} from "./my-tasks-read-model.js";

function cronJob(over: Partial<WorkbenchMyTasksCronJob> & { id: string }): WorkbenchMyTasksCronJob {
  return {
    name: `Job ${over.id}`,
    enabled: true,
    updatedAtMs: 100,
    ownership: { ownerId: "user-1" },
    ...over,
  };
}

function supervised(
  over: Partial<SupervisedTask> & { taskId: string; goal: string },
): SupervisedTask {
  return {
    repoRoot: "/repo",
    worker: { backendId: "cli" },
    workspace: { id: "ws", root: "/ws", kind: "directory" },
    acceptance: { steps: [], source: "user" },
    state: "planned",
    iterations: [],
    budget: { maxIterations: 5, maxCostUsd: 5, maxDurationMinutes: 30, spentCostUsd: 0 },
    createdAt: new Date(1).toISOString(),
    updatedAt: new Date(200).toISOString(),
    userId: "user-1",
    tenantId: "tenant-a",
    ...over,
  };
}

function assigned(over: Partial<TaskAssignment> & { id: string }): TaskAssignment {
  return {
    organizationId: "space-a",
    title: `Task ${over.id}`,
    ownerAgentId: "bot-x",
    createdByAgentId: "main",
    status: "pending",
    createdAt: new Date(1).toISOString(),
    updatedAt: new Date(300).toISOString(),
    ackRequired: true,
    assigneeUserId: "user-1",
    ...over,
  };
}

function deps(over: Partial<WorkbenchMyTasksDeps>): Partial<WorkbenchMyTasksDeps> {
  return {
    listCronJobs: async () => [],
    listSupervisedTasks: async () => [],
    listAssignedTasks: async () => [],
    ...over,
  };
}

describe("workbench my-tasks read model", () => {
  it("aggregates actor-owned cron, supervised, and assigned tasks", async () => {
    const result = await buildWorkbenchMyTasks({
      userId: "user-1",
      userEmail: "u1@example.com",
      tenantId: "tenant-a",
      seatSpaceIds: ["space-a"],
      deps: deps({
        listCronJobs: async () => [
          cronJob({ id: "c1", ownership: { ownerId: "user-1", tenantId: "tenant-a" } }),
          cronJob({ id: "c-other", ownership: { ownerId: "user-2", tenantId: "tenant-a" } }),
        ],
        listSupervisedTasks: async () => [
          supervised({ taskId: "s1", goal: "Mine supervised", userId: "user-1" }),
          supervised({ taskId: "s2", goal: "Theirs", userId: "user-2" }),
          supervised({ taskId: "s-orphan", goal: "Orphan", userId: undefined }),
        ],
        listAssignedTasks: async (orgId) =>
          orgId === "space-a"
            ? [
                assigned({ id: "a1", assigneeUserId: "user-1" }),
                assigned({ id: "a2", assigneeUserId: "user-2" }),
                assigned({ id: "a-legacy", assigneeUserId: undefined }),
              ]
            : [],
      }),
    });

    expect(result.cronCount).toBe(1);
    expect(result.supervisedCount).toBe(1);
    expect(result.assignedCount).toBe(1);
    expect(result.totalCount).toBe(3);
    expect(result.cronJobs.map((item) => item.id)).toEqual(["cron:c1"]);
    expect(result.supervisedTasks.map((item) => item.id)).toEqual(["supervised:s1"]);
    expect(result.assignedTasks.map((item) => item.id)).toEqual(["assigned:a1"]);
  });

  it("matches legacy email-stamped supervised tasks via userEmail", async () => {
    const result = await buildWorkbenchMyTasks({
      userId: "uuid-1",
      userEmail: "u1@example.com",
      seatSpaceIds: [],
      deps: deps({
        listSupervisedTasks: async () => [
          supervised({
            taskId: "email-stamped",
            goal: "Legacy",
            userId: "u1@example.com",
            tenantId: undefined,
          }),
        ],
      }),
    });
    expect(result.supervisedCount).toBe(1);
    expect(result.supervisedTasks[0]?.id).toBe("supervised:email-stamped");
  });

  it("returns empty lanes for a brand-new member", async () => {
    const result = await buildWorkbenchMyTasks({
      userId: "newcomer",
      seatSpaceIds: [],
      deps: deps({}),
    });
    expect(result).toEqual({
      totalCount: 0,
      cronCount: 0,
      supervisedCount: 0,
      assignedCount: 0,
      cronJobs: [],
      supervisedTasks: [],
      assignedTasks: [],
    });
  });

  it("limits each lane independently while preserving full counts", async () => {
    const result = await buildWorkbenchMyTasks({
      userId: "user-1",
      seatSpaceIds: ["space-a"],
      limit: 1,
      deps: deps({
        listCronJobs: async () => [
          cronJob({ id: "c1", updatedAtMs: 10, ownership: { ownerId: "user-1" } }),
          cronJob({ id: "c2", updatedAtMs: 20, ownership: { ownerId: "user-1" } }),
        ],
        listAssignedTasks: async () => [
          assigned({ id: "a1", updatedAt: new Date(10).toISOString() }),
          assigned({ id: "a2", updatedAt: new Date(20).toISOString() }),
        ],
      }),
    });
    expect(result.cronCount).toBe(2);
    expect(result.assignedCount).toBe(2);
    expect(result.cronJobs).toHaveLength(1);
    expect(result.cronJobs[0]?.id).toBe("cron:c2");
    expect(result.assignedTasks).toHaveLength(1);
    expect(result.assignedTasks[0]?.id).toBe("assigned:a2");
  });
});
