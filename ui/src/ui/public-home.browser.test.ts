/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import {
  replaceLocationWithPublicHomepage,
  resolveControlUiHomepageState,
  resolvePublicHomepageState,
  shouldUsePublicHomepageForCurrentLocation,
} from "./public-home.ts";

describe("public homepage helpers", () => {
  it("forces a renderable public homepage state after logout even when platform auth is disabled", () => {
    const result = resolvePublicHomepageState({
      platformAuthState: {
        enabled: false,
        hasUsers: true,
        hasPlatformAdmins: true,
        availableModes: ["employee-register", "login"],
      },
      activePlatformSession: null,
      useBootstrapAuth: true,
      forcePublicHomepage: true,
    });

    expect(result).toEqual({
      enabled: true,
      hasUsers: true,
      hasPlatformAdmins: true,
      availableModes: ["employee-register", "login"],
    });
  });

  it("keeps the current session surface when no logout override is active", () => {
    const result = resolvePublicHomepageState({
      platformAuthState: {
        enabled: false,
        hasUsers: true,
      },
      activePlatformSession: {
        provider: "trusted-proxy",
        user: "alice@example.com",
      },
      useBootstrapAuth: true,
      forcePublicHomepage: false,
    });

    expect(result).toBeNull();
  });

  it("replaces the current URL with the root homepage and clears query/hash", () => {
    window.history.replaceState({}, "", "/ops/runtime/runtime-7?session=main#auth");
    const replaceSpy = vi.spyOn(window.history, "replaceState");

    replaceLocationWithPublicHomepage("");

    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });

  it("preserves a configured base path when returning to the public homepage", () => {
    window.history.replaceState({}, "", "/ui/ops/incidents?session=main#auth");

    replaceLocationWithPublicHomepage("/ui");

    expect(window.location.pathname).toBe("/ui");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });

  it("keeps the marketing homepage at the bare public root even when a session exists", () => {
    const result = resolvePublicHomepageState({
      platformAuthState: {
        enabled: true,
        hasUsers: true,
        hasPlatformAdmins: true,
        session: {
          provider: "trusted-proxy",
          user: "member@example.com",
        },
      },
      activePlatformSession: {
        provider: "trusted-proxy",
        user: "member@example.com",
      },
      useBootstrapAuth: true,
      forcePublicHomepage: false,
      pageUrl: "https://openbot.love/",
    });

    expect(result).toMatchObject({
      enabled: true,
      hasUsers: true,
      hasPlatformAdmins: true,
    });
    expect(result?.session).toBeUndefined();
  });

  it("treats an explicit session query at the public root as a workspace entry", () => {
    expect(
      shouldUsePublicHomepageForCurrentLocation(
        "",
        "https://www.openbot.love/?session=agent%3Amain%3Amain",
      ),
    ).toBe(false);
  });

  it("does not replace a connected loopback console with the registration wall", () => {
    const platformAuthState = {
      enabled: true,
      hasUsers: false,
      availableModes: ["employee-register", "login"] as Array<"employee-register" | "login">,
    };
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
    // A gateway-token console must mount chat (textarea + chat-work-progress),
    // not 团队工作台 / 注册 登录.
    expect(opened).toBeNull();
  });

  it("keeps the marketing homepage and an explicit logout even when the gateway is connected", () => {
    const platformAuthState = {
      enabled: true,
      hasUsers: true,
    };
    expect(
      resolveControlUiHomepageState({
        platformAuthState,
        activePlatformSession: null,
        useBootstrapAuth: true,
        forcePublicHomepage: false,
        gatewayConnected: true,
        pageUrl: "https://openbot.love/",
      })?.enabled,
    ).toBe(true);
    expect(
      resolveControlUiHomepageState({
        platformAuthState,
        activePlatformSession: null,
        useBootstrapAuth: true,
        forcePublicHomepage: true,
        gatewayConnected: true,
        pageUrl: "http://127.0.0.1:18789/",
      })?.enabled,
    ).toBe(true);
  });
});
