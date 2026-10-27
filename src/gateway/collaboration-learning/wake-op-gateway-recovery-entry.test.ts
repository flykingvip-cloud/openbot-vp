import { describe, expect, it, vi, beforeEach } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import type { GatewayClient } from "../server-methods/types.js";
import {
  isWakeOpGatewayRecoveryEnabled,
  mintTrustedGatewaySessionFromClient,
  resolvePlatformAuthFieldsFromGatewayClient,
  releaseWakeOpForRetryViaGatewaySession,
  WakeOpGatewayRecoveryFlagOffError,
  WakeOpGatewayRecoveryEntryError,
} from "./wake-op-gateway-recovery-entry.js";

const mintSpy = vi.fn();
const createExecSpy = vi.fn();
const releaseAuthSpy = vi.fn();

vi.mock("./wake-op-recovery-entry.js", async () => {
  const actual = await vi.importActual<typeof import("./wake-op-recovery-entry.js")>(
    "./wake-op-recovery-entry.js",
  );
  return {
    ...actual,
    mintWakeOpTrustedGatewaySessionFromPlatformAuth: (...args: unknown[]) => mintSpy(...args),
    createGatewaySessionRecoveryExecContext: (...args: unknown[]) => createExecSpy(...args),
    releaseWakeOpForRetryAuthorized: (...args: unknown[]) => releaseAuthSpy(...args),
  };
});

vi.mock("./shared.js", () => ({
  createWorkspaceCollaborationStores: () => ({
    fileStore: {},
    objectStorage: {},
  }),
  readGroupOperatingState: async () => null,
  resolveCollaborationGroupTenantId: () => null,
}));

vi.mock("../collaboration-dispatch/resolve-effective-policy.js", () => ({
  resolveGroupPolicyInput: () => ({}),
}));

vi.mock("../collaboration-dispatch/round-policy-snapshot.js", () => ({
  createRoundPolicySnapshot: () => ({ id: "snap" }),
  generatePolicySnapshotId: () => "snap-id",
}));

vi.mock("../collaboration-dispatch/runtime-authority.js", () => ({
  createRuntimeAuthority: () => ({ __brand: "authority" }),
}));

vi.mock("../security-profile.js", () => ({
  resolveSecurityProfile: () => ({ profile: "personal_local" }),
}));

vi.mock("./trusted-tenant.js", () => ({
  resolveAuthorityTenantForEntry: () => ({ tenantId: null, trust: "none" }),
}));

function client(partial: Partial<GatewayClient>): GatewayClient {
  return {
    connect: {
      minProtocol: 1,
      maxProtocol: 1,
      client: { id: "test", version: "1", platform: "web", mode: "webchat" },
    },
    ...partial,
  } as GatewayClient;
}

describe("wake-op gateway recovery enable flag (fail-closed)", () => {
  it("defaults off", () => {
    const cfg = { collaboration: { task: {} } } as OpenBotConfig;
    expect(isWakeOpGatewayRecoveryEnabled(cfg)).toBe(false);
    expect(isWakeOpGatewayRecoveryEnabled(cfg, "grp-a")).toBe(false);
  });

  it("global flag enables", () => {
    const cfg = {
      collaboration: { task: { wakeOpGatewayRecovery: true } },
    } as OpenBotConfig;
    expect(isWakeOpGatewayRecoveryEnabled(cfg)).toBe(true);
  });

  it("gray allowlist enables scoped group only", () => {
    const cfg = {
      collaboration: {
        task: { wakeOpGatewayRecoveryGroupAllowlist: ["001/grp-canary"] },
      },
    } as OpenBotConfig;
    expect(isWakeOpGatewayRecoveryEnabled(cfg, "grp-canary", "001")).toBe(true);
    expect(isWakeOpGatewayRecoveryEnabled(cfg, "grp-other", "001")).toBe(false);
    // bare groupId must not authorize managed tenant caller
    expect(isWakeOpGatewayRecoveryEnabled(cfg, "grp-canary", "001")).toBe(true);
  });
});

