import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveEmployeeWorkbenchActorMock = vi.fn();

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({}),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds: () => ["agt-other", "agt-mine", "main"],
  resolveAgentDir: () => "/tmp/agent-dir",
  resolveAgentWorkspaceDir: () => "/tmp/agent-workspace",
}));

vi.mock("../session-utils.js", () => ({
  listAgentsForGateway: () => ({
    agents: [
      { id: "agt-other", name: "市场助手", ownerId: "other-user", scope: "shared" },
      { id: "agt-mine", name: "我的助手", ownerId: "me@example.com", scope: "shared" },
    ],
  }),
}));

vi.mock("../employee-workbench-scope.js", async () => {
  const actual = await vi.importActual<typeof import("../employee-workbench-scope.js")>(
    "../employee-workbench-scope.js",
  );
  return {
    ...actual,
    resolveEmployeeWorkbenchActor: (...args: unknown[]) =>
      resolveEmployeeWorkbenchActorMock(...args),
  };
});

vi.mock("../protocol/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../protocol/index.js")>("../protocol/index.js");
  return {
    ...actual,
    validateAgentsFilesListParams: Object.assign(() => true, { errors: null }),
  };
});

describe("agents.files.* personal-workbench object ACL", () => {
  beforeEach(() => {
    resolveEmployeeWorkbenchActorMock.mockReset();
  });

  it("denies list when actor cannot be resolved on employee session", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue(null);
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");

    await agentsHandlers["agents.files.list"]({
      req: {} as never,
      params: { agentId: "agt-other" },
      respond: respond as never,
      client: { sessionDomain: "employee", user: "me@example.com" } as never,
      isWebchatConnect: () => true,
      context: {} as never,
    });

    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(String(respond.mock.calls[0]?.[2]?.message ?? "")).toMatch(/resolved employee actor/i);
  });

  it("denies list for another employee's agent", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({
      userId: "user-me",
      userEmail: "me@example.com",
      tenantId: "tenant-a",
      seatAgentIds: ["main", "agt-mine"],
      seatSpaceIds: [],
    });
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");

    await agentsHandlers["agents.files.list"]({
      req: {} as never,
      params: { agentId: "agt-other" },
      respond: respond as never,
      client: { sessionDomain: "employee", user: "me@example.com" } as never,
      isWebchatConnect: () => true,
      context: {} as never,
    });

    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(String(respond.mock.calls[0]?.[2]?.message ?? "")).toMatch(/do not have permission/i);
  });
});
