/**
 * Phase D3 T6 — employee steward session key wrapper preserves agent bot keys.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveEmployeeWorkbenchActorMock = vi.hoisted(() => vi.fn());
const loadStoreMock = vi.hoisted(() => vi.fn());

vi.mock("../employee-workbench-scope.js", () => ({
  resolveEmployeeWorkbenchActor: resolveEmployeeWorkbenchActorMock,
  requiresEmployeeAssetScope: (
    client: { user?: string; sessionDomain?: string } | null | undefined,
  ) => Boolean(client?.user && client.sessionDomain !== "platform"),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({}),
}));

vi.mock("../platform-auth/config.js", () => ({
  resolvePlatformAuthConfig: () => ({ kind: "trusted-proxy" }),
}));

vi.mock("../platform-auth/store.js", () => ({
  loadStore: loadStoreMock,
}));

const { applyResolvedEmployeeStewardHelloDefaults, resolveEmployeeScopedChatSessionKey } =
  await import("../employee-steward-session.js");
const { EMPLOYEE_GLOBAL_STEWARD_HISTORY_DENIED } =
  await import("../../agents/builtin-steward/employee-isolation.js");

describe("resolveEmployeeScopedChatSessionKey (D3 T6)", () => {
  beforeEach(() => {
    resolveEmployeeWorkbenchActorMock.mockReset();
    loadStoreMock.mockReset();
    loadStoreMock.mockResolvedValue({
      users: {
        "user-elle": {
          id: "user-elle",
          email: "elle@acme.com",
          normalizedEmail: "elle@acme.com",
        },
      },
    });
  });

  it("returns raw key when no employee workbench actor", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue(null);
    await expect(
      resolveEmployeeScopedChatSessionKey(
        { connect: {} as never, user: "x@y.com" },
        "agent:bot-2:main",
      ),
    ).resolves.toBe("agent:bot-2:main");
  });

  it("preserves collaboration space keys for an employee actor", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({ userId: "user-elle" });
    await expect(
      resolveEmployeeScopedChatSessionKey(
        { connect: {} as never, user: "elle@acme.com" },
        "agent:main:space:grp-1",
      ),
    ).resolves.toBe("space:grp-1");
  });

  it("preserves non-steward agent bot session keys for an employee actor", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({ userId: "user-elle" });
    await expect(
      resolveEmployeeScopedChatSessionKey(
        { connect: {} as never, user: "elle@acme.com" },
        "agent:bot-2:main",
      ),
    ).resolves.toBe("agent:bot-2:main");
  });

  it("maps main alias to per-user steward session for an employee actor", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({ userId: "user-elle" });
    await expect(
      resolveEmployeeScopedChatSessionKey({ connect: {} as never, user: "elle@acme.com" }, "main"),
    ).resolves.toBe("agent:main:employee:user-elle");
  });

  it("maps main alias using platform user before actor resolution is ready", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue(null);
    await expect(
      resolveEmployeeScopedChatSessionKey(
        {
          connect: {} as never,
          user: "user-elle",
          sessionDomain: "employee",
        },
        "main",
      ),
    ).resolves.toBe("agent:main:employee:user-elle");
  });

  it("maps main alias from login email to platform user id before actor is ready", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue(null);
    await expect(
      resolveEmployeeScopedChatSessionKey(
        {
          connect: {} as never,
          user: "elle@acme.com",
          sessionDomain: "employee",
        },
        "main",
      ),
    ).resolves.toBe("agent:main:employee:user-elle");
  });

  it("maps global steward aliases to the employee key for an employee actor", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({ userId: "user-elle" });
    const client = {
      connect: {} as never,
      user: "elle@acme.com",
      sessionDomain: "employee" as const,
    };
    await expect(resolveEmployeeScopedChatSessionKey(client, "agent:main:main")).resolves.toBe(
      "agent:main:employee:user-elle",
    );
    await expect(resolveEmployeeScopedChatSessionKey(client, "agent:main")).resolves.toBe(
      "agent:main:employee:user-elle",
    );
    await expect(resolveEmployeeScopedChatSessionKey(client, "global")).resolves.toBe(
      "agent:main:employee:user-elle",
    );
  });

  it("maps global aliases from a device-owner platform user id when email and domain are absent", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue(null);
    const client = {
      connect: {} as never,
      platformUserId: "e8666db5-f43d-4d98-883e-536a6808a8c0",
    };
    await expect(resolveEmployeeScopedChatSessionKey(client, "agent:main:main")).resolves.toBe(
      "agent:main:employee:e8666db5-f43d-4d98-883e-536a6808a8c0",
    );
    await expect(resolveEmployeeScopedChatSessionKey(client, "main")).resolves.toBe(
      "agent:main:employee:e8666db5-f43d-4d98-883e-536a6808a8c0",
    );
  });

  it("does not return the global steward key when an employee session cannot be remapped", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue(null);
    await expect(
      resolveEmployeeScopedChatSessionKey(
        { connect: {} as never, sessionDomain: "employee" },
        "agent:main:main",
      ),
    ).resolves.toBe(EMPLOYEE_GLOBAL_STEWARD_HISTORY_DENIED);
    await expect(
      resolveEmployeeScopedChatSessionKey(
        { connect: {} as never, sessionDomain: "enterprise" },
        "main",
      ),
    ).resolves.toBe(EMPLOYEE_GLOBAL_STEWARD_HISTORY_DENIED);
  });

  it("keeps the global steward key for an explicit platform control-plane session", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue(null);
    await expect(
      resolveEmployeeScopedChatSessionKey(
        {
          connect: {} as never,
          user: "ops@acme.com",
          platformUserId: "user-ops",
          sessionDomain: "platform",
        },
        "agent:main:main",
      ),
    ).resolves.toBe("agent:main:main");
  });
});

describe("applyResolvedEmployeeStewardHelloDefaults", () => {
  function globalDefaults() {
    return {
      defaultAgentId: "main",
      mainKey: "main",
      mainSessionKey: "agent:main:main",
      scope: "per-sender",
    };
  }

  it("pins device-owner and cookie-owner hello defaults to the employee steward key", () => {
    const deviceOwner = globalDefaults();
    expect(
      applyResolvedEmployeeStewardHelloDefaults({
        sessionDefaults: deviceOwner,
        platformUserId: "e8666db5-f43d-4d98-883e-536a6808a8c0",
      }),
    ).toBe(true);
    expect(deviceOwner.mainSessionKey).toBe(
      "agent:main:employee:e8666db5-f43d-4d98-883e-536a6808a8c0",
    );
    expect(deviceOwner.mainSessionKey).not.toBe("agent:main:main");

    const cookieOwner = globalDefaults();
    expect(
      applyResolvedEmployeeStewardHelloDefaults({
        sessionDefaults: cookieOwner,
        platformUserId: "user-elle",
        sessionDomain: undefined,
      }),
    ).toBe(true);
    expect(cookieOwner.mainSessionKey).toBe("agent:main:employee:user-elle");
  });

  it("pins email-resolved employee hello defaults and leaves platform control plane on the global key", () => {
    const employee = globalDefaults();
    expect(
      applyResolvedEmployeeStewardHelloDefaults({
        sessionDefaults: employee,
        platformUserId: "user-elle",
        sessionDomain: "employee",
      }),
    ).toBe(true);
    expect(employee.mainSessionKey).toBe("agent:main:employee:user-elle");

    const platform = globalDefaults();
    expect(
      applyResolvedEmployeeStewardHelloDefaults({
        sessionDefaults: platform,
        platformUserId: "user-ops",
        sessionDomain: "platform",
      }),
    ).toBe(false);
    expect(platform.mainSessionKey).toBe("agent:main:main");

    const anonymous = globalDefaults();
    expect(
      applyResolvedEmployeeStewardHelloDefaults({
        sessionDefaults: anonymous,
      }),
    ).toBe(false);
    expect(anonymous.mainSessionKey).toBe("agent:main:main");
  });
});
