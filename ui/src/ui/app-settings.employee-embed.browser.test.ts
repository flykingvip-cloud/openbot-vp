import { afterEach, describe, expect, it, vi } from "vitest";
import { syncTabWithLocation, type SettingsHost } from "./app-settings.ts";
import type { Tab } from "./navigation.ts";

type EmbedRouteHost = SettingsHost & {
  logsPollInterval: number | null;
  debugPollInterval: number | null;
};

const createHost = (tab: Tab): EmbedRouteHost => ({
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

const hasClass = (name: string) => document.documentElement.classList.contains(name);

afterEach(() => {
  window.history.replaceState({}, "", "/");
  document.documentElement.classList.remove("employee-embed", "employee-embed--mobile");
});

describe("syncTabWithLocation — employee embed routes", () => {
  it("routes /embed/employee/workspace to the workbench collaboration module, chrome-less", () => {
    window.history.replaceState({}, "", "/embed/employee/workspace");
    const host = createHost("chat");

    syncTabWithLocation(host, true);

    expect(host.tab).toBe("me");
    expect(host.workbenchPrimaryModule).toBe("collaboration");
    expect(hasClass("employee-embed")).toBe(true);
    // No phone marker -> not the mobile shell.
    expect(hasClass("employee-embed--mobile")).toBe(false);
  });

  it("applies ?session= so app and web open the same conversation store", () => {
    window.history.replaceState({}, "", "/embed/employee/overview?session=agent:bot-2:main");
    const host = createHost("chat");

    syncTabWithLocation(host, true);

    expect(host.sessionKey).toBe("agent:bot-2:main");
    expect(host.workbenchTeamSelectedKey).toBe("agent:bot-2:main");
    expect(host.settings.sessionKey).toBe("agent:bot-2:main");
    expect(host.workbenchPrimaryModule).toBe("assistant");
  });

  it("maps leftover ?spaceId= onto the canonical space session store", () => {
    window.history.replaceState({}, "", "/embed/employee/workspace?spaceId=grp-1");
    const host = createHost("chat");

    syncTabWithLocation(host, true);

    expect(host.sessionKey).toBe("space:grp-1");
    expect(host.workbenchTeamSelectedKey).toBe("space:grp-1");
    expect(host.settings.sessionKey).toBe("space:grp-1");
    expect(host.workbenchPrimaryModule).toBe("collaboration");
  });

  it("canonicalizes leftover mirror session query onto space:<groupId>", () => {
    window.history.replaceState(
      {},
      "",
      "/embed/employee/workspace?session=agent:panda:main:space:grp-1",
    );
    const host = createHost("chat");

    syncTabWithLocation(host, true);

    expect(host.sessionKey).toBe("space:grp-1");
    expect(host.settings.sessionKey).toBe("space:grp-1");
  });

  it("maps the overview surface to the workbench home module", () => {
    window.history.replaceState({}, "", "/embed/employee/overview");
    const host = createHost("chat");

    syncTabWithLocation(host, true);

    expect(host.tab).toBe("me");
    expect(host.workbenchPrimaryModule).toBe("assistant");
    expect(hasClass("employee-embed")).toBe(true);
  });

  it("adds the mobile marker class only for the ?shell=mobile phone shell", () => {
    window.history.replaceState({}, "", "/embed/employee/overview?shell=mobile");
    const host = createHost("chat");

    syncTabWithLocation(host, true);

    expect(hasClass("employee-embed")).toBe(true);
    expect(hasClass("employee-embed--mobile")).toBe(true);
  });

  it("pins me -> personal settings on the PHONE shell (?shell=mobile)", () => {
    window.history.replaceState({}, "", "/embed/employee/me?shell=mobile");
    const host = createHost("chat");

    syncTabWithLocation(host, true);

    expect(host.tab).toBe("me");
    expect(host.workbenchPrimaryModule).toBe("settings");
    expect(host.workbenchSettingsView).toBe("personal");
    expect(hasClass("employee-embed--mobile")).toBe(true);
  });

  it("keeps macOS embed at full parity: me does NOT force personal, no mobile class", () => {
    window.history.replaceState({}, "", "/embed/employee/me");
    const host = createHost("chat");

    syncTabWithLocation(host, true);

    expect(host.tab).toBe("me");
    expect(host.workbenchPrimaryModule).toBe("settings");
    // System settings remains reachable (settingsView untouched) on the macOS embed.
    expect(host.workbenchSettingsView).toBeUndefined();
    expect(hasClass("employee-embed")).toBe(true);
    expect(hasClass("employee-embed--mobile")).toBe(false);
  });

  it("clears the embed chrome flags when navigating to a normal route", () => {
    document.documentElement.classList.add("employee-embed", "employee-embed--mobile");
    window.history.replaceState({}, "", "/me");
    const host = createHost("chat");

    syncTabWithLocation(host, true);

    expect(hasClass("employee-embed")).toBe(false);
    expect(hasClass("employee-embed--mobile")).toBe(false);
  });
});
