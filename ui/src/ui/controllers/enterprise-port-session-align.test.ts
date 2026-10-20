import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAlignableEnterprisePortSessionKind,
  resetEnterprisePortSessionAlignForTests,
  resolveEnterprisePortAlignTenantId,
  shouldAlignEnterprisePortSession,
} from "./enterprise-port-session-align.ts";

describe("enterprise-port-session-align", () => {
  afterEach(() => {
    resetEnterprisePortSessionAlignForTests();
    vi.unstubAllGlobals();
  });

  it("recognizes member and platform sessions as alignable", () => {
    expect(isAlignableEnterprisePortSessionKind("member")).toBe(true);
    expect(isAlignableEnterprisePortSessionKind("platform-admin")).toBe(true);
    expect(isAlignableEnterprisePortSessionKind("platform-super-admin")).toBe(true);
    expect(isAlignableEnterprisePortSessionKind("enterprise-admin")).toBe(false);
    expect(isAlignableEnterprisePortSessionKind(undefined)).toBe(false);
  });

  it("only aligns on the enterprise port host", () => {
    const host = {
      platformAuthState: { enabled: true, hasUsers: true, sessionKind: "member" as const },
    };
    expect(shouldAlignEnterprisePortSession(host, "biz.openbot.love")).toBe(true);
    expect(shouldAlignEnterprisePortSession(host, "www.openbot.love")).toBe(false);
    expect(shouldAlignEnterprisePortSession(host, "admin.openbot.love")).toBe(false);
    expect(
      shouldAlignEnterprisePortSession(
        { platformAuthState: { enabled: true, hasUsers: true, sessionKind: "enterprise-admin" } },
        "biz.openbot.love",
      ),
    ).toBe(false);
  });

  it("resolves tenant id from session / enterprise / recent list", () => {
    expect(
      resolveEnterprisePortAlignTenantId({
        basePath: "",
        platformAuthState: {
          enabled: true,
          hasUsers: true,
          enterprise: {
            id: "001",
            name: "upbeyond",
            status: "trial",
            plan: "trial",
            billingStatus: "trialing",
            createdSource: "self-service",
            seatQuota: 1,
            seatUsed: 0,
            seatsRemaining: 1,
          },
        },
        connect: () => undefined,
        platformAuthBusy: false,
        platformAuthError: null,
        platformAuthMode: "login",
        platformAuthEmail: "",
        platformAuthPassword: "",
        platformAuthDisplayName: "",
        platformAuthPlatformAdminDisplayName: "",
        platformAuthTenantName: "",
        platformAuthSeatTitle: "",
        platformAuthExpectedUsers: "",
        platformAuthUseCase: "",
        platformAuthCompanySize: "",
        platformAuthNeedsDemo: "",
        platformAuthIndustry: "",
        platformAuthTrialStep: 1,
        platformAuthInviteCode: "",
        platformAuthCurrentPassword: "",
        platformAuthNewPassword: "",
        platformAuthPolicyTrialDays: "",
        platformAuthPolicySeatCount: "",
        platformAuthPolicyUpgradeUrl: "",
        platformAuthPolicyContactAdvisorUrl: "",
        platformAuthInstanceEnterpriseId: "",
        platformAuthInstanceTrialDays: "",
        platformAuthInstanceSeatCount: "",
        platformAuthInstanceUpgradeUrl: "",
        platformAuthInstanceContactAdvisorUrl: "",
        platformAuthPlatformAdminEmail: "",
        platformAuthPlatformAdminPassword: "",
        platformAuthPlatformAdminScopes: [],
        lastError: null,
        lastErrorCode: null,
        assistantName: "",
        assistantAvatar: null,
        assistantAgentId: null,
        serverVersion: null,
        bootstrapAuthMode: null,
        bootstrapAuthSession: null,
      }),
    ).toBe("001");
  });
});
