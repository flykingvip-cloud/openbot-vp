import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveScopedAgentsForClientMock = vi.fn();

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({}),
}));

vi.mock("../session-utils.js", () => ({
  listAgentsForGateway: () => ({
    defaultId: "main",
    mainKey: "agent:main:main",
    scope: "global",
    agents: [
      { id: "main", name: "大白管家", scope: "self" },
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
    resolveScopedAgentsForClient: (...args: unknown[]) => resolveScopedAgentsForClientMock(...args),
  };
});

describe("robot.workspace actor fail-closed", () => {
  beforeEach(() => {
    resolveScopedAgentsForClientMock.mockReset();
    resolveScopedAgentsForClientMock.mockResolvedValue([
      { id: "main", name: "大白管家", scope: "self" },
    ]);
  });

  it("denies get when scoped roster does not include the requested agent", async () => {
    const respond = vi.fn();
    const { robotWorkspaceHandlers } = await import("./robot-workspace.js");

    await robotWorkspaceHandlers["robot.workspace.get"]({
      req: {} as never,
      params: { agentId: "agt-other" },
      respond: respond as never,
      client: { sessionDomain: "employee", user: "me@example.com" } as never,
      isWebchatConnect: () => true,
      context: {} as never,
    });

    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(String(respond.mock.calls[0]?.[2]?.message ?? "")).toMatch(/inaccessible/i);
  });

  it("denies listPersonas for agents outside the scoped roster", async () => {
    const respond = vi.fn();
    const { robotWorkspaceHandlers } = await import("./robot-workspace.js");

    await robotWorkspaceHandlers["robot.workspace.listPersonas"]({
      req: {} as never,
      params: { agentId: "agt-other" },
      respond: respond as never,
      client: { sessionDomain: "employee", user: "me@example.com" } as never,
      isWebchatConnect: () => true,
      context: {} as never,
    });

    expect(respond.mock.calls[0]?.[0]).toBe(false);
  });
});
