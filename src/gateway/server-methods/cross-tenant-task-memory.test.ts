import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../protocol/index.js";

const listAgentMemoryEntriesMock = vi.fn();
const getMemorySearchManagerMock = vi.fn();
const listTaskContextsMock = vi.fn();

vi.mock("../../data/memory-list.js", () => ({
  listAgentMemoryEntries: listAgentMemoryEntriesMock,
}));

vi.mock("../../memory/search-manager.js", () => ({
  getMemorySearchManager: getMemorySearchManagerMock,
}));

vi.mock("../../auto-reply/reply/task-context-store.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../auto-reply/reply/task-context-store.js")>();
  return {
    ...actual,
    listTaskContexts: listTaskContextsMock,
  };
});

const actorA = {
  userId: "user-a",
  userEmail: "a@test.com",
  tenantId: "tenant-a",
  seatAgentIds: ["bot-a"],
  seatSpaceIds: [],
};

vi.mock("../employee-workbench-scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../employee-workbench-scope.js")>();
  return {
    ...actual,
    resolveEmployeeWorkbenchActor: vi.fn(async (client: { user?: string } | null) => {
      if (client?.user === "a@test.com") {
        return actorA;
      }
      if (client?.user === "b@test.com") {
        return {
          userId: "user-b",
          userEmail: "b@test.com",
          tenantId: "tenant-b",
          seatAgentIds: ["bot-b"],
          seatSpaceIds: [],
        };
      }
      return null;
    }),
    isAgentOwnedByEmployeeUser: vi.fn((agent: { id: string }, actor: { seatAgentIds: string[] }) =>
      actor.seatAgentIds.includes(agent.id),
    ),
    isPersonalWorkbenchClient: vi.fn(
      (client: { sessionDomain?: string } | null) =>
        client?.sessionDomain === "employee" || client?.sessionDomain === "enterprise",
    ),
  };
});

vi.mock("../session-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session-utils.js")>();
  return {
    ...actual,
    listAgentsForGateway: vi.fn(() => ({
      agents: [
        { id: "bot-a", ownerId: "user-a", scope: "employee" },
        { id: "bot-b", ownerId: "user-b", scope: "employee" },
      ],
    })),
  };
});

function captureRespond() {
  const calls: Array<{
    ok: boolean;
    payload?: unknown;
    error?: { code?: string; message?: string };
  }> = [];
  return {
    calls,
    respond: (ok: boolean, payload?: unknown, error?: { code?: string; message?: string }) => {
      calls.push({ ok, payload, error });
    },
  };
}

describe("TC-CL-09 cross-tenant Task/Memory isolation", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("data.memory.list denies employee A access to employee B agent memory", async () => {
    listAgentMemoryEntriesMock.mockResolvedValue({ entries: [] });
    getMemorySearchManagerMock.mockResolvedValue({ manager: null });

    const { dataHandlers } = await import("./data.js");
    const capture = captureRespond();
    await dataHandlers["data.memory.list"]({
      params: { agentId: "bot-b" },
      respond: capture.respond,
      client: { sessionDomain: "employee", user: "a@test.com" } as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(false);
    expect(capture.calls[0]?.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
    expect(listAgentMemoryEntriesMock).not.toHaveBeenCalled();
  });

  it("tasks.list denies employee A listing tasks for employee B agent", async () => {
    listTaskContextsMock.mockResolvedValue([{ id: "task_secret", title: "Secret" }]);

    const { taskContextHandlers } = await import("./task-context.js");
    const capture = captureRespond();
    await taskContextHandlers["tasks.list"]({
      params: { agentId: "bot-b" },
      respond: capture.respond,
      client: { sessionDomain: "employee", user: "a@test.com" } as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(false);
    expect(listTaskContextsMock).not.toHaveBeenCalled();
  });

  it("data.memory.list allows employee A to list own agent memory", async () => {
    listAgentMemoryEntriesMock.mockResolvedValue({
      entries: [{ key: "memory/agent/note.md", bytes: 10, updatedAtMs: 1 }],
    });
    getMemorySearchManagerMock.mockResolvedValue({ manager: null });

    const { dataHandlers } = await import("./data.js");
    const capture = captureRespond();
    await dataHandlers["data.memory.list"]({
      params: { agentId: "bot-a" },
      respond: capture.respond,
      client: { sessionDomain: "employee", user: "a@test.com" } as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(true);
    expect(listAgentMemoryEntriesMock).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "bot-a" }),
    );
  });
});
