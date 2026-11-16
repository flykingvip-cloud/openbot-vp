/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTROL_UI_ENTERPRISE_BASE_PATH,
  CONTROL_UI_PLATFORM_AUTH_BASE_PATH,
} from "../../../../src/gateway/control-ui-contract.js";
import { i18n } from "../../i18n/index.ts";
import { parseEmployeeShellBridgeJSON } from "../employee-shell/native-bridge.ts";
import { EMPLOYEE_SHELL_HOST_HANDLER } from "../employee-shell/native-host.ts";
import {
  acceptPlatformSeatAssignmentOffer,
  changePlatformAuthPassword,
  createPlatformAdmin,
  createPlatformAuthInvite,
  declinePlatformSeatAssignmentOffer,
  inviteEmployeeToNewPosition,
  invitePlatformEnterpriseAdmin,
  localizePlatformAuthOperatorError,
  readEnterpriseAdminInviteCodeFromLocation,
  logoutPlatformAuth,
  provisionPlatformAuthEmployee,
  switchPlatformAuthSessionKind,
  removePlatformAdmin,
  submitPlatformAuth,
  submitPlatformTrialApply,
  sendPlatformEmployeeActivations,
  localizePlatformAuthLoginError,
  type PlatformAuthHost,
  updatePlatformTrialPolicy,
} from "./platform-auth.ts";

function sessionCookieCheckResponse(
  sessionUser = "alice@example.com",
  extras: {
    sessionKind?: string;
    tenantId?: string;
    displayName?: string;
    scopes?: string[];
  } = {},
) {
  const session: Record<string, unknown> = {
    provider: "trusted-proxy",
    user: sessionUser,
    role: "operator",
    scopes: extras.scopes ?? ["operator.admin"],
  };
  if (extras.tenantId) {
    session.tenantId = extras.tenantId;
  }
  if (extras.displayName) {
    session.displayName = extras.displayName;
  }
  return {
    ok: true,
    json: async () => ({
      enabled: true,
      session,
      sessionKind: extras.sessionKind ?? "platform-super-admin",
    }),
  };
}

