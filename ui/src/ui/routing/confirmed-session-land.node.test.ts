import { describe, expect, it } from "vitest";
import {
  decideControlledLogin,
  isControlledLoginPath,
  isStaleEnterpriseLoginSuccessNotice,
  landTabForConfirmedSession,
} from "./confirmed-session-land.ts";

const enterpriseConfirmed = {
  sessionDomain: "enterprise" as const,
  sessionKind: "enterprise-admin" as const,
};

describe("decideControlledLogin", () => {
  it("treats the dedicated login routes as controlled paths", () => {
    expect(isControlledLoginPath("/enterprise/login")).toBe(true);
    expect(isControlledLoginPath("/platform/login")).toBe(true);
    expect(isControlledLoginPath("/")).toBe(true);
    expect(isControlledLoginPath("/enterprise")).toBe(false);
  });

  it("lands a confirmed enterprise-admin session off /enterprise/login", () => {
    expect(landTabForConfirmedSession(enterpriseConfirmed)).toBe("enterpriseOverview");
    expect(
      decideControlledLogin({
        path: "/enterprise/login",
        auth: enterpriseConfirmed,
        enterpriseAuthenticated: true,
        platformAuthenticated: false,
      }),
    ).toEqual({ action: "redirect", tab: "enterpriseOverview" });
  });

  it("lands when the enterprise-admin session is confirmed even without sessionDomain", () => {
    expect(
      decideControlledLogin({
        path: "/enterprise/login",
        auth: { sessionKind: "enterprise-admin" },
        enterpriseAuthenticated: true,
        platformAuthenticated: false,
      }),
    ).toEqual({ action: "redirect", tab: "enterpriseOverview" });
  });

  it("asks for an explicit continue when the land tab would bounce", () => {
    expect(
      decideControlledLogin({
        path: "/enterprise/login",
        auth: enterpriseConfirmed,
        enterpriseAuthenticated: true,
        platformAuthenticated: false,
        landReachable: () => false,
      }),
    ).toEqual({ action: "continue", tab: "enterpriseOverview" });
  });

  it("does not treat a member session or missing sessionKind as an enterprise admin", () => {
    expect(
      decideControlledLogin({
        path: "/enterprise/login",
        auth: { sessionDomain: "employee", sessionKind: "member" },
        enterpriseAuthenticated: false,
        platformAuthenticated: false,
        notice: "已登录企业工作台。",
      }),
    ).toEqual({ action: "stay", clearStaleSuccessNotice: true });
    expect(
      decideControlledLogin({
        path: "/enterprise/login",
        auth: { sessionDomain: "enterprise" },
        enterpriseAuthenticated: false,
        platformAuthenticated: false,
        notice: "已登录企业工作台。",
      }),
    ).toEqual({ action: "stay", clearStaleSuccessNotice: true });
  });

  it("clears the English login-success sentence and keeps unrelated notices", () => {
    expect(isStaleEnterpriseLoginSuccessNotice("Signed in to the enterprise workspace.")).toBe(
      true,
    );
    expect(isStaleEnterpriseLoginSuccessNotice("重置验证码已发送。")).toBe(false);
    expect(
      decideControlledLogin({
        path: "/enterprise/login",
        auth: null,
        enterpriseAuthenticated: false,
        platformAuthenticated: false,
        notice: "重置验证码已发送。",
      }),
    ).toEqual({ action: "stay", clearStaleSuccessNotice: false });
  });

  it("does not send a platform admin from the enterprise login route to the platform console", () => {
    expect(
      decideControlledLogin({
        path: "/enterprise/login",
        auth: { sessionDomain: "platform", sessionKind: "platform-admin" },
        enterpriseAuthenticated: false,
        platformAuthenticated: true,
        notice: "已登录企业工作台。",
      }),
    ).toEqual({ action: "stay", clearStaleSuccessNotice: true });
  });

  it("lands a confirmed platform admin off /platform/login", () => {
    expect(
      decideControlledLogin({
        path: "/platform/login",
        auth: { sessionDomain: "platform", sessionKind: "platform-super-admin" },
        enterpriseAuthenticated: false,
        platformAuthenticated: true,
      }),
    ).toEqual({ action: "redirect", tab: "platformDashboard" });
  });

  it("leaves the public root to the existing homepage rules", () => {
    expect(
      decideControlledLogin({
        path: "/",
        auth: enterpriseConfirmed,
        enterpriseAuthenticated: true,
        platformAuthenticated: false,
      }),
    ).toEqual({ action: "stay", clearStaleSuccessNotice: false });
  });
});
