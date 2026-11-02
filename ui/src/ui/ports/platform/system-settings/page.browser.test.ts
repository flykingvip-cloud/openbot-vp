// @vitest-environment jsdom

import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetDevicePlatformConnectionPanelForTests,
  setDevicePlatformAdminClientForTests,
  type DevicePlatformAdminClient,
  type DevicePlatformConnectionView,
} from "../device-platform/page.ts";
import type { PlatformSurfaceProps } from "../shared/surface.ts";
import { renderPlatformSurface } from "../views/platform-surfaces.ts";
import { renderPlatformSystemSettingsSurface } from "./page.ts";

const INVITE_CODE = "INVITE-SECRET-9F3A";

function createProps(): PlatformSurfaceProps {
  return {
    tab: "platformSystemSettings",
    basePath: "",
    readModel: {
      currentTenantId: "tenant-a",
      currentTenantLabel: "Tenant A",
      knownTenantIds: ["tenant-a"],
      tenantDirectory: [],
      enterpriseDirectory: [],
      agentDirectory: [],
      modelDirectory: [],
      gatewayCatalogModels: [],
      taskPlanDirectory: [],
      routingPolicyDirectory: [],
      gatewayCatalogCount: 0,
      defaultModelPrimary: "openai/gpt",
      defaultModelFallbacks: [],
      defaultImageModelPrimary: null,
      allowlistedModelRefs: [],
      allowlistEntries: [],
      aliasCount: 0,
      providerHealthDirectory: [],
      agentCount: 0,
      featureMethodCount: 0,
      channelCount: 0,
      channelIds: [],
      accountCount: 0,
      connectedAccountCount: 0,
      presenceCount: 0,
      runtimeHosts: [],
      sessionsCount: 0,
      totalTokens: 0,
      totalCost: 0,
      missingCostEntries: 0,
      currentUsageOverview: {
        sessionCount: 0,
        totalTokens: 0,
        totalCost: 0,
        totalMessages: 0,
        errorCount: 0,
        errorRate: 0,
        avgLatencyMs: null,
        peakErrorDayLabel: null,
        topModelLabel: null,
        topAgentId: null,
        activeAgentCount: 0,
        activeChannelCount: 0,
        dailyCalls: [],
        dailyCost: [],
        updatedAt: null,
      },
      modelMode: "merge",
      configuredProviderCount: 0,
      providerIds: [],
      configuredModelCount: 1,
      configuredModelIds: ["openai/gpt"],
      installedCapabilityCount: 0,
      attentionItems: [],
      currentVersion: "2026.3.9",
      latestVersion: "2026.3.9",
      hasUpdateAvailable: false,
      cronEnabled: null,
      cronNextAt: null,
      operatorUser: "ops@example.com",
      operatorRole: "super_admin",
      latestInvite: {
        code: INVITE_CODE,
        expiresAt: "2026-12-01",
        tenantId: "tenant-a",
        tenantName: "华东运营中心",
      },
      runtimeAgents: [],
      runtimeBindings: [],
      runtimeTelemetry: [],
      runtimeGovernanceIssues: [],
      platformModelsMode: "native",
      configIssueCount: 4,
      pendingOfferCount: 2,
    } as never,
    channelsProps: { configFormDirty: true, configSaving: false } as never,
    authPanelProps: {
      mode: "platform-admin-login",
      busy: false,
      error: null,
      notice: null,
      email: "",
      password: "",
      displayName: "",
      platformAdminDisplayName: "",
      platformAdminEmail: "",
      platformAdminPassword: "",
      platformAdminScopes: [],
      tenantName: "",
      inviteCode: "",
      state: {
        enabled: true,
        canManagePlatform: true,
        canManagePlatformAdmins: true,
        platformRole: "super-admin",
        requireMfaForPlatformAdmins: true,
        platformAdmins: [],
        availableModes: ["platform-admin-login"],
      },
      onSetMfaPolicy: vi.fn(),
      onCreatePlatformAdmin: vi.fn(),
      onRemovePlatformAdmin: vi.fn(),
    } as never,
    actions: {
      dashboard: { onRefresh: vi.fn() },
      tenants: { onRefresh: vi.fn() },
      systemSettings: {
        onRefresh: vi.fn(),
        onSaveConfig: vi.fn(),
        onSetPlatformModelsMode: vi.fn(),
      },
    } as never,
  };
}

