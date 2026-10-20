import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveQueryScopeMock = vi.fn();
const listTenantMeshGrowthAgentsMock = vi.fn();
const listOwnershipRecordsMock = vi.fn();
const loadSeatAssetsStoreForTenantIdMock = vi.fn();
const loadStoreMock = vi.fn();
const resolvePlatformAuthConfigMock = vi.fn();

vi.mock("../config/config.js", () => ({
  loadConfig: () => ({ gateway: { auth: {} } }),
}));

vi.mock("./scope-attribution.js", () => ({
  resolveQueryScope: (...args: unknown[]) => resolveQueryScopeMock(...args),
}));

vi.mock("./agent-growth/mesh-growth-tenant-scope.js", () => ({
  listTenantMeshGrowthAgents: (...args: unknown[]) => listTenantMeshGrowthAgentsMock(...args),
}));

vi.mock("./ownership-store.js", () => ({
  listOwnershipRecords: (...args: unknown[]) => listOwnershipRecordsMock(...args),
}));

vi.mock("./platform-auth/seat-store-loader.js", () => ({
  loadSeatAssetsStoreForTenantId: (...args: unknown[]) =>
    loadSeatAssetsStoreForTenantIdMock(...args),
}));

vi.mock("./platform-auth/store.js", () => ({
  loadStore: (...args: unknown[]) => loadStoreMock(...args),
}));

vi.mock("./platform-auth/config.js", () => ({
  resolvePlatformAuthConfig: (...args: unknown[]) => resolvePlatformAuthConfigMock(...args),
}));

describe("enterprise tenant roster scope", () => {
  beforeEach(() => {
    resolveQueryScopeMock.mockReset();
    listTenantMeshGrowthAgentsMock.mockReset();
    listOwnershipRecordsMock.mockReset();
    loadSeatAssetsStoreForTenantIdMock.mockReset();
    loadStoreMock.mockReset();
    resolvePlatformAuthConfigMock.mockReset();
    listOwnershipRecordsMock.mockReturnValue([]);
    loadSeatAssetsStoreForTenantIdMock.mockResolvedValue({
      version: 1,
      seats: {},
      assetBindings: {},
    });
    resolvePlatformAuthConfigMock.mockReturnValue(null);
  });

  it("filters agents to tenant mesh roster for enterprise sessions", async () => {
    resolveQueryScopeMock.mockResolvedValue({ kind: "tenant", tenantId: "001" });
    listTenantMeshGrowthAgentsMock.mockResolvedValue([
      { agentId: "bot-sales", name: "销售助手" },
      { agentId: "bot-hr", name: "人事助手" },
    ]);
    const { filterAgentsForEnterpriseTenantClient } =
      await import("./enterprise-tenant-roster-scope.js");
    const agents = await filterAgentsForEnterpriseTenantClient(
      { sessionDomain: "enterprise", user: "ceo@example.com" } as never,
      [
        { id: "main", name: "大白管家" },
        { id: "bot-sales", name: "销售助手" },
        { id: "bot-hr", name: "人事助手" },
        { id: "bot-other-tenant", name: "外部机器人" },
      ] as never,
    );
    expect(agents?.map((entry) => entry.id).toSorted()).toEqual(["bot-hr", "bot-sales", "main"]);
  });

  it("returns null for non-enterprise sessions", async () => {
    const { filterAgentsForEnterpriseTenantClient } =
      await import("./enterprise-tenant-roster-scope.js");
    const agents = await filterAgentsForEnterpriseTenantClient(
      { sessionDomain: "employee", user: "me@example.com" } as never,
      [{ id: "main", name: "大白管家" }] as never,
    );
    expect(agents).toBeNull();
    expect(resolveQueryScopeMock).not.toHaveBeenCalled();
  });

  it("includes spaces owned by tenant members", async () => {
    resolvePlatformAuthConfigMock.mockReturnValue({ enabled: true });
    loadStoreMock.mockResolvedValue({
      users: {
        "user-a": { id: "user-a", email: "alice@example.com" },
        "user-b": { id: "user-b", email: "bob@example.com" },
      },
      memberships: {
        m1: { id: "m1", userId: "user-a", enterpriseId: "001" },
        m2: { id: "m2", userId: "user-b", enterpriseId: "001" },
      },
    });
    const { collectTenantVisibleSpaceIds } = await import("./enterprise-tenant-roster-scope.js");
    const ids = await collectTenantVisibleSpaceIds({
      tenantId: "001",
      spaces: [
        {
          id: "space-alice",
          groupId: "space-alice",
          ownerUserId: "alice@example.com",
          members: { humans: [] },
        },
        {
          id: "space-foreign",
          groupId: "space-foreign",
          ownerUserId: "outsider@example.com",
          members: { humans: [] },
        },
        {
          id: "space-bob-member",
          groupId: "space-bob-member",
          ownerUserId: "outsider@example.com",
          members: {
            humans: [{ userId: "bob@example.com", status: "active" }],
          },
        },
      ],
    });
    expect([...ids].toSorted()).toEqual(["space-alice", "space-bob-member"]);
  });
});
