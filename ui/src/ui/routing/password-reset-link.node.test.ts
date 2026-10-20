import { describe, expect, it } from "vitest";
import {
  canonicalPasswordResetLocation,
  passwordResetLoginMode,
  passwordResetLoginTab,
} from "./password-reset-link.ts";

describe("password reset mail deep link", () => {
  it.each([
    {
      host: "www.openbot.love",
      surface: "employee",
      pathname: "/",
    },
    {
      host: "openbot.love",
      surface: "employee",
      pathname: "/",
    },
    {
      host: "biz.openbot.love",
      surface: "enterprise",
      pathname: "/enterprise/login",
    },
    {
      host: "admin.openbot.love",
      surface: "platform",
      pathname: "/platform/login",
    },
  ] as const)("opens $surface reset from /auth on $host", ({ host, surface, pathname }) => {
    expect(
      canonicalPasswordResetLocation({
        pathname: "/auth",
        search: `?mode=password-reset&code=RESET-1&surface=${surface}`,
        host,
      }),
    ).toEqual({
      pathname,
      search: `?authMode=password-reset&code=RESET-1&surface=${surface}`,
      hash: "#auth",
      surface,
    });
  });

  it("keeps an already canonical login link", () => {
    expect(
      canonicalPasswordResetLocation({
        pathname: "/enterprise/login",
        search: "?authMode=password-reset&code=RESET-1&surface=enterprise",
        host: "biz.openbot.love",
      }),
    ).toBeNull();
  });

  it("uses the host when a legacy /auth link omits surface", () => {
    expect(
      canonicalPasswordResetLocation({
        pathname: "/auth",
        search: "?mode=password-reset&code=RESET-9",
        host: "biz.openbot.love",
      })?.surface,
    ).toBe("enterprise");
    expect(
      canonicalPasswordResetLocation({
        pathname: "/auth",
        search: "?mode=password-reset&code=RESET-9",
        host: "admin.openbot.love",
      })?.pathname,
    ).toBe("/platform/login");
  });
});

describe("password reset return navigation", () => {
  it("sends each surface back to its login tab without an MFA step", () => {
    expect(passwordResetLoginTab("/", "employee")).toBe("me");
    expect(passwordResetLoginMode("me")).toBe("login");
    expect(passwordResetLoginTab("/enterprise/login", "enterprise")).toBe("enterpriseLogin");
    expect(passwordResetLoginMode("enterpriseLogin")).toBe("login");
    expect(passwordResetLoginTab("/platform/login", "platform")).toBe("platformLogin");
    expect(passwordResetLoginMode("platformLogin")).toBe("platform-admin-login");
  });
});
