import { describe, expect, it } from "vitest";
import { resolveEmbeddedSandboxAccount } from "../agents/sandbox/account-scope.js";
import {
  buildCronSandboxRunIdentityInject,
  CRON_ACCOUNT_MISSING_PREFIX,
  hasCronOwnershipAccountFields,
  isCronAccountMissingError,
  normalizeCronOwnerUserId,
  preflightCronManagedSandboxAccount,
  resolveCronSandboxAccountBinding,
} from "./sandbox-account-preflight.js";

describe("normalizeCronOwnerUserId", () => {
  it("strips platform-user prefix", () => {
    expect(normalizeCronOwnerUserId("platform-user:abc-123")).toBe("abc-123");
  });
});

describe("resolveCronSandboxAccountBinding", () => {
  it("returns binding when tenant and owner present", () => {
    expect(
      resolveCronSandboxAccountBinding({
        tenantId: "tenant-a",
        ownerId: "user-1",
      }),
    ).toEqual({ tenantId: "tenant-a", userId: "user-1" });
  });

  it("rejects incomplete ownership", () => {
    expect(resolveCronSandboxAccountBinding({ tenantId: "t" })).toBeNull();
    expect(resolveCronSandboxAccountBinding({ ownerId: "u" })).toBeNull();
  });

  it("rejects email-shaped ownerId (sandbox keys are platform ids)", () => {
    expect(
      resolveCronSandboxAccountBinding({
        tenantId: "tenant-a",
        ownerId: "owner@acme.test",
      }),
    ).toBeNull();
  });
});

describe("hasCronOwnershipAccountFields", () => {
  it("accepts email owner when tenant present (deferred uuid resolve)", () => {
    expect(
      hasCronOwnershipAccountFields({
        tenantId: "tenant-a",
        ownerId: "owner@acme.test",
      }),
    ).toBe(true);
  });

  it("rejects missing tenant even with email owner", () => {
    expect(hasCronOwnershipAccountFields({ ownerId: "owner@acme.test" })).toBe(false);
  });
});

describe("preflightCronManagedSandboxAccount", () => {
  it("fail-closes when managed addressing on and ownership missing", () => {
    const result = preflightCronManagedSandboxAccount({
      cfg: { data: { mode: "managed" } } as never,
      ownership: undefined,
      env: { OPENBOT_MULTITENANT: "1" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.startsWith(CRON_ACCOUNT_MISSING_PREFIX)).toBe(true);
    }
  });

  it("injects enterpriseId when ownership present under managed addressing", () => {
    const result = preflightCronManagedSandboxAccount({
      cfg: { data: { mode: "managed" } } as never,
      ownership: { tenantId: "ent-1", ownerId: "platform-user:uid-9" },
      env: { OPENBOT_MULTITENANT: "1" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gatewayClientSessionEnterpriseId).toBe("ent-1");
      expect(result.gatewayClientPlatformUserId).toBe("uid-9");
    }
  });

  it("allows missing ownership when shared addressing off", () => {
    const result = preflightCronManagedSandboxAccount({
      cfg: {} as never,
      ownership: undefined,
      env: {},
    });
    expect(result.ok).toBe(true);
  });

  it("injects enterprise only when ownerId is email (platform uuid deferred)", () => {
    const result = preflightCronManagedSandboxAccount({
      cfg: { data: { mode: "managed" } } as never,
      ownership: { tenantId: "ent-1", ownerId: "owner@acme.test" },
      env: { OPENBOT_MULTITENANT: "1" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gatewayClientSessionEnterpriseId).toBe("ent-1");
      expect(result.gatewayClientPlatformUserId).toBeUndefined();
      expect(result.binding).toBeNull();
    }
  });
});

describe("isCronAccountMissingError", () => {
  it("matches prefix", () => {
    expect(isCronAccountMissingError(`${CRON_ACCOUNT_MISSING_PREFIX} x`)).toBe(true);
    expect(isCronAccountMissingError("other")).toBe(false);
  });

  it("matches raw managed sandbox server-derived account error", () => {
    expect(
      isCronAccountMissingError(
        "Managed multitenant sandbox requires a server-derived account (tenantId and userId).",
      ),
    ).toBe(true);
  });
});

describe("buildCronSandboxRunIdentityInject", () => {
  it("freezes executionIdentity with ownership tenant + platform user for nested hops", () => {
    const preflight = preflightCronManagedSandboxAccount({
      cfg: { data: { mode: "managed" } } as never,
      ownership: { tenantId: "001", ownerId: "90fed19a-owner" },
      env: { OPENBOT_MULTITENANT: "1" },
    });
    expect(preflight.ok).toBe(true);
    if (!preflight.ok) {
      return;
    }
    const inject = buildCronSandboxRunIdentityInject({
      preflight,
      knowledge: {
        user: "owner@acme.test",
        platformUserId: "90fed19a-owner",
        sessionDomain: "employee",
      },
      agentId: "bot-2",
      sessionKey: "cron:adeb5b54",
    });
    expect(inject.executionIdentity?.enterpriseId).toBe("001");
    expect(inject.executionIdentity?.platformUserId).toBe("90fed19a-owner");
    expect(inject.executionIdentity?.user).toBe("owner@acme.test");
    expect(inject.gatewayClientSessionEnterpriseId).toBe("001");
    expect(inject.gatewayClientPlatformUserId).toBe("90fed19a-owner");
    // Nested sandbox create must resolve account from frozen identity alone.
    expect(
      resolveEmbeddedSandboxAccount({
        agentId: "bot-2",
        executionIdentity: inject.executionIdentity,
      }),
    ).toEqual({
      tenantId: "001",
      userId: "90fed19a-owner",
      agentId: "bot-2",
    });
  });

  it("prefers ownership platform user over knowledge when both present", () => {
    const preflight = preflightCronManagedSandboxAccount({
      cfg: { data: { mode: "managed" } } as never,
      ownership: { tenantId: "ent-1", ownerId: "owner-uuid" },
      env: { OPENBOT_MULTITENANT: "1" },
    });
    expect(preflight.ok).toBe(true);
    if (!preflight.ok) {
      return;
    }
    const inject = buildCronSandboxRunIdentityInject({
      preflight,
      knowledge: { user: "a@b.c", platformUserId: "other-uuid" },
    });
    expect(inject.gatewayClientPlatformUserId).toBe("owner-uuid");
    expect(inject.executionIdentity?.platformUserId).toBe("owner-uuid");
  });
});
