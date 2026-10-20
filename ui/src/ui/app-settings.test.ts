/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { shouldUsePublicHomepageForCurrentLocationMock } = vi.hoisted(() => ({
  shouldUsePublicHomepageForCurrentLocationMock: vi.fn(() => false),
}));

vi.mock("./public-home.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./public-home.ts")>();
  return {
    ...actual,
    shouldUsePublicHomepageForCurrentLocation: shouldUsePublicHomepageForCurrentLocationMock,
  };
});

import {
  applySettingsFromUrl,
  onPopState,
  setTabFromRoute,
  syncTabWithLocation,
  syncUrlWithTab,
  type SettingsHost,
} from "./app-settings.ts";
import type { Tab } from "./navigation.ts";

type SettingsRouteHost = SettingsHost & {
  logsPollInterval: number | null;
  debugPollInterval: number | null;
};

const createHost = (tab: Tab): SettingsRouteHost => ({
  settings: {
    gatewayUrl: "",
    token: "",
    sessionKey: "main",
    lastActiveSessionKey: "main",
    sessionSeenAt: { main: 1 },
    theme: "system",
    chatFocusMode: false,
    chatShowThinking: true,
    splitRatio: 0.6,
    navCollapsed: false,
    navGroupsCollapsed: {},
  },
  theme: "system",
  themeResolved: "dark",
  applySessionKey: "main",
  sessionKey: "main",
  tab,
  connected: false,
  chatHasAutoScrolled: false,
  logsAtBottom: false,
  eventLog: [],
  eventLogBuffer: [],
  basePath: "",
  cronRunsScope: "all",
  cronRunsJobId: null,
  themeMedia: null,
  themeMediaHandler: null,
  logsPollInterval: null,
  debugPollInterval: null,
  syncEnterpriseHandoverRoute: vi.fn().mockResolvedValue(undefined),
});