function mount(hash: string) {
  const container = document.createElement("div");
  document.body.append(container);
  window.history.replaceState({}, "", `/platform/system-settings${hash}`);
  const props = createProps();
  const doRender = () => render(renderPlatformSystemSettingsSurface(props), container);
  const appHost = document.createElement("openbot-app") as HTMLElement & {
    requestUpdate: () => void;
  };
  appHost.requestUpdate = () => doRender();
  document.body.append(appHost);
  doRender();
  return { container, props };
}

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  setDevicePlatformAdminClientForTests(null);
  resetDevicePlatformConnectionPanelForTests();
  vi.restoreAllMocks();
});

describe("renderPlatformSystemSettingsSurface", () => {
  it("switches hash tabs without a synthetic popstate refresh", () => {
    const popSpy = vi.fn();
    window.addEventListener("popstate", popSpy);
    try {
      const { container } = mount("#platform-system-settings:admins");
      const defaults = [...container.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "默认策略",
      );
      defaults?.click();
      expect(popSpy).not.toHaveBeenCalled();
      expect(window.location.hash).toBe("#platform-system-settings:defaults");
      expect(container.textContent).toContain("租户创建默认策略");
      expect(container.textContent).not.toContain("平台策略");
    } finally {
      window.removeEventListener("popstate", popSpy);
    }
  });

  it("does not render the latest invite code on the security tab", () => {
    const { container } = mount("#platform-system-settings:security");
    const text = container.textContent ?? "";
    expect(text).toContain("激活码已签发");
    expect(text).toContain("华东运营中心");
    expect(text).toContain("到期 2026-12-01");
    expect(text).not.toContain(INVITE_CODE);
  });

  it("asks before disabling forced MFA", () => {
    const { container, props } = mount("#platform-system-settings:security");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const disable = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "关闭强制 MFA",
    );
    disable?.click();
    expect(confirm).toHaveBeenCalled();
    expect(props.authPanelProps?.onSetMfaPolicy).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    disable?.click();
    expect(props.authPanelProps?.onSetMfaPolicy).toHaveBeenCalledWith(false);
  });

  it("refreshes system settings from the surface header", async () => {
    const props = createProps();
    const container = document.createElement("div");
    document.body.append(container);
    render(renderPlatformSurface(props), container);
    const refresh = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("刷新数据"),
    );
    refresh?.click();
    await vi.waitFor(() => {
      expect(props.actions.systemSettings.onRefresh).toHaveBeenCalled();
    });
    expect(props.actions.dashboard.onRefresh).not.toHaveBeenCalled();
  });

  it("keeps the add-admin form compact and above the admin list", () => {
    const { container } = mount("#platform-system-settings:admins");
    const text = container.textContent ?? "";
    expect(text).toContain("添加管理员");
    expect(text).toContain("请把初始密码告知对方。对方用该邮箱和密码登录；创建时不发送邮件。");
    expect(text).toContain("平台管理员");
    expect(text.indexOf("添加管理员")).toBeLessThan(text.indexOf("暂无管理员"));
    expect(container.querySelector(".platform-admin-form-grid")).not.toBeNull();
    expect(container.querySelector(".platform-admin-scope-summary")).not.toBeNull();
    const create = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "创建",
    );
    expect(create).toBeTruthy();
    expect(create?.hasAttribute("disabled")).toBe(true);
    expect(container.querySelector('.platform-admin-form-grid input[type="email"]')).not.toBeNull();
    expect(
      container.querySelector('.platform-admin-form-grid input[type="password"]'),
    ).not.toBeNull();
  });

  it("creates with full scopes for the admin preset and removes via platform admin API", async () => {
    const props = createProps();
    const onCreate = vi.fn();
    const onRemove = vi.fn();
    const onScopes = vi.fn((next: string[]) => {
      (props.authPanelProps as { platformAdminScopes: string[] }).platformAdminScopes = next;
    });
    Object.assign(props.authPanelProps!, {
      platformAdminEmail: "ops@example.com",
      platformAdminPassword: "password-123",
      platformAdminScopes: [],
      onPlatformAdminEmailChange: vi.fn(),
      onPlatformAdminPasswordChange: vi.fn(),
      onPlatformAdminDisplayNameChange: vi.fn(),
      onPlatformAdminScopesChange: onScopes,
      onCreatePlatformAdmin: onCreate,
      onRemovePlatformAdmin: onRemove,
      state: {
        ...props.authPanelProps!.state,
        platformAdmins: [
          {
            user: "root@example.com",
            displayName: "Root",
            platformRole: "super-admin",
            status: "active",
            scopes: ["operator.admin"],
            isCurrentUser: true,
          },
          {
            user: "ops@example.com",
            displayName: "Ops",
            platformRole: "admin",
            status: "active",
            scopes: ["operator.read"],
          },
        ],
      },
    });
    const container = document.createElement("div");
    document.body.append(container);
    window.history.replaceState(
      {},
      "",
      "/platform/system-settings#platform-system-settings:admins",
    );
    const doRender = () => render(renderPlatformSystemSettingsSurface(props), container);
    const appHost = document.createElement("openbot-app") as HTMLElement & {
      requestUpdate: () => void;
    };
    appHost.requestUpdate = () => doRender();
    document.body.append(appHost);
    doRender();

    const create = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "创建",
    );
    create?.click();
    expect(onScopes).toHaveBeenCalledWith([
      "operator.admin",
      "operator.read",
      "operator.write",
      "operator.approvals",
      "operator.pairing",
    ]);
    expect(onCreate).toHaveBeenCalled();

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const revoke = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "撤销",
    );
    revoke?.click();
    expect(confirm).toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalledWith("ops@example.com");
  });

  it("device-platform tab click returns to list after add/edit form", async () => {
    const connection: DevicePlatformConnectionView = {
      platformId: "plat-1",
      displayName: "生产设备平台",
      environment: "production",
      serviceBaseUrl: "https://device.example",
      contractVersion: "v1",
      credentialRef: "cred://device-platform/plat-1",
      clientIdentity: "device-platform",
      registrationNotes: "",
      callbackAllowlist: [],
      serviceClientIds: ["device-platform"],
      enabled: true,
      disabledDisposition: "block_new_keep_existing",
      credentialPresent: true,
      health: "unknown",
    };
    const client: DevicePlatformAdminClient = {
      list: async () => [connection],
      save: vi.fn(),
      setCredential: vi.fn(),
      test: vi.fn(),
    };
    setDevicePlatformAdminClientForTests(client);
    resetDevicePlatformConnectionPanelForTests();
    const { container } = mount("#platform-system-settings:device-platform");
    await vi.waitFor(() => {
      expect(container.querySelector("[data-testid='device-platform-list']")).not.toBeNull();
    });
    expect(container.querySelector(".device-platform-admin__eyebrow")).toBeNull();
    expect(container.querySelector(".device-platform-admin__title")).toBeNull();
    (container.querySelector("[data-testid='device-platform-add']") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(container.querySelector("form")).not.toBeNull();
    });
    const tab = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "设备平台连接",
    );
    expect(tab).toBeTruthy();
    tab?.click();
    await vi.waitFor(() => {
      expect(container.querySelector("[data-testid='device-platform-list']")).not.toBeNull();
    });
    expect(container.querySelector("form")).toBeNull();
    expect(window.location.hash).toBe("#platform-system-settings:device-platform");
  });
});