function seatCreateResponse(seatId: string, title: string) {
  return {
    ok: true,
    json: async () => ({
      ok: true,
      seat: {
        seatId,
        title,
        status: "vacant",
        defaultSpaceIds: [],
        defaultAgentAssetIds: [],
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    }),
  };
}

function attachEnterprise(host: PlatformAuthHost, tenantId = "acme") {
  host.platformAuthState = {
    enabled: true,
    hasUsers: true,
    enterprise: {
      id: tenantId,
      name: "Acme",
      status: "paid",
      plan: "pro",
      billingStatus: "active",
      createdSource: "self-service",
      seatQuota: 10,
      seatUsed: 1,
      seatsRemaining: 9,
    },
  };
}

function createHost(): PlatformAuthHost {
  return {
    basePath: "/openclaw/",
    platformAuthBusy: false,
    platformAuthError: null,
    platformAuthMode: "enterprise-create",
    platformAuthEmail: "alice@example.com",
    platformAuthPassword: "password-123",
    platformAuthDisplayName: "Alice",
    platformAuthPlatformAdminDisplayName: "Ops Delegate",
    platformAuthTenantName: "Acme",
    platformAuthSeatTitle: "Sales Lead",
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
    platformAuthPlatformAdminEmail: "ops@example.com",
    platformAuthPlatformAdminPassword: "delegate-password-123",
    platformAuthPlatformAdminScopes: [],
    platformAuthLoginIntent: undefined,
    connect: vi.fn(),
    lastError: "stale",
    lastErrorCode: "AUTH_REQUIRED",
    platformAuthState: null,
    assistantName: "Assistant",
    assistantAvatar: null,
    assistantAgentId: null,
    serverVersion: null,
    bootstrapAuthMode: "trusted-proxy",
    bootstrapAuthSession: null,
  };
}

describe("platform auth controller", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates an enterprise and switches the UI into admin activation mode", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        platformAuth: {
          enabled: true,
          hasUsers: false,
          hasPlatformAdmins: true,
          availableModes: [
            "enterprise-create",
            "enterprise-activate",
            "login",
            "forgot-password",
            "password-reset",
          ],
          pendingActivation: {
            kind: "enterprise-admin-activation",
            email: "alice@example.com",
            enterpriseName: "Acme",
            code: "ACT-123456",
            expiresAt: "2026-04-20T00:00:00.000Z",
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();

    await submitPlatformAuth(host);

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/enterprise/create`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          enterpriseName: "Acme",
          adminName: "Alice",
          adminEmail: "alice@example.com",
        }),
      }),
    );
    expect(host.platformAuthMode).toBe("enterprise-activate");
    expect(host.platformAuthInviteCode).toBe("ACT-123456");
    expect(host.platformAuthState?.pendingActivation?.enterpriseName).toBe("Acme");
    expect(host.platformAuthError).toBeNull();
  });

  it("submits a homepage trial application and switches to admin activation for auto approval", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        platformAuth: {
          enabled: true,
          hasUsers: false,
          hasPlatformAdmins: true,
          availableModes: [
            "enterprise-create",
            "enterprise-activate",
            "login",
            "forgot-password",
            "password-reset",
          ],
          pendingActivation: {
            kind: "enterprise-admin-activation",
            email: "alice@acme.com",
            enterpriseName: "Acme",
            code: "ACT-TRIAL-1",
            expiresAt: "2026-04-20T00:00:00.000Z",
          },
        },
        trialApplication: {
          mode: "auto",
          message: "🎉 试用已开通，请前往邮箱激活。",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    host.platformAuthEmail = "alice@acme.com";
    host.platformAuthExpectedUsers = "20";
    host.platformAuthUseCase = "搭建团队知识库和 AI 助手";
    host.platformAuthCompanySize = "21-50";
    host.platformAuthNeedsDemo = "no";
    host.platformAuthIndustry = "software";

    const result = await submitPlatformTrialApply(host);

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/trial/apply`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          companyName: "Acme",
          contactName: "Alice",
          workEmail: "alice@acme.com",
          expectedUsers: "20",
          useCase: "搭建团队知识库和 AI 助手",
          companySize: "21-50",
          needsDemo: false,
          industry: "software",
        }),
      }),
    );
    expect(host.platformAuthMode).toBe("enterprise-activate");
    expect(host.platformAuthInviteCode).toBe("ACT-TRIAL-1");
    expect(host.platformAuthExpectedUsers).toBe("");
    expect(host.platformAuthUseCase).toBe("");
    expect(result).toEqual({ notice: "🎉 试用已开通，请前往邮箱激活。" });
  });

  it("keeps the trial form active for manual review applications", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        platformAuth: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          availableModes: [
            "enterprise-create",
            "enterprise-activate",
            "login",
            "forgot-password",
            "password-reset",
          ],
        },
        trialApplication: {
          mode: "manual",
          message: "我们的产品顾问将在 24 小时内联系你。",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    host.platformAuthEmail = "alice@gmail.com";
    host.platformAuthExpectedUsers = "101";
    host.platformAuthUseCase = "部署到全国多个业务团队";

    const result = await submitPlatformTrialApply(host);

    expect(host.platformAuthMode).toBe("enterprise-create");
    expect(host.platformAuthInviteCode).toBe("");
    expect(result).toEqual({ notice: "我们的产品顾问将在 24 小时内联系你。" });
  });

  it("activates an enterprise admin and reconnects with the new session", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        session: {
          provider: "trusted-proxy",
          user: "alice@example.com",
          displayName: "Alice",
          tenantId: "acme-1234",
          role: "operator",
          scopes: ["operator.admin"],
        },
        platformAuth: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          availableModes: ["platform-enterprise-create"],
          sessionKind: "enterprise-admin",
          tenantName: "Acme",
          membershipRole: "enterprise-admin",
          enterprise: {
            id: "acme-1234",
            name: "Acme",
            status: "trial",
            plan: "trial",
            billingStatus: "trialing",
            createdSource: "self-service",
            seatQuota: 5,
            seatUsed: 1,
            seatsRemaining: 4,
          },
        },
      }),
    });
    fetchMock.mockResolvedValueOnce(
      sessionCookieCheckResponse("alice@example.com", {
        sessionKind: "enterprise-admin",
        tenantId: "acme-1234",
        displayName: "Alice",
      }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    host.platformAuthMode = "enterprise-activate";
    host.platformAuthInviteCode = "ACT-123456";

    await submitPlatformAuth(host);

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/enterprise/admin/activate`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          email: "alice@example.com",
          password: "password-123",
          displayName: "Alice",
          code: "ACT-123456",
        }),
      }),
    );
    expect(host.bootstrapAuthSession).toMatchObject({
      user: "alice@example.com",
      tenantId: "acme-1234",
    });
    expect(host.connect).toHaveBeenCalledTimes(1);
    expect(host.platformAuthPassword).toBe("");
    expect(host.platformAuthInviteCode).toBe("");
    expect(host.platformAuthError).toBeNull();
  });

  it("requests an enterprise admin session for the dedicated enterprise login", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        session: {
          provider: "trusted-proxy",
          user: "alice@example.com",
          displayName: "Alice",
          tenantId: "acme-1234",
          role: "operator",
          scopes: ["operator.admin"],
        },
        platformAuth: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          sessionKind: "enterprise-admin",
          membershipRole: "enterprise-admin",
          platformRole: "super-admin",
        },
      }),
    });
    fetchMock.mockResolvedValueOnce(
      sessionCookieCheckResponse("alice@example.com", {
        sessionKind: "enterprise-admin",
        tenantId: "acme-1234",
        displayName: "Alice",
      }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    host.platformAuthMode = "login";
    host.platformAuthLoginIntent = "enterprise-admin";

    await submitPlatformAuth(host);

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/login`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          email: "alice@example.com",
          password: "password-123",
          sessionDomain: "enterprise",
          expectedSessionKind: "enterprise-admin",
        }),
      }),
    );
    expect(host.platformAuthState?.sessionKind).toBe("enterprise-admin");
    expect(host.connect).toHaveBeenCalledTimes(1);
    expect(host.platformAuthPassword).toBe("");
    expect(host.platformAuthError).toBeNull();
  });

  it("returns the originating login path after password reset and does not sign in", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        passwordReset: {
          sessionIssued: false,
          returnSurface: "enterprise",
          loginPath: "/enterprise/login",
        },
        platformAuth: {
          enabled: true,
          hasUsers: true,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    host.platformAuthMode = "password-reset";
    host.platformAuthInviteCode = "RESET-1";

    const result = await submitPlatformAuth(host);

    expect(result?.passwordReset).toEqual({
      sessionIssued: false,
      returnSurface: "enterprise",
      loginPath: "/enterprise/login",
    });
    expect(result?.notice).toContain("原来的登录入口");
    expect(host.platformAuthMode).toBe("login");
    expect(host.bootstrapAuthSession).toBeNull();
    expect(host.connect).not.toHaveBeenCalled();
    expect(host.platformAuthPassword).toBe("");
  });

  it("surfaces a Chinese hint when employee login rejects an enterprise-admin-only account", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        ok: false,
        code: "PLATFORM_AUTH_MEMBERSHIP_SELECTION_REQUIRED",
        error: "No eligible enterprise membership for this login.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    host.platformAuthMode = "login";

    await submitPlatformAuth(host);

    expect(host.platformAuthError).toContain("多家企业");
    expect(host.platformAuthError).not.toContain("身份不匹配");
    expect(host.connect).not.toHaveBeenCalled();
  });

  it("localizes login membership errors", () => {
    expect(
      localizePlatformAuthLoginError(
        "PLATFORM_AUTH_MEMBERSHIP_SELECTION_REQUIRED",
        "No eligible enterprise membership for this login.",
        "/openclaw",
      ),
    ).toContain("多家企业");
  });

  it("localizes enterprise-admin role mismatch to employee-entry guidance", () => {
    expect(
      localizePlatformAuthLoginError(
        "PLATFORM_AUTH_ROLE_MISMATCH",
        "This account is not an enterprise administrator.",
      ),
    ).toContain("没有企业管理员资格");
  });

  it("tells zh-CN users on the enterprise host to open the employee site", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        ok: false,
        code: "PLATFORM_AUTH_SURFACE_MISMATCH",
        error: "This login entry does not match the requested surface.",
        requestSurface: "enterprise",
        targetSurface: "employee",
        loginPath: "/",
        loginUrl: "https://www.openbot.love/",
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    await i18n.setLocale("zh-CN");
    const host = createHost();
    host.platformAuthMode = "login";
    host.platformAuthMfaStage = "code";

    await submitPlatformAuth(host);

    expect(host.platformAuthError).toBe(
      "你正在企业登录入口，不能在这里完成员工登录。请改用员工登录页：https://www.openbot.love/",
    );
    expect(host.platformAuthError).not.toContain("requested surface");
    expect(host.platformAuthMfaStage).toBe("none");
    expect(host.platformAuthNotice).toBeNull();
    expect(host.connect).not.toHaveBeenCalled();
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      sessionDomain?: string;
    };
    expect(body.sessionDomain).toBe("employee");
  });

  it("does not open an MFA stage when enterprise or employee login is asked for a code", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        ok: false,
        code: "PLATFORM_AUTH_MFA_REQUIRED",
        error: "Multi-factor authentication is required.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const enterprise = createHost();
    enterprise.platformAuthMode = "login";
    enterprise.platformAuthLoginIntent = "enterprise-admin";
    enterprise.platformAuthMfaStage = "code";
    await submitPlatformAuth(enterprise);
    expect(enterprise.platformAuthMfaStage).toBe("none");
    expect(enterprise.platformAuthError).toContain("不需要验证器");
    expect(enterprise.platformAuthNotice).toBeNull();
    expect(enterprise.connect).not.toHaveBeenCalled();
    const enterpriseBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      sessionDomain?: string;
      expectedSessionKind?: string;
      mfaCode?: string;
    };
    expect(enterpriseBody.sessionDomain).toBe("enterprise");
    expect(enterpriseBody.expectedSessionKind).toBe("enterprise-admin");
    expect(enterpriseBody.mfaCode).toBeUndefined();

    const employee = createHost();
    employee.platformAuthMode = "login";
    await submitPlatformAuth(employee);
    expect(employee.platformAuthMfaStage).toBe("none");
    expect(employee.platformAuthError).toContain("不需要验证器");
    const employeeBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      sessionDomain?: string;
      mfaCode?: string;
    };
    expect(employeeBody.sessionDomain).toBe("employee");
    expect(employeeBody.mfaCode).toBeUndefined();
  });

  it("still opens the MFA stage for platform login when a code is required", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({
        ok: false,
        code: "PLATFORM_AUTH_MFA_REQUIRED",
        error: "Multi-factor authentication is required.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    host.platformAuthMode = "platform-admin-login";

    await submitPlatformAuth(host);

    expect(host.platformAuthError).toBeNull();
    expect(host.platformAuthMfaStage).toBe("code");
    expect(host.platformAuthNotice).toContain("两步验证");
    expect(host.connect).not.toHaveBeenCalled();
  });

  it("keeps a missing enterprise-admin role as an access error instead of an MFA challenge", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        ok: false,
        code: "PLATFORM_AUTH_SURFACE_INELIGIBLE",
        error: "This account cannot sign in on the enterprise surface.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    host.platformAuthMode = "login";
    host.platformAuthLoginIntent = "enterprise-admin";
    host.platformAuthNotice = "stale notice";

    await submitPlatformAuth(host);

    expect(host.platformAuthError).toContain("不能从当前入口登录");
    expect(host.platformAuthMfaStage).toBe("none");
    expect(host.platformAuthNotice).toBeNull();
    expect(host.connect).not.toHaveBeenCalled();
  });

  function stubPageLocation(
    assign: ReturnType<typeof vi.fn>,
    location: {
      host?: string;
      hostname?: string;
      pathname?: string;
      href?: string;
    } = {},
  ): () => void {
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        host: location.host ?? "localhost:3000",
        hostname: location.hostname ?? "localhost",
        pathname: location.pathname ?? "/",
        href: location.href ?? "http://localhost:3000/",
        assign,
      },
    });
    return () => {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    };
  }

  it("sends the current page path when confirming the session cookie landed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          session: {
            provider: "trusted-proxy",
            user: "alice@example.com",
            role: "operator",
            scopes: ["operator.admin"],
          },
          platformAuth: {
            enabled: true,
            sessionKind: "enterprise-admin",
          },
        }),
      })
      .mockResolvedValueOnce(
        sessionCookieCheckResponse("alice@example.com", {
          sessionKind: "enterprise-admin",
        }),
      );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const assign = vi.fn();
    const restore = stubPageLocation(assign, {
      host: "127.0.0.1:18789",
      hostname: "127.0.0.1",
      pathname: "/enterprise/001/overview",
      href: "http://127.0.0.1:18789/enterprise/001/overview",
    });
    const host = createHost();
    host.platformAuthMode = "login";
    host.platformAuthLoginIntent = "enterprise-admin";

    await submitPlatformAuth(host);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/session");
    expect(String(fetchMock.mock.calls[1]?.[0])).not.toContain("/session/switch");
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        referrerPolicy: "same-origin",
        headers: expect.objectContaining({
          "x-openbot-page-path": "/enterprise/001/overview",
        }),
      }),
    );
    expect(host.connect).toHaveBeenCalledTimes(1);
    restore();
  });

  it("does not confirm a platform switch by reading /session on the employee page", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        platformAuth: { sessionKind: "platform-super-admin" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const assign = vi.fn();
    const restore = stubPageLocation(assign);
    const host = createHost();

    const switched = await switchPlatformAuthSessionKind(host, {
      targetSessionKind: "platform-super-admin",
    });

    expect(switched).toBe(true);
    expect(assign).toHaveBeenCalledWith("/platform/login");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/session/switch");
    expect(host.connect).not.toHaveBeenCalled();
    restore();
  });

  it("returns to the platform login when elevation is refused", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        ok: false,
        code: "PLATFORM_AUTH_PLATFORM_ENTRY_REQUIRED",
        error: "Platform access requires the platform login and authenticator verification.",
        loginPath: "/platform/login",
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const assign = vi.fn();
    const restore = stubPageLocation(assign);
    const host = createHost();

    const switched = await switchPlatformAuthSessionKind(host, {
      targetSessionKind: "platform-super-admin",
    });

    expect(switched).toBe(false);
    expect(host.platformAuthError).toContain("平台登录页");
    expect(assign).toHaveBeenCalledWith("/platform/login");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(host.connect).not.toHaveBeenCalled();
    restore();
  });

  it("keeps MFA invalid errors in Chinese even when the gateway returns English", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({
        ok: false,
        code: "PLATFORM_AUTH_MFA_INVALID",
        error: "The verification code is incorrect or expired.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    host.platformAuthMode = "platform-admin-login";
    host.platformAuthMfaStage = "code";

    await submitPlatformAuth(host);

    expect(host.platformAuthError).toBe("验证码不正确或已过期。");
    expect(host.platformAuthMfaStage).toBe("code");
    expect(host.connect).not.toHaveBeenCalled();
  });

  it("issues an employee activation against a concrete seat", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(seatCreateResponse("seat-sales", "Sales Lead"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          session: {
            provider: "trusted-proxy",
            user: "owner@example.com",
            displayName: "Owner",
            tenantId: "acme-1234",
            role: "operator",
            scopes: ["operator.admin"],
          },
          platformAuth: {
            enabled: true,
            hasUsers: true,
            hasPlatformAdmins: true,
            sessionKind: "enterprise-admin",
            membershipRole: "enterprise-admin",
            pendingActivation: {
              kind: "employee-activation",
              email: "member@example.com",
              enterpriseName: "Acme",
              code: "EMP-123456",
              expiresAt: "2026-04-20T00:00:00.000Z",
            },
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    attachEnterprise(host, "acme-1234");
    host.platformAuthDisplayName = "Member";
    host.platformAuthEmail = "member@example.com";
    host.platformAuthSeatTitle = "Sales Lead";

    await createPlatformAuthInvite(host);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/openclaw${CONTROL_UI_ENTERPRISE_BASE_PATH}/acme-1234/seats`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ seatTitle: "Sales Lead" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/employee/provision`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          employeeName: "Member",
          employeeEmail: "member@example.com",
          seatId: "seat-sales",
          seatTitle: "Sales Lead",
        }),
      }),
    );
    expect(host.platformAuthInviteCode).toBe("EMP-123456");
    expect(host.platformAuthError).toBeNull();
  });

  it("does not provision when the invite has no position id", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();

    const payload = await provisionPlatformAuthEmployee(host, {
      employeeName: "Member",
      employeeEmail: "member@example.com",
      seatTitle: "Sales Lead",
    });

    expect(payload).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.platformAuthError).toBe("Invite requires an existing position id.");
  });

  it("does not provision when creating the vacant position fails", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        ok: false,
        code: "ENTERPRISE_ASSETS_SEAT_CREATE_FAILED",
        error: "Seat creation failed.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    attachEnterprise(host);

    const payload = await inviteEmployeeToNewPosition({
      host,
      employeeName: "Member",
      employeeEmail: "member@example.com",
      seatTitle: "Sales Lead",
    });

    expect(payload).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/seats");
    expect(host.platformAuthError).toContain("岗位创建失败");
  });

  it("provisions imported organization rows without sending activation email", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(seatCreateResponse("seat-sales", "Sales Lead"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          platformAuth: {
            enabled: true,
            pendingActivation: {
              kind: "employee-activation",
              email: "member@example.com",
              enterpriseName: "Acme",
              code: "EMP-123456",
              expiresAt: "2026-04-20T00:00:00.000Z",
            },
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    attachEnterprise(host);

    await inviteEmployeeToNewPosition({
      host,
      employeeName: "Member",
      employeeEmail: "member@example.com",
      seatTitle: "Sales Lead",
      teamLabel: "Sales",
      responsibility: "岗位等级：L2",
      sendActivationEmail: false,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/openclaw${CONTROL_UI_ENTERPRISE_BASE_PATH}/acme/seats`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          seatTitle: "Sales Lead",
          teamLabel: "Sales",
          responsibility: "岗位等级：L2",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/employee/provision`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          employeeName: "Member",
          employeeEmail: "member@example.com",
          seatId: "seat-sales",
          seatTitle: "Sales Lead",
          teamLabel: "Sales",
          responsibility: "岗位等级：L2",
          sendActivationEmail: false,
        }),
      }),
    );
    expect(host.platformAuthInviteCode).toBe("EMP-123456");
    expect(host.platformAuthError).toBeNull();
  });

  it("allows employee provisioning even when the same email has a pending activation in another enterprise", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        platformAuth: {
          enabled: true,
          pendingActivation: {
            kind: "employee-activation",
            email: "hedon25@126.com",
            enterpriseName: "UPBEYOND",
            code: "EMP-654321",
            expiresAt: "2026-06-20T00:00:00.000Z",
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();

    await provisionPlatformAuthEmployee(host, {
      employeeName: "黄海东",
      employeeEmail: "hedon25@126.com",
      seatId: "seat-assistant",
      seatTitle: "销售助理",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/employee/provision`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          employeeName: "黄海东",
          employeeEmail: "hedon25@126.com",
          seatId: "seat-assistant",
          seatTitle: "销售助理",
        }),
      }),
    );
    expect(host.platformAuthInviteCode).toBe("EMP-654321");
    expect(host.platformAuthError).toBeNull();
  });

  it("returns queued email delivery details when smtp is not configured", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        emailDelivery: {
          status: "queued",
          reason: "smtp_not_configured",
        },
        platformAuth: {
          enabled: true,
          pendingActivation: {
            kind: "employee-activation",
            email: "hedon25@126.com",
            enterpriseName: "UPBEYOND",
            code: "EMP-654321",
            expiresAt: "2026-06-20T00:00:00.000Z",
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();

    const payload = await provisionPlatformAuthEmployee(host, {
      employeeName: "黄海东",
      employeeEmail: "hedon25@126.com",
      seatId: "seat-assistant",
      seatTitle: "销售助理",
    });

    expect(payload?.emailDelivery).toMatchObject({
      status: "queued",
      reason: "smtp_not_configured",
    });
    expect(host.platformAuthError).toBeNull();
  });

  it("sends pending employee activation emails", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        platformAuth: {
          enabled: true,
        },
        activationDelivery: {
          total: 1,
          sent: 1,
          queued: 0,
          failed: 0,
          skipped: 0,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();

    const payload = await sendPlatformEmployeeActivations(host, {
      emails: ["member@example.com"],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/employee/activation/send`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          emails: ["member@example.com"],
        }),
      }),
    );
    expect(payload?.activationDelivery).toMatchObject({ total: 1, sent: 1 });
    expect(host.platformAuthError).toBeNull();
  });

  it("invites an existing employee as enterprise admin from the directory", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        platformAuth: { enabled: true },
        emailDelivery: { status: "sent", recipient: "member@example.com" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();

    const payload = await invitePlatformEnterpriseAdmin(host, " member@example.com ", {
      resend: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/enterprise/admin/invite`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ user: "member@example.com", resend: true }),
      }),
    );
    // Never routes through employee provisioning.
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("/employee/provision");
    expect(payload?.ok).toBe(true);
    expect(host.platformAuthBusy).toBe(false);
    expect(host.platformAuthError).toBeNull();
  });

  it("localizes enterprise admin invite conflicts", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        ok: false,
        code: "PLATFORM_AUTH_ADMIN_INVITE_PENDING",
        error: "pending",
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();

    const payload = await invitePlatformEnterpriseAdmin(host, "member@example.com");

    expect(payload).toBeUndefined();
    expect(host.platformAuthError).toContain("重发管理员邀请");
    expect(
      localizePlatformAuthOperatorError(
        Object.assign(new Error("x"), { code: "PLATFORM_AUTH_ALREADY_ENTERPRISE_ADMIN" }),
      ),
    ).toBe("该员工已是本企业管理员。");
    expect(localizePlatformAuthLoginError("PLATFORM_AUTH_ADMIN_INVITE_EXPIRED", "x")).toContain(
      "重新发送",
    );
  });

  it("accepts an admin invite at enterprise login with the unchanged employee password", async () => {
    window.history.replaceState(
      {},
      "",
      "/openclaw/enterprise/login?authMode=login&adminInvite=COADMIN-ABC&email=member%40example.com#auth",
    );
    expect(readEnterpriseAdminInviteCodeFromLocation()).toBe("COADMIN-ABC");
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        session: {
          provider: "trusted-proxy",
          user: "member@example.com",
          tenantId: "acme",
          role: "operator",
          scopes: ["operator.read"],
        },
        platformAuth: {
          enabled: true,
          hasUsers: true,
          sessionKind: "enterprise-admin",
          membershipRole: "enterprise-admin",
        },
      }),
    });
    fetchMock.mockResolvedValueOnce(sessionCookieCheckResponse("member@example.com"));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    host.platformAuthMode = "login";
    host.platformAuthEmail = "member@example.com";
    host.platformAuthPassword = "employee-password-1";

    await submitPlatformAuth(host);

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/login`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "member@example.com",
          password: "employee-password-1",
          sessionDomain: "enterprise",
          expectedSessionKind: "enterprise-admin",
          adminInviteCode: "COADMIN-ABC",
        }),
      }),
    );
    expect(host.platformAuthPassword).toBe("");
    expect(host.platformAuthAdminInviteCode ?? "").toBe("");
    expect(window.location.search).not.toContain("adminInvite");
    expect(window.location.hash).toBe("#auth");
    expect(host.platformAuthNotice).toContain("同时拥有员工与企业管理员身份");
    window.history.replaceState({}, "", "/");
  });

  it("accepts a pending seat assignment offer", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        platformAuth: {
          enabled: true,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();

    const result = await acceptPlatformSeatAssignmentOffer(host, "offer-1");

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/employee-access/offer/accept`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          offerId: "offer-1",
        }),
      }),
    );
    expect(result).toEqual({ notice: "已接受岗位绑定。" });
  });

  it("declines a pending seat assignment offer", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        platformAuth: {
          enabled: true,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();

    const result = await declinePlatformSeatAssignmentOffer(host, "offer-1");

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/employee-access/offer/decline`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          offerId: "offer-1",
        }),
      }),
    );
    expect(result).toEqual({ notice: "已拒绝岗位绑定。" });
  });

  it("lets a platform admin create an enterprise with explicit trial settings", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        session: {
          provider: "trusted-proxy",
          user: "ops@example.com",
          displayName: "Ops",
          role: "operator",
          scopes: ["operator.admin"],
        },
        platformAuth: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          availableModes: ["platform-enterprise-create"],
          sessionKind: "platform-admin",
          canManagePlatform: true,
          pendingActivation: {
            kind: "enterprise-admin-activation",
            email: "alice@example.com",
            enterpriseName: "Acme",
            enterpriseId: "acme-tenant-1",
            activationUrl:
              "https://biz.openbot.love/enterprise/login?authMode=enterprise-activate&code=ACT-777777#auth",
            code: "ACT-777777",
            expiresAt: "2026-04-20T00:00:00.000Z",
          },
        },
        emailDelivery: { status: "sent", messageId: "msg-1" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    host.platformAuthMode = "platform-enterprise-create";
    host.platformAuthCreationMode = "formal";
    host.platformAuthInstanceTrialDays = "21";
    host.platformAuthInstanceSeatCount = "10";
    host.platformAuthInstanceUpgradeUrl = "https://example.com/upgrade";
    host.platformAuthInstanceContactAdvisorUrl = "https://example.com/advisor";

    await submitPlatformAuth(host);

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/enterprise/create`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          enterpriseName: "Acme",
          adminName: "Alice",
          adminEmail: "alice@example.com",
          creationMode: "formal",
          trialDays: 21,
          seatCount: 10,
          upgradeUrl: "https://example.com/upgrade",
          contactAdvisorUrl: "https://example.com/advisor",
        }),
      }),
    );
    expect(host.platformAuthInviteCode).toBe("ACT-777777");
    expect(host.platformAuthInstanceEnterpriseId).toBe("acme-tenant-1");
    expect(host.platformAuthNotice).toContain("企业租户已创建");
    expect(host.platformAuthNotice).toContain("发送至 alice@example.com");
    expect(host.platformAuthNotice).toContain("msg-1");
    expect(host.platformAuthInstanceTrialDays).toBe("");
    expect(host.platformAuthInstanceSeatCount).toBe("");
    expect(host.platformAuthInstanceUpgradeUrl).toBe("");
    expect(host.platformAuthInstanceContactAdvisorUrl).toBe("");
    expect(host.platformAuthError).toBeNull();
  });

  it("logs in through the platform super admin entry with an explicit role guard", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        session: {
          provider: "trusted-proxy",
          user: "root@example.com",
          displayName: "Root",
          role: "operator",
          scopes: ["operator.admin"],
        },
        platformAuth: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          sessionKind: "platform-super-admin",
          platformRole: "super-admin",
          canManagePlatform: true,
          canManagePlatformAdmins: true,
          availableModes: ["platform-enterprise-create"],
        },
      }),
    });
    fetchMock.mockResolvedValueOnce(sessionCookieCheckResponse("root@example.com"));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    host.platformAuthMode = "platform-super-admin-login";
    host.platformAuthEmail = "root@example.com";

    await submitPlatformAuth(host);

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/login`,
      expect.objectContaining({
        body: JSON.stringify({
          email: "root@example.com",
          password: "password-123",
          sessionDomain: "platform",
          expectedPlatformRole: "super-admin",
        }),
      }),
    );
    expect(host.connect).toHaveBeenCalledTimes(1);
    expect(host.platformAuthState?.sessionKind).toBe("platform-super-admin");
    expect(host.platformAuthState?.session?.user).toBe("root@example.com");
    expect(host.bootstrapAuthSession?.user).toBe("root@example.com");
  });

  it("logs in through the platform admin entry with an explicit role guard", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        session: {
          provider: "trusted-proxy",
          user: "ops@example.com",
          displayName: "Ops",
          role: "operator",
          scopes: ["operator.read", "operator.write"],
        },
        platformAuth: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          sessionKind: "platform-admin",
          platformRole: "admin",
          canManagePlatform: true,
          availableModes: ["platform-enterprise-create"],
        },
      }),
    });
    fetchMock.mockResolvedValueOnce(
      sessionCookieCheckResponse("ops@example.com", {
        sessionKind: "platform-admin",
        displayName: "Ops",
        scopes: ["operator.read", "operator.write"],
      }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    host.platformAuthMode = "platform-admin-login";
    host.platformAuthEmail = "ops@example.com";

    await submitPlatformAuth(host);

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/login`,
      expect.objectContaining({
        body: JSON.stringify({
          email: "ops@example.com",
          password: "password-123",
          sessionDomain: "platform",
          expectedPlatformRole: "admin",
        }),
      }),
    );
    expect(host.connect).toHaveBeenCalledTimes(1);
    expect(host.platformAuthState?.sessionKind).toBe("platform-admin");
    expect(host.platformAuthState?.session?.user).toBe("ops@example.com");
  });

  it("blocks gateway connect when login JSON succeeds but session cookie did not land", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          session: {
            provider: "trusted-proxy",
            user: "root@example.com",
            displayName: "Root",
            role: "operator",
            scopes: ["operator.admin"],
          },
          platformAuth: {
            enabled: true,
            hasUsers: true,
            hasPlatformAdmins: true,
            sessionKind: "platform-super-admin",
            platformRole: "super-admin",
            canManagePlatform: true,
            availableModes: ["platform-enterprise-create"],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          availableModes: ["login"],
        }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    host.platformAuthMode = "platform-super-admin-login";
    host.platformAuthEmail = "root@example.com";

    await submitPlatformAuth(host);

    expect(host.connect).not.toHaveBeenCalled();
    expect(host.bootstrapAuthSession).toBeNull();
    expect(host.platformAuthError).toMatch(/Cookie/);
  });

  it("clears MFA state after a successful platform admin login", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        session: {
          provider: "trusted-proxy",
          user: "ops@example.com",
          displayName: "Ops",
          role: "operator",
          scopes: ["operator.read", "operator.write"],
        },
        platformAuth: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          sessionKind: "platform-admin",
          platformRole: "admin",
          canManagePlatform: true,
          availableModes: ["platform-enterprise-create"],
        },
      }),
    });
    fetchMock.mockResolvedValueOnce(sessionCookieCheckResponse("ops@example.com"));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    host.platformAuthMode = "platform-admin-login";
    host.platformAuthEmail = "ops@example.com";
    host.platformAuthMfaStage = "code";
    host.platformAuthMfaCode = "123456";
    host.platformAuthMfaEnrollment = {
      otpAuthUrl: "otpauth://totp/OpenBot:ops@example.com?secret=ABC123&issuer=OpenBot",
      recoveryCodes: ["code-1"],
    };

    await submitPlatformAuth(host);

    expect(host.platformAuthMfaStage).toBe("none");
    expect(host.platformAuthMfaCode).toBe("");
    expect(host.platformAuthMfaEnrollment).toBeNull();
  });

  it("lets a super admin create a delegated platform administrator", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        session: {
          provider: "trusted-proxy",
          user: "root@example.com",
          displayName: "Root",
          role: "operator",
          scopes: ["operator.admin"],
        },
        platformAuth: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          sessionKind: "platform-super-admin",
          platformRole: "super-admin",
          canManagePlatform: true,
          canManagePlatformAdmins: true,
          platformAdmins: [
            {
              user: "root@example.com",
              displayName: "Root",
              platformRole: "super-admin",
              status: "active",
              scopes: ["operator.admin"],
              isCurrentUser: true,
            },
            {
              user: "ops@example.com",
              displayName: "Ops Delegate",
              platformRole: "admin",
              status: "active",
              scopes: ["operator.read", "operator.write"],
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    host.platformAuthPlatformAdminScopes = ["operator.read", "operator.write"];

    await createPlatformAdmin(host);

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/admin/create`,
      expect.objectContaining({
        body: JSON.stringify({
          email: "ops@example.com",
          password: "delegate-password-123",
          displayName: "Ops Delegate",
          scopes: ["operator.read", "operator.write"],
        }),
      }),
    );
    expect(host.platformAuthPlatformAdminDisplayName).toBe("");
    expect(host.platformAuthPlatformAdminEmail).toBe("");
    expect(host.platformAuthPlatformAdminPassword).toBe("");
    expect(host.platformAuthPlatformAdminScopes).toEqual([
      "operator.read",
      "operator.write",
      "operator.admin",
      "operator.approvals",
      "operator.pairing",
    ]);
  });

  it("defaults empty scopes to the full platform admin preset on create", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        platformAuth: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          sessionKind: "platform-super-admin",
          platformRole: "super-admin",
          canManagePlatform: true,
          canManagePlatformAdmins: true,
          platformAdmins: [
            {
              user: "root@example.com",
              displayName: "Root",
              platformRole: "super-admin",
              status: "active",
              scopes: ["operator.admin"],
              isCurrentUser: true,
            },
            {
              user: "ops@example.com",
              displayName: "Ops Delegate",
              platformRole: "admin",
              status: "active",
              scopes: [
                "operator.read",
                "operator.write",
                "operator.admin",
                "operator.approvals",
                "operator.pairing",
              ],
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    host.platformAuthPlatformAdminScopes = [];

    await createPlatformAdmin(host);

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/admin/create`,
      expect.objectContaining({
        body: JSON.stringify({
          email: "ops@example.com",
          password: "delegate-password-123",
          displayName: "Ops Delegate",
          scopes: [
            "operator.read",
            "operator.write",
            "operator.admin",
            "operator.approvals",
            "operator.pairing",
          ],
        }),
      }),
    );
  });

  it("removes a platform administrator through the platform admin remove route", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        platformAuth: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          sessionKind: "platform-super-admin",
          platformRole: "super-admin",
          canManagePlatform: true,
          canManagePlatformAdmins: true,
          platformAdmins: [
            {
              user: "root@example.com",
              displayName: "Root",
              platformRole: "super-admin",
              status: "active",
              scopes: ["operator.admin"],
              isCurrentUser: true,
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();

    await removePlatformAdmin(host, "ops@example.com");

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/admin/remove`,
      expect.objectContaining({
        body: JSON.stringify({ user: "ops@example.com" }),
      }),
    );
    expect(host.platformAuthError).toBeNull();
  });

  it("localizes platform admin create/remove operator errors", () => {
    expect(
      localizePlatformAuthOperatorError(
        Object.assign(new Error("Password must be at least 8 characters."), {
          code: "PLATFORM_AUTH_WEAK_PASSWORD",
        }),
      ),
    ).toBe("密码至少需要 8 个字符。");
    expect(
      localizePlatformAuthOperatorError(
        Object.assign(new Error("Enter a valid admin email address."), {
          code: "PLATFORM_AUTH_INVALID_EMAIL",
        }),
      ),
    ).toBe("请输入有效的管理员邮箱。");
    expect(
      localizePlatformAuthOperatorError(
        Object.assign(new Error("Only super administrators can create platform administrators."), {
          code: "PLATFORM_AUTH_SUPER_ADMIN_REQUIRED",
        }),
      ),
    ).toContain("超级管理员");
  });

  it("logs out the platform session and clears cached bootstrap auth", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        platformAuth: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          availableModes: [
            "enterprise-create",
            "enterprise-activate",
            "login",
            "forgot-password",
            "password-reset",
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();
    host.bootstrapAuthSession = {
      provider: "trusted-proxy",
      user: "alice@example.com",
      displayName: "Alice",
      tenantId: "acme-1234",
      role: "operator",
      scopes: ["operator.admin"],
    };

    await logoutPlatformAuth(host);

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/logout`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
      }),
    );
    expect(host.bootstrapAuthSession).toBeNull();
    expect(host.connect).toHaveBeenCalledTimes(1);
    expect(host.platformAuthError).toBeNull();
  });

  it("posts signOut to the native employee-shell host in addition to HTTP logout", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        platformAuth: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          availableModes: ["login"],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const received: unknown[] = [];
    const nativeWindow = {
      webkit: {
        messageHandlers: {
          [EMPLOYEE_SHELL_HOST_HANDLER]: {
            postMessage: (message: unknown) => {
              received.push(message);
            },
          },
        },
      },
    } as unknown as Window;
    const host = createHost();

    await logoutPlatformAuth(host, nativeWindow);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(host.connect).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(1);
    const parsed = parseEmployeeShellBridgeJSON(received[0] as string);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.message.type).toBe("signOut");
    }
  });

  it("changes the signed-in account password and reconnects with the refreshed session", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        session: {
          provider: "trusted-proxy",
          user: "alice@example.com",
          displayName: "Alice",
          tenantId: "acme-1234",
          role: "operator",
          scopes: ["operator.admin"],
        },
        platformAuth: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          availableModes: ["platform-enterprise-create"],
          sessionKind: "enterprise-admin",
          tenantName: "Acme",
          membershipRole: "enterprise-admin",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();

    await changePlatformAuthPassword(host, {
      currentPassword: "password-123",
      newPassword: "new-password-123",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/password/change`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          currentPassword: "password-123",
          newPassword: "new-password-123",
        }),
      }),
    );
    expect(host.bootstrapAuthSession).toMatchObject({
      user: "alice@example.com",
      tenantId: "acme-1234",
    });
    expect(host.connect).toHaveBeenCalledTimes(1);
    expect(host.platformAuthError).toBeNull();
  });

  it("updates platform trial policy through the dedicated platform route", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        session: {
          provider: "trusted-proxy",
          user: "ops@example.com",
          displayName: "Ops",
          role: "operator",
          scopes: ["operator.admin"],
        },
        platformAuth: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          availableModes: ["platform-enterprise-create"],
          sessionKind: "platform-admin",
          canManagePlatform: true,
          platformPolicy: {
            defaultTrialDays: 21,
            allowedTrialDays: [7, 14, 21],
            defaultTrialSeatCount: 10,
            trialSeatOptions: [5, 10, 20],
            allowCustomTrialSeatCount: true,
            trialExpiryPolicy: "choose",
            upgradeUrl: "https://example.com/upgrade",
            contactAdvisorUrl: "https://example.com/advisor",
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();

    await updatePlatformTrialPolicy(host, {
      defaultTrialDays: 21,
      defaultTrialSeatCount: 10,
      upgradeUrl: "https://example.com/upgrade",
      contactAdvisorUrl: "https://example.com/advisor",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/enterprise/trial/policy/update`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          defaultTrialDays: 21,
          defaultTrialSeatCount: 10,
          upgradeUrl: "https://example.com/upgrade",
          contactAdvisorUrl: "https://example.com/advisor",
        }),
      }),
    );
    expect(host.platformAuthState?.platformPolicy).toMatchObject({
      defaultTrialDays: 21,
      defaultTrialSeatCount: 10,
      upgradeUrl: "https://example.com/upgrade",
      contactAdvisorUrl: "https://example.com/advisor",
    });
    expect(host.platformAuthError).toBeNull();
  });
});
