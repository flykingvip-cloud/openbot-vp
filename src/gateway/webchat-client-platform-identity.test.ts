import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayClient } from "./server-methods/types.js";

const readSessionMock = vi.fn();

vi.mock("./platform-auth.js", () => ({
  readPlatformAuthSessionFromRequest: (...args: unknown[]) => readSessionMock(...args),
}));

vi.mock("./platform-auth/active-membership-client-context.js", () => ({
  resolveClientSessionIdentity: (session: {
    user?: string;
    domain?: string;
    tenantId?: string;
  }) => ({
    ...(session.user ? { user: session.user } : {}),
    ...(session.domain ? { sessionDomain: session.domain } : {}),
    ...(session.tenantId ? { sessionTenantId: session.tenantId } : {}),
  }),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: () => ({ gateway: { auth: { trustedProxy: { enabled: true } } } }),
}));

vi.mock("./platform-auth/config.js", () => ({
  resolvePlatformAuthConfig: () => ({ enabled: true }),
}));

vi.mock("./platform-auth/store.js", () => ({
  loadStore: async () => ({
    users: {
      "user-90": {
        id: "user-90",
        email: "owner@example.com",
        normalizedEmail: "owner@example.com",
        status: "active",
      },
      "user-91": {
        id: "user-91",
        email: "other@example.com",
        normalizedEmail: "other@example.com",
        status: "active",
      },
      "user-ceo": {
        id: "user-ceo",
        email: "ceo@example.com",
        normalizedEmail: "ceo@example.com",
        status: "active",
        platformRole: "super-admin",
      },
      "user-multi": {
        id: "user-multi",
        email: "multi@example.com",
        normalizedEmail: "multi@example.com",
        status: "active",
      },
    },
    enterprises: {
      "ent-1": {
        id: "ent-1",
        name: "Acme",
        status: "paid",
      },
      "ent-2": {
        id: "ent-2",
        name: "Other",
        status: "paid",
      },
    },
    memberships: {
      "mem-1": {
        id: "mem-1",
        userId: "user-ceo",
        enterpriseId: "ent-1",
        membershipRole: "enterprise-admin",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      "mem-multi-b": {
        id: "mem-multi-b",
        userId: "user-multi",
        enterpriseId: "ent-2",
        membershipRole: "member",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      "mem-multi-a": {
        id: "mem-multi-a",
        userId: "user-multi",
        enterpriseId: "ent-1",
        membershipRole: "enterprise-admin",
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    },
    sessions: {},
  }),
}));

const getPairedDeviceMock = vi.fn();
vi.mock("../infra/device-pairing.js", () => ({
  getPairedDevice: (...args: unknown[]) => getPairedDeviceMock(...args),
}));

vi.mock("./tenant-context.js", () => ({
  resolveAuthoritativeMembership: async (client: { user?: string; platformUserId?: string }) => {
    if (client?.user === "ceo@example.com" || client?.platformUserId === "user-ceo") {
      return { tenantId: "ent-1", userId: "user-ceo" };
    }
    return { tenantId: null, userId: null };
  },
}));

const {
  ensureGatewayClientUserFromPlatformIdentity,
  ensureGatewayClientEnterpriseTenant,
  extractUpgradeRequestCookieHeader,
  hydrateWebchatGatewayClientPlatformIdentity,
  preferPlatformSessionWithUser,
} = await import("./webchat-client-platform-identity.js");

describe("webchat-client-platform-identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers the session that already carries a user", () => {
    expect(
      preferPlatformSessionWithUser({
        primary: { user: "a@example.com" },
        fallback: { user: "b@example.com" },
      }),
    ).toEqual({ user: "a@example.com" });
    expect(
      preferPlatformSessionWithUser({
        primary: { user: "   " },
        fallback: { user: "b@example.com" },
      }),
    ).toEqual({ user: "b@example.com" });
  });

  it("extracts cookie header from upgrade request", () => {
    expect(
      extractUpgradeRequestCookieHeader({
        headers: { cookie: "openbot_session=abc.def; other=1" },
      }),
    ).toBe("openbot_session=abc.def; other=1");
  });

  it("hydrates missing client.user from stashed upgrade cookie for webchat", async () => {
    readSessionMock.mockResolvedValue({
      user: "hrqb@163.com",
      domain: "employee",
      tenantId: "acme",
      displayName: "王军",
    });
    const client: GatewayClient = {
      connect: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openbot-control-ui",
          version: "control-ui",
          platform: "web",
          mode: "webchat",
        },
        role: "operator",
        scopes: [],
      } as GatewayClient["connect"],
      upgradeRequestCookie: "openbot_session=sid.sig",
      upgradeRequestLocalDirect: true,
    };
    await hydrateWebchatGatewayClientPlatformIdentity({ client });
    expect(client.user).toBe("hrqb@163.com");
    expect(client.sessionDomain).toBe("employee");
    expect(readSessionMock).toHaveBeenCalledOnce();
  });

  it("skips hydration when client already has user + domain + platformUserId", async () => {
    const client: GatewayClient = {
      connect: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openbot-control-ui",
          version: "control-ui",
          platform: "web",
          mode: "webchat",
        },
        role: "operator",
        scopes: [],
      } as GatewayClient["connect"],
      user: "already@example.com",
      sessionDomain: "employee",
      platformUserId: "user-already",
      sessionMembershipId: "mem-already",
      sessionEnterpriseId: "ent-already",
      upgradeRequestCookie: "openbot_session=sid.sig",
    };
    await hydrateWebchatGatewayClientPlatformIdentity({ client });
    expect(readSessionMock).not.toHaveBeenCalled();
    expect(client.user).toBe("already@example.com");
  });

  it("re-projects an already-bound platform session to employee on www", async () => {
    const client: GatewayClient = {
      connect: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openbot-control-ui",
          version: "control-ui",
          platform: "web",
          mode: "webchat",
        },
        role: "operator",
        scopes: [],
      } as GatewayClient["connect"],
      user: "ceo@example.com",
      sessionDomain: "platform",
      sessionKind: "platform-super-admin",
      platformUserId: "user-ceo",
      upgradeRequestCookie: "openbot_session=sid.sig",
      upgradeRequestOrigin: "https://www.openbot.love",
    };
    await hydrateWebchatGatewayClientPlatformIdentity({ client });
    expect(readSessionMock).not.toHaveBeenCalled();
    expect(client.sessionDomain).toBe("employee");
    expect(client.sessionKind).toBe("member");
    expect(client.sessionMembershipId).toBe("mem-1");
    expect(client.sessionEnterpriseId).toBe("ent-1");
    expect(client.sessionTenantId).toBe("ent-1");
  });

  it("projects a cookie-hydrated platform session to employee when the socket opened on www", async () => {
    readSessionMock.mockResolvedValue({
      user: "ceo@example.com",
      domain: "platform",
      sessionKind: "platform-super-admin",
    });
    const client: GatewayClient = {
      connect: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openbot-control-ui",
          version: "control-ui",
          platform: "web",
          mode: "webchat",
        },
        role: "operator",
        scopes: [],
      } as GatewayClient["connect"],
      upgradeRequestCookie: "openbot_session=sid.sig",
      upgradeRequestOrigin: "https://www.openbot.love",
    };
    await hydrateWebchatGatewayClientPlatformIdentity({ client });
    expect(client.user).toBe("ceo@example.com");
    expect(client.sessionDomain).toBe("employee");
    expect(client.sessionKind).toBe("member");
    expect(client.sessionEnterpriseId).toBe("ent-1");
  });

  it("re-projects a platform session when the public host is www and Origin is absent", async () => {
    const client: GatewayClient = {
      connect: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openbot-control-ui",
          version: "control-ui",
          platform: "web",
          mode: "webchat",
        },
        role: "operator",
        scopes: [],
      } as GatewayClient["connect"],
      user: "ceo@example.com",
      sessionDomain: "platform",
      sessionKind: "platform-super-admin",
      platformUserId: "user-ceo",
      upgradeRequestHost: "www.openbot.love",
    };
    await hydrateWebchatGatewayClientPlatformIdentity({ client });
    expect(client.user).toBe("ceo@example.com");
    expect(client.sessionDomain).toBe("employee");
    expect(client.sessionKind).toBe("member");
    expect(client.sessionMembershipId).toBe("mem-1");
    expect(client.sessionEnterpriseId).toBe("ent-1");
  });

  it("pins the employee surface on www when nobody is signed in", async () => {
    const client: GatewayClient = {
      connect: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openbot-control-ui",
          version: "control-ui",
          platform: "web",
          mode: "webchat",
        },
        role: "operator",
        scopes: [],
      } as GatewayClient["connect"],
      sessionDomain: "platform",
      upgradeRequestOrigin: "https://www.openbot.love",
    };
    await hydrateWebchatGatewayClientPlatformIdentity({ client });
    expect(client.user).toBeUndefined();
    expect(client.sessionDomain).toBe("employee");
    expect(client.sessionKind).toBe("member");
  });

  it("does not remap a platform session when origin and host are missing", async () => {
    const client: GatewayClient = {
      connect: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openbot-control-ui",
          version: "control-ui",
          platform: "web",
          mode: "webchat",
        },
        role: "operator",
        scopes: [],
      } as GatewayClient["connect"],
      user: "ceo@example.com",
      sessionDomain: "platform",
      sessionKind: "platform-super-admin",
      platformUserId: "user-ceo",
      upgradeRequestCookie: "openbot_session=sid.sig",
    };
    await hydrateWebchatGatewayClientPlatformIdentity({ client });
    expect(client.sessionDomain).toBe("platform");
    expect(client.sessionKind).toBe("platform-super-admin");
    expect(client.sessionEnterpriseId).toBeUndefined();
  });

  it("rehydrates employee clients that still lack platformUserId", async () => {
    const client: GatewayClient = {
      connect: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openbot-control-ui",
          version: "control-ui",
          platform: "web",
          mode: "webchat",
        },
        role: "operator",
        scopes: [],
      } as GatewayClient["connect"],
      user: "already@example.com",
      sessionDomain: "employee",
      upgradeRequestCookie: "openbot_session=sid.sig",
    };
    await hydrateWebchatGatewayClientPlatformIdentity({ client });
    expect(readSessionMock).toHaveBeenCalledOnce();
  });

  it("fills client.user from platformUserId when the upgrade cookie is missing", async () => {
    const client: GatewayClient = {
      connect: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openbot-control-ui",
          version: "control-ui",
          platform: "web",
          mode: "webchat",
        },
        role: "operator",
        scopes: [],
      } as GatewayClient["connect"],
      platformUserId: "user-90",
    };
    await hydrateWebchatGatewayClientPlatformIdentity({ client });
    expect(readSessionMock).not.toHaveBeenCalled();
    expect(client.user).toBe("owner@example.com");
  });

  it("fills client.user from platformUserId for non-webchat workbench clients", async () => {
    const client: GatewayClient = {
      connect: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "cli",
          version: "1",
          platform: "node",
          mode: "backend",
        },
        role: "operator",
        scopes: [],
      } as GatewayClient["connect"],
      platformUserId: "user-90",
    };
    await ensureGatewayClientUserFromPlatformIdentity({ client });
    expect(client.user).toBe("owner@example.com");
  });

  it("fills platformUserId from connect.device.id when pairedDeviceId is absent", async () => {
    getPairedDeviceMock.mockResolvedValue({ ownerId: "user-90" });
    const client: GatewayClient = {
      connect: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openbot-control-ui",
          version: "control-ui",
          platform: "web",
          mode: "webchat",
        },
        role: "operator",
        scopes: [],
        device: {
          id: "device-from-connect",
          publicKey: "test-device-public-key",
          signature: "test-device-signature",
          signedAt: 1,
          nonce: "test-device-nonce",
        },
      } as GatewayClient["connect"],
    };
    await hydrateWebchatGatewayClientPlatformIdentity({ client });
    expect(getPairedDeviceMock).toHaveBeenCalledWith("device-from-connect");
    expect(client.platformUserId).toBe("user-90");
    expect(client.user).toBe("owner@example.com");
  });

  it("fills platformUserId and email from the paired device owner", async () => {
    getPairedDeviceMock.mockResolvedValue({ ownerId: "user-91" });
    const client: GatewayClient = {
      connect: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openbot-control-ui",
          version: "control-ui",
          platform: "web",
          mode: "webchat",
        },
        role: "operator",
        scopes: [],
      } as GatewayClient["connect"],
      pairedDeviceId: "device-other-user",
    };
    await hydrateWebchatGatewayClientPlatformIdentity({ client });
    expect(getPairedDeviceMock).toHaveBeenCalledWith("device-other-user");
    expect(client.platformUserId).toBe("user-91");
    expect(client.user).toBe("other@example.com");
  });

  it("does not reuse another user's mailbox when the paired owner differs", async () => {
    getPairedDeviceMock.mockResolvedValue({ ownerId: "user-90" });
    const first: GatewayClient = {
      connect: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openbot-control-ui",
          version: "control-ui",
          platform: "web",
          mode: "webchat",
        },
        role: "operator",
        scopes: [],
      } as GatewayClient["connect"],
      pairedDeviceId: "device-a",
    };
    const second: GatewayClient = {
      connect: first.connect,
      pairedDeviceId: "device-b",
    };
    getPairedDeviceMock.mockResolvedValueOnce({ ownerId: "user-90" });
    await ensureGatewayClientUserFromPlatformIdentity({ client: first });
    getPairedDeviceMock.mockResolvedValueOnce({ ownerId: "user-91" });
    await ensureGatewayClientUserFromPlatformIdentity({ client: second });
    expect(first.user).toBe("owner@example.com");
    expect(second.user).toBe("other@example.com");
    expect(first.platformUserId).not.toBe(second.platformUserId);
  });

  it("does not hydrate non-webchat clients", async () => {
    const client: GatewayClient = {
      connect: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "cli",
          version: "1",
          platform: "node",
          mode: "backend",
        },
        role: "operator",
        scopes: [],
      } as GatewayClient["connect"],
      upgradeRequestCookie: "openbot_session=sid.sig",
    };
    await hydrateWebchatGatewayClientPlatformIdentity({ client });
    expect(readSessionMock).not.toHaveBeenCalled();
    expect(client.user).toBeUndefined();
  });
  it("infers operational domain when membership resolves without sessionDomain", async () => {
    const client = {
      connect: { client: { id: "openbot-control-ui", mode: "webchat" } },
      user: "ceo@example.com",
    } as GatewayClient;
    await ensureGatewayClientEnterpriseTenant(client);
    expect(client.sessionMembershipId).toBe("mem-1");
    expect(client.sessionEnterpriseId).toBe("ent-1");
    expect(client.sessionDomain).toBe("enterprise");
  });

  it("completes a half-bound enterprise id with the membership pair", async () => {
    const client = {
      connect: { client: { id: "openbot-control-ui", mode: "webchat" } },
      user: "ceo@example.com",
      platformUserId: "user-ceo",
      sessionDomain: "employee",
      sessionEnterpriseId: "ent-1",
    } as GatewayClient;
    await ensureGatewayClientEnterpriseTenant(client);
    expect(client.sessionMembershipId).toBe("mem-1");
    expect(client.sessionEnterpriseId).toBe("ent-1");
  });

  it("does not invent a half-bound tenant when memberships span enterprises", async () => {
    const client = {
      connect: { client: { id: "openbot-control-ui", mode: "webchat" } },
      user: "multi@example.com",
    } as GatewayClient;
    await ensureGatewayClientEnterpriseTenant(client);
    expect(client.sessionMembershipId).toBeUndefined();
    expect(client.sessionEnterpriseId).toBeUndefined();
    expect(client.sessionDomain).toBeUndefined();
  });
});
