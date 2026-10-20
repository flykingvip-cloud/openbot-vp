// @vitest-environment node
// Feature: employee-schedule-meeting-lifecycle (Phase C4b)
// 人类受派闭环 RPC：受派人对自己的 managed 任务 accept/complete/list；按归属结构化授权。

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskAssignment } from "../../organization/task-assignment.js";
import type { EmployeeWorkbenchActor } from "../employee-workbench-scope.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const actorState = vi.hoisted(() => ({ current: null as EmployeeWorkbenchActor | null }));
const tasksState = vi.hoisted(() => ({ current: [] as TaskAssignment[] }));
const upsertManagedMock = vi.hoisted(() => vi.fn(async (task: TaskAssignment) => task));
const readManagedMock = vi.hoisted(() =>
  vi.fn(async (_organizationId: string) => tasksState.current),
);

vi.mock("../employee-workbench-scope.js", () => ({
  resolveEmployeeWorkbenchActor: vi.fn(async () => actorState.current),
}));

// Keep the pure transitionTaskAssignment real; stub the managed-store IO.
vi.mock("../../organization/task-assignment.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../organization/task-assignment.js")>();
  return {
    ...actual,
    readManagedOrganizationTaskAssignments: readManagedMock,
    upsertManagedOrganizationTaskAssignment: upsertManagedMock,
  };
});

const { taskHandlers } = await import("./task.js");

const ACTOR: EmployeeWorkbenchActor = {
  userId: "user-1",
  userEmail: "u1@example.com",
  tenantId: "tenant-a",
  seatAgentIds: [],
  seatSpaceIds: ["space-a"],
};

function taskFor(over: Partial<TaskAssignment> & { id: string }): TaskAssignment {
  return {
    organizationId: "space-a",
    title: `Task ${over.id}`,
    ownerAgentId: "main",
    createdByAgentId: "main",
    status: "pending",
    createdAt: new Date(1).toISOString(),
    updatedAt: new Date(1).toISOString(),
    ackRequired: true,
    assigneeUserId: "user-1",
    sourceRef: { kind: "meeting", id: "m1" },
    ...over,
  };
}

async function invoke(
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ ok: boolean; payload?: Record<string, unknown>; error?: { message?: string } }> {
  const handler = taskHandlers[method] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: {
    ok: boolean;
    payload?: Record<string, unknown>;
    error?: { message?: string };
  } | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: { connect: {} as never, user: "u1@example.com" },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = {
        ok,
        payload: payload as Record<string, unknown> | undefined,
        error: error as { message?: string } | undefined,
      };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

beforeEach(() => {
  actorState.current = ACTOR;
  tasksState.current = [];
  upsertManagedMock.mockClear();
  readManagedMock.mockClear();
});

describe("task.accept", () => {
  it("accepts the actor's own pending task", async () => {
    tasksState.current = [taskFor({ id: "t1", status: "pending", assigneeUserId: "user-1" })];
    const result = await invoke("task.accept", { organizationId: "space-a", id: "t1" });
    expect(result.ok).toBe(true);
    const saved = upsertManagedMock.mock.calls[0]?.[0] as TaskAssignment | undefined;
    expect(saved?.status).toBe("accepted");
  });

  it("rejects a task assigned to someone else (ownership isolation)", async () => {
    tasksState.current = [taskFor({ id: "t1", assigneeUserId: "user-2" })];
    const result = await invoke("task.accept", { organizationId: "space-a", id: "t1" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/not your task/i);
    expect(upsertManagedMock).not.toHaveBeenCalled();
  });

  it("rejects a legacy task with no assignee", async () => {
    tasksState.current = [taskFor({ id: "t1", assigneeUserId: undefined })];
    const result = await invoke("task.accept", { organizationId: "space-a", id: "t1" });
    expect(result.ok).toBe(false);
    expect(upsertManagedMock).not.toHaveBeenCalled();
  });

  it("rejects when the task is not found", async () => {
    tasksState.current = [];
    const result = await invoke("task.accept", { organizationId: "space-a", id: "missing" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/not found/i);
  });

  it("rejects accepting a non-pending task", async () => {
    tasksState.current = [taskFor({ id: "t1", status: "accepted", assigneeUserId: "user-1" })];
    const result = await invoke("task.accept", { organizationId: "space-a", id: "t1" });
    expect(result.ok).toBe(false);
    expect(upsertManagedMock).not.toHaveBeenCalled();
  });

  it("requires organizationId and id", async () => {
    const result = await invoke("task.accept", { id: "t1" });
    expect(result.ok).toBe(false);
  });
});

describe("task.complete", () => {
  it("completes the actor's own accepted task", async () => {
    tasksState.current = [taskFor({ id: "t1", status: "accepted", assigneeUserId: "user-1" })];
    const result = await invoke("task.complete", { organizationId: "space-a", id: "t1" });
    expect(result.ok).toBe(true);
    const saved = upsertManagedMock.mock.calls[0]?.[0] as TaskAssignment | undefined;
    expect(saved?.status).toBe("completed");
  });

  it("rejects completing an already-completed task", async () => {
    tasksState.current = [taskFor({ id: "t1", status: "completed", assigneeUserId: "user-1" })];
    const result = await invoke("task.complete", { organizationId: "space-a", id: "t1" });
    expect(result.ok).toBe(false);
    expect(upsertManagedMock).not.toHaveBeenCalled();
  });
});

describe("task.list", () => {
  it("returns only the actor's own assigned tasks", async () => {
    tasksState.current = [
      taskFor({ id: "mine", assigneeUserId: "user-1" }),
      taskFor({ id: "theirs", assigneeUserId: "user-2" }),
      taskFor({ id: "legacy", assigneeUserId: undefined }),
    ];
    const result = await invoke("task.list", { organizationId: "space-a" });
    expect(result.ok).toBe(true);
    const tasks = result.payload?.tasks as TaskAssignment[] | undefined;
    expect(tasks?.map((task) => task.id)).toEqual(["mine"]);
  });

  it("returns an empty list when no actor resolves", async () => {
    actorState.current = null;
    const result = await invoke("task.list", {});
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({ tasks: [] });
  });
});
