import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function setTestLocation(params: { protocol: string; host: string; pathname: string }) {
  if (typeof window !== "undefined" && window.history?.replaceState) {
    window.history.replaceState({}, "", params.pathname);
    return;
  }
  vi.stubGlobal("location", {
    protocol: params.protocol,
    host: params.host,
    pathname: params.pathname,
  } as Location);
}

function setControlUiBasePath(value: string | undefined) {
  if (typeof window === "undefined") {
    vi.stubGlobal(
      "window",
      value == null
        ? ({} as Window & typeof globalThis)
        : ({ __OPENBOT_CONTROL_UI_BASE_PATH__: value } as Window & typeof globalThis),
    );
    return;
  }
  if (value == null) {
    delete window.__OPENBOT_CONTROL_UI_BASE_PATH__;
    return;
  }
  Object.defineProperty(window, "__OPENBOT_CONTROL_UI_BASE_PATH__", {
    value,
    writable: true,
    configurable: true,
  });
}

function expectedGatewayUrl(basePath: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${basePath}`;
}

describe("loadSettings default gateway URL derivation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("sessionStorage", createStorageMock());
    vi.stubGlobal("navigator", { language: "en-US" } as Navigator);
    localStorage.clear();
    sessionStorage.clear();
    setControlUiBasePath(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setControlUiBasePath(undefined);
    vi.unstubAllGlobals();
  });

  it("uses configured base path and normalizes trailing slash", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/ignored/path",
    });
    setControlUiBasePath(" /openclaw/ ");

    const { loadSettings } = await import("./storage.ts");
    expect(loadSettings().gatewayUrl).toBe(expectedGatewayUrl("/openclaw"));
  });

  it("infers base path from nested pathname when configured base path is not set", async () => {
    setTestLocation({
      protocol: "http:",
      host: "gateway.example:18789",
      pathname: "/apps/openclaw/chat",
    });

    const { loadSettings } = await import("./storage.ts");
    expect(loadSettings().gatewayUrl).toBe(expectedGatewayUrl("/apps/openclaw"));
  });

  it("ignores legacy settings and tokens", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });
    sessionStorage.setItem("openclaw.control.token.v1", "legacy-session-token");
    localStorage.setItem(
      "openclaw.control.settings.v1",
      JSON.stringify({
        gatewayUrl: "wss://gateway.example:8443/openclaw",
        token: "persisted-token",
        sessionKey: "agent",
      }),
    );

    const { loadSettings } = await import("./storage.ts");
    expect(loadSettings()).toMatchObject({
      gatewayUrl: "wss://gateway.example:8443",
      token: "",
      sessionKey: "main",
    });
    expect(localStorage.getItem("openbot.control.settings.v1")).toBeNull();
    expect(localStorage.getItem("openclaw.control.settings.v1")).not.toBeNull();
    expect(sessionStorage.getItem("openclaw.control.token.v1")).toBe("legacy-session-token");
  });

  it("loads the current-tab token from sessionStorage", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });

    const { loadSettings, saveSettings } = await import("./storage.ts");
    saveSettings({
      gatewayUrl: "wss://gateway.example:8443/openclaw",
      token: "session-token",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      sessionSeenAt: { main: 1 },
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    });

    expect(loadSettings()).toMatchObject({
      gatewayUrl: "wss://gateway.example:8443/openclaw",
      token: "session-token",
      navGroupsCollapsed: {
        frontstage: false,
        console: true,
      },
    });
  });

  it("defaults the public openbot.love host to zh-CN locale", async () => {
    setTestLocation({
      protocol: "https:",
      host: "www.openbot.love",
      pathname: "/",
    });

    const { loadSettings } = await import("./storage.ts");
    expect(loadSettings().locale).toBe("zh-CN");
  });

  it("preserves an explicitly saved locale even on the public openbot.love host", async () => {
    setTestLocation({
      protocol: "https:",
      host: "www.openbot.love",
      pathname: "/",
    });
    localStorage.setItem(
      "openbot.control.settings.v1",
      JSON.stringify({
        gatewayUrl: "wss://www.openbot.love",
        sessionKey: "main",
        lastActiveSessionKey: "main",
        sessionSeenAt: { main: 1 },
        theme: "system",
        chatFocusMode: false,
        chatShowThinking: true,
        splitRatio: 0.6,
        navCollapsed: true,
        navCompactLayoutApplied: true,
        navGroupsCollapsed: {
          frontstage: false,
          console: true,
        },
        locale: "en",
        localePinnedByUser: true,
      }),
    );

    const { loadSettings } = await import("./storage.ts");
    expect(loadSettings().locale).toBe("en");
  });

  it("replaces a stale public-home gateway URL when opening a port subdomain", async () => {
    setTestLocation({
      protocol: "https:",
      host: "biz.openbot.love",
      pathname: "/enterprise/organization",
    });
    localStorage.setItem(
      "openbot.control.settings.v1",
      JSON.stringify({
        gatewayUrl: "wss://www.openbot.love",
        sessionKey: "main",
        lastActiveSessionKey: "main",
        sessionSeenAt: { main: 1 },
        theme: "system",
        chatFocusMode: false,
        chatShowThinking: true,
        splitRatio: 0.6,
        navCollapsed: true,
        navCompactLayoutApplied: true,
        navGroupsCollapsed: {
          frontstage: false,
          console: true,
        },
      }),
    );

    const { loadSettings } = await import("./storage.ts");
    expect(loadSettings().gatewayUrl).toBe("wss://biz.openbot.love");
  });

  it("does not reuse a session token for a different gatewayUrl", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });

    const { loadSettings, saveSettings } = await import("./storage.ts");
    saveSettings({
      gatewayUrl: "wss://gateway.example:8443/openclaw",
      token: "gateway-a-token",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      sessionSeenAt: { main: 1 },
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    });

    localStorage.setItem(
      "openbot.control.settings.v1",
      JSON.stringify({
        gatewayUrl: "wss://other-gateway.example:8443/openclaw",
        sessionKey: "main",
        lastActiveSessionKey: "main",
        sessionSeenAt: { main: 1 },
        workspaceTeamObjects: {},
        workspaceTeamOrder: [],
        theme: "system",
        chatFocusMode: false,
        chatShowThinking: true,
        splitRatio: 0.6,
        navCollapsed: false,
        navGroupsCollapsed: {},
      }),
    );

    expect(loadSettings()).toMatchObject({
      gatewayUrl: "wss://other-gateway.example:8443/openclaw",
      token: "",
      navGroupsCollapsed: {
        frontstage: false,
        console: true,
      },
    });
  });

  it("does not persist gateway tokens when saving settings", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });

    const { loadSettings, saveSettings } = await import("./storage.ts");
    saveSettings({
      gatewayUrl: "wss://gateway.example:8443/openclaw",
      token: "memory-only-token",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      sessionSeenAt: { main: 1 },
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    });
    expect(loadSettings()).toMatchObject({
      gatewayUrl: "wss://gateway.example:8443/openclaw",
      token: "memory-only-token",
      navCollapsed: true,
      navGroupsCollapsed: {
        frontstage: false,
        console: true,
      },
    });

    expect(JSON.parse(localStorage.getItem("openbot.control.settings.v1") ?? "{}")).toEqual({
      gatewayUrl: "wss://gateway.example:8443/openclaw",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      sessionSeenAt: { main: 1 },
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: true,
      navCompactLayoutApplied: true,
      navGroupsCollapsed: {
        frontstage: false,
        console: true,
      },
    });
    expect(sessionStorage.length).toBe(1);
  });

  it("clears the current-tab token when saving an empty token", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });

    const { loadSettings, saveSettings } = await import("./storage.ts");
    saveSettings({
      gatewayUrl: "wss://gateway.example:8443/openclaw",
      token: "stale-token",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      sessionSeenAt: { main: 1 },
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    });
    saveSettings({
      gatewayUrl: "wss://gateway.example:8443/openclaw",
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
    });

    expect(loadSettings().token).toBe("");
    expect(sessionStorage.length).toBe(0);
  });

  it("merges new nav group defaults into older saved settings", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });
    localStorage.setItem(
      "openbot.control.settings.v1",
      JSON.stringify({
        gatewayUrl: "wss://gateway.example:8443/openclaw",
        navGroupsCollapsed: { frontstage: true },
      }),
    );

    const { loadSettings } = await import("./storage.ts");
    expect(loadSettings().navGroupsCollapsed).toEqual({
      frontstage: true,
      console: true,
    });
  });

  it("drops deprecated team metadata when loading settings", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });
    localStorage.setItem(
      "openbot.control.settings.v1",
      JSON.stringify({
        gatewayUrl: "wss://gateway.example:8443/openclaw",
        workspaceTeamObjects: {
          squad: {
            key: "squad",
            kind: "space",
            createdAt: 1,
            updatedAt: 2,
          },
        },
        workspaceTeamOrder: ["squad"],
      }),
    );

    const { loadSettings } = await import("./storage.ts");
    expect(loadSettings()).toMatchObject({
      gatewayUrl: "wss://gateway.example:8443/openclaw",
    });
    expect(JSON.parse(localStorage.getItem("openbot.control.settings.v1") ?? "{}")).toEqual({
      gatewayUrl: "wss://gateway.example:8443/openclaw",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      sessionSeenAt: expect.any(Object),
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: true,
      navCompactLayoutApplied: true,
      navGroupsCollapsed: {
        frontstage: false,
        console: true,
      },
    });
  });

  it("scrubs deprecated workbench team metadata keys from saved settings", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });
    localStorage.setItem(
      "openbot.control.settings.v1",
      JSON.stringify({
        gatewayUrl: "wss://gateway.example:8443/openclaw",
        workbenchTeamObjects: {
          squad: {
            key: "squad",
            kind: "space",
            createdAt: 1,
            updatedAt: 2,
          },
        },
        workbenchTeamOrder: ["squad"],
      }),
    );

    const { loadSettings } = await import("./storage.ts");
    expect(loadSettings()).toMatchObject({
      gatewayUrl: "wss://gateway.example:8443/openclaw",
    });
    expect(localStorage.getItem("openbot.control.settings.v1") ?? "").not.toContain(
      "workbenchTeamObjects",
    );
    expect(localStorage.getItem("openbot.control.settings.v1") ?? "").not.toContain(
      "workbenchTeamOrder",
    );
  });

  it("persists custom brand logos without leaking gateway tokens", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });

    const { loadSettings, saveSettings } = await import("./storage.ts");
    saveSettings({
      gatewayUrl: "wss://gateway.example:8443/openclaw",
      token: "memory-only-token",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      sessionSeenAt: { main: 1 },
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
      customBrandLogoDataUrl: "data:image/png;base64,AAAA",
    });

    expect(loadSettings().customBrandLogoDataUrl).toBe("data:image/png;base64,AAAA");
    expect(JSON.parse(localStorage.getItem("openbot.control.settings.v1") ?? "{}")).toMatchObject({
      customBrandLogoDataUrl: "data:image/png;base64,AAAA",
    });
    expect(
      JSON.parse(localStorage.getItem("openbot.control.settings.v1") ?? "{}").token,
    ).toBeUndefined();
  });

  it("round-trips personal workbench preferences without leaking auth", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });

    const { loadSettings, saveSettings } = await import("./storage.ts");
    saveSettings({
      gatewayUrl: "wss://gateway.example:8443/openclaw",
      token: "memory-only-token",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      sessionSeenAt: { main: 1 },
      theme: "system",
      chatFocusMode: true,
      chatShowThinking: false,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
      workbenchProfileName: "Daniel",
      workbenchProfileNote: "APAC owner",
    });

    expect(loadSettings()).toMatchObject({
      workbenchProfileName: "Daniel",
      workbenchProfileNote: "APAC owner",
      chatFocusMode: true,
      chatShowThinking: false,
      token: "memory-only-token",
    });
    expect(JSON.parse(localStorage.getItem("openbot.control.settings.v1") ?? "{}")).toMatchObject({
      workbenchProfileName: "Daniel",
      workbenchProfileNote: "APAC owner",
      chatFocusMode: true,
      chatShowThinking: false,
    });
    expect(
      JSON.parse(localStorage.getItem("openbot.control.settings.v1") ?? "{}").token,
    ).toBeUndefined();
  });

  it("drops invalid custom brand logo payloads when loading settings", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });
    localStorage.setItem(
      "openbot.control.settings.v1",
      JSON.stringify({
        gatewayUrl: "wss://gateway.example:8443/openclaw",
        customBrandLogoDataUrl: "javascript:alert(1)",
      }),
    );

    const { loadSettings } = await import("./storage.ts");
    expect(loadSettings().customBrandLogoDataUrl).toBeUndefined();
  });
});
