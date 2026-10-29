/**
 * #137 P2: getTodolist/listTodolists must use trusted READ context so observers
 * can hydrate plans/cards; writes (confirm) still refuse observers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getTodolistMock = vi.hoisted(() =>
  vi.fn(async () => ({
    todolistId: "tl-1",
    taskId: "task-1",
    boardItemId: "board-1",
    groupId: "grp-1",
    ownerMemberId: "bot-exec",
    status: "proposed",
    steps: [{ stepId: "s1", title: "step", status: "pending" }],
    proposedBy: "bot-exec",
    proposedAt: 1,
    version: 1,
    visibility: "executor_private",
  })),
);

const listTodolistsMock = vi.hoisted(() =>
  vi.fn(async () => [
    {
      todolistId: "tl-1",
      taskId: "task-1",
      status: "proposed",
      version: 1,
    },
  ]),
);

const listDeliveriesMock = vi.hoisted(() => vi.fn(async () => []));

const confirmMock = vi.hoisted(() =>
  vi.fn(async () => ({
    todolistId: "tl-1",
    taskId: "task-1",
    status: "confirmed",
    version: 2,
  })),
);

const resolveTrustedMock = vi.hoisted(() =>
  vi.fn(async (params: { action: "read" | "write" }) => {
    if (params.action === "write") {
      return {
        ok: false as const,
        reason: "write_acl_denied",
        detail: "observer/read-only role cannot write (governance=observer collab=none)",
      };
    }
    return {
      ok: true as const,
      auth: { ok: true, groupsRoot: "/tmp/groups", groupLocator: "grp-1" },
      stores: {
        groupsRoot: "/tmp/groups",
        groupLocator: "grp-1",
        usedLegacyWorkspaceFallback: false,
      },
      trusted: { groupsRoot: "/tmp/groups", groupLocator: "grp-1" },
    };
  }),
);

vi.mock("../collaboration-learning.js", async () => {
  const actual = await vi.importActual<typeof import("../collaboration-learning.js")>(
    "../collaboration-learning.js",
  );
  return {
    ...actual,
    getCollaborationTodolist: getTodolistMock,
    listCollaborationTodolists: listTodolistsMock,
    listCollaborationOwnerDecisionDeliveries: listDeliveriesMock,
    confirmCollaborationTodolist: confirmMock,
  };
});

vi.mock("../collaboration-learning/post-plan-confirm-advance.js", () => ({
  triggerPostPlanConfirmAdvance: vi.fn(async () => ({
    autoAdvanceWired: false,
    wakeRecorded: false,
    wakeConsumed: false,
    dispatched: false,
    reason: "test",
    targetAgentIds: [],
  })),
}));

vi.mock("../collaboration-learning/delivery-actor-binding.js", async () => {
  const actual = await vi.importActual<
    typeof import("../collaboration-learning/delivery-actor-binding.js")
  >("../collaboration-learning/delivery-actor-binding.js");
  return {
    ...actual,
    authenticatedSessionSubjects: vi.fn(() => ["human:observer"]),
    resolveDeliveryAclActor: vi.fn(async () => "human:observer"),
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
    resolveHandlerTrustedTeamContext: resolveTrustedMock,
  };
});

describe("todolist read vs write trusted context (observer)", () => {
  beforeEach(() => {
    getTodolistMock.mockClear();
    listTodolistsMock.mockClear();
    listDeliveriesMock.mockClear();
    confirmMock.mockClear();
    resolveTrustedMock.mockClear();
  });

  it("observer getTodolist succeeds via action:read", async () => {
    const { collaborationLearningHandlers } = await import("./collaboration-learning.js");
    const respond = vi.fn();
    await collaborationLearningHandlers["collaboration.task.getTodolist"]({
      req: {} as never,
      params: { groupId: "grp-1", taskId: "task-1", todolistId: "tl-1" },
      respond: respond as never,
      context: {} as never,
      client: { connect: { user: "human:observer" }, user: "human:observer" } as never,
      isWebchatConnect: () => false,
    });
    expect(resolveTrustedMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "read", groupId: "grp-1", actor: "human:observer" }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        todolist: expect.objectContaining({ todolistId: "tl-1" }),
      }),
      undefined,
    );
  });

  it("observer listTodolists succeeds via action:read", async () => {
    const { collaborationLearningHandlers } = await import("./collaboration-learning.js");
    const respond = vi.fn();
    await collaborationLearningHandlers["collaboration.task.listTodolists"]({
      req: {} as never,
      params: { groupId: "grp-1", taskId: "task-1" },
      respond: respond as never,
      context: {} as never,
      client: { connect: { user: "human:observer" }, user: "human:observer" } as never,
      isWebchatConnect: () => false,
    });
    expect(resolveTrustedMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "read", groupId: "grp-1", actor: "human:observer" }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ todolists: expect.any(Array) }),
      undefined,
    );
  });

  it("observer confirmTodolist is refused via action:write", async () => {
    const { collaborationLearningHandlers } = await import("./collaboration-learning.js");
    const respond = vi.fn();
    await collaborationLearningHandlers["collaboration.task.confirmTodolist"]({
      req: {} as never,
      params: { groupId: "grp-1", taskId: "task-1", todolistId: "tl-1" },
      respond: respond as never,
      context: {} as never,
      client: { connect: { user: "human:observer" }, user: "human:observer" } as never,
      isWebchatConnect: () => false,
    });
    expect(resolveTrustedMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "write", groupId: "grp-1", actor: "human:observer" }),
    );
    expect(confirmMock).not.toHaveBeenCalled();
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    const err = respond.mock.calls[0]?.[2] as { message?: string } | undefined;
    expect(err?.message ?? "").toContain("write_acl_denied");
  });
});