describe("setTabFromRoute", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    shouldUsePublicHomepageForCurrentLocationMock.mockReset();
    shouldUsePublicHomepageForCurrentLocationMock.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts and stops log polling based on the tab", () => {
    const host = createHost("chat");

    setTabFromRoute(host, "logs");
    expect(host.tab).toBe("platformAdvanced");
    expect(host.logsPollInterval).not.toBeNull();
    expect(host.debugPollInterval).not.toBeNull();

    setTabFromRoute(host, "chat");
    expect(host.logsPollInterval).toBeNull();
  });

  it("starts and stops debug polling based on the tab", () => {
    const host = createHost("chat");

    setTabFromRoute(host, "debug");
    expect(host.tab).toBe("platformAdvanced");
    expect(host.debugPollInterval).not.toBeNull();
    expect(host.logsPollInterval).not.toBeNull();

    setTabFromRoute(host, "chat");
    expect(host.debugPollInterval).toBeNull();
  });

  it("falls back to the employee home when a restricted member lands on an ops route", () => {
    const host = createHost("chat");
    host.bootstrapAuthMode = "trusted-proxy";
    host.bootstrapAuthSession = {
      provider: "trusted-proxy",
      user: "member@example.com",
      tenantId: "acme",
    };
    host.platformAuthState = {
      enabled: true,
      hasUsers: true,
      allowRegistration: false,
      membershipRole: "member",
    };

    window.history.replaceState({}, "", "/ops/diagnostics");
    syncTabWithLocation(host, true);

    expect(host.tab).toBe("me");
    expect(window.location.pathname).toBe("/");
  });

  it("keeps the dedicated enterprise login route reachable before authentication", () => {
    const host = createHost("chat");
    host.bootstrapAuthMode = "trusted-proxy";
    host.platformAuthState = {
      enabled: true,
      hasUsers: true,
      allowRegistration: true,
    };

    window.history.replaceState({}, "", "/enterprise/login");
    syncTabWithLocation(host, true);

    expect(host.tab).toBe("enterpriseLogin");
    expect(window.location.pathname).toBe("/enterprise/login");
  });

  it("captures seatOffer context from the enterprise login link", () => {
    const host = createHost("chat");
    host.bootstrapAuthMode = "trusted-proxy";
    host.platformAuthState = {
      enabled: true,
      hasUsers: true,
      allowRegistration: true,
    };

    window.history.replaceState(
      {},
      "",
      "/enterprise/login?workbench=settings&settingsView=personal&seatOffer=offer-1#seat-offer",
    );
    applySettingsFromUrl(host);
    syncTabWithLocation(host, true);

    expect(host.tab).toBe("enterpriseLogin");
    expect(host.platformAuthSeatOfferId).toBe("offer-1");
    expect(host.workbenchPrimaryModule).toBe("settings");
    expect(host.workbenchSettingsView).toBe("personal");
  });

  it("preserves seatOffer deep-link context when syncing the employee homepage URL", () => {
    const host = createHost("chat");
    host.bootstrapAuthMode = "trusted-proxy";
    host.platformAuthState = {
      enabled: true,
      hasUsers: true,
      allowRegistration: true,
    };
    host.platformAuthSeatOfferId = "offer-1";
    host.workbenchPrimaryModule = "settings";
    host.workbenchSettingsView = "personal";

    window.history.replaceState({}, "", "/");
    setTabFromRoute(host, "me");
    syncTabWithLocation(host, true);

    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toContain("workbench=settings");
    expect(window.location.search).toContain("settingsView=personal");
    expect(window.location.search).toContain("seatOffer=offer-1");
    expect(window.location.hash).toBe("#seat-offer");
  });

  it("leaves /enterprise/login for the enterprise overview when an enterprise admin session is confirmed", () => {
    const host = createHost("enterpriseLogin");
    host.bootstrapAuthMode = "trusted-proxy";
    host.platformAuthNotice = "已登录企业工作台。";
    host.platformAuthState = {
      enabled: true,
      hasUsers: true,
      sessionKind: "enterprise-admin",
      sessionDomain: "enterprise",
      membershipRole: "enterprise-admin",
      session: {
        provider: "trusted-proxy",
        user: "owner@example.com",
        tenantId: "acme",
        role: "operator",
      },
    };

    window.history.replaceState({}, "", "/enterprise/login");
    syncTabWithLocation(host, true);

    expect(host.tab).toBe("enterpriseOverview");
    expect(window.location.pathname).toBe("/enterprise/acme/overview");
    expect(host.platformAuthNotice).toBe("已登录企业工作台。");
  });

  it("lands an enterprise admin on /enterprise/login even when sessionDomain was dropped", () => {
    const host = createHost("me");
    host.bootstrapAuthMode = "trusted-proxy";
    host.platformAuthState = {
      enabled: true,
      hasUsers: true,
      sessionKind: "enterprise-admin",
      membershipRole: "enterprise-admin",
      session: {
        provider: "trusted-proxy",
        user: "owner@example.com",
        tenantId: "acme",
        role: "operator",
      },
    };

    window.history.replaceState({}, "", "/ui/enterprise/login");
    host.basePath = "/ui";
    syncTabWithLocation(host, true);

    expect(host.tab).toBe("enterpriseOverview");
    expect(window.location.pathname).toBe("/ui/enterprise/acme/overview");
  });

  it("clears a stale enterprise login success notice when the visitor is not an enterprise admin", () => {
    const host = createHost("chat");
    host.bootstrapAuthMode = "trusted-proxy";
    host.platformAuthNotice = "已登录企业工作台。";
    host.platformAuthState = {
      enabled: true,
      hasUsers: true,
      sessionKind: "member",
      membershipRole: "enterprise-admin",
      sessionDomain: "employee",
      session: {
        provider: "trusted-proxy",
        user: "member@example.com",
        tenantId: "acme",
        role: "operator",
      },
    };

    window.history.replaceState({}, "", "/enterprise/login");
    onPopState(host);

    expect(host.tab).toBe("enterpriseLogin");
    expect(window.location.pathname).toBe("/enterprise/login");
    expect(host.platformAuthNotice).toBeNull();
  });

  it("keeps an unrelated enterprise login notice when the visitor is not authenticated", () => {
    const host = createHost("chat");
    host.platformAuthNotice = "重置验证码已发送。";
    host.platformAuthState = {
      enabled: true,
      hasUsers: true,
      allowRegistration: true,
    };

    window.history.replaceState({}, "", "/enterprise/login");
    syncTabWithLocation(host, true);

    expect(host.tab).toBe("enterpriseLogin");
    expect(host.platformAuthNotice).toBe("重置验证码已发送。");
  });

  it("keeps the dedicated platform login route reachable before authentication", () => {
    const host = createHost("chat");
    host.bootstrapAuthMode = "trusted-proxy";
    host.platformAuthState = {
      enabled: true,
      hasUsers: true,
      allowRegistration: true,
    };

    window.history.replaceState({}, "", "/platform/login");
    syncTabWithLocation(host, true);

    expect(host.tab).toBe("platformLogin");
    expect(window.location.pathname).toBe("/platform/login");
  });

  it("redirects the root path to the platform dashboard when a platform admin session exists", () => {
    const host = createHost("me");
    host.bootstrapAuthMode = "trusted-proxy";
    host.platformAuthState = {
      enabled: true,
      hasUsers: true,
      hasPlatformAdmins: true,
      sessionKind: "platform-super-admin",
      session: {
        provider: "trusted-proxy",
        user: "ops@example.com",
        role: "operator",
      },
    };

    window.history.replaceState({}, "", "/");
    syncTabWithLocation(host, true);

    expect(host.tab).toBe("platformDashboard");
    expect(window.location.pathname).toBe("/platform");
  });

  it("keeps the bare public root on the marketing homepage even with a platform session", () => {
    const host = createHost("me");
    host.bootstrapAuthMode = "trusted-proxy";
    host.platformAuthState = {
      enabled: true,
      hasUsers: true,
      hasPlatformAdmins: true,
      sessionKind: "platform-super-admin",
      session: {
        provider: "trusted-proxy",
        user: "ops@example.com",
        role: "operator",
      },
    };
    shouldUsePublicHomepageForCurrentLocationMock.mockReturnValue(true);

    window.history.replaceState({}, "", "/");
    syncTabWithLocation(host, true);

    expect(host.tab).toBe("me");
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("");
  });

  it("redirects the root path to the enterprise overview when an enterprise admin session exists", () => {
    const host = createHost("me");
    host.bootstrapAuthMode = "trusted-proxy";
    host.platformAuthState = {
      enabled: true,
      hasUsers: true,
      hasPlatformAdmins: true,
      sessionKind: "enterprise-admin",
      session: {
        provider: "trusted-proxy",
        user: "owner@example.com",
        tenantId: "acme",
        role: "operator",
      },
    };

    window.history.replaceState({}, "", "/");
    syncTabWithLocation(host, true);

    expect(host.tab).toBe("enterpriseOverview");
    expect(window.location.pathname).toBe("/enterprise/acme/overview");
  });

  it("keeps the employee workbench on a root refresh when an employee session is active", () => {
    const host = createHost("me");
    host.bootstrapAuthMode = "trusted-proxy";
    host.platformAuthState = {
      enabled: true,
      hasUsers: true,
      hasPlatformAdmins: true,
      sessionKind: "enterprise-admin",
      session: {
        provider: "trusted-proxy",
        user: "owner@example.com",
        tenantId: "acme",
        role: "operator",
      },
    };

    // An active employee session in the URL must not bounce an enterprise-admin to
    // the enterprise console on refresh — they are working inside the employee side.
    window.history.replaceState({}, "", "/?session=agent%3Abot-skill%3Amain");
    syncTabWithLocation(host, true);

    expect(host.tab).toBe("me");
  });

  it("preserves enterprise cost budget sub-route on popstate", () => {
    const host = createHost("enterpriseUsage");
    host.settings = {
      ...host.settings,
      recentEnterpriseTenantIds: ["acme"],
    };
    window.history.pushState({}, "", "/enterprise/acme/usage/subscription");
    onPopState(host);
    expect(window.location.pathname).toBe("/enterprise/acme/usage/subscription");
  });

  it("preserves platform advanced sub-route hash on popstate", () => {
    const host = createHost("platformAdvanced");
    window.history.pushState({}, "", "/platform/advanced#platform-advanced:devices");
    onPopState(host);
    expect(window.location.hash).toBe("#platform-advanced:devices");
  });

  it("preserves platform pricing plan detail sub-route on popstate", () => {
    const host = createHost("platformPricing");
    window.history.pushState({}, "", "/platform/pricing/plan-pro?mode=edit&tab=models");
    onPopState(host);
    expect(window.location.pathname).toBe("/platform/pricing/plan-pro");
  });

  it("preserves platform tenants sub-route on popstate", () => {
    const host = createHost("platformTenants");
    window.history.pushState({}, "", "/platform/tenants/tenant-42");
    onPopState(host);
    expect(window.location.pathname).toBe("/platform/tenants/tenant-42");
  });

  it("preserves platform pricing query tab on popstate", () => {
    const host = createHost("platformPricing");
    window.history.pushState({}, "", "/platform/pricing?tab=economics&mode=preview");
    onPopState(host);
    expect(window.location.pathname).toBe("/platform/pricing");
    expect(window.location.search).toContain("tab=economics");
    expect(window.location.search).toContain("mode=preview");
  });

  it("sends biz public home with an employee session query to www instead of painting it", () => {
    const replace = vi.fn();
    const original = window.location;
    const session = "?session=agent%3Amain%3Aemployee%3A90fed19a-1c8b-4420-87e0-bcc6165e32fa";
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        host: "biz.openbot.love",
        hostname: "biz.openbot.love",
        href: `https://biz.openbot.love/${session}`,
        origin: "https://biz.openbot.love",
        protocol: "https:",
        pathname: "/",
        search: session,
        hash: "",
        replace,
      },
    });
    const host = createHost("enterpriseOverview");
    host.sessionKey = "agent:main:employee:90fed19a-1c8b-4420-87e0-bcc6165e32fa";

    onPopState(host);
    expect(replace).toHaveBeenCalledWith("https://www.openbot.love/");
    expect(host.tab).toBe("enterpriseOverview");

    replace.mockClear();
    syncUrlWithTab(host, "me", true);
    expect(replace).toHaveBeenCalledWith("https://www.openbot.love/");
    expect(host.tab).toBe("enterpriseOverview");

    Object.defineProperty(window, "location", { configurable: true, value: original });
  });
});
