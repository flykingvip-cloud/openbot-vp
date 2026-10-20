import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveEmployeeWorkbenchActorMock = vi.fn();
const listAgentsForGatewayMock = vi.fn();

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({}),
}));

vi.mock("../session-utils.js", () => ({
  listAgentsForGateway: (...args: unknown[]) => listAgentsForGatewayMock(...args),
}));

vi.mock("../employee-workbench-scope.js", async () => {
  const actual = await vi.importActual<typeof import("../employee-workbench-scope.js")>(
    "../employee-workbench-scope.js",
  );
  return {
    ...actual,
    resolveEmployeeWorkbenchActor: (...args: unknown[]) =>
      resolveEmployeeWorkbenchActorMock(...args),
    // Handlers call resolveScopedAgentsForClient, which must honor the actor mock.
    resolveScopedAgentsForClient: async (client: unknown, agents: unknown[]) => {
      const actor = await resolveEmployeeWorkbenchActorMock(client);
      return actual.scopeAgentsForClientActor(client as never, agents as never, actor);
    },
  };
});

vi.mock("../protocol/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../protocol/index.js")>("../protocol/index.js");
  return {
    ...actual,
    validateAgentsListParams: Object.assign(() => true, { errors: null }),
  };
});

describe("agents.list actor fail-closed", () => {
  beforeEach(() => {
    resolveEmployeeWorkbenchActorMock.mockReset();
    listAgentsForGatewayMock.mockReset();
    listAgentsForGatewayMock.mockReturnValue({
      defaultId: "main",
      mainKey: "agent:main:main",
      scope: "global",
      agents: [
        { id: "main", name: "大白管家", scope: "self" },
        {
          id: "agt-other",
          name: "市场助手",
          ownerId: "other-user",
          scope: "shared",
        },
        {
          id: "agt-mine",
          name: "我的助手",
          ownerId: "me@example.com",
          scope: "shared",
        },
      ],
    });
  });

  it("does not leak the install-wide roster when a personal-workbench actor cannot be resolved", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue(null);
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");

    await agentsHandlers["agents.list"]({
      req: {} as never,
      params: {},
      respond: respond as never,
      client: { sessionDomain: "employee", user: "me@example.com" } as never,
      isWebchatConnect: () => true,
      context: {} as never,
    });

    const agents = respond.mock.calls[0]?.[1]?.agents as Array<{ id: string }>;
    expect(agents.map((entry) => entry.id)).toEqual(["main"]);
  });

  it("fails closed for authenticated sessions without a platform domain", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue(null);
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");

    await agentsHandlers["agents.list"]({
      req: {} as never,
      params: {},
      respond: respond as never,
      // Missing sessionDomain — same shape as unresolved_tenant chat.history failures.
      client: { user: "me@example.com" } as never,
      isWebchatConnect: () => true,
      context: {} as never,
    });

    const agents = respond.mock.calls[0]?.[1]?.agents as Array<{ id: string }>;
    expect(agents.map((entry) => entry.id)).toEqual(["main"]);
  });

  it("does not include another employee's owned bot when actor resolves for this user", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({
      userId: "user-me",
      userEmail: "me@example.com",
      tenantId: "tenant-a",
      seatAgentIds: ["main", "agt-mine"],
      seatSpaceIds: [],
    });
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");

    await agentsHandlers["agents.list"]({
      req: {} as never,
      params: {},
      respond: respond as never,
      client: { sessionDomain: "employee", user: "me@example.com" } as never,
      isWebchatConnect: () => true,
      context: {} as never,
    });

    const agents = respond.mock.calls[0]?.[1]?.agents as Array<{ id: string; ownerId?: string }>;
    expect(agents.map((entry) => entry.id).toSorted()).toEqual(["agt-mine", "main"]);
    expect(agents.some((entry) => entry.id === "agt-other")).toBe(false);
  });

  it("does not leak foreign agents when a www client still has a platform session", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue(null);
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");

    await agentsHandlers["agents.list"]({
      req: {} as never,
      params: {},
      respond: respond as never,
      client: {
        sessionDomain: "platform",
        user: "ceo@example.com",
        upgradeRequestOrigin: "https://www.openbot.love",
      } as never,
      isWebchatConnect: () => true,
      context: {} as never,
    });

    const agents = respond.mock.calls[0]?.[1]?.agents as Array<{ id: string }>;
    expect(agents.map((entry) => entry.id)).toEqual(["main"]);
    expect(agents.some((entry) => entry.id === "agt-other")).toBe(false);
  });
});
