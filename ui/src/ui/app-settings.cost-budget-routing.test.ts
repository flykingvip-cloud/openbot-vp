/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { onPopState, type SettingsHost } from "./app-settings.ts";
import type { Tab } from "./navigation.ts";

const createHost = (tab: Tab): SettingsHost => ({
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
    recentEnterpriseTenantIds: ["acme"],
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
  syncEnterpriseHandoverRoute: async () => undefined,
});

describe("enterprise cost budget routing", () => {
  it("preserves enterprise cost budget sub-route on popstate", () => {
    const host = createHost("enterpriseUsage");
    window.history.pushState({}, "", "/enterprise/acme/usage/subscription");
    onPopState(host);
    expect(window.location.pathname).toBe("/enterprise/acme/usage/subscription");
  });

  it("preserves cost budget v2 plan-orders sub-route on popstate", () => {
    const host = createHost("enterpriseUsage");
    window.history.pushState({}, "", "/enterprise/acme/usage/plan-orders#plan");
    onPopState(host);
    expect(window.location.pathname).toBe("/enterprise/acme/usage/plan-orders");
    expect(window.location.hash).toBe("#plan");
  });

  it("preserves cost budget v2 settings sub-route on popstate", () => {
    const host = createHost("enterpriseUsage");
    window.history.pushState({}, "", "/enterprise/acme/usage/settings#resources");
    onPopState(host);
    expect(window.location.pathname).toBe("/enterprise/acme/usage/settings");
    expect(window.location.hash).toBe("#resources");
  });
});

describe("enterprise settings sub-section routing", () => {
  it("preserves the settings sub-section (identities) on popstate", () => {
    const host = createHost("enterpriseSettings");
    window.history.pushState({}, "", "/enterprise/acme/settings/identities");
    onPopState(host);
    expect(window.location.pathname).toBe("/enterprise/acme/settings/identities");
  });

  it("still canonicalizes the bare settings tab path", () => {
    const host = createHost("enterpriseSettings");
    window.history.pushState({}, "", "/enterprise/acme/settings");
    onPopState(host);
    expect(window.location.pathname).toBe("/enterprise/acme/settings");
  });
});
