import { describe, expect, it } from "vitest";
import {
  CRON_ACCOUNT_MISSING_PREFIX,
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
});

describe("isCronAccountMissingError", () => {
  it("matches prefix", () => {
    expect(isCronAccountMissingError(`${CRON_ACCOUNT_MISSING_PREFIX} x`)).toBe(true);
    expect(isCronAccountMissingError("other")).toBe(false);
  });
});
