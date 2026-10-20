import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveEmployeeWorkbenchActorMock = vi.fn();
const findAgentEntryIndexMock = vi.fn();
const unbindAgentAssetFromSeatForTenantMock = vi.fn();
const findActiveOwnershipRecordMock = vi.fn();
const revokeOwnershipRecordMock = vi.fn();
const pruneAgentConfigMock = vi.fn();
const writeConfigFileMock = vi.fn();
const resolveAgentsHandlerWorkspaceLocatorOrRespondMock = vi.fn();
const releaseBillableBotForAgentMock = vi.fn(async (..._args: unknown[]) => null);

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({ agents: { list: [] } }),
  writeConfigFile: (...args: unknown[]) => writeConfigFileMock(...args),
}));

vi.mock("../../commands/agents.config.js", () => ({
  applyAgentConfig: vi.fn(),
  findAgentEntryIndex: (...args: unknown[]) => findAgentEntryIndexMock(...args),
  listAgentEntries: () => [],
  pruneAgentConfig: (...args: unknown[]) => pruneAgentConfigMock(...args),
}));

vi.mock("../session-utils.js", () => ({
  listAgentsForGateway: () => ({ agents: [] }),
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

vi.mock("../platform-auth/seat-store-loader.js", () => ({
  bindAgentAssetToSeatForTenant: vi.fn(),
  unbindAgentAssetFromSeatForTenant: (...args: unknown[]) =>
    unbindAgentAssetFromSeatForTenantMock(...args),
}));

vi.mock("../ownership-store.js", () => ({
  findActiveOwnershipRecord: (...args: unknown[]) => findActiveOwnershipRecordMock(...args),
  revokeOwnershipRecord: (...args: unknown[]) => revokeOwnershipRecordMock(...args),
  upsertOwnershipRecord: vi.fn(),
}));

vi.mock("../billing/billable-bot.js", () => ({
  authorizeBillableBotCreate: vi.fn(async () => ({ allowed: true, existing: null })),
  registerBillableBot: vi.fn(async () => ({ bot: { id: "bot-x" }, created: true })),
  publishBillableBotChanged: vi.fn(async () => {}),
  releaseBillableBotForAgent: (...args: unknown[]) => releaseBillableBotForAgentMock(...args),
}));

vi.mock("./agents-handler-workspace-locator.js", () => ({
  resolveAgentsHandlerWorkspaceLocatorOrRespond: (...args: unknown[]) =>
    resolveAgentsHandlerWorkspaceLocatorOrRespondMock(...args),
}));

describe("agents.delete owner leftover", () => {
  beforeEach(() => {
    resolveEmployeeWorkbenchActorMock.mockReset();
    findAgentEntryIndexMock.mockReset();
    unbindAgentAssetFromSeatForTenantMock.mockReset();
    findActiveOwnershipRecordMock.mockReset();
    revokeOwnershipRecordMock.mockReset();
    pruneAgentConfigMock.mockReset();
    writeConfigFileMock.mockReset();
    resolveAgentsHandlerWorkspaceLocatorOrRespondMock.mockReset();
    releaseBillableBotForAgentMock.mockReset();
    releaseBillableBotForAgentMock.mockResolvedValue(null);
    findAgentEntryIndexMock.mockReturnValue(-1);
    unbindAgentAssetFromSeatForTenantMock.mockResolvedValue(undefined);
    findActiveOwnershipRecordMock.mockReturnValue({
      positionId: "seat-ceo",
    });
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({
      userId: "user-ceo",
      userEmail: "daniel.hhd@gmail.com",
      tenantId: "001",
      currentSeatId: "seat-ceo",
      seatAgentIds: ["main", "agt-daniel-hhd-gmail-com-nchn5ey"],
      seatSpaceIds: [],
    });
  });

  it("lets the owner confirm-delete a leftover roster stub without config or locator", async () => {
    const { agentsHandlers } = await import("./agents.js");
    const respond = vi.fn();
    await agentsHandlers["agents.delete"]({
      req: {} as never,
      params: { agentId: "agt-daniel-hhd-gmail-com-nchn5ey" },
      respond: respond as never,
      client: { sessionDomain: "employee", user: "daniel.hhd@gmail.com" } as never,
      isWebchatConnect: () => true,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        agentId: "agt-daniel-hhd-gmail-com-nchn5ey",
        removedBindings: 0,
      }),
      undefined,
    );
    expect(unbindAgentAssetFromSeatForTenantMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "001",
        seatId: "seat-ceo",
        agentId: "agt-daniel-hhd-gmail-com-nchn5ey",
        actorUserId: "user-ceo",
      }),
    );
    expect(revokeOwnershipRecordMock).toHaveBeenCalled();
    expect(releaseBillableBotForAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enterpriseId: "001",
        agentId: "agt-daniel-hhd-gmail-com-nchn5ey",
      }),
    );
    expect(resolveAgentsHandlerWorkspaceLocatorOrRespondMock).not.toHaveBeenCalled();
    expect(pruneAgentConfigMock).not.toHaveBeenCalled();
    expect(writeConfigFileMock).not.toHaveBeenCalled();
  });

  it("still rejects a leftover the caller does not own", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({
      userId: "user-ceo",
      userEmail: "daniel.hhd@gmail.com",
      tenantId: "001",
      currentSeatId: "seat-ceo",
      seatAgentIds: ["main"],
      seatSpaceIds: [],
    });
    const { agentsHandlers } = await import("./agents.js");
    const respond = vi.fn();
    await agentsHandlers["agents.delete"]({
      req: {} as never,
      params: { agentId: "agt-someone-else" },
      respond: respond as never,
      client: { sessionDomain: "employee", user: "daniel.hhd@gmail.com" } as never,
      isWebchatConnect: () => true,
      context: {} as never,
    });

    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(String(respond.mock.calls[0]?.[2]?.message ?? "")).toMatch(/not found/i);
    expect(unbindAgentAssetFromSeatForTenantMock).not.toHaveBeenCalled();
  });
});
