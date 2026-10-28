/**
 * F4: UI RPC collaboration.task.confirmTodolist must wire the same
 * triggerPostPlanConfirmAdvance path as chat-plan-confirm-hook.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const confirmMock = vi.hoisted(() =>
  vi.fn(async () => ({
    todolistId: "tl-1",
    taskId: "task-1",
    boardItemId: "board-1",
    groupId: "grp-1",
    ownerMemberId: "bot-exec",
    status: "confirmed",
    steps: [{ stepId: "s1", title: "step", status: "pending" }],
    proposedBy: "bot-exec",
    proposedAt: 1,
    confirmedBy: "human:owner",
    confirmedAt: 2,
    version: 2,
    visibility: "executor_private",
  })),
);

const advanceMock = vi.hoisted(() =>
  vi.fn(async () => ({
    autoAdvanceWired: true,
    wakeRecorded: true,
    wakeConsumed: false,
    dispatched: false,
    reason: "test_advance",
    targetAgentIds: ["bot-exec"],
  })),
);

vi.mock("../collaboration-learning.js", async () => {
  const actual = await vi.importActual<typeof import("../collaboration-learning.js")>(
    "../collaboration-learning.js",
  );
  return {
    ...actual,
    confirmCollaborationTodolist: confirmMock,
  };
});

vi.mock("../collaboration-learning/post-plan-confirm-advance.js", () => ({
  triggerPostPlanConfirmAdvance: advanceMock,
}));

vi.mock("../collaboration-learning/delivery-actor-binding.js", async () => {
  const actual = await vi.importActual<
    typeof import("../collaboration-learning/delivery-actor-binding.js")
  >("../collaboration-learning/delivery-actor-binding.js");
  return {
    ...actual,
    authenticatedSessionSubjects: vi.fn(() => ["human:owner", "owner@example.com"]),
    resolveDeliveryAclActor: vi.fn(async () => "human:owner"),
  };
});

vi.mock("../collaboration-learning/trusted-tenant.js", async () => {
  const actual = await vi.importActual<
    typeof import("../collaboration-learning/trusted-tenant.js")
  >("../collaboration-learning/trusted-tenant.js");
  return {
    ...actual,
    resolveCollaborationTenantResolution: vi.fn(async () => ({
      tenantId: "tenant-1",
      source: "test",
    })),
  };
});

vi.mock("../collaboration-learning/team-resource-auth.js", async () => {
  const actual = await vi.importActual<
    typeof import("../collaboration-learning/team-resource-auth.js")
  >("../collaboration-learning/team-resource-auth.js");
  return {
    ...actual,
    resolveHandlerTrustedTeamContext: vi.fn(async () => ({
      ok: true,
      auth: { ok: true, groupsRoot: "/tmp/groups", groupLocator: "grp-1" },
      stores: {
        groupsRoot: "/tmp/groups",
        groupLocator: "grp-1",
        usedLegacyWorkspaceFallback: false,
      },
      trusted: { groupsRoot: "/tmp/groups", groupLocator: "grp-1" },
    })),
  };
});

describe("collaboration.task.confirmTodolist post-plan advance wiring", () => {
  beforeEach(() => {
    confirmMock.mockClear();
    advanceMock.mockClear();
    advanceMock.mockResolvedValue({
      autoAdvanceWired: true,
      wakeRecorded: true,
      wakeConsumed: false,
      dispatched: false,
      reason: "test_advance",
      targetAgentIds: ["bot-exec"],
    });
    confirmMock.mockResolvedValue({
      todolistId: "tl-1",
      taskId: "task-1",
      boardItemId: "board-1",
      groupId: "grp-1",
      ownerMemberId: "bot-exec",
      status: "confirmed",
      steps: [{ stepId: "s1", title: "step", status: "pending" }],
      proposedBy: "bot-exec",
      proposedAt: 1,
      confirmedBy: "human:owner",
      confirmedAt: 2,
      version: 2,
      visibility: "executor_private",
    });
  });

  it("calls triggerPostPlanConfirmAdvance after successful confirm", async () => {
    const { collaborationLearningHandlers } = await import("./collaboration-learning.js");
    const respond = vi.fn();
    await collaborationLearningHandlers["collaboration.task.confirmTodolist"]({
      req: {} as never,
      params: {
        groupId: "grp-1",
        taskId: "task-1",
        todolistId: "tl-1",
        expectedVersion: 2,
      },
      respond: respond as never,
      context: {} as never,
      client: {
        connect: { user: "human:owner" },
        platformUserId: "human:owner",
      } as never,
      isWebchatConnect: () => false,
    });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(advanceMock).toHaveBeenCalledTimes(1);
    expect(advanceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "grp-1",
        taskId: "task-1",
        boardItemId: "board-1",
        todolistId: "tl-1",
        confirmedVersion: 2,
        stepId: "s1",
        confirmerId: "human:owner",
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        todolist: expect.objectContaining({ status: "confirmed", todolistId: "tl-1" }),
        autoAdvanceWired: true,
        autoAdvance: expect.objectContaining({
          autoAdvanceWired: true,
          wakeRecorded: true,
          reason: "test_advance",
          targetAgentIds: ["bot-exec"],
        }),
      }),
      undefined,
    );
  });

  it("still succeeds confirm when advance throws (no rollback)", async () => {
    advanceMock.mockRejectedValueOnce(new Error("dispatcher_down"));
    const { collaborationLearningHandlers } = await import("./collaboration-learning.js");
    const respond = vi.fn();
    await collaborationLearningHandlers["collaboration.task.confirmTodolist"]({
      req: {} as never,
      params: {
        groupId: "grp-1",
        taskId: "task-1",
        todolistId: "tl-1",
        expectedVersion: 2,
      },
      respond: respond as never,
      context: {} as never,
      client: {
        connect: { user: "human:owner" },
        platformUserId: "human:owner",
      } as never,
      isWebchatConnect: () => false,
    });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(advanceMock).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        todolist: expect.objectContaining({ status: "confirmed" }),
        autoAdvanceWired: true,
        autoAdvance: expect.objectContaining({
          autoAdvanceWired: true,
          wakeRecorded: false,
          reason: expect.stringContaining("advance_threw:dispatcher_down"),
        }),
      }),
      undefined,
    );
  });

  it("surfaces wakeRecorded=false reason when advance declines (no silent OK)", async () => {
    advanceMock.mockResolvedValueOnce({
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: "execution_bag_plan_not_confirmed",
      targetAgentIds: [],
    });
    const { collaborationLearningHandlers } = await import("./collaboration-learning.js");
    const respond = vi.fn();
    await collaborationLearningHandlers["collaboration.task.confirmTodolist"]({
      req: {} as never,
      params: {
        groupId: "grp-1",
        taskId: "task-1",
        todolistId: "tl-1",
        expectedVersion: 2,
      },
      respond: respond as never,
      context: {} as never,
      client: {
        connect: { user: "human:owner" },
        platformUserId: "human:owner",
      } as never,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        autoAdvanceWired: true,
        autoAdvance: expect.objectContaining({
          wakeRecorded: false,
          reason: "execution_bag_plan_not_confirmed",
        }),
      }),
      undefined,
    );
  });

  it("does not call advance when confirm throws", async () => {
    const { ClaimContractEntryError } = await import("../collaboration-learning.js");
    confirmMock.mockRejectedValueOnce(
      new ClaimContractEntryError("actor_not_confirmer", "not confirmer"),
    );
    const { collaborationLearningHandlers } = await import("./collaboration-learning.js");
    const respond = vi.fn();
    await collaborationLearningHandlers["collaboration.task.confirmTodolist"]({
      req: {} as never,
      params: {
        groupId: "grp-1",
        taskId: "task-1",
        todolistId: "tl-1",
        expectedVersion: 2,
      },
      respond: respond as never,
      context: {} as never,
      client: {
        connect: { user: "human:owner" },
        platformUserId: "human:owner",
      } as never,
      isWebchatConnect: () => false,
    });

    expect(advanceMock).not.toHaveBeenCalled();
    expect(respond.mock.calls[0]?.[0]).toBe(false);
  });
});
