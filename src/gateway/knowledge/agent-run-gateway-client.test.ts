// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const platformMock = vi.hoisted(() => ({
  loadPlatformAuthStore: vi.fn(),
  resolvePlatformAuthConfig: vi.fn(() => ({ enabled: true })),
  findUserById: vi.fn(),
  findUserByEmail: vi.fn(),
}));

const entitlementMock = vi.hoisted(() => ({
  resolveAgentRunEntitlementScope: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({ gateway: { auth: { trustedProxy: { enabled: true } } } }),
}));

vi.mock("../platform-auth.js", () => ({
  resolvePlatformAuthConfig: platformMock.resolvePlatformAuthConfig,
  loadPlatformAuthStore: platformMock.loadPlatformAuthStore,
  findUserById: platformMock.findUserById,
  findUserByEmail: platformMock.findUserByEmail,
}));

vi.mock("../model-entitlement/resolve-agent-run-scope.js", () => ({
  resolveAgentRunEntitlementScope: entitlementMock.resolveAgentRunEntitlementScope,
}));

const { resolveKnowledgeGatewayClientForAgentRun, resolveKnowledgeToolGatewayClient } =
  await import("./agent-run-gateway-client.js");

const owner = { id: "user-90", email: "owner@acme.test" };
const store = {
  users: { [owner.id]: { ...owner, normalizedEmail: owner.email, status: "active" } },
};

describe("resolveKnowledgeGatewayClientForAgentRun", () => {
  beforeEach(() => {
    platformMock.loadPlatformAuthStore.mockResolvedValue(store);
    platformMock.resolvePlatformAuthConfig.mockReturnValue({ enabled: true });
    platformMock.findUserById.mockImplementation((_s: unknown, id: string) =>
      id === owner.id ? owner : undefined,
    );
    platformMock.findUserByEmail.mockImplementation((_s: unknown, email: string) =>
      email === owner.email ? owner : undefined,
    );
    entitlementMock.resolveAgentRunEntitlementScope.mockReset();
    entitlementMock.resolveAgentRunEntitlementScope.mockResolvedValue(null);
  });

  it("returns null when no trusted identity is available", async () => {
    await expect(
      resolveKnowledgeGatewayClientForAgentRun({ agentId: "bot-skill" }),
    ).resolves.toBeNull();
  });

  it("keeps an explicit websocket email", async () => {
    const resolved = await resolveKnowledgeGatewayClientForAgentRun({
      gatewayClientUser: "owner@acme.test",
      gatewayClientSessionDomain: "employee",
    });
    expect(resolved?.user).toBe("owner@acme.test");
    expect(resolved?.platformUserId).toBe("user-90");
    expect(resolved?.client.user).toBe("owner@acme.test");
  });

  it("hydrates email from an explicit platform user id", async () => {
    const resolved = await resolveKnowledgeGatewayClientForAgentRun({
      gatewayClientPlatformUserId: "user-90",
    });
    expect(resolved?.user).toBe("owner@acme.test");
    expect(resolved?.platformUserId).toBe("user-90");
  });

  it("uses cron/group owner user id when no session email exists", async () => {
    const resolved = await resolveKnowledgeGatewayClientForAgentRun({
      ownerUserId: "user-90",
      agentId: "bot-skill",
    });
    expect(resolved?.user).toBe("owner@acme.test");
    expect(entitlementMock.resolveAgentRunEntitlementScope).not.toHaveBeenCalled();
  });

  it("falls back to the bot seat employee when owner is unknown", async () => {
    entitlementMock.resolveAgentRunEntitlementScope.mockResolvedValue({
      tenantId: "001",
      seatId: "seat-1",
      employeeId: "user-90",
    });
    const resolved = await resolveKnowledgeGatewayClientForAgentRun({
      agentId: "bot-skill",
      tenantId: "001",
    });
    expect(resolved?.user).toBe("owner@acme.test");
    expect(entitlementMock.resolveAgentRunEntitlementScope).toHaveBeenCalledWith({
      agentId: "bot-skill",
      tenantId: "001",
    });
  });

  it("builds a tool client from platform user id without waiting on store hydrate", async () => {
    const client = await resolveKnowledgeToolGatewayClient({
      gatewayClientPlatformUserId: "user-90",
    });
    expect(client?.platformUserId).toBe("user-90");
    expect(entitlementMock.resolveAgentRunEntitlementScope).not.toHaveBeenCalled();
  });

  it("resolves a tool client from the bot seat when no session identity exists", async () => {
    entitlementMock.resolveAgentRunEntitlementScope.mockResolvedValue({
      tenantId: "001",
      seatId: "seat-1",
      employeeId: "user-90",
    });
    const client = await resolveKnowledgeToolGatewayClient({
      agentId: "bot-skill",
      tenantId: "001",
    });
    expect(client?.user).toBe("owner@acme.test");
  });
});
