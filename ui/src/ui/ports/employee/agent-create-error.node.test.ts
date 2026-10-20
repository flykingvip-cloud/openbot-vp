import { describe, expect, it } from "vitest";
import { GatewayRequestError } from "../../gateway.ts";
import { formatEmployeeAgentCreateError } from "./agent-create-error.ts";

describe("formatEmployeeAgentCreateError", () => {
  it("guides re-login instead of showing a bare English gateway error", () => {
    const error = new GatewayRequestError({
      code: "INVALID_REQUEST",
      message:
        "tenantId requires an authenticated enterprise session with exactly one resolved membership.",
      details: {
        code: "NO_AUTHORITATIVE_TENANT",
        scopeKind: "deny",
        denyReason: "membership-ambiguous",
      },
    });
    const text = formatEmployeeAgentCreateError(error);
    expect(text).toContain("重新登录");
    expect(text).toContain("deny/membership-ambiguous");
    expect(text).not.toContain("GatewayRequestError");
    expect(text).not.toContain("authenticated enterprise session");
  });

  it("keeps the server message when it already explains the missing membership", () => {
    const message =
      "无法创建企业数字员工：当前连接没有唯一的企业成员身份（deny/membership-ambiguous）。请退出后重新登录企业账号后再试。";
    const error = new GatewayRequestError({
      code: "INVALID_REQUEST",
      message,
      details: {
        code: "NO_AUTHORITATIVE_TENANT",
        scopeKind: "deny",
        denyReason: "membership-ambiguous",
      },
    });
    expect(formatEmployeeAgentCreateError(error)).toBe(message);
  });

  it("strips the gateway error class from a stringified authoritative-tenant failure", () => {
    expect(
      formatEmployeeAgentCreateError(
        "GatewayRequestError: tenantId requires an authenticated enterprise session with exactly one resolved membership.",
      ),
    ).toBe("当前登录没有绑定唯一的企业成员身份。请退出后重新登录，再创建数字员工。");
  });

  it("leaves unrelated gateway failures as the server message", () => {
    const error = new GatewayRequestError({
      code: "INVALID_REQUEST",
      message: "ownerUserId must be the authenticated caller.",
    });
    expect(formatEmployeeAgentCreateError(error)).toBe(
      "ownerUserId must be the authenticated caller.",
    );
  });
});