describe("resolvePlatformAuthFieldsFromGatewayClient", () => {
  it("refuses missing stamped identity (connect.user alone is not enough)", () => {
    const c = client({
      connect: {
        minProtocol: 1,
        maxProtocol: 1,
        client: { id: "test", version: "1", platform: "web", mode: "webchat" },
        user: "forged-connect-user",
      } as never,
    });
    const resolved = resolvePlatformAuthFieldsFromGatewayClient(c);
    expect(resolved.ok).toBe(false);
  });

  it("prefers platformUserId from stamped session", () => {
    const resolved = resolvePlatformAuthFieldsFromGatewayClient(
      client({
        platformUserId: "user-42",
        user: "user-42@example.com",
        sessionDomain: "employee",
        sessionKind: "member",
        sessionMembershipId: "mem-1",
      }),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      throw new Error("expected ok");
    }
    expect(resolved.fields.userId).toBe("user-42");
    expect(resolved.fields.userStatus).toBe("active");
    expect(resolved.fields.sessionKind).toBe("member");
  });
});

describe("mintTrustedGatewaySessionFromClient", () => {
  beforeEach(() => {
    mintSpy.mockReset();
  });

  it("calls production platform mint (not TEST_ONLY)", () => {
    mintSpy.mockReturnValue({
      ok: true,
      session: { authenticatedUserId: "user-42", mintSource: "platform_auth_context" },
    });
    const result = mintTrustedGatewaySessionFromClient(
      client({
        platformUserId: "user-42",
        sessionDomain: "employee",
        sessionKind: "member",
      }),
    );
    expect(result.ok).toBe(true);
    expect(mintSpy).toHaveBeenCalledTimes(1);
    expect(mintSpy.mock.calls[0][0]).toMatchObject({
      userId: "user-42",
      userStatus: "active",
      sessionKind: "member",
    });
  });
});

describe("releaseWakeOpForRetryViaGatewaySession", () => {
  beforeEach(() => {
    mintSpy.mockReset();
    createExecSpy.mockReset();
    releaseAuthSpy.mockReset();
  });

  it("fail-closed when flag off", async () => {
    const cfg = { collaboration: { task: {} } } as OpenBotConfig;
    await expect(
      releaseWakeOpForRetryViaGatewaySession({
        client: client({ platformUserId: "u1", sessionDomain: "employee", sessionKind: "member" }),
        groupId: "grp-a",
        taskId: "task-1",
        opKey: "op-1",
        verificationId: "ver-1",
        cfg,
      }),
    ).rejects.toBeInstanceOf(WakeOpGatewayRecoveryFlagOffError);
    expect(mintSpy).not.toHaveBeenCalled();
  });

  it("refuses bare actorId on production path", async () => {
    const cfg = {
      collaboration: { task: { wakeOpGatewayRecovery: true } },
    } as OpenBotConfig;
    await expect(
      releaseWakeOpForRetryViaGatewaySession({
        client: client({ platformUserId: "u1", sessionDomain: "employee", sessionKind: "member" }),
        groupId: "grp-a",
        taskId: "task-1",
        opKey: "op-1",
        verificationId: "ver-1",
        actorId: "forged-actor",
        cfg,
      }),
    ).rejects.toBeInstanceOf(WakeOpGatewayRecoveryEntryError);
    expect(mintSpy).not.toHaveBeenCalled();
  });

  it("wires mint → createGatewaySessionRecoveryExecContext → releaseAuthorized", async () => {
    const cfg = {
      collaboration: { task: { wakeOpGatewayRecovery: true } },
    } as OpenBotConfig;
    const session = {
      authenticatedUserId: "u1",
      sessionStatus: "active" as const,
      sessionKind: "member",
      sessionId: "mem-1",
      mintSource: "platform_auth_context" as const,
    };
    mintSpy.mockReturnValue({ ok: true, session });
    createExecSpy.mockResolvedValue({
      ok: true,
      exec: {
        actorId: "u1",
        groupId: "grp-a",
        taskId: "task-1",
        action: "release_for_retry",
        identityProvenance: "gateway_session",
      },
    });
    releaseAuthSpy.mockResolvedValue({ ok: true, record: { status: "failed" } });

    const result = await releaseWakeOpForRetryViaGatewaySession({
      client: client({
        platformUserId: "u1",
        sessionDomain: "employee",
        sessionKind: "member",
        sessionMembershipId: "mem-1",
      }),
      groupId: "grp-a",
      taskId: "task-1",
      opKey: "op-1",
      verificationId: "ver-1",
      cfg,
    });

    expect(mintSpy).toHaveBeenCalledTimes(1);
    expect(createExecSpy).toHaveBeenCalledTimes(1);
    expect(createExecSpy.mock.calls[0][0]).toMatchObject({
      session,
      groupId: "grp-a",
      taskId: "task-1",
      action: "release_for_retry",
    });
    expect(releaseAuthSpy).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identityProvenance).toBe("gateway_session");
    }
  });
});
