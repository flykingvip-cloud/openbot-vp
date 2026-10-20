/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.ts";
import { OpenBotApp } from "./app.ts";

describe("OpenBotApp platform auth submit flow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("routes dedicated platform login to platformDashboard as soon as platform session is returned", async () => {
    const app = new OpenBotApp();
    app.platformAuthMode = "platform-admin-login";
    app.platformAuthLoginIntent = "platform-admin";
    app.platformAuthState = {
      enabled: true,
      hasUsers: true,
      hasPlatformAdmins: true,
      sessionDomain: "platform",
      sessionKind: "platform-admin",
      platformRole: "admin",
      canManagePlatform: true,
      session: {
        provider: "trusted-proxy",
        user: "ops@example.com",
        role: "operator",
        scopes: ["operator.read"],
      },
    };
    app.connect = vi.fn();
    app.setTab = vi.fn((next) => {
      app.tab = next;
    });

    const submitResult = { notice: undefined };
    const submitMock = vi
      .spyOn(await import("./controllers/platform-auth.ts"), "submitPlatformAuth")
      .mockResolvedValue(submitResult);

    await app.submitPlatformAuth();

    expect(submitMock).toHaveBeenCalled();
    expect(app.tab).toBe("platformDashboard");
    expect(app.platformAuthNotice).toBe("Signed in to the platform console.");
    expect(app.platformAuthLoginIntent).toBeUndefined();
  });

  it("shows translated login copy on the employee notice instead of the raw key", async () => {
    await i18n.setLocale("en");
    const app = new OpenBotApp();
    app.platformAuthMode = "login";
    app.platformAuthError = null;
    app.platformAuthState = {
      enabled: true,
      hasUsers: true,
      hasPlatformAdmins: false,
      sessionDomain: "employee",
      sessionKind: "member",
      session: {
        provider: "trusted-proxy",
        user: "employee@example.com",
        role: "operator",
        scopes: ["operator.read"],
      },
    };
    app.setTab = vi.fn((next) => {
      app.tab = next;
    });

    vi.spyOn(
      await import("./controllers/platform-auth.ts"),
      "submitPlatformAuth",
    ).mockResolvedValue({ notice: undefined });

    await app.submitPlatformAuth();

    expect(app.tab).toBe("me");
    expect(app.platformAuthNotice).toBe("Signed in to your workspace.");
    expect(app.platformAuthNotice).not.toContain("enterprise workspace");
    expect(app.platformAuthNotice).not.toContain("overview.platformAuth.notice");
  });

  it("uses the enterprise workspace sentence only for an enterprise-admin sign-in", async () => {
    await i18n.setLocale("en");
    const app = new OpenBotApp();
    app.platformAuthMode = "login";
    app.platformAuthLoginIntent = "enterprise-admin";
    app.platformAuthState = {
      enabled: true,
      hasUsers: true,
      hasPlatformAdmins: true,
      sessionDomain: "enterprise",
      sessionKind: "enterprise-admin",
      session: {
        provider: "trusted-proxy",
        user: "admin@example.com",
        role: "operator",
        scopes: ["operator.admin"],
      },
    };
    app.setTab = vi.fn((next) => {
      app.tab = next;
    });

    vi.spyOn(
      await import("./controllers/platform-auth.ts"),
      "submitPlatformAuth",
    ).mockResolvedValue({ notice: undefined });

    await app.submitPlatformAuth();

    expect(app.platformAuthNotice).toBe("Signed in to the enterprise workspace.");
  });

  it("does not announce a signed-in workspace while platform MFA is still required", async () => {
    await i18n.setLocale("en");
    const app = new OpenBotApp();
    app.platformAuthMode = "platform-admin-login";
    app.platformAuthLoginIntent = "platform-admin";
    app.platformAuthState = {
      enabled: true,
      hasUsers: true,
      hasPlatformAdmins: true,
    };
    app.setTab = vi.fn((next) => {
      app.tab = next;
    });

    vi.spyOn(
      await import("./controllers/platform-auth.ts"),
      "submitPlatformAuth",
    ).mockImplementation(async () => {
      app.platformAuthError = null;
      app.platformAuthMfaStage = "code";
      app.platformAuthNotice = "此账号已开启两步验证。请输入验证器中的 6 位动态验证码后再次登录。";
    });

    await app.submitPlatformAuth();

    expect(app.platformAuthNotice).toBe(
      "This account uses two-factor authentication. Enter the 6-digit code from your authenticator app, then sign in again.",
    );
    expect(app.platformAuthNotice).not.toContain("Signed in");
    expect(app.tab).not.toBe("platformDashboard");
  });

  it("does not show an enterprise success banner when the employee home is mid-auth", async () => {
    await i18n.setLocale("zh-CN");
    const app = new OpenBotApp();
    app.platformAuthMode = "login";
    app.platformAuthState = {
      enabled: true,
      hasUsers: true,
      hasPlatformAdmins: false,
    };
    app.setTab = vi.fn((next) => {
      app.tab = next;
    });

    vi.spyOn(
      await import("./controllers/platform-auth.ts"),
      "submitPlatformAuth",
    ).mockImplementation(async () => {
      app.platformAuthError = null;
      app.platformAuthMfaStage = "code";
      app.platformAuthNotice = "已登录企业工作台。";
    });

    await app.submitPlatformAuth();

    expect(app.platformAuthNotice).toBeNull();
    expect(app.platformAuthNotice ?? "").not.toContain("已登录企业工作台");
  });
});
