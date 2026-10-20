import { describe, expect, it } from "vitest";
import {
  isGatewayAuthIssue,
  isTrustedProxyBrowserAuthMode,
  resolveGatewayAuthRecoveryHint,
} from "./gateway-auth-classification.ts";

describe("gateway auth classification", () => {
  it("detects token and trusted-proxy auth failures", () => {
    expect(isGatewayAuthIssue("unauthorized: gateway token missing")).toBe(true);
    expect(isGatewayAuthIssue("unauthorized: platform session missing")).toBe(true);
    expect(isGatewayAuthIssue("企业数据未配置")).toBe(false);
  });

  it("returns platform-login recovery hints for trusted-proxy browser mode", () => {
    expect(
      resolveGatewayAuthRecoveryHint({
        authMode: "trusted-proxy",
        hasPlatformSession: false,
      }),
    ).toContain("平台或反向代理登录");
    expect(
      resolveGatewayAuthRecoveryHint({
        authMode: "trusted-proxy",
        hasPlatformSession: true,
      }),
    ).toContain("重新登录");
  });

  it("keeps token recovery hints for token browser mode", () => {
    expect(
      resolveGatewayAuthRecoveryHint({
        authMode: "token",
        hasPlatformSession: false,
      }),
    ).toContain("Control UI 设置");
  });

  it("identifies trusted-proxy browser auth mode", () => {
    expect(isTrustedProxyBrowserAuthMode("trusted-proxy")).toBe(true);
    expect(isTrustedProxyBrowserAuthMode("token")).toBe(false);
  });
});
