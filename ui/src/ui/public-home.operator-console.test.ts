/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import {
  replaceLocationWithPublicHomepage,
  resolveControlUiHomepageState,
  resolveEmployeePublicHomeHref,
} from "./public-home.ts";

const platformAuthState = {
  enabled: true,
  hasUsers: false,
  availableModes: ["employee-register", "login"] as Array<"employee-register" | "login">,
};

describe("operator console homepage", () => {
  it("does not replace a connected loopback console with the registration wall", () => {
    const blocked = resolveControlUiHomepageState({
      platformAuthState,
      activePlatformSession: null,
      useBootstrapAuth: true,
      forcePublicHomepage: false,
      gatewayConnected: false,
      pageUrl: "http://127.0.0.1:18789/?session=main",
    });
    expect(blocked?.enabled).toBe(true);

    const opened = resolveControlUiHomepageState({
      platformAuthState,
      activePlatformSession: null,
      useBootstrapAuth: true,
      forcePublicHomepage: false,
      gatewayConnected: true,
      pageUrl: "http://127.0.0.1:18789/?session=main",
    });
    // Gateway-token console must mount chat, not 团队工作台 / 注册 登录.
    expect(opened).toBeNull();
  });

  it("keeps the marketing homepage and an explicit logout even when the gateway is connected", () => {
    expect(
      resolveControlUiHomepageState({
        platformAuthState: { enabled: true, hasUsers: true },
        activePlatformSession: null,
        useBootstrapAuth: true,
        forcePublicHomepage: false,
        gatewayConnected: true,
        pageUrl: "https://openbot.love/",
      })?.enabled,
    ).toBe(true);
    expect(
      resolveControlUiHomepageState({
        platformAuthState: { enabled: true, hasUsers: true },
        activePlatformSession: null,
        useBootstrapAuth: true,
        forcePublicHomepage: true,
        gatewayConnected: true,
        pageUrl: "http://127.0.0.1:18789/",
      })?.enabled,
    ).toBe(true);
  });
});

describe("console host public home", () => {
  it("points biz and admin 首页 at the employee site", () => {
    expect(resolveEmployeePublicHomeHref("biz.openbot.love")).toBe("https://www.openbot.love/");
    expect(resolveEmployeePublicHomeHref("admin.openbot.love")).toBe("https://www.openbot.love/");
    expect(resolveEmployeePublicHomeHref("www.openbot.love")).toBe("/");
    expect(resolveEmployeePublicHomeHref("openbot.love")).toBe("/");
    expect(resolveEmployeePublicHomeHref("localhost:18789", "/ui")).toBe("/ui");
  });

  it("hard-navigates off biz instead of rewriting the public homepage onto that host", () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        host: "biz.openbot.love",
        href: "https://biz.openbot.love/?session=agent%3Amain%3Aemployee%3A90fed19a",
        assign,
      },
    });

    replaceLocationWithPublicHomepage("");

    expect(assign).toHaveBeenCalledWith("https://www.openbot.love/");
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });
});
