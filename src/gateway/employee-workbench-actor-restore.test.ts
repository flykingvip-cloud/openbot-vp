import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveActor = vi.hoisted(() => vi.fn());

vi.mock("./employee-workbench-scope.js", () => ({
  resolveEmployeeWorkbenchActor: (...args: unknown[]) => resolveActor(...args),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: () => ({ gateway: { auth: { trustedProxy: { enabled: true } } } }),
}));

vi.mock("./platform-auth/config.js", () => ({
  resolvePlatformAuthConfig: () => ({ enabled: true }),
}));

vi.mock("./platform-auth/store.js", () => ({
  loadStore: async () => ({ users: {}, memberships: {} }),
}));

vi.mock("./platform-auth/memberships.js", () => ({
  findUserById: (_store: unknown, userId: string) =>
    userId === "90fed19a-1c8b-4420-87e0-bcc6165e32fa"
      ? { id: userId, email: "ceo@example.com", status: "active" }
      : undefined,
  findUserByEmail: () => undefined,
  resolvePreferredMembershipForUser: () => ({
    id: "mem-ceo",
    enterpriseId: "ent-upbeyond",
    userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
  }),
}));

vi.mock("./platform-auth/request-helpers.js", () => ({
  normalizeEmail: (value: string) => value.trim().toLowerCase(),
}));

const { PERSONAL_WORKBENCH_ACTOR_RESTORE_FAILURE, restorePersonalWorkbenchActor } =
  await import("./employee-workbench-actor-restore.js");

const ownerId = "90fed19a-1c8b-4420-87e0-bcc6165e32fa";

describe("restorePersonalWorkbenchActor", () => {
  beforeEach(() => {
    resolveActor.mockReset();
  });

  it("restores employee domain, user, and tenant from the session key after restart", async () => {
    const client: {
      platformUserId?: string;
      user?: string;
      sessionDomain?: "employee";
      sessionEnterpriseId?: string;
      sessionTenantId?: string;
      sessionMembershipId?: string;
    } = {};
    resolveActor.mockImplementation(async (next: typeof client | null) => {
      if (next?.user && next.sessionDomain === "employee" && next.sessionEnterpriseId) {
        return {
          userId: next.platformUserId,
          userEmail: next.user,
          tenantId: next.sessionEnterpriseId,
          seatAgentIds: ["main"],
          seatSpaceIds: [],
        };
      }
      return null;
    });

    const restored = await restorePersonalWorkbenchActor({
      client: client as never,
      sessionKey: `agent:main:employee:${ownerId}`,
    });

    expect(restored.ok).toBe(true);
    expect(client).toMatchObject({
      platformUserId: ownerId,
      user: "ceo@example.com",
      sessionDomain: "employee",
      sessionEnterpriseId: "ent-upbeyond",
      sessionTenantId: "ent-upbeyond",
      sessionMembershipId: "mem-ceo",
    });
    if (restored.ok) {
      expect(restored.actor.userId).toBe(ownerId);
    }
  });

  it("fails closed when a personal session cannot be rebuilt", async () => {
    resolveActor.mockResolvedValue(null);
    const restored = await restorePersonalWorkbenchActor({
      client: { sessionDomain: "employee" } as never,
      sessionKey: "agent:main:employee:missing-user",
    });
    expect(restored).toEqual({
      ok: false,
      reason: "unrestorable",
      message: PERSONAL_WORKBENCH_ACTOR_RESTORE_FAILURE,
    });
  });

  it("does not rewrite a platform console session", async () => {
    resolveActor.mockResolvedValue(null);
    const restored = await restorePersonalWorkbenchActor({
      client: { sessionDomain: "platform" } as never,
      sessionKey: `agent:main:employee:${ownerId}`,
    });
    expect(restored).toEqual({ ok: false, reason: "not_personal" });
  });

  it("does not replace a live actor with the session-key owner", async () => {
    resolveActor.mockResolvedValue({
      userId: "other-user",
      userEmail: "other@example.com",
      seatAgentIds: [],
      seatSpaceIds: [],
    });
    const client = {
      platformUserId: "other-user",
      user: "other@example.com",
      sessionDomain: "employee" as const,
    };
    const restored = await restorePersonalWorkbenchActor({
      client: client as never,
      sessionKey: `agent:main:employee:${ownerId}`,
    });
    expect(restored.ok).toBe(true);
    expect(client.platformUserId).toBe("other-user");
  });
});
