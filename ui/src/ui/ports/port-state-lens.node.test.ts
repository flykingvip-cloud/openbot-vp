import { describe, expect, it, vi } from "vitest";
import type { UiSettings } from "../storage.ts";
import { adaptEnterprisePortState } from "./enterprise/port-state.ts";
import { adaptPlatformPortState } from "./platform/port-state.ts";

function buildSettings(overrides: Partial<UiSettings> = {}): UiSettings {
  return {
    gatewayUrl: "",
    token: "",
    sessionKey: "main",
    lastActiveSessionKey: "main",
    sessionSeenAt: {},
    theme: "system",
    chatFocusMode: false,
    chatShowThinking: true,
    splitRatio: 0.6,
    navCollapsed: false,
    navGroupsCollapsed: {},
    ...overrides,
  };
}

describe("port state adapters", () => {
  it("exposes a narrowed platform contract while proxying updates to the source state", () => {
    const source = {
      tab: "platformDashboard",
      basePath: "/ui",
      setTab: vi.fn(),
      connected: true,
      channelsLoading: false,
      channelsSnapshot: null,
      channelsError: null,
      channelsLastSuccess: 123,
      whatsappLoginMessage: null,
      whatsappLoginQrDataUrl: null,
      whatsappLoginConnected: false,
      whatsappBusy: false,
      configSchema: null,
      configSchemaLoading: false,
      configForm: null,
      configUiHints: null,
      configSaving: false,
      configFormDirty: false,
      nostrProfileFormState: null,
      nostrProfileAccountId: null,
      presenceLoading: false,
      presenceEntries: [],
      presenceError: null,
      presenceStatus: null,
      hello: null,
      platformAuthState: null,
      bootstrapAuthSession: null,
      settings: buildSettings({ recentEnterpriseTenantIds: [] }),
      agentsList: null,
      sessionsResult: null,
      cronStatus: null,
      updateAvailable: null,
      usageResult: null,
      password: "secret",
    };

    const adapted = adaptPlatformPortState(
      source as unknown as Parameters<typeof adaptPlatformPortState>[0],
    );
    adapted.tab = "platformAdvanced";

    expect(adapted.port).toBe("platform");
    expect(adapted.platformScope).toBe("operations");
    expect(adapted.tab).toBe("platformAdvanced");
    expect(source.tab).toBe("platformAdvanced");
    expect("password" in adapted).toBe(false);
  });

  it("binds enterprise methods to the original source state", () => {
    const source = {
      tab: "enterpriseOverview",
      basePath: "/enterprise",
      setTab(next: string) {
        this.tab = next;
      },
      applySettings(next: UiSettings) {
        this.settings = next;
      },
      settings: buildSettings({ recentEnterpriseTenantIds: ["acme"] }),
      platformAuthState: null,
      platformAuthMode: "login",
      platformAuthBusy: false,
      platformAuthError: null,
      platformAuthNotice: null,
      enterpriseSeatOfferEditorMode: "offer",
      platformAuthEmail: "",
      platformAuthPassword: "",
      platformAuthDisplayName: "",
      platformAuthTenantName: "",
      platformAuthInviteCode: "",
      submitPlatformAuth: vi.fn(),
      logoutPlatformAuth: vi.fn(),
      createPlatformAuthInvite: vi.fn(),
      revokePlatformAuthInvite: vi.fn(),
      removePlatformAuthMember: vi.fn(),
      hello: null,
      bootstrapAuthSession: null,
      presenceLoading: false,
      presenceEntries: [],
      presenceError: null,
      presenceStatus: null,
      agentsList: null,
      channelsSnapshot: null,
      configIssues: [],
      configValid: true,
      cronJobs: [],
      nodes: [],
      sessionsResult: null,
      usageResult: null,
    };

    const adapted = adaptEnterprisePortState(
      source as unknown as Parameters<typeof adaptEnterprisePortState>[0],
    );
    adapted.setTab("enterpriseMesh");
    adapted.applySettings(buildSettings({ recentEnterpriseTenantIds: ["beta"] }));

    expect(source.tab).toBe("enterpriseMesh");
    expect(source.settings.recentEnterpriseTenantIds).toEqual(["beta"]);
    expect(adapted.port).toBe("enterprise");
    expect(adapted.enterpriseSeatOfferEditorMode).toBe("offer");
  });
});
