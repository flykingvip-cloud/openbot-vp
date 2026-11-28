// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { renderEnterprisePortShell } from "./enterprise/views/enterprise-shell.ts";
import { closePlatformCreateTenantDrawer } from "./platform/system-settings/create-tenant-drawer.ts";
import { renderPlatformPortShell } from "./platform/views/platform-shell.ts";

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
  closePlatformCreateTenantDrawer();
});

function noop() {
  return undefined;
}

function createPlatformChannelsProps() {
  return {
    connected: true,
    loading: false,
    snapshot: {
      channelMeta: [
        { id: "slack", label: "Slack" },
        { id: "telegram", label: "Telegram" },
      ],
      channelOrder: ["slack", "telegram"],
      channelLabels: { slack: "Slack", telegram: "Telegram" },
      channelAccounts: {},
      channels: {
        slack: { configured: true, running: true, connected: true },
        telegram: { configured: true, running: true, connected: true },
      },
    },
    lastError: null,
    lastSuccessAt: Date.now(),
    whatsappMessage: null,
    whatsappQrDataUrl: null,
    whatsappConnected: null,
    whatsappBusy: false,
    configSchema: null,
    configSchemaLoading: false,
    configForm: {},
    configUiHints: {},
    configSaving: false,
    configFormDirty: false,
    nostrProfileFormState: null,
    nostrProfileAccountId: null,
    onRefresh: noop,
    onWhatsAppStart: noop,
    onWhatsAppWait: noop,
    onWhatsAppLogout: noop,
    onConfigPatch: noop,
    onConfigSave: noop,
    onConfigReload: noop,
    onNostrProfileEdit: noop,
    onNostrProfileCancel: noop,
    onNostrProfileFieldChange: noop,
    onNostrProfileSave: noop,
    onNostrProfileImport: noop,
    onNostrProfileToggleAdvanced: noop,
  };
}

describe("port shell integration", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  it("renders platform dashboard as overview, health, cost, and attention workspaces", () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderPlatformPortShell({
        state: { tab: "platformDashboard" },
        subnavProps: {
          tabs: ["platformDashboard", "platformCapabilities"],
          activeTab: "platformDashboard",
          basePath: "",
          onOpenConsoleTab: noop,
        },
        channelsProps: createPlatformChannelsProps(),
        readModel: {
          currentTenantId: "acme",
          currentTenantLabel: "Acme",
          knownTenantIds: ["acme", "beta"],
          tenantDirectory: [
            { tenantId: "acme", label: "Acme" },
            { tenantId: "beta", label: "Beta" },
          ],
          enterpriseDirectory: [],
          agentCount: 3,
          featureMethodCount: 12,
          channelCount: 2,
          channelIds: ["slack", "telegram"],
          accountCount: 4,
          connectedAccountCount: 3,
          presenceCount: 2,
          runtimeHosts: ["runtime-a", "runtime-b"],
          sessionsCount: 5,
          totalTokens: 1200,
          totalCost: 8.5,
          missingCostEntries: 1,
          modelMode: "pool",
          configuredProviderCount: 2,
          providerIds: ["openai", "anthropic"],
          configuredModelCount: 3,
          configuredModelIds: ["gpt-5.4", "gpt-5.4-mini"],
          installedCapabilityCount: 4,
          attentionItems: ["usage attribution missing"],
          currentVersion: "1.0.0",
          latestVersion: "1.0.1",
          hasUpdateAvailable: true,
          cronEnabled: true,
          cronNextAt: 123,
          operatorUser: "alice@example.com",
          operatorRole: "operator",
        },
        surfaceActions: {
          dashboard: { onRefresh: noop },
          tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
          capabilities: {
            onRefresh: noop,
            onRefreshCatalog: noop,
            onRefreshInstalled: noop,
            onRefreshSetupHealth: noop,
          },
          models: {
            onRefresh: noop,
            onRefreshPool: noop,
            onRefreshPolicies: noop,
            onRefreshOverrides: noop,
          },
          platformAgents: {
            onRefresh: noop,
            onRefreshFleet: noop,
            onRefreshWorkspaces: noop,
          },
          advanced: {
            onRefresh: noop,
            onRefreshChannels: noop,
            onRefreshInstances: noop,
            onRefreshUsage: noop,
          },
        },
      } as never),
      container,
    );

    expect(container.textContent).toContain("平台总览");
    expect(container.textContent).toContain("核心入口");
    expect(container.textContent).toContain("平台关注项");

    const tenantLink = container.querySelector<HTMLAnchorElement>('a[href="/platform/tenants"]');
    expect(tenantLink).not.toBeNull();
    tenantLink?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    expect(window.location.pathname).toBe("/platform/tenants");
  });

  it("renders platform capability workspace modules", () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderPlatformPortShell({
        state: { tab: "platformCapabilities" },
        subnavProps: {
          tabs: ["platformDashboard", "platformCapabilities"],
          activeTab: "platformCapabilities",
          basePath: "",
          onOpenConsoleTab: noop,
        },
        channelsProps: createPlatformChannelsProps(),
        readModel: {
          currentTenantId: "acme",
          currentTenantLabel: "Acme",
          knownTenantIds: ["acme"],
          tenantDirectory: [{ tenantId: "acme", label: "Acme" }],
          agentCount: 3,
          featureMethodCount: 12,
          channelCount: 2,
          channelIds: ["slack", "telegram"],
          accountCount: 2,
          connectedAccountCount: 2,
          presenceCount: 1,
          runtimeHosts: ["runtime-a"],
          sessionsCount: 5,
          totalTokens: 1200,
          totalCost: 8.5,
          missingCostEntries: 0,
          modelMode: "pool",
          configuredProviderCount: 2,
          providerIds: ["openai", "anthropic"],
          configuredModelCount: 3,
          configuredModelIds: ["gpt-5.4", "gpt-5.4-mini"],
          installedCapabilityCount: 4,
          attentionItems: ["No model providers configured"],
          currentVersion: "1.0.0",
          latestVersion: "1.0.1",
          hasUpdateAvailable: true,
          cronEnabled: true,
          cronNextAt: 123,
          operatorUser: "alice@example.com",
          operatorRole: "operator",
        },
        surfaceActions: {
          dashboard: { onRefresh: noop },
          tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
          capabilities: {
            onRefresh: noop,
            onRefreshCatalog: noop,
            onRefreshInstalled: noop,
            onRefreshSetupHealth: noop,
          },
          models: {
            onRefresh: noop,
            onRefreshPool: noop,
            onRefreshPolicies: noop,
            onRefreshOverrides: noop,
          },
          platformAgents: {
            onRefresh: noop,
            onRefreshFleet: noop,
            onRefreshWorkspaces: noop,
          },
          advanced: {
            onRefresh: noop,
            onRefreshChannels: noop,
            onRefreshInstances: noop,
            onRefreshUsage: noop,
          },
        },
      } as never),
      container,
    );

    expect(container.textContent).toContain("能力目录");
    expect(container.textContent).toContain("已安装");
  });

  it("renders platform model overview tab and updates hash when navigating", () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderPlatformPortShell({
        state: { tab: "platformModels" },
        subnavProps: {
          tabs: ["platformDashboard", "platformModels"],
          activeTab: "platformModels",
          basePath: "",
          onOpenConsoleTab: noop,
        },
        channelsProps: createPlatformChannelsProps(),
        readModel: {
          currentTenantId: "acme",
          currentTenantLabel: "Acme",
          knownTenantIds: ["acme"],
          tenantDirectory: [{ tenantId: "acme", label: "Acme" }],
          enterpriseDirectory: [],
          agentDirectory: [],
          featureMethodCount: 4,
          installedCapabilityCount: 2,
          channelCount: 2,
          channelIds: ["slack", "telegram"],
          accountCount: 2,
          connectedAccountCount: 2,
          presenceCount: 1,
          runtimeHosts: ["runtime-a"],
          sessionsCount: 2,
          totalTokens: 300,
          totalCost: 2.1,
          missingCostEntries: 1,
          modelMode: "merge",
          configuredProviderCount: 1,
          providerIds: ["openai"],
          configuredModelCount: 1,
          modelsManagementSnapshot: { generatedAt: "2026-11-28T00:00:00.000Z" },
          configuredModelIds: ["gpt-5.4"],
          gatewayCatalogCount: 1,
          gatewayCatalogModels: [],
          modelDirectory: [],
          providerHealthDirectory: [],
          allowlistedModelRefs: [],
          allowlistEntries: [],
          aliasCount: 0,
          defaultModelPrimary: "openai/gpt-5.4",
          defaultModelFallbacks: [],
          defaultImageModelPrimary: null,
          attentionItems: [],
          currentVersion: "1.0.0",
          latestVersion: "1.0.0",
          hasUpdateAvailable: false,
          cronEnabled: true,
          cronNextAt: 123,
          operatorUser: "alice@example.com",
          operatorRole: "operator",
        },
        pageViewModels: {
          models: {
            summary: [
              { label: "模型池", value: "1" },
              { label: "策略", value: "merge" },
            ],
            sectionLinks: [
              { id: "model-pool", label: "模型池", meta: "1 个模型" },
              { id: "model-routing", label: "路由与 Allowlist", meta: "2 个候选" },
              { id: "model-catalog", label: "目录与 Provider", meta: "1 个目录项" },
              { id: "model-governance", label: "策略与覆盖", meta: "1 个关注" },
            ],
            mode: "merge",
            modeLabel: "Merge",
            canManage: true,
            configDirty: false,
            configSaving: false,
            providerEntries: [],
            providerHealthEntries: [],
            standardModels: [],
            gatewayCatalogEntries: [],
            gatewayCatalogItems: [],
            routingPrimary: "openai/gpt-5.4",
            routingFallbacks: [],
            routingImagePrimary: null,
            routingCandidates: ["openai/gpt-5.4", "openai/gpt-image-1"],
            allowlistItems: [],
            allowlistEntries: [],
            aliasCount: 0,
            modelItems: [],
            policyItems: [],
            matchingItems: [],
            overrideItems: [],
            issueItems: [],
          },
        },
        surfaceActions: {
          dashboard: { onRefresh: noop },
          tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
          capabilities: {
            onRefresh: noop,
            onRefreshCatalog: noop,
            onRefreshInstalled: noop,
            onRefreshSetupHealth: noop,
          },
          models: {
            onRefresh: noop,
            onRefreshPool: noop,
            onRefreshPolicies: noop,
            onRefreshOverrides: noop,
            onSaveConfig: noop,
            onAddModel: noop,
            onUpdateModel: noop,
            onRemoveModel: noop,
            onSetDefaultPrimary: noop,
            onSetDefaultFallbacks: noop,
            onSetDefaultImagePrimary: noop,
            onUpsertAllowlistEntry: noop,
            onRemoveAllowlistEntry: noop,
            onRefreshCatalog: noop,
            onRefreshProviders: noop,
            onRefreshProviderHealth: noop,
            onRefreshMatching: noop,
            onRefreshIssues: noop,
          },
          platformAgents: {
            onRefresh: noop,
            onRefreshFleet: noop,
            onRefreshWorkspaces: noop,
          },
          advanced: {
            onRefresh: noop,
            onRefreshChannels: noop,
            onRefreshInstances: noop,
            onRefreshUsage: noop,
          },
        },
      } as never),
      container,
    );

    expect(container.textContent).toContain("模型管理");
    expect(container.textContent).toContain("模型池");
    expect(container.textContent).toContain("模型池");
    expect(container.textContent).toContain("任务方案");
    expect(container.textContent).toContain("智能路由");
    expect(container.textContent).toContain("使用分析");
    expect(container.textContent).toContain("治理告警");
    expect(container.textContent).toContain("模型管理");
    expect(container.textContent).toContain("模型池");
    expect(container.textContent).toContain("任务方案");
    expect(container.textContent).toContain("智能路由");
    expect(container.textContent).toContain("使用分析");
    expect(container.textContent).toContain("治理告警");

    const routingAction = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "使用分析",
    );
    routingAction?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    expect(window.location.hash).toBe("#platform-models:usageAnalytics");
  });

  it("renders platform model assets tab", () => {
    window.history.replaceState({}, "", "/platform/models#platform-models:modelAssets");
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderPlatformPortShell({
        state: { tab: "platformModels" },
        subnavProps: {
          tabs: ["platformDashboard", "platformModels"],
          activeTab: "platformModels",
          basePath: "",
          onOpenConsoleTab: noop,
        },
        channelsProps: createPlatformChannelsProps(),
        readModel: {
          currentTenantId: "acme",
          currentTenantLabel: "Acme",
          knownTenantIds: ["acme"],
          tenantDirectory: [{ tenantId: "acme", label: "Acme" }],
          enterpriseDirectory: [],
          agentDirectory: [],
          featureMethodCount: 4,
          installedCapabilityCount: 2,
          channelCount: 2,
          channelIds: ["slack", "telegram"],
          accountCount: 2,
          connectedAccountCount: 2,
          presenceCount: 1,
          runtimeHosts: ["runtime-a"],
          sessionsCount: 2,
          totalTokens: 300,
          totalCost: 2.1,
          missingCostEntries: 1,
          modelMode: "merge",
          configuredProviderCount: 1,
          providerIds: ["openai"],
          configuredModelCount: 1,
          modelsManagementSnapshot: { generatedAt: "2026-11-28T00:00:00.000Z" },
          configuredModelIds: ["gpt-5.4"],
          gatewayCatalogCount: 1,
          gatewayCatalogModels: [],
          modelDirectory: [
            {
              providerId: "openai",
              modelId: "gpt-5.4",
              name: "GPT 5.4",
              api: "openai-responses",
              providerApi: "openai-responses",
              baseUrl: "https://api.openai.com/v1",
              auth: "api-key",
              reasoning: true,
              input: ["text"],
              contextWindow: 128000,
              maxTokens: 8192,
              costTier: "high",
              supportsTools: true,
            },
          ],
          providerHealthDirectory: [
            {
              providerId: "openai",
              authMode: "api-key",
              authStatus: "ok",
              authLabel: "configured",
              modelCount: 1,
              catalogCount: 1,
              issue: "ok",
            },
          ],
          allowlistedModelRefs: [],
          allowlistEntries: [],
          aliasCount: 0,
          defaultModelPrimary: "openai/gpt-5.4",
          defaultModelFallbacks: [],
          defaultImageModelPrimary: null,
          attentionItems: [],
          currentVersion: "1.0.0",
          latestVersion: "1.0.0",
          hasUpdateAvailable: false,
          cronEnabled: true,
          cronNextAt: 123,
          operatorUser: "alice@example.com",
          operatorRole: "operator",
          latestInvite: null,
        },
        pageViewModels: {
          models: {
            summary: [
              { label: "模型池", value: "1" },
              { label: "策略", value: "merge" },
            ],
            sectionLinks: [],
            mode: "merge",
            modeLabel: "Merge",
            canManage: true,
            configDirty: false,
            configSaving: false,
            providerEntries: [],
            providerHealthEntries: [],
            standardModels: [],
            gatewayCatalogEntries: [],
            gatewayCatalogItems: [],
            routingPrimary: "openai/gpt-5.4",
            routingFallbacks: [],
            routingImagePrimary: null,
            routingCandidates: ["openai/gpt-5.4"],
            allowlistItems: [],
            allowlistEntries: [],
            aliasCount: 0,
            modelItems: [],
            policyItems: [],
            matchingItems: [],
            overrideItems: [],
            issueItems: [],
          },
        },
        surfaceActions: {
          dashboard: { onRefresh: noop },
          tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
          capabilities: {
            onRefresh: noop,
            onRefreshCatalog: noop,
            onRefreshInstalled: noop,
            onRefreshSetupHealth: noop,
          },
          models: {
            onRefresh: noop,
            onRefreshPool: noop,
            onRefreshPolicies: noop,
            onRefreshOverrides: noop,
            onSaveConfig: noop,
            onAddModel: noop,
            onUpdateModel: noop,
            onRemoveModel: noop,
            onSetDefaultPrimary: noop,
            onSetDefaultFallbacks: noop,
            onSetDefaultImagePrimary: noop,
            onUpsertAllowlistEntry: noop,
            onRemoveAllowlistEntry: noop,
            onRefreshCatalog: noop,
            onRefreshProviders: noop,
            onRefreshProviderHealth: noop,
            onRefreshMatching: noop,
            onRefreshIssues: noop,
          },
          platformAgents: {
            onRefresh: noop,
            onRefreshFleet: noop,
            onRefreshWorkspaces: noop,
          },
          advanced: {
            onRefresh: noop,
            onRefreshChannels: noop,
            onRefreshInstances: noop,
            onRefreshUsage: noop,
          },
        },
      } as never),
      container,
    );

    expect(container.textContent).toContain("模型池");
    expect(container.textContent).toContain("所有 Provider");
    expect(
      container.querySelector(".platform-model-assets-search input")?.getAttribute("placeholder"),
    ).toBe("搜索模型名称 / ID");
    expect(container.textContent).toContain("添加模型");
    expect(container.textContent).not.toContain("4 步完成");
    expect(container.textContent).toContain("GPT 5.4");
    expect(container.textContent).toContain("健康状态");
    expect(container.textContent).toContain("7 日调用");

    const detailButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "详情",
    );
    detailButton?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );

    render(
      renderPlatformPortShell({
        state: { tab: "platformModels" },
        subnavProps: {
          tabs: ["platformDashboard", "platformModels"],
          activeTab: "platformModels",
          basePath: "",
          onOpenConsoleTab: noop,
        },
        channelsProps: createPlatformChannelsProps(),
        readModel: {
          currentTenantId: "acme",
          currentTenantLabel: "Acme",
          knownTenantIds: ["acme"],
          tenantDirectory: [{ tenantId: "acme", label: "Acme" }],
          enterpriseDirectory: [],
          agentDirectory: [],
          featureMethodCount: 4,
          installedCapabilityCount: 2,
          channelCount: 2,
          channelIds: ["slack", "telegram"],
          accountCount: 2,
          connectedAccountCount: 2,
          presenceCount: 1,
          runtimeHosts: ["runtime-a"],
          sessionsCount: 2,
          totalTokens: 300,
          totalCost: 2.1,
          missingCostEntries: 1,
          modelMode: "merge",
          configuredProviderCount: 1,
          providerIds: ["openai"],
          configuredModelCount: 1,
          modelsManagementSnapshot: { generatedAt: "2026-11-28T00:00:00.000Z" },
          configuredModelIds: ["gpt-5.4"],
          gatewayCatalogCount: 1,
          gatewayCatalogModels: [],
          modelDirectory: [
            {
              providerId: "openai",
              modelId: "gpt-5.4",
              name: "GPT 5.4",
              api: "openai-responses",
              providerApi: "openai-responses",
              baseUrl: "https://api.openai.com/v1",
              auth: "api-key",
              reasoning: true,
              input: ["text"],
              contextWindow: 128000,
              maxTokens: 8192,
              costTier: "high",
              supportsTools: true,
            },
          ],
          providerHealthDirectory: [
            {
              providerId: "openai",
              authMode: "api-key",
              authStatus: "ok",
              authLabel: "configured",
              modelCount: 1,
              catalogCount: 1,
              issue: "ok",
            },
          ],
          allowlistedModelRefs: [],
          allowlistEntries: [],
          aliasCount: 0,
          defaultModelPrimary: "openai/gpt-5.4",
          defaultModelFallbacks: [],
          defaultImageModelPrimary: null,
          attentionItems: [],
          currentVersion: "1.0.0",
          latestVersion: "1.0.0",
          hasUpdateAvailable: false,
          cronEnabled: true,
          cronNextAt: 123,
          operatorUser: "alice@example.com",
          operatorRole: "operator",
          latestInvite: null,
        },
        pageViewModels: {
          models: {
            summary: [
              { label: "模型池", value: "1" },
              { label: "策略", value: "merge" },
            ],
            sectionLinks: [],
            mode: "merge",
            modeLabel: "Merge",
            canManage: true,
            configDirty: false,
            configSaving: false,
            providerEntries: [],
            providerHealthEntries: [],
            standardModels: [],
            gatewayCatalogEntries: [],
            gatewayCatalogItems: [],
            routingPrimary: "openai/gpt-5.4",
            routingFallbacks: [],
            routingImagePrimary: null,
            routingCandidates: ["openai/gpt-5.4"],
            allowlistItems: [],
            allowlistEntries: [],
            aliasCount: 0,
            modelItems: [],
            policyItems: [],
            matchingItems: [],
            overrideItems: [],
            issueItems: [],
          },
        },
        surfaceActions: {
          dashboard: { onRefresh: noop },
          tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
          capabilities: {
            onRefresh: noop,
            onRefreshCatalog: noop,
            onRefreshInstalled: noop,
            onRefreshSetupHealth: noop,
          },
          models: {
            onRefresh: noop,
            onRefreshPool: noop,
            onRefreshPolicies: noop,
            onRefreshOverrides: noop,
            onSaveConfig: noop,
            onAddModel: noop,
            onUpdateModel: noop,
            onRemoveModel: noop,
            onSetDefaultPrimary: noop,
            onSetDefaultFallbacks: noop,
            onSetDefaultImagePrimary: noop,
            onUpsertAllowlistEntry: noop,
            onRemoveAllowlistEntry: noop,
            onRefreshCatalog: noop,
            onRefreshProviders: noop,
            onRefreshProviderHealth: noop,
            onRefreshMatching: noop,
            onRefreshIssues: noop,
          },
          platformAgents: {
            onRefresh: noop,
            onRefreshFleet: noop,
            onRefreshWorkspaces: noop,
          },
          advanced: {
            onRefresh: noop,
            onRefreshChannels: noop,
            onRefreshInstances: noop,
            onRefreshUsage: noop,
          },
        },
      } as never),
      container,
    );

    const detailOverlay = container.querySelector<HTMLElement>(".model-assets-drawer-overlay");
    expect(detailOverlay).not.toBeNull();
    expect(container.textContent).toContain("模型详情");
    expect(container.textContent).toContain("在此完成接入验证、入池与治理操作");
    expect(container.textContent).toContain("推荐池（入池）");
    detailOverlay?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
  });

  it("renders platform model assets bootstrap when no models exist", () => {
    window.history.replaceState({}, "", "/platform/models#platform-models:modelAssets");
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderPlatformPortShell({
        state: { tab: "platformModels" },
        subnavProps: {
          tabs: ["platformDashboard", "platformModels"],
          activeTab: "platformModels",
          basePath: "",
          onOpenConsoleTab: noop,
        },
        channelsProps: createPlatformChannelsProps(),
        readModel: {
          currentTenantId: "acme",
          currentTenantLabel: "Acme",
          knownTenantIds: ["acme"],
          tenantDirectory: [{ tenantId: "acme", label: "Acme" }],
          enterpriseDirectory: [],
          agentDirectory: [],
          featureMethodCount: 4,
          installedCapabilityCount: 2,
          channelCount: 2,
          channelIds: ["slack", "telegram"],
          accountCount: 2,
          connectedAccountCount: 2,
          presenceCount: 1,
          runtimeHosts: ["runtime-a"],
          sessionsCount: 2,
          totalTokens: 300,
          totalCost: 2.1,
          missingCostEntries: 1,
          modelMode: "merge",
          configuredProviderCount: 0,
          providerIds: [],
          configuredModelCount: 0,
          modelsManagementSnapshot: { generatedAt: "2026-11-28T00:00:00.000Z" },
          configuredModelIds: [],
          gatewayCatalogCount: 0,
          gatewayCatalogModels: [],
          modelDirectory: [],
          providerHealthDirectory: [],
          allowlistedModelRefs: [],
          allowlistEntries: [],
          aliasCount: 0,
          defaultModelPrimary: null,
          defaultModelFallbacks: [],
          defaultImageModelPrimary: null,
          attentionItems: [],
          currentVersion: "1.0.0",
          latestVersion: "1.0.0",
          hasUpdateAvailable: false,
          cronEnabled: true,
          cronNextAt: 123,
          operatorUser: "alice@example.com",
          operatorRole: "operator",
          latestInvite: null,
        },
        pageViewModels: {
          models: {
            summary: [
              { label: "模型池", value: "0" },
              { label: "策略", value: "merge" },
            ],
            sectionLinks: [],
            mode: "merge",
            modeLabel: "Merge",
            canManage: true,
            configDirty: false,
            configSaving: false,
            providerEntries: [],
            providerHealthEntries: [],
            standardModels: [],
            gatewayCatalogEntries: [],
            gatewayCatalogItems: [],
            routingPrimary: null,
            routingFallbacks: [],
            routingImagePrimary: null,
            routingCandidates: [],
            allowlistItems: [],
            allowlistEntries: [],
            aliasCount: 0,
            modelItems: [],
            policyItems: [],
            matchingItems: [],
            overrideItems: [],
            issueItems: [],
          },
        },
        surfaceActions: {
          dashboard: { onRefresh: noop },
          tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
          capabilities: {
            onRefresh: noop,
            onRefreshCatalog: noop,
            onRefreshInstalled: noop,
            onRefreshSetupHealth: noop,
          },
          models: {
            onRefresh: noop,
            onRefreshPool: noop,
            onRefreshPolicies: noop,
            onRefreshOverrides: noop,
            onSaveConfig: noop,
            onAddModel: noop,
            onUpdateModel: noop,
            onRemoveModel: noop,
            onSetDefaultPrimary: noop,
            onSetDefaultFallbacks: noop,
            onSetDefaultImagePrimary: noop,
            onUpsertAllowlistEntry: noop,
            onRemoveAllowlistEntry: noop,
            onRefreshCatalog: noop,
            onRefreshProviders: noop,
            onRefreshProviderHealth: noop,
            onRefreshMatching: noop,
            onRefreshIssues: noop,
          },
          platformAgents: {
            onRefresh: noop,
            onRefreshFleet: noop,
            onRefreshWorkspaces: noop,
          },
          advanced: {
            onRefresh: noop,
            onRefreshChannels: noop,
            onRefreshInstances: noop,
            onRefreshUsage: noop,
          },
        },
      } as never),
      container,
    );

    expect(container.textContent).toContain("暂无已纳管模型资产");
    expect(container.textContent).toContain("手动添加模型");
    expect(container.textContent).toContain("验证连接");
    expect(container.textContent).not.toContain("Model Asset Table");
  });

  it("keeps discovered catalog models outside the managed model pool", () => {
    window.history.replaceState({}, "", "/platform/models#platform-models:modelAssets");
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderPlatformPortShell({
        state: { tab: "platformModels" },
        subnavProps: {
          tabs: ["platformDashboard", "platformModels"],
          activeTab: "platformModels",
          basePath: "",
          onOpenConsoleTab: noop,
        },
        channelsProps: createPlatformChannelsProps(),
        readModel: {
          currentTenantId: "acme",
          currentTenantLabel: "Acme",
          knownTenantIds: ["acme"],
          tenantDirectory: [{ tenantId: "acme", label: "Acme" }],
          enterpriseDirectory: [],
          agentDirectory: [],
          featureMethodCount: 4,
          installedCapabilityCount: 2,
          channelCount: 2,
          channelIds: ["slack", "telegram"],
          accountCount: 2,
          connectedAccountCount: 2,
          presenceCount: 1,
          runtimeHosts: ["runtime-a"],
          sessionsCount: 2,
          totalTokens: 300,
          totalCost: 2.1,
          missingCostEntries: 1,
          modelMode: "merge",
          configuredProviderCount: 1,
          providerIds: ["deepseek"],
          configuredModelCount: 0,
          modelsManagementSnapshot: { generatedAt: "2026-11-28T00:00:00.000Z" },
          configuredModelIds: [],
          gatewayCatalogCount: 1,
          gatewayCatalogModels: [
            {
              providerId: "deepseek",
              modelId: "deepseek-chat",
              name: "DeepSeek Chat",
              contextWindow: 128000,
            },
          ],
          modelProbeDirectory: [
            {
              providerId: "deepseek",
              modelId: "deepseek-chat",
              status: "ok",
              source: "profile",
              label: "default",
              latencyMs: 840,
              error: null,
              checkedAt: 1713000000000,
            },
          ],
          modelDirectory: [],
          providerHealthDirectory: [
            {
              providerId: "deepseek",
              authMode: "api-key",
              authStatus: "ok",
              authLabel: "configured",
              modelCount: 0,
              catalogCount: 1,
              issue: "Provider 已声明但未配置任何模型",
            },
          ],
          allowlistedModelRefs: [],
          allowlistEntries: [],
          aliasCount: 0,
          defaultModelPrimary: null,
          defaultModelFallbacks: [],
          defaultImageModelPrimary: null,
          attentionItems: [],
          currentVersion: "1.0.0",
          latestVersion: "1.0.0",
          hasUpdateAvailable: false,
          cronEnabled: true,
          cronNextAt: 123,
          operatorUser: "alice@example.com",
          operatorRole: "operator",
          latestInvite: null,
        },
        pageViewModels: {
          models: {
            summary: [
              { label: "模型池", value: "0" },
              { label: "策略", value: "merge" },
            ],
            sectionLinks: [],
            mode: "merge",
            modeLabel: "Merge",
            canManage: true,
            configDirty: false,
            configSaving: false,
            providerEntries: [],
            providerHealthEntries: [],
            standardModels: [],
            gatewayCatalogEntries: [],
            gatewayCatalogItems: [],
            routingPrimary: null,
            routingFallbacks: [],
            routingImagePrimary: null,
            routingCandidates: [],
            allowlistItems: [],
            allowlistEntries: [],
            aliasCount: 0,
            modelItems: [],
            policyItems: [],
            matchingItems: [],
            overrideItems: [],
            issueItems: [],
          },
        },
        surfaceActions: {
          dashboard: { onRefresh: noop },
          tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
          capabilities: {
            onRefresh: noop,
            onRefreshCatalog: noop,
            onRefreshInstalled: noop,
            onRefreshSetupHealth: noop,
          },
          models: {
            onRefresh: noop,
            onRefreshPool: noop,
            onRefreshPolicies: noop,
            onRefreshOverrides: noop,
            onSaveConfig: noop,
            onAddModel: noop,
            onImportCatalogModel: noop,
            onUpdateModel: noop,
            onRemoveModel: noop,
            onSetDefaultPrimary: noop,
            onSetDefaultFallbacks: noop,
            onSetDefaultImagePrimary: noop,
            onUpsertAllowlistEntry: noop,
            onRemoveAllowlistEntry: noop,
            onRefreshCatalog: noop,
            onRefreshProviders: noop,
            onRefreshProviderHealth: noop,
            onRefreshMatching: noop,
            onRefreshIssues: noop,
          },
          platformAgents: {
            onRefresh: noop,
            onRefreshFleet: noop,
            onRefreshWorkspaces: noop,
          },
          advanced: {
            onRefresh: noop,
            onRefreshChannels: noop,
            onRefreshInstances: noop,
            onRefreshUsage: noop,
          },
        },
      } as never),
      container,
    );

    expect(container.textContent).not.toContain("DeepSeek Chat");
    expect(container.textContent).toContain("暂无已纳管模型资产");
    expect(container.querySelector('[data-testid="model-pending-connect"]')).toBeNull();
    expect(container.textContent).toContain("手动添加模型");
    expect(container.textContent).not.toContain("openai/deepseek-chat");
  });

  it("renders platform task plans tab empty state without synthetic plans", () => {
    window.history.replaceState({}, "", "/platform/models#platform-models:taskPlans");
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderPlatformPortShell({
        state: { tab: "platformModels" },
        subnavProps: {
          tabs: ["platformDashboard", "platformModels"],
          activeTab: "platformModels",
          basePath: "",
          onOpenConsoleTab: noop,
        },
        channelsProps: createPlatformChannelsProps(),
        readModel: {
          currentTenantId: "acme",
          currentTenantLabel: "Acme",
          knownTenantIds: ["acme"],
          tenantDirectory: [{ tenantId: "acme", label: "Acme" }],
          enterpriseDirectory: [],
          agentDirectory: [],
          featureMethodCount: 4,
          installedCapabilityCount: 2,
          channelCount: 2,
          channelIds: ["slack", "telegram"],
          accountCount: 2,
          connectedAccountCount: 2,
          presenceCount: 1,
          runtimeHosts: ["runtime-a"],
          sessionsCount: 2,
          totalTokens: 300,
          totalCost: 2.1,
          missingCostEntries: 1,
          modelMode: "merge",
          configuredProviderCount: 1,
          providerIds: ["openai"],
          configuredModelCount: 2,
          configuredModelIds: ["gpt-5.4", "gpt-5.4-mini"],
          gatewayCatalogCount: 1,
          gatewayCatalogModels: [],
          modelDirectory: [
            {
              providerId: "openai",
              modelId: "gpt-5.4",
              name: "GPT 5.4",
              api: "openai-responses",
              providerApi: "openai-responses",
              baseUrl: "https://api.openai.com/v1",
              auth: "api-key",
              reasoning: true,
              input: ["text"],
              contextWindow: 128000,
              maxTokens: 8192,
              costTier: "high",
              supportsTools: true,
            },
            {
              providerId: "openai",
              modelId: "gpt-5.4-mini",
              name: "GPT 5.4 Mini",
              api: "openai-responses",
              providerApi: "openai-responses",
              baseUrl: "https://api.openai.com/v1",
              auth: "api-key",
              reasoning: true,
              input: ["text"],
              contextWindow: 128000,
              maxTokens: 8192,
              costTier: "medium",
              supportsTools: true,
            },
          ],
          providerHealthDirectory: [
            {
              providerId: "openai",
              authMode: "api-key",
              authStatus: "ok",
              authLabel: "configured",
              modelCount: 2,
              catalogCount: 2,
              issue: "ok",
            },
          ],
          allowlistedModelRefs: [],
          allowlistEntries: [],
          aliasCount: 0,
          defaultModelPrimary: "openai/gpt-5.4",
          defaultModelFallbacks: ["openai/gpt-5.4-mini"],
          defaultImageModelPrimary: null,
          attentionItems: [],
          currentVersion: "1.0.0",
          latestVersion: "1.0.0",
          hasUpdateAvailable: false,
          cronEnabled: true,
          cronNextAt: 123,
          operatorUser: "alice@example.com",
          operatorRole: "operator",
          latestInvite: null,
        },
        pageViewModels: { models: null },
        surfaceActions: {
          dashboard: { onRefresh: noop },
          tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
          capabilities: {
            onRefresh: noop,
            onRefreshCatalog: noop,
            onRefreshInstalled: noop,
            onRefreshSetupHealth: noop,
          },
          models: {
            onRefresh: noop,
            onRefreshPool: noop,
            onRefreshPolicies: noop,
            onRefreshOverrides: noop,
          },
          platformAgents: {
            onRefresh: noop,
            onRefreshFleet: noop,
            onRefreshWorkspaces: noop,
          },
          advanced: {
            onRefresh: noop,
            onRefreshChannels: noop,
            onRefreshInstances: noop,
            onRefreshUsage: noop,
          },
        },
      } as never),
      container,
    );

    expect(container.textContent).toContain("暂无任务方案");
    expect(container.textContent).toContain("新建任务方案");
    expect(container.textContent).not.toContain("Task Plan Table");
    expect(container.textContent).not.toContain("缺少 fallback 的方案");
  });

  it("renders platform smart routing tab empty state without synthetic policies", () => {
    window.history.replaceState({}, "", "/platform/models#platform-models:smartRouting");
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderPlatformPortShell({
        state: { tab: "platformModels" },
        subnavProps: {
          tabs: ["platformDashboard", "platformModels"],
          activeTab: "platformModels",
          basePath: "",
          onOpenConsoleTab: noop,
        },
        channelsProps: createPlatformChannelsProps(),
        readModel: {
          currentTenantId: "acme",
          currentTenantLabel: "Acme",
          knownTenantIds: ["acme"],
          tenantDirectory: [{ tenantId: "acme", label: "Acme" }],
          enterpriseDirectory: [],
          agentDirectory: [],
          featureMethodCount: 4,
          installedCapabilityCount: 2,
          channelCount: 2,
          channelIds: ["slack", "telegram"],
          accountCount: 2,
          connectedAccountCount: 2,
          presenceCount: 1,
          runtimeHosts: ["runtime-a"],
          sessionsCount: 4,
          totalTokens: 600,
          totalCost: 4.5,
          missingCostEntries: 1,
          modelMode: "merge",
          configuredProviderCount: 1,
          providerIds: ["openai"],
          configuredModelCount: 2,
          configuredModelIds: ["gpt-5.4", "gpt-5.4-mini"],
          gatewayCatalogCount: 1,
          gatewayCatalogModels: [],
          modelDirectory: [
            {
              providerId: "openai",
              modelId: "gpt-5.4",
              name: "GPT 5.4",
              api: "openai-responses",
              providerApi: "openai-responses",
              baseUrl: "https://api.openai.com/v1",
              auth: "api-key",
              reasoning: true,
              input: ["text"],
              contextWindow: 128000,
              maxTokens: 8192,
              costTier: "high",
              supportsTools: true,
            },
            {
              providerId: "openai",
              modelId: "gpt-5.4-mini",
              name: "GPT 5.4 Mini",
              api: "openai-responses",
              providerApi: "openai-responses",
              baseUrl: "https://api.openai.com/v1",
              auth: "api-key",
              reasoning: true,
              input: ["text"],
              contextWindow: 128000,
              maxTokens: 8192,
              costTier: "medium",
              supportsTools: true,
            },
          ],
          providerHealthDirectory: [
            {
              providerId: "openai",
              authMode: "api-key",
              authStatus: "ok",
              authLabel: "configured",
              modelCount: 2,
              catalogCount: 2,
              issue: "ok",
            },
          ],
          allowlistedModelRefs: [],
          allowlistEntries: [],
          aliasCount: 0,
          defaultModelPrimary: "openai/gpt-5.4",
          defaultModelFallbacks: ["openai/gpt-5.4-mini"],
          defaultImageModelPrimary: null,
          attentionItems: [],
          currentVersion: "1.0.0",
          latestVersion: "1.0.0",
          hasUpdateAvailable: false,
          cronEnabled: true,
          cronNextAt: 123,
          operatorUser: "alice@example.com",
          operatorRole: "operator",
          latestInvite: null,
        },
        pageViewModels: { models: null },
        surfaceActions: {
          dashboard: { onRefresh: noop },
          tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
          capabilities: {
            onRefresh: noop,
            onRefreshCatalog: noop,
            onRefreshInstalled: noop,
            onRefreshSetupHealth: noop,
          },
          models: {
            onRefresh: noop,
            onRefreshPool: noop,
            onRefreshPolicies: noop,
            onRefreshOverrides: noop,
          },
          platformAgents: {
            onRefresh: noop,
            onRefreshFleet: noop,
            onRefreshWorkspaces: noop,
          },
          advanced: {
            onRefresh: noop,
            onRefreshChannels: noop,
            onRefreshInstances: noop,
            onRefreshUsage: noop,
          },
        },
      } as never),
      container,
    );

    expect(container.textContent).toContain("暂无智能路由策略");
    expect(container.textContent).toContain("前往任务方案");
    expect(container.textContent).not.toContain("Routing Policy List");
    expect(container.textContent).not.toContain("Routing Chain Viewer");
    expect(container.textContent).not.toContain("Decision Explanation");
    expect(container.textContent).not.toContain("Conflicts / Warnings");
  });

  it("renders platform usage analytics tab and drills down to model assets", () => {
    window.history.replaceState({}, "", "/platform/models#platform-models:usageAnalytics");
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderPlatformPortShell({
        state: { tab: "platformModels" },
        subnavProps: {
          tabs: ["platformDashboard", "platformModels"],
          activeTab: "platformModels",
          basePath: "",
          onOpenConsoleTab: noop,
        },
        channelsProps: createPlatformChannelsProps(),
        readModel: {
          currentTenantId: "acme",
          currentTenantLabel: "Acme",
          knownTenantIds: ["acme"],
          tenantDirectory: [{ tenantId: "acme", label: "Acme" }],
          enterpriseDirectory: [],
          agentDirectory: [],
          featureMethodCount: 4,
          installedCapabilityCount: 2,
          channelCount: 2,
          channelIds: ["slack", "telegram"],
          accountCount: 2,
          connectedAccountCount: 2,
          presenceCount: 1,
          runtimeHosts: ["runtime-a"],
          sessionsCount: 6,
          totalTokens: 1200,
          totalCost: 6.5,
          missingCostEntries: 1,
          modelMode: "merge",
          configuredProviderCount: 1,
          providerIds: ["openai"],
          configuredModelCount: 2,
          configuredModelIds: ["gpt-5.4", "gpt-5.4-mini"],
          gatewayCatalogCount: 1,
          gatewayCatalogModels: [],
          modelDirectory: [
            {
              providerId: "openai",
              modelId: "gpt-5.4",
              name: "GPT 5.4",
              api: "openai-responses",
              providerApi: "openai-responses",
              baseUrl: "https://api.openai.com/v1",
              auth: "api-key",
              reasoning: true,
              input: ["text"],
              contextWindow: 128000,
              maxTokens: 8192,
              costTier: "high",
              supportsTools: true,
            },
            {
              providerId: "openai",
              modelId: "gpt-5.4-mini",
              name: "GPT 5.4 Mini",
              api: "openai-responses",
              providerApi: "openai-responses",
              baseUrl: "https://api.openai.com/v1",
              auth: "api-key",
              reasoning: true,
              input: ["text"],
              contextWindow: 128000,
              maxTokens: 8192,
              costTier: "medium",
              supportsTools: true,
            },
          ],
          providerHealthDirectory: [
            {
              providerId: "openai",
              authMode: "api-key",
              authStatus: "ok",
              authLabel: "configured",
              modelCount: 2,
              catalogCount: 2,
              issue: "ok",
            },
          ],
          allowlistedModelRefs: [],
          allowlistEntries: [],
          aliasCount: 0,
          defaultModelPrimary: "openai/gpt-5.4",
          defaultModelFallbacks: ["openai/gpt-5.4-mini"],
          defaultImageModelPrimary: null,
          attentionItems: [],
          currentVersion: "1.0.0",
          latestVersion: "1.0.0",
          hasUpdateAvailable: false,
          cronEnabled: true,
          cronNextAt: 123,
          operatorUser: "alice@example.com",
          operatorRole: "operator",
          latestInvite: null,
        },
        pageViewModels: { models: null },
        surfaceActions: {
          dashboard: { onRefresh: noop },
          tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
          capabilities: {
            onRefresh: noop,
            onRefreshCatalog: noop,
            onRefreshInstalled: noop,
            onRefreshSetupHealth: noop,
          },
          models: {
            onRefresh: noop,
            onRefreshPool: noop,
            onRefreshPolicies: noop,
            onRefreshOverrides: noop,
          },
          platformAgents: {
            onRefresh: noop,
            onRefreshFleet: noop,
            onRefreshWorkspaces: noop,
          },
          advanced: {
            onRefresh: noop,
            onRefreshChannels: noop,
            onRefreshInstances: noop,
            onRefreshUsage: noop,
          },
        },
      } as never),
      container,
    );

    expect(container.textContent).toContain("暂无模型使用数据");
    expect(container.textContent).toContain("查看模型资产");
    expect(container.textContent).not.toContain("By Plan");

    const modelAssetsButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("查看模型资产"),
    );
    modelAssetsButton?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    expect(window.location.hash).toBe("#platform-models:modelAssets");
  });

  it("renders platform governance tab and drills down from issue actions", () => {
    window.history.replaceState({}, "", "/platform/models#platform-models:governance");
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderPlatformPortShell({
        state: { tab: "platformModels" },
        subnavProps: {
          tabs: ["platformDashboard", "platformModels"],
          activeTab: "platformModels",
          basePath: "",
          onOpenConsoleTab: noop,
        },
        channelsProps: createPlatformChannelsProps(),
        readModel: {
          currentTenantId: "acme",
          currentTenantLabel: "Acme",
          knownTenantIds: ["acme"],
          tenantDirectory: [{ tenantId: "acme", label: "Acme" }],
          enterpriseDirectory: [],
          agentDirectory: [],
          featureMethodCount: 4,
          installedCapabilityCount: 2,
          channelCount: 2,
          channelIds: ["slack", "telegram"],
          accountCount: 2,
          connectedAccountCount: 2,
          presenceCount: 1,
          runtimeHosts: ["runtime-a"],
          sessionsCount: 6,
          totalTokens: 1200,
          totalCost: 6.5,
          missingCostEntries: 1,
          modelMode: "merge",
          configuredProviderCount: 1,
          providerIds: ["openai"],
          configuredModelCount: 2,
          configuredModelIds: ["gpt-5.4", "gpt-5.4-mini"],
          gatewayCatalogCount: 1,
          gatewayCatalogModels: [],
          modelDirectory: [
            {
              providerId: "openai",
              modelId: "gpt-5.4",
              name: "GPT 5.4",
              api: "openai-responses",
              providerApi: "openai-responses",
              baseUrl: "https://api.openai.com/v1",
              auth: "api-key",
              reasoning: true,
              input: ["text"],
              contextWindow: 128000,
              maxTokens: 8192,
              costTier: "high",
              supportsTools: true,
            },
            {
              providerId: "openai",
              modelId: "gpt-5.4-mini",
              name: "GPT 5.4 Mini",
              api: "openai-responses",
              providerApi: "openai-responses",
              baseUrl: "https://api.openai.com/v1",
              auth: "api-key",
              reasoning: true,
              input: ["text"],
              contextWindow: 128000,
              maxTokens: 8192,
              costTier: "medium",
              supportsTools: true,
            },
          ],
          providerHealthDirectory: [
            {
              providerId: "openai",
              authMode: "api-key",
              authStatus: "ok",
              authLabel: "configured",
              modelCount: 2,
              catalogCount: 2,
              issue: "ok",
            },
          ],
          allowlistedModelRefs: [],
          allowlistEntries: [],
          aliasCount: 0,
          defaultModelPrimary: "openai/gpt-5.4",
          defaultModelFallbacks: ["openai/gpt-5.4-mini"],
          defaultImageModelPrimary: null,
          attentionItems: [],
          currentVersion: "1.0.0",
          latestVersion: "1.0.0",
          hasUpdateAvailable: false,
          cronEnabled: true,
          cronNextAt: 123,
          operatorUser: "alice@example.com",
          operatorRole: "operator",
          latestInvite: null,
        },
        pageViewModels: { models: null },
        surfaceActions: {
          dashboard: { onRefresh: noop },
          tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
          capabilities: {
            onRefresh: noop,
            onRefreshCatalog: noop,
            onRefreshInstalled: noop,
            onRefreshSetupHealth: noop,
          },
          models: {
            onRefresh: noop,
            onRefreshPool: noop,
            onRefreshPolicies: noop,
            onRefreshOverrides: noop,
          },
          platformAgents: {
            onRefresh: noop,
            onRefreshFleet: noop,
            onRefreshWorkspaces: noop,
          },
          advanced: {
            onRefresh: noop,
            onRefreshChannels: noop,
            onRefreshInstances: noop,
            onRefreshUsage: noop,
          },
        },
      } as never),
      container,
    );

    expect(container.textContent).toContain("治理工作台");
    expect(container.textContent).toContain("问题列表");

    const handleButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "处理",
    );
    handleButton?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    expect(window.location.hash).not.toBe("#platform-models:governance");
  });

  it("renders platform advanced workspace modules without legacy console panels", () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderPlatformPortShell({
        state: { tab: "platformAdvanced" },
        subnavProps: {
          tabs: ["platformDashboard", "platformAdvanced"],
          activeTab: "platformAdvanced",
          basePath: "",
          onOpenConsoleTab: noop,
        },
        channelsProps: createPlatformChannelsProps(),
        readModel: {
          currentTenantId: "acme",
          currentTenantLabel: "Acme",
          knownTenantIds: ["acme", "beta"],
          tenantDirectory: [
            { tenantId: "acme", label: "Acme" },
            { tenantId: "beta", label: "Beta" },
          ],
          agentCount: 3,
          featureMethodCount: 12,
          channelCount: 2,
          channelIds: ["slack", "telegram"],
          accountCount: 4,
          connectedAccountCount: 3,
          presenceCount: 2,
          runtimeHosts: ["runtime-a", "runtime-b"],
          sessionsCount: 5,
          totalTokens: 1200,
          totalCost: 8.5,
          missingCostEntries: 1,
          modelMode: "pool",
          configuredProviderCount: 2,
          providerIds: ["openai", "anthropic"],
          configuredModelCount: 3,
          configuredModelIds: ["gpt-5.4", "gpt-5.4-mini"],
          installedCapabilityCount: 4,
          attentionItems: ["usage attribution missing"],
          currentVersion: "1.0.0",
          latestVersion: "1.0.1",
          hasUpdateAvailable: true,
          cronEnabled: true,
          cronNextAt: 123,
          operatorUser: "alice@example.com",
          operatorRole: "operator",
        },
        surfaceActions: {
          dashboard: { onRefresh: noop },
          tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
          capabilities: {
            onRefresh: noop,
            onRefreshCatalog: noop,
            onRefreshInstalled: noop,
            onRefreshSetupHealth: noop,
          },
          models: {
            onRefresh: noop,
            onRefreshPool: noop,
            onRefreshPolicies: noop,
            onRefreshOverrides: noop,
          },
          platformAgents: {
            onRefresh: noop,
            onRefreshFleet: noop,
            onRefreshWorkspaces: noop,
          },
          advanced: {
            onRefresh: noop,
            onRefreshChannels: noop,
            onRefreshInstances: noop,
            onRefreshUsage: noop,
          },
        },
      } as never),
      container,
    );

    expect(container.textContent).toContain("通道");
    expect(container.textContent).toContain("实例");
    expect(container.textContent).toContain("使用");
    expect(container.textContent).toContain("路由");
    expect(container.textContent).toContain("通道连接器目录与治理");
    expect(container.textContent).not.toContain(
      "Platform advanced channel visibility and routing posture.",
    );
  });

  it("renders platform tenants as a two-level management surface with unified directory", () => {
    window.history.replaceState({}, "", "/platform/tenants");
    const container = document.createElement("div");
    document.body.append(container);
    const onPlatformAuthModeChange = vi.fn();

    const model = {
      state: { tab: "platformTenants" },
      subnavProps: {
        tabs: ["platformDashboard", "platformTenants"],
        activeTab: "platformTenants",
        basePath: "",
        onOpenConsoleTab: noop,
      },
      channelsProps: createPlatformChannelsProps(),
      readModel: {
        currentTenantId: "acme",
        currentTenantLabel: "Acme",
        knownTenantIds: ["acme", "beta"],
        tenantDirectory: [
          { tenantId: "acme", label: "Acme" },
          { tenantId: "beta", label: "Beta" },
        ],
        enterpriseDirectory: [
          {
            tenantId: "acme",
            label: "Acme",
            status: "trial",
            createdSource: "platform-created",
            seatQuota: 5,
            seatUsed: 2,
            seatsRemaining: 3,
            trialEndsAt: "2026-04-21",
            contact: { updatedAt: "2026-07-18T10:00:00.000Z", contactEmail: "admin@acme.example" },
            usageSummary: { calls7d: 12, updatedAt: Date.parse("2026-07-19T12:00:00.000Z") },
          },
          {
            tenantId: "beta",
            label: "Beta",
            status: "paid",
            createdSource: "self-service",
            seatQuota: 10,
            seatUsed: 0,
            seatsRemaining: 10,
            // Formal tenant may still carry a stale trialEndsAt from conversion — must not drive updatedAt.
            trialEndsAt: "2026-04-21",
            contact: {
              status: "activated",
              contactEmail: "admin@beta.example",
              updatedAt: "2026-09-01T08:00:00.000Z",
            },
          },
          {
            tenantId: "gamma",
            label: "Gamma Converted",
            status: "trial",
            createdSource: "self-service",
            seatQuota: 3,
            seatUsed: 1,
            seatsRemaining: 2,
          },
          {
            tenantId: "delta",
            label: "Delta Pending Admin",
            status: "trial",
            createdSource: "platform-created",
            seatQuota: 5,
            seatUsed: 0,
            seatsRemaining: 5,
            trialEndsAt: "2099-08-01",
          },
        ],
        agentCount: 3,
        featureMethodCount: 12,
        channelCount: 2,
        channelIds: ["slack", "telegram"],
        accountCount: 4,
        connectedAccountCount: 3,
        presenceCount: 2,
        runtimeHosts: ["runtime-a", "runtime-b"],
        sessionsCount: 5,
        totalTokens: 1200,
        totalCost: 8.5,
        missingCostEntries: 1,
        modelMode: "pool",
        configuredProviderCount: 2,
        providerIds: ["openai", "anthropic"],
        configuredModelCount: 3,
        configuredModelIds: ["gpt-5.4", "gpt-5.4-mini"],
        installedCapabilityCount: 4,
        attentionItems: ["usage attribution missing"],
        currentVersion: "1.0.0",
        latestVersion: "1.0.1",
        hasUpdateAvailable: true,
        cronEnabled: true,
        cronNextAt: 123,
        operatorUser: "alice@example.com",
        operatorRole: "operator",
        latestInvite: {
          code: "INV-001",
          expiresAt: "2026-04-20",
          tenantId: "acme",
          tenantName: "Acme",
        },
      },
      authPanelProps: {
        state: {
          enabled: true,
          sessionKind: "platform-admin",
          canManagePlatform: true,
          platformEnterprises: [],
          trialApplications: [
            {
              id: "app-pending-1",
              companyName: "Pending Co",
              contactName: "Pat",
              workEmail: "pat@pending.example",
              expectedUsers: 12,
              useCase: "sales assist",
              needsDemo: false,
              mode: "manual",
              highIntentLead: true,
              reviewReasons: ["free_email"],
              status: "pending",
              createdAt: "2026-07-20T08:00:00.000Z",
              updatedAt: "2026-07-20T08:00:00.000Z",
            },
            {
              id: "app-converted-1",
              companyName: "Gamma Converted",
              contactName: "Gale",
              workEmail: "gale@gamma.example",
              expectedUsers: 8,
              useCase: "ops",
              needsDemo: false,
              mode: "auto",
              highIntentLead: false,
              reviewReasons: [],
              status: "converted",
              enterpriseId: "gamma",
              createdAt: "2026-07-01T08:00:00.000Z",
              updatedAt: "2026-07-02T08:00:00.000Z",
            },
          ],
          pendingAdminActivations: [
            {
              provisionId: "prov-delta",
              enterpriseId: "delta",
              enterpriseName: "Delta Pending Admin",
              enterpriseStatus: "trial",
              adminEmail: "admin@delta.example",
              adminName: "Delta Admin",
              provisionCreatedAt: "2026-07-15T08:00:00.000Z",
              latestCodeStatus: "expired",
              latestCodeExpiresAt: "2026-07-16T08:00:00.000Z",
              needsResend: true,
            },
          ],
        },
        session: {
          provider: "trusted-proxy",
          user: "alice@example.com",
          displayName: "Alice",
          tenantId: null,
          role: "platform-admin",
          scopes: [],
        },
        mode: "login",
        busy: false,
        error: null,
        notice: null,
        email: "",
        password: "",
        displayName: "",
        platformAdminDisplayName: "",
        tenantName: "",
        inviteCode: "",
        currentPassword: "",
        newPassword: "",
        policyTrialDays: "",
        policySeatCount: "",
        policyUpgradeUrl: "",
        policyContactAdvisorUrl: "",
        instanceEnterpriseId: "",
        instanceTrialDays: "",
        instanceSeatCount: "",
        instanceUpgradeUrl: "",
        instanceContactAdvisorUrl: "",
        platformAdminEmail: "",
        platformAdminPassword: "",
        platformAdminScopes: [],
        onModeChange: onPlatformAuthModeChange,
        onEmailChange: noop,
        onPasswordChange: noop,
        onDisplayNameChange: noop,
        onPlatformAdminDisplayNameChange: noop,
        onTenantNameChange: noop,
        onInviteCodeChange: noop,
        onCurrentPasswordChange: noop,
        onNewPasswordChange: noop,
        onPolicyTrialDaysChange: noop,
        onPolicySeatCountChange: noop,
        onPolicyUpgradeUrlChange: noop,
        onPolicyContactAdvisorUrlChange: noop,
        onInstanceEnterpriseIdChange: noop,
        onInstanceTrialDaysChange: noop,
        onInstanceSeatCountChange: noop,
        onInstanceUpgradeUrlChange: noop,
        onInstanceContactAdvisorUrlChange: noop,
        onPlatformAdminEmailChange: noop,
        onPlatformAdminPasswordChange: noop,
        onPlatformAdminScopesChange: noop,
        onSubmit: noop,
        onCreatePlatformAdmin: noop,
        onLogout: noop,
        onCreateInvite: noop,
        onRevokeInvite: noop,
        onRemoveMember: noop,
        onChangePassword: noop,
        onUpdateTrialPolicy: noop,
        onUpdateTrialInstance: noop,
        onUpdateEnterpriseAdmin: noop,
        onResendEnterpriseAdminActivation: noop,
      },
      surfaceActions: {
        dashboard: { onRefresh: noop },
        tenants: {
          onRefresh: noop,
          onRefreshDirectory: noop,
          onRefreshCoverage: noop,
          onApproveTrialApplication: async () => undefined,
          onRejectTrialApplication: async () => undefined,
        },
        capabilities: {
          onRefresh: noop,
          onRefreshCatalog: noop,
          onRefreshInstalled: noop,
          onRefreshSetupHealth: noop,
        },
        models: {
          onRefresh: noop,
          onRefreshPool: noop,
          onRefreshPolicies: noop,
          onRefreshOverrides: noop,
        },
        platformAgents: {
          onRefresh: noop,
          onRefreshFleet: noop,
          onRefreshWorkspaces: noop,
        },
        advanced: {
          onRefresh: noop,
          onRefreshChannels: noop,
          onRefreshInstances: noop,
          onRefreshUsage: noop,
        },
      },
    } as never;
    render(renderPlatformPortShell(model), container);

    expect(container.textContent).toContain("租户管理");
    expect(container.textContent).not.toContain("试用申请审核");
    expect(container.textContent).toContain("Pending Co");
    expect(container.textContent).toContain("试用申请");
    expect(container.textContent).toContain("查看详情");
    expect(container.textContent).toContain("创建租户");
    // Converted application must not duplicate alongside tenant.
    expect(container.textContent).toContain("Gamma Converted");
    expect(container.textContent?.match(/Gamma Converted/g)?.length ?? 0).toBe(1);
    expect(container.querySelector('a[aria-label^="使用分析"]')).toBeNull();
    expect(container.querySelector(".platform-tenants__lifecycle-action")).toBeNull();
    // seatUsed=0 + activated admin must NOT invent admin-activation todos / 待激活 stage.
    const betaRow = Array.from(
      container.querySelectorAll<HTMLElement>(".platform-tenants__table-row"),
    ).find((row) => row.textContent?.includes("Beta"));
    expect(betaRow?.textContent).not.toContain("管理员尚未激活");
    expect(betaRow?.textContent).not.toContain("激活链接已过期");
    expect(betaRow?.textContent).not.toContain("需要发送激活邮件");
    expect(betaRow?.textContent).not.toContain("待激活");
    expect(betaRow?.textContent).not.toMatch(/2026\/04\/21|2026-04-21/);
    // Real pendingAdminActivations drives activation todos.
    const deltaRow = Array.from(
      container.querySelectorAll<HTMLElement>(".platform-tenants__table-row"),
    ).find((row) => row.textContent?.includes("Delta Pending Admin"));
    expect(deltaRow?.textContent).toContain("激活链接已过期");
    expect(deltaRow?.textContent).toContain("待激活");
    expect(deltaRow?.textContent).not.toContain("激活链接已撤销");
    expect(deltaRow?.textContent).not.toContain("需要发送激活邮件");
    // Updated time uses summary/contact timestamps, not trialEndsAt.
    const acmeRow = Array.from(
      container.querySelectorAll<HTMLElement>(".platform-tenants__table-row"),
    ).find((row) => row.textContent?.includes("Acme") && row.textContent?.includes("租户 ID"));
    expect(acmeRow?.textContent).toContain("2026");
    expect(acmeRow?.textContent).not.toMatch(/2026\/04\/21|2026-04-21/);

    const trialAppFilter = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".platform-tenants__segment-tab"),
    ).find((button) => button.textContent?.includes("试用申请"));
    expect(trialAppFilter).toBeTruthy();
    trialAppFilter?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    render(renderPlatformPortShell(model), container);
    expect(container.textContent).toContain("Pending Co");
    expect(container.textContent).not.toContain("Beta");

    // Open application detail from unified list.
    const pendingRow = Array.from(
      container.querySelectorAll<HTMLElement>(".platform-tenants__table-row"),
    ).find((row) => row.textContent?.includes("Pending Co"));
    pendingRow?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    render(renderPlatformPortShell(model), container);
    expect(window.location.hash).toContain("app%3Aapp-pending-1");
    expect(container.textContent).toContain("Pending Co");
    expect(container.textContent).toContain("申请信息");
    expect(container.textContent).toContain("批准申请");
    expect(container.textContent).not.toContain("7 天调用");

    // Back to list then open tenant detail.
    container
      .querySelector<HTMLButtonElement>(".platform-tenants__detail-crumb button")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    render(renderPlatformPortShell(model), container);
    const clearFilters = container.querySelector<HTMLButtonElement>(
      ".platform-tenants__filterbar-reset",
    );
    clearFilters?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    render(renderPlatformPortShell(model), container);

    const detailAction = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="查看详情 — Acme"]',
    );
    expect(detailAction?.getAttribute("href")).toContain("tenant%3Aacme");
    detailAction?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    render(renderPlatformPortShell(model), container);
    expect(window.location.hash).toContain("tenant%3Aacme");
    expect(container.textContent).toContain("基本信息");
    expect(container.textContent).toContain("使用与资源");
    expect(container.textContent).toContain("计费与配额");
    expect(container.textContent).toContain("风险与策略");
    expect(container.textContent).toContain("操作记录");
    expect(container.textContent).not.toContain("企业主控台");
    expect(container.textContent).not.toContain("租户运营工作区");

    expect(container.querySelector('[data-testid="tenant-detail-tab-risks"]')).not.toBeNull();
    container.querySelector<HTMLButtonElement>('[data-testid="tenant-detail-tab-risks"]')!.click();
    render(renderPlatformPortShell(model), container);
    const controlsTab = container.querySelector<HTMLButtonElement>(
      '[data-testid="tenant-detail-subtab-controls"]',
    );
    expect(controlsTab).not.toBeNull();
    controlsTab!.click();
    render(renderPlatformPortShell(model), container);
    expect(window.location.hash).toContain(":controls");
    expect(container.textContent).toContain("策略");
    container
      .querySelector<HTMLButtonElement>('[data-testid="tenant-detail-tab-logs"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    render(renderPlatformPortShell(model), container);
    expect(window.location.hash).toContain(":logs");
    expect(container.textContent).toContain("操作记录");
    expect(container.textContent).not.toContain("导出日志");

    container
      .querySelector<HTMLButtonElement>(".platform-tenants__detail-crumb button")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    render(renderPlatformPortShell(model), container);
    const createTenantLink = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(
        'a[href="/platform/tenants#create-formal-advanced"]',
      ),
    ).find((link) => link.textContent?.includes("创建租户"));
    expect(createTenantLink).not.toBeNull();
    createTenantLink?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    render(renderPlatformPortShell(model), container);
    expect(container.querySelector(".platform-create-tenant-drawer")).toBeNull();
    expect(container.textContent).toContain("创建租户 · 完整模式");
  });

  it("shows platform auth entry on system settings without platform-admin capability", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const shellProps = {
      state: { tab: "platformSystemSettings" },
      subnavProps: {
        tabs: ["platformDashboard", "platformSystemSettings"],
        activeTab: "platformSystemSettings",
        basePath: "",
        onOpenConsoleTab: noop,
      },
      channelsProps: createPlatformChannelsProps(),
      readModel: {
        currentTenantId: "acme",
        currentTenantLabel: "Acme",
        knownTenantIds: ["acme"],
        tenantDirectory: [{ tenantId: "acme", label: "Acme" }],
        agentCount: 1,
        featureMethodCount: 4,
        channelCount: 2,
        channelIds: ["slack", "telegram"],
        accountCount: 1,
        connectedAccountCount: 1,
        presenceCount: 1,
        runtimeHosts: ["runtime-a"],
        sessionsCount: 2,
        totalTokens: 300,
        totalCost: 2.1,
        missingCostEntries: 0,
        modelMode: "pool",
        configuredProviderCount: 1,
        providerIds: ["openai"],
        configuredModelCount: 1,
        configuredModelIds: ["gpt-5.4"],
        installedCapabilityCount: 2,
        attentionItems: [],
        currentVersion: "1.0.0",
        latestVersion: "1.0.0",
        hasUpdateAvailable: false,
        cronEnabled: true,
        cronNextAt: 123,
        operatorUser: "alice@example.com",
        operatorRole: "operator",
      },
      authPanelProps: {
        state: {
          enabled: true,
          availableModes: ["enterprise-create", "enterprise-activate", "login"],
        },
        session: null,
        mode: "enterprise-create",
        busy: false,
        error: null,
        notice: null,
        email: "",
        password: "",
        displayName: "",
        platformAdminDisplayName: "",
        tenantName: "",
        inviteCode: "",
        currentPassword: "",
        newPassword: "",
        policyTrialDays: "",
        policySeatCount: "",
        policyUpgradeUrl: "",
        policyContactAdvisorUrl: "",
        instanceEnterpriseId: "",
        instanceTrialDays: "",
        instanceSeatCount: "",
        instanceUpgradeUrl: "",
        instanceContactAdvisorUrl: "",
        platformAdminEmail: "",
        platformAdminPassword: "",
        platformAdminScopes: [],
        onModeChange: noop,
        onEmailChange: noop,
        onPasswordChange: noop,
        onDisplayNameChange: noop,
        onPlatformAdminDisplayNameChange: noop,
        onTenantNameChange: noop,
        onInviteCodeChange: noop,
        onCurrentPasswordChange: noop,
        onNewPasswordChange: noop,
        onPolicyTrialDaysChange: noop,
        onPolicySeatCountChange: noop,
        onPolicyUpgradeUrlChange: noop,
        onPolicyContactAdvisorUrlChange: noop,
        onInstanceEnterpriseIdChange: noop,
        onInstanceTrialDaysChange: noop,
        onInstanceSeatCountChange: noop,
        onInstanceUpgradeUrlChange: noop,
        onInstanceContactAdvisorUrlChange: noop,
        onPlatformAdminEmailChange: noop,
        onPlatformAdminPasswordChange: noop,
        onPlatformAdminScopesChange: noop,
        onSubmit: noop,
        onCreatePlatformAdmin: noop,
      },
      surfaceActions: {
        dashboard: { onRefresh: noop },
        tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
        capabilities: {
          onRefresh: noop,
          onRefreshCatalog: noop,
          onRefreshInstalled: noop,
          onRefreshSetupHealth: noop,
        },
        models: {
          onRefresh: noop,
          onRefreshPool: noop,
          onRefreshPolicies: noop,
          onRefreshOverrides: noop,
        },
        platformAgents: {
          onRefresh: noop,
          onRefreshFleet: noop,
          onRefreshWorkspaces: noop,
        },
        advanced: {
          onRefresh: noop,
          onRefreshChannels: noop,
          onRefreshInstances: noop,
          onRefreshUsage: noop,
        },
        systemSettings: {
          onRefresh: noop,
        },
      },
    };

    render(renderPlatformPortShell(shellProps as never), container);

    expect(container.textContent).toContain("平台管理员登录");
    expect(container.textContent).toContain("当前会话还没有系统设置权限");
    expect(
      [...container.querySelectorAll("button")].some((button) =>
        button.textContent?.includes("创建企业租户"),
      ),
    ).toBe(false);
  });

  it("migrates the legacy create-tenant drawer hash to the full create page", () => {
    window.history.replaceState({}, "", "/platform/tenants#open-create-tenant");
    const container = document.createElement("div");
    document.body.append(container);

    const shellProps = {
      state: { tab: "platformTenants" },
      subnavProps: {
        tabs: ["platformDashboard", "platformTenants"],
        activeTab: "platformTenants",
        basePath: "",
        onOpenConsoleTab: noop,
      },
      channelsProps: createPlatformChannelsProps(),
      readModel: {
        currentTenantId: "acme",
        currentTenantLabel: "Acme",
        knownTenantIds: ["acme"],
        tenantDirectory: [{ tenantId: "acme", label: "Acme" }],
        enterpriseDirectory: [],
        agentCount: 1,
        featureMethodCount: 4,
        channelCount: 1,
        channelIds: ["slack"],
        accountCount: 1,
        connectedAccountCount: 1,
        presenceCount: 1,
        runtimeHosts: ["runtime-a"],
        sessionsCount: 2,
        totalTokens: 300,
        totalCost: 2.1,
        missingCostEntries: 0,
        modelMode: "pool",
        configuredProviderCount: 1,
        providerIds: ["openai"],
        configuredModelCount: 1,
        configuredModelIds: ["gpt-5.4"],
        installedCapabilityCount: 2,
        attentionItems: [],
        currentVersion: "1.0.0",
        latestVersion: "1.0.0",
        hasUpdateAvailable: false,
        cronEnabled: true,
        cronNextAt: 123,
        operatorUser: "ops@example.com",
        operatorRole: "platform-admin",
      },
      authPanelProps: {
        state: {
          enabled: true,
          sessionKind: "platform-admin",
          platformRole: "admin",
          canManagePlatform: true,
          platformPolicy: {
            defaultTrialDays: 14,
            defaultTrialSeatCount: 20,
            upgradeUrl: "https://example.com/upgrade",
            contactAdvisorUrl: "https://example.com/advisor",
          },
          platformEnterprises: [],
        },
        session: {
          provider: "trusted-proxy",
          user: "ops@example.com",
          displayName: "Ops",
          tenantId: null,
          role: "platform-admin",
          scopes: [],
        },
        mode: "platform-enterprise-create",
        busy: false,
        error: null,
        notice: null,
        email: "admin@upbeyond.com",
        password: "",
        displayName: "Admin",
        platformAdminDisplayName: "",
        tenantName: "UPBEYOND",
        inviteCode: "",
        currentPassword: "",
        newPassword: "",
        policyTrialDays: "",
        policySeatCount: "",
        policyUpgradeUrl: "",
        policyContactAdvisorUrl: "",
        instanceEnterpriseId: "",
        instanceTrialDays: "30",
        instanceSeatCount: "50",
        instanceUpgradeUrl: "",
        instanceContactAdvisorUrl: "",
        platformAdminEmail: "",
        platformAdminPassword: "",
        platformAdminScopes: [],
        onModeChange: noop,
        onEmailChange: noop,
        onPasswordChange: noop,
        onDisplayNameChange: noop,
        onPlatformAdminDisplayNameChange: noop,
        onTenantNameChange: noop,
        onInviteCodeChange: noop,
        onCurrentPasswordChange: noop,
        onNewPasswordChange: noop,
        onPolicyTrialDaysChange: noop,
        onPolicySeatCountChange: noop,
        onPolicyUpgradeUrlChange: noop,
        onPolicyContactAdvisorUrlChange: noop,
        onInstanceEnterpriseIdChange: noop,
        onInstanceTrialDaysChange: noop,
        onInstanceSeatCountChange: noop,
        onInstanceUpgradeUrlChange: noop,
        onInstanceContactAdvisorUrlChange: noop,
        onPlatformAdminEmailChange: noop,
        onPlatformAdminPasswordChange: noop,
        onPlatformAdminScopesChange: noop,
        onSubmit: noop,
        onCreatePlatformAdmin: noop,
        onLogout: noop,
        onCreateInvite: noop,
        onRevokeInvite: noop,
        onRemoveMember: noop,
        onChangePassword: noop,
        onUpdateTrialPolicy: noop,
        onUpdateTrialInstance: noop,
        onUpdateEnterpriseAdmin: noop,
        onResendEnterpriseAdminActivation: noop,
      },
      surfaceActions: {
        dashboard: { onRefresh: noop },
        tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
        capabilities: {
          onRefresh: noop,
          onRefreshCatalog: noop,
          onRefreshInstalled: noop,
          onRefreshSetupHealth: noop,
        },
        models: {
          onRefresh: noop,
          onRefreshPool: noop,
          onRefreshPolicies: noop,
          onRefreshOverrides: noop,
        },
        platformAgents: {
          onRefresh: noop,
          onRefreshFleet: noop,
          onRefreshWorkspaces: noop,
        },
        advanced: {
          onRefresh: noop,
          onRefreshChannels: noop,
          onRefreshInstances: noop,
          onRefreshUsage: noop,
        },
        systemSettings: {
          onRefresh: noop,
        },
      },
    };

    render(renderPlatformPortShell(shellProps as never), container);

    expect(window.location.hash).toBe("#create-formal-advanced");
    expect(container.querySelector(".platform-create-tenant-drawer")).toBeNull();
    expect(container.textContent).toContain("创建租户 · 完整模式");
  });

  it("renders the full-page formal / advanced create flow at #create-formal-advanced", () => {
    window.history.replaceState({}, "", "/platform/tenants#create-formal-advanced");
    const container = document.createElement("div");
    document.body.append(container);
    const onPlatformAuthModeChange = vi.fn();

    const shellProps = {
      state: { tab: "platformTenants" },
      subnavProps: {
        tabs: ["platformDashboard", "platformTenants"],
        activeTab: "platformTenants",
        basePath: "",
        onOpenConsoleTab: noop,
      },
      channelsProps: createPlatformChannelsProps(),
      readModel: {
        currentTenantId: "acme",
        currentTenantLabel: "Acme",
        knownTenantIds: ["acme"],
        tenantDirectory: [{ tenantId: "acme", label: "Acme" }],
        enterpriseDirectory: [],
        agentCount: 1,
        featureMethodCount: 4,
        channelCount: 1,
        channelIds: ["slack"],
        accountCount: 1,
        connectedAccountCount: 1,
        presenceCount: 1,
        runtimeHosts: ["runtime-a"],
        sessionsCount: 2,
        totalTokens: 300,
        totalCost: 2.1,
        missingCostEntries: 0,
        modelMode: "pool",
        configuredProviderCount: 1,
        providerIds: ["openai"],
        configuredModelCount: 1,
        configuredModelIds: ["gpt-5.4"],
        installedCapabilityCount: 2,
        attentionItems: [],
        currentVersion: "1.0.0",
        latestVersion: "1.0.0",
        hasUpdateAvailable: false,
        cronEnabled: true,
        cronNextAt: 123,
        operatorUser: "ops@example.com",
        operatorRole: "platform-admin",
      },
      authPanelProps: {
        state: {
          enabled: true,
          sessionKind: "platform-admin",
          platformRole: "admin",
          canManagePlatform: true,
          platformPolicy: {
            defaultTrialDays: 14,
            defaultTrialSeatCount: 20,
            upgradeUrl: "https://example.com/upgrade",
            contactAdvisorUrl: "https://example.com/advisor",
          },
          platformEnterprises: [],
        },
        session: {
          provider: "trusted-proxy",
          user: "ops@example.com",
          displayName: "Ops",
          tenantId: null,
          role: "platform-admin",
          scopes: [],
        },
        mode: "platform-enterprise-create",
        busy: false,
        error: null,
        notice: null,
        email: "admin@example.com",
        password: "",
        displayName: "Admin",
        platformAdminDisplayName: "",
        tenantName: "Example",
        inviteCode: "",
        currentPassword: "",
        newPassword: "",
        policyTrialDays: "",
        policySeatCount: "",
        policyUpgradeUrl: "",
        policyContactAdvisorUrl: "",
        instanceEnterpriseId: "",
        instanceTrialDays: "",
        instanceSeatCount: "",
        instanceUpgradeUrl: "",
        instanceContactAdvisorUrl: "",
        platformAdminEmail: "",
        platformAdminPassword: "",
        platformAdminScopes: [],
        onModeChange: onPlatformAuthModeChange,
        onEmailChange: noop,
        onPasswordChange: noop,
        onDisplayNameChange: noop,
        onPlatformAdminDisplayNameChange: noop,
        onTenantNameChange: noop,
        onInviteCodeChange: noop,
        onCurrentPasswordChange: noop,
        onNewPasswordChange: noop,
        onPolicyTrialDaysChange: noop,
        onPolicySeatCountChange: noop,
        onPolicyUpgradeUrlChange: noop,
        onPolicyContactAdvisorUrlChange: noop,
        onInstanceEnterpriseIdChange: noop,
        onInstanceTrialDaysChange: noop,
        onInstanceSeatCountChange: noop,
        onInstanceUpgradeUrlChange: noop,
        onInstanceContactAdvisorUrlChange: noop,
        onPlatformAdminEmailChange: noop,
        onPlatformAdminPasswordChange: noop,
        onPlatformAdminScopesChange: noop,
        onSubmit: noop,
        onCreatePlatformAdmin: noop,
        onLogout: noop,
        onCreateInvite: noop,
        onRevokeInvite: noop,
        onRemoveMember: noop,
        onChangePassword: noop,
        onUpdateTrialPolicy: noop,
        onUpdateTrialInstance: noop,
        onUpdateEnterpriseAdmin: noop,
        onResendEnterpriseAdminActivation: noop,
      },
      surfaceActions: {
        dashboard: { onRefresh: noop },
        tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
        capabilities: {
          onRefresh: noop,
          onRefreshCatalog: noop,
          onRefreshInstalled: noop,
          onRefreshSetupHealth: noop,
        },
        models: {
          onRefresh: noop,
          onRefreshPool: noop,
          onRefreshPolicies: noop,
          onRefreshOverrides: noop,
        },
        platformAgents: {
          onRefresh: noop,
          onRefreshFleet: noop,
          onRefreshWorkspaces: noop,
        },
        advanced: {
          onRefresh: noop,
          onRefreshChannels: noop,
          onRefreshInstances: noop,
          onRefreshUsage: noop,
        },
        systemSettings: {
          onRefresh: noop,
        },
      },
    };

    render(renderPlatformPortShell(shellProps as never), container);
    const fullPage = container.querySelector(".platform-tenant-full-create") as HTMLElement;
    expect(fullPage).not.toBeNull();
    // The full page contains the mode pill bar (drawer hides it).
    expect(fullPage.querySelector(".platform-tenant-create__mode-pills")).not.toBeNull();
    // Default lands on quick-trial; switch to formal.
    const formalButton = [...fullPage.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("正式企业"),
    );
    formalButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    render(renderPlatformPortShell(shellProps as never), container);
    const fullPageAfterFormal = container.querySelector(
      ".platform-tenant-full-create",
    ) as HTMLElement;
    // Wizard step 1: 3-step bar visible, sidebar preview open, only 企业身份 fields rendered.
    expect(fullPageAfterFormal.querySelector(".platform-tenant-create__wizard-bar")).not.toBeNull();
    expect(fullPageAfterFormal.querySelector(".platform-tenant-create__side")).not.toBeNull();
    expect(fullPageAfterFormal.textContent).toContain("企业身份");
    expect(fullPageAfterFormal.textContent).toContain("商业与 AI");
    expect(fullPageAfterFormal.textContent).toContain("安全与激活");
    // Submit button is gated until step 3.
    expect(
      [...fullPageAfterFormal.querySelectorAll("button")].some((button) =>
        button.textContent?.includes("创建正式企业租户"),
      ),
    ).toBe(false);

    // Step 1 → 2.
    const nextButton1 = [...fullPageAfterFormal.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "下一步",
    );
    nextButton1?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    render(renderPlatformPortShell(shellProps as never), container);
    const fullPageAfterStep2 = container.querySelector(
      ".platform-tenant-full-create",
    ) as HTMLElement;
    expect(fullPageAfterStep2.textContent).toContain("商业配置");
    expect(fullPageAfterStep2.textContent).toContain("AI 默认配置");
    expect(fullPageAfterStep2.textContent).toContain("SLA 等级");
    expect(
      [...fullPageAfterStep2.querySelectorAll("button")].some((button) =>
        button.textContent?.includes("创建正式企业租户"),
      ),
    ).toBe(false);

    // Step 2 → 3.
    const nextButton2 = [...fullPageAfterStep2.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "下一步",
    );
    nextButton2?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    render(renderPlatformPortShell(shellProps as never), container);
    const fullPageAfterStep3 = container.querySelector(
      ".platform-tenant-full-create",
    ) as HTMLElement;
    expect(fullPageAfterStep3.textContent).toContain("安全配置");
    expect(fullPageAfterStep3.textContent).toContain("激活与通知");
    expect(fullPageAfterStep3.textContent).toContain("创建正式企业租户");

    // Advanced mode (no wizard).
    const advancedButton = [...fullPageAfterStep3.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("高级创建"),
    );
    advancedButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    render(renderPlatformPortShell(shellProps as never), container);
    const fullPageAfterAdvanced = container.querySelector(
      ".platform-tenant-full-create",
    ) as HTMLElement;
    expect(fullPageAfterAdvanced.textContent).toContain("高级创建流程");
    expect(fullPageAfterAdvanced.textContent).toContain("模型白名单");
    expect(fullPageAfterAdvanced.textContent).toContain("资源隔离");
    expect(fullPageAfterAdvanced.textContent).toContain("提交高级创建审批");

    // Reset to quick-trial so other tests start clean.
    const quickButton = [...fullPageAfterAdvanced.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("快速试用企业"),
    );
    quickButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });

  it("shows platform admin management only for super administrators", () => {
    const superAdminContainer = document.createElement("div");
    document.body.append(superAdminContainer);

    render(
      renderPlatformPortShell({
        state: { tab: "platformSystemSettings" },
        subnavProps: {
          tabs: ["platformDashboard", "platformSystemSettings"],
          activeTab: "platformSystemSettings",
          basePath: "",
          onOpenConsoleTab: noop,
        },
        channelsProps: createPlatformChannelsProps(),
        readModel: {
          currentTenantId: "acme",
          currentTenantLabel: "Acme",
          knownTenantIds: ["acme"],
          tenantDirectory: [{ tenantId: "acme", label: "Acme" }],
          enterpriseDirectory: [],
          defaultModelPrimary: "openai/gpt-5.4",
          defaultModelFallbacks: ["anthropic/claude-sonnet-4.5"],
          defaultImageModelPrimary: "openai/gpt-image-1",
          allowlistedModelRefs: ["openai/gpt-5.4"],
          aliasCount: 1,
          agentCount: 1,
          featureMethodCount: 4,
          channelCount: 1,
          channelIds: ["slack"],
          accountCount: 1,
          connectedAccountCount: 1,
          presenceCount: 1,
          runtimeHosts: ["runtime-a"],
          sessionsCount: 2,
          totalTokens: 300,
          totalCost: 2.1,
          missingCostEntries: 0,
          modelMode: "pool",
          configuredProviderCount: 1,
          providerIds: ["openai"],
          configuredModelCount: 1,
          configuredModelIds: ["gpt-5.4"],
          installedCapabilityCount: 2,
          attentionItems: [],
          currentVersion: "1.0.0",
          latestVersion: "1.0.0",
          hasUpdateAvailable: false,
          cronEnabled: true,
          cronNextAt: 123,
          operatorUser: "root@example.com",
          operatorRole: "platform-super-admin",
        },
        authPanelProps: {
          state: {
            enabled: true,
            sessionKind: "platform-super-admin",
            platformRole: "super-admin",
            canManagePlatform: true,
            canManagePlatformAdmins: true,
            platformAdmins: [
              {
                user: "root@example.com",
                displayName: "Root",
                platformRole: "super-admin",
                isCurrentUser: true,
                scopes: ["operator.admin", "operator.read"],
              },
              {
                user: "ops@example.com",
                displayName: "Ops",
                platformRole: "admin",
                scopes: ["operator.read"],
              },
            ],
            platformEnterprises: [],
          },
          session: {
            provider: "trusted-proxy",
            user: "root@example.com",
            displayName: "Root",
            tenantId: null,
            role: "platform-super-admin",
            scopes: [],
          },
          mode: "platform-enterprise-create",
          busy: false,
          error: null,
          notice: null,
          email: "",
          password: "",
          displayName: "",
          platformAdminDisplayName: "",
          tenantName: "",
          inviteCode: "",
          currentPassword: "",
          newPassword: "",
          policyTrialDays: "",
          policySeatCount: "",
          policyUpgradeUrl: "",
          policyContactAdvisorUrl: "",
          instanceEnterpriseId: "",
          instanceTrialDays: "",
          instanceSeatCount: "",
          instanceUpgradeUrl: "",
          instanceContactAdvisorUrl: "",
          platformAdminEmail: "",
          platformAdminPassword: "",
          platformAdminScopes: [],
          onModeChange: noop,
          onEmailChange: noop,
          onPasswordChange: noop,
          onDisplayNameChange: noop,
          onPlatformAdminDisplayNameChange: noop,
          onTenantNameChange: noop,
          onInviteCodeChange: noop,
          onCurrentPasswordChange: noop,
          onNewPasswordChange: noop,
          onPolicyTrialDaysChange: noop,
          onPolicySeatCountChange: noop,
          onPolicyUpgradeUrlChange: noop,
          onPolicyContactAdvisorUrlChange: noop,
          onInstanceEnterpriseIdChange: noop,
          onInstanceTrialDaysChange: noop,
          onInstanceSeatCountChange: noop,
          onInstanceUpgradeUrlChange: noop,
          onInstanceContactAdvisorUrlChange: noop,
          onPlatformAdminEmailChange: noop,
          onPlatformAdminPasswordChange: noop,
          onPlatformAdminScopesChange: noop,
          onSubmit: noop,
          onCreatePlatformAdmin: noop,
          onLogout: noop,
          onCreateInvite: noop,
          onRevokeInvite: noop,
          onRemoveMember: noop,
          onChangePassword: noop,
          onUpdateTrialPolicy: noop,
          onUpdateTrialInstance: noop,
          onUpdateEnterpriseAdmin: noop,
          onResendEnterpriseAdminActivation: noop,
        },
        surfaceActions: {
          dashboard: { onRefresh: noop },
          tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
          capabilities: {
            onRefresh: noop,
            onRefreshCatalog: noop,
            onRefreshInstalled: noop,
            onRefreshSetupHealth: noop,
          },
          models: {
            onRefresh: noop,
            onRefreshPool: noop,
            onRefreshPolicies: noop,
            onRefreshOverrides: noop,
          },
          platformAgents: {
            onRefresh: noop,
            onRefreshFleet: noop,
            onRefreshWorkspaces: noop,
          },
          advanced: {
            onRefresh: noop,
            onRefreshChannels: noop,
            onRefreshInstances: noop,
            onRefreshUsage: noop,
          },
          systemSettings: {
            onRefresh: noop,
          },
        },
      } as never),
      superAdminContainer,
    );

    expect(superAdminContainer.textContent).toContain("平台管理员");
    expect(superAdminContainer.textContent).toContain("超级管理员");
    expect(superAdminContainer.textContent).toContain("管理员");

    const adminContainer = document.createElement("div");
    document.body.append(adminContainer);

    render(
      renderPlatformPortShell({
        state: { tab: "platformSystemSettings" },
        subnavProps: {
          tabs: ["platformDashboard", "platformSystemSettings"],
          activeTab: "platformSystemSettings",
          basePath: "",
          onOpenConsoleTab: noop,
        },
        channelsProps: createPlatformChannelsProps(),
        readModel: {
          currentTenantId: "acme",
          currentTenantLabel: "Acme",
          knownTenantIds: ["acme"],
          tenantDirectory: [{ tenantId: "acme", label: "Acme" }],
          enterpriseDirectory: [],
          defaultModelPrimary: "openai/gpt-5.4",
          defaultModelFallbacks: ["anthropic/claude-sonnet-4.5"],
          defaultImageModelPrimary: "openai/gpt-image-1",
          allowlistedModelRefs: ["openai/gpt-5.4"],
          aliasCount: 1,
          agentCount: 1,
          featureMethodCount: 4,
          channelCount: 1,
          channelIds: ["slack"],
          accountCount: 1,
          connectedAccountCount: 1,
          presenceCount: 1,
          runtimeHosts: ["runtime-a"],
          sessionsCount: 2,
          totalTokens: 300,
          totalCost: 2.1,
          missingCostEntries: 0,
          modelMode: "pool",
          configuredProviderCount: 1,
          providerIds: ["openai"],
          configuredModelCount: 1,
          configuredModelIds: ["gpt-5.4"],
          installedCapabilityCount: 2,
          attentionItems: [],
          currentVersion: "1.0.0",
          latestVersion: "1.0.0",
          hasUpdateAvailable: false,
          cronEnabled: true,
          cronNextAt: 123,
          operatorUser: "ops@example.com",
          operatorRole: "platform-admin",
        },
        authPanelProps: {
          state: {
            enabled: true,
            sessionKind: "platform-admin",
            platformRole: "admin",
            canManagePlatform: true,
            platformEnterprises: [],
          },
          session: {
            provider: "trusted-proxy",
            user: "ops@example.com",
            displayName: "Ops",
            tenantId: null,
            role: "platform-admin",
            scopes: [],
          },
          mode: "platform-enterprise-create",
          busy: false,
          error: null,
          notice: null,
          email: "",
          password: "",
          displayName: "",
          platformAdminDisplayName: "",
          tenantName: "",
          inviteCode: "",
          currentPassword: "",
          newPassword: "",
          policyTrialDays: "",
          policySeatCount: "",
          policyUpgradeUrl: "",
          policyContactAdvisorUrl: "",
          instanceEnterpriseId: "",
          instanceTrialDays: "",
          instanceSeatCount: "",
          instanceUpgradeUrl: "",
          instanceContactAdvisorUrl: "",
          platformAdminEmail: "",
          platformAdminPassword: "",
          platformAdminScopes: [],
          onModeChange: noop,
          onEmailChange: noop,
          onPasswordChange: noop,
          onDisplayNameChange: noop,
          onPlatformAdminDisplayNameChange: noop,
          onTenantNameChange: noop,
          onInviteCodeChange: noop,
          onCurrentPasswordChange: noop,
          onNewPasswordChange: noop,
          onPolicyTrialDaysChange: noop,
          onPolicySeatCountChange: noop,
          onPolicyUpgradeUrlChange: noop,
          onPolicyContactAdvisorUrlChange: noop,
          onInstanceEnterpriseIdChange: noop,
          onInstanceTrialDaysChange: noop,
          onInstanceSeatCountChange: noop,
          onInstanceUpgradeUrlChange: noop,
          onInstanceContactAdvisorUrlChange: noop,
          onPlatformAdminEmailChange: noop,
          onPlatformAdminPasswordChange: noop,
          onPlatformAdminScopesChange: noop,
          onSubmit: noop,
          onCreatePlatformAdmin: noop,
          onLogout: noop,
          onCreateInvite: noop,
          onRevokeInvite: noop,
          onRemoveMember: noop,
          onChangePassword: noop,
          onUpdateTrialPolicy: noop,
          onUpdateTrialInstance: noop,
          onUpdateEnterpriseAdmin: noop,
          onResendEnterpriseAdminActivation: noop,
        },
        surfaceActions: {
          dashboard: { onRefresh: noop },
          tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
          capabilities: {
            onRefresh: noop,
            onRefreshCatalog: noop,
            onRefreshInstalled: noop,
            onRefreshSetupHealth: noop,
          },
          models: {
            onRefresh: noop,
            onRefreshPool: noop,
            onRefreshPolicies: noop,
            onRefreshOverrides: noop,
          },
          platformAgents: {
            onRefresh: noop,
            onRefreshFleet: noop,
            onRefreshWorkspaces: noop,
          },
          advanced: {
            onRefresh: noop,
            onRefreshChannels: noop,
            onRefreshInstances: noop,
            onRefreshUsage: noop,
          },
          systemSettings: {
            onRefresh: noop,
          },
        },
      } as never),
      adminContainer,
    );

    expect(adminContainer.textContent).not.toContain("Platform admin management");
  });

  it("renders a platform models mode switch in system settings and wires config actions", () => {
    window.history.replaceState(
      {},
      "",
      "/platform/system-settings#platform-system-settings:defaults",
    );
    const container = document.createElement("div");
    document.body.append(container);
    const onSetPlatformModelsMode = vi.fn();
    const onSaveConfig = vi.fn();

    render(
      renderPlatformPortShell({
        state: { tab: "platformSystemSettings", basePath: "" },
        subnavProps: {
          tabs: ["platformDashboard", "platformSystemSettings"],
          activeTab: "platformSystemSettings",
          basePath: "",
          onOpenConsoleTab: noop,
        },
        channelsProps: {
          ...createPlatformChannelsProps(),
          configForm: {
            gateway: {
              platform: {
                models: {
                  mode: "native",
                },
              },
            },
          },
          configFormDirty: true,
          configSaving: false,
        },
        readModel: {
          currentTenantId: "acme",
          currentTenantLabel: "Acme",
          knownTenantIds: ["acme"],
          tenantDirectory: [{ tenantId: "acme", label: "Acme" }],
          agentCount: 1,
          featureMethodCount: 4,
          channelCount: 1,
          channelIds: ["slack"],
          accountCount: 1,
          connectedAccountCount: 1,
          presenceCount: 1,
          runtimeHosts: ["runtime-a"],
          sessionsCount: 2,
          totalTokens: 300,
          totalCost: 2.1,
          missingCostEntries: 0,
          modelMode: "merge",
          configuredProviderCount: 1,
          providerIds: ["openai"],
          configuredModelCount: 1,
          configuredModelIds: ["gpt-5.4"],
          installedCapabilityCount: 2,
          attentionItems: [],
          currentVersion: "1.0.0",
          latestVersion: "1.0.0",
          hasUpdateAvailable: false,
          cronEnabled: true,
          cronNextAt: 123,
          operatorUser: "ops@example.com",
          operatorRole: "platform-admin",
          platformModelsMode: "native",
        },
        authPanelProps: {
          state: {
            enabled: true,
            sessionKind: "platform-admin",
            platformRole: "admin",
            canManagePlatform: true,
            platformEnterprises: [],
          },
          session: {
            provider: "trusted-proxy",
            user: "ops@example.com",
            displayName: "Ops",
            tenantId: null,
            role: "platform-admin",
            scopes: [],
          },
          mode: "platform-enterprise-create",
          busy: false,
          error: null,
          notice: null,
          email: "",
          password: "",
          displayName: "",
          platformAdminDisplayName: "",
          tenantName: "",
          inviteCode: "",
          currentPassword: "",
          newPassword: "",
          policyTrialDays: "",
          policySeatCount: "",
          policyUpgradeUrl: "",
          policyContactAdvisorUrl: "",
          instanceEnterpriseId: "",
          instanceTrialDays: "",
          instanceSeatCount: "",
          instanceUpgradeUrl: "",
          instanceContactAdvisorUrl: "",
          platformAdminEmail: "",
          platformAdminPassword: "",
          platformAdminScopes: [],
          onModeChange: noop,
          onEmailChange: noop,
          onPasswordChange: noop,
          onDisplayNameChange: noop,
          onPlatformAdminDisplayNameChange: noop,
          onTenantNameChange: noop,
          onInviteCodeChange: noop,
          onCurrentPasswordChange: noop,
          onNewPasswordChange: noop,
          onPolicyTrialDaysChange: noop,
          onPolicySeatCountChange: noop,
          onPolicyUpgradeUrlChange: noop,
          onPolicyContactAdvisorUrlChange: noop,
          onInstanceEnterpriseIdChange: noop,
          onInstanceTrialDaysChange: noop,
          onInstanceSeatCountChange: noop,
          onInstanceUpgradeUrlChange: noop,
          onInstanceContactAdvisorUrlChange: noop,
          onPlatformAdminEmailChange: noop,
          onPlatformAdminPasswordChange: noop,
          onPlatformAdminScopesChange: noop,
          onSubmit: noop,
          onCreatePlatformAdmin: noop,
          onLogout: noop,
          onCreateInvite: noop,
          onRevokeInvite: noop,
          onRemoveMember: noop,
          onChangePassword: noop,
          onUpdateTrialPolicy: noop,
          onUpdateTrialInstance: noop,
          onUpdateEnterpriseAdmin: noop,
          onResendEnterpriseAdminActivation: noop,
        },
        surfaceActions: {
          dashboard: { onRefresh: noop },
          tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
          capabilities: {
            onRefresh: noop,
            onRefreshCatalog: noop,
            onRefreshInstalled: noop,
            onRefreshSetupHealth: noop,
          },
          models: {
            onRefresh: noop,
            onRefreshPool: noop,
            onRefreshPolicies: noop,
            onRefreshOverrides: noop,
          },
          platformAgents: {
            onRefresh: noop,
            onRefreshFleet: noop,
            onRefreshWorkspaces: noop,
          },
          advanced: {
            onRefresh: noop,
            onRefreshChannels: noop,
            onRefreshInstances: noop,
            onRefreshUsage: noop,
          },
          systemSettings: {
            onRefresh: noop,
            onSetPlatformModelsMode,
            onSaveConfig,
          },
        },
      } as never),
      container,
    );

    expect(container.textContent).toContain("模型管理运行模式");
    expect(container.textContent).toContain("模型管理模式");
    expect(container.textContent).toContain("当前运行 原生");
    expect(container.textContent).toContain("切换到 AOR 增强后将额外获得");
    expect(container.textContent).toContain("Live Coding 证据");

    const enhancedButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("AOR 增强"),
    );
    expect(enhancedButton).not.toBeNull();
    enhancedButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onSetPlatformModelsMode).toHaveBeenCalledWith("aor_enhanced");

    const saveButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("保存运行模式"),
    );
    expect(saveButton).not.toBeNull();
    // Saving a runtime mode requires explicit confirmation in the production UI.
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(confirm).toHaveBeenCalledWith(
      "确认保存模型管理运行模式？保存后，模型管理会在下次刷新时按新模式加载。",
    );
    expect(onSaveConfig).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(onSaveConfig).toHaveBeenCalledTimes(1);
  });

  it("renders enterprise mesh workspace modules", () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderEnterprisePortShell({
        state: { tab: "enterpriseMesh" },
        subnavProps: {
          tabs: ["enterpriseOverview", "enterpriseMesh"],
          activeTab: "enterpriseMesh",
          basePath: "",
          enterpriseTenantId: "acme",
          onOpenConsoleTab: noop,
        },
        isResolverSurface: false,
        resolverProps: {
          currentTenantId: "acme",
          authenticatedUser: "alice@example.com",
          options: [],
          onOpenTenant: noop,
        },
        readModel: {
          currentTenantId: "acme",
          currentTenantLabel: "Acme",
          connected: true,
          authenticatedUser: "alice@example.com",
          membershipRole: "enterprise-admin",
          memberCount: 4,
          memberUsers: ["alice@example.com", "bob@example.com"],
          adminCount: 1,
          latestInviteCode: "INVITE",
          latestInviteExpiresAt: "2026-04-20",
          agentCount: 3,
          defaultAgentId: "main",
          presenceCount: 2,
          runtimeHosts: ["runtime-a", "runtime-b"],
          sessionsCount: 6,
          nodeCount: 2,
          groupIds: ["sales", "support"],
          cronJobCount: 1,
          totalTokens: 500,
          totalCost: 4.2,
          missingCostEntries: 0,
          channelCount: 2,
          channelIds: ["slack", "telegram"],
          accountCount: 2,
          modelMode: "tenant",
          configuredProviderCount: 2,
          providerIds: ["openai", "anthropic"],
          configuredModelCount: 2,
          configuredModelIds: ["gpt-5.4", "claude-sonnet"],
          configValid: true,
          configIssueCount: 1,
          configIssueLabels: ["runtime drift"],
          meshSummary: {
            userCount: 4,
            agentCount: 3,
            groupCount: 2,
            onlineAgentCount: 2,
            activeAgentCount: 2,
            activeGroupCount: 1,
            activeAgentRate: 0.67,
            activeGroupRate: 0.5,
            totalCost: 4.2,
            totalTokens: 500,
            costPerSession: 0.7,
            sessionCount: 6,
            inefficientAssetCount: 0,
            unattributedCostCount: 0,
            unownedAssetCount: 0,
            governanceIssueCount: 1,
          },
          meshUsers: [],
          meshAgents: [],
          meshGroups: [],
          meshAnomalies: [],
          resolverOptions: [],
        },
        surfaceActions: {
          overview: { onRefresh: noop },
          organization: {
            onRefresh: noop,
            onCreateInvite: noop,
            onSubmitAuth: noop,
            onRefreshUsers: noop,
            onRefreshTeams: noop,
            onRefreshRoles: noop,
          },
          enterpriseAgents: {
            onRefresh: noop,
            onRefreshAssignments: noop,
            onRefreshTemplates: noop,
          },
          mesh: {
            onRefresh: noop,
            onRefreshOverview: noop,
            onRefreshRuntime: noop,
            onRefreshIncidents: noop,
          },
          usage: {
            onRefresh: noop,
            onRefreshBreakdown: noop,
            onRefreshHistory: noop,
          },
          settings: {
            onRefresh: noop,
            onLogout: noop,
            onRefreshIntegrations: noop,
            onRefreshPolicies: noop,
          },
        },
        authPanelProps: null,
      } as never),
      container,
    );

    const meshPage = container.querySelector("governance-assets-page");
    expect(meshPage).not.toBeNull();
    expect((meshPage as HTMLElement).tagName.toLowerCase()).toBe("governance-assets-page");
  });

  it("renders enterprise module previews without a duplicated tenant chooser block", () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderEnterprisePortShell({
        state: { tab: "enterpriseOrganization", basePath: "" },
        subnavProps: {
          tabs: ["enterpriseOverview", "enterpriseOrganization"],
          activeTab: "enterpriseOrganization",
          basePath: "",
          enterpriseTenantId: null,
          onOpenConsoleTab: noop,
        },
        isResolverSurface: true,
        resolverProps: {
          currentTenantId: null,
          authenticatedUser: "alice@example.com",
          options: [],
          onOpenTenant: noop,
        },
        readModel: {
          currentTenantId: null,
          currentTenantLabel: null,
          authenticatedUser: "alice@example.com",
          membershipRole: "enterprise-member",
          memberCount: 0,
          memberUsers: [],
          adminCount: 0,
          latestInviteCode: null,
          latestInviteExpiresAt: null,
          agentCount: 0,
          defaultAgentId: null,
          presenceCount: 0,
          runtimeHosts: [],
          sessionsCount: 0,
          nodeCount: 0,
          groupIds: [],
          cronJobCount: 0,
          totalTokens: 0,
          totalCost: 0,
          missingCostEntries: 0,
          channelCount: 0,
          channelIds: [],
          accountCount: 0,
          modelMode: "tenant",
          configuredProviderCount: 0,
          providerIds: [],
          configuredModelCount: 0,
          configuredModelIds: [],
          configValid: false,
          configIssueCount: 0,
          configIssueLabels: [],
          resolverOptions: [],
        },
        surfaceActions: {
          overview: { onRefresh: noop },
          organization: {
            onRefresh: noop,
            onCreateInvite: noop,
            onSubmitAuth: noop,
            onRefreshUsers: noop,
            onRefreshTeams: noop,
            onRefreshRoles: noop,
          },
          enterpriseAgents: {
            onRefresh: noop,
            onRefreshAssignments: noop,
            onRefreshTemplates: noop,
          },
          mesh: {
            onRefresh: noop,
            onRefreshOverview: noop,
            onRefreshRuntime: noop,
            onRefreshIncidents: noop,
          },
          usage: {
            onRefresh: noop,
            onRefreshBreakdown: noop,
            onRefreshHistory: noop,
          },
          settings: {
            onRefresh: noop,
            onLogout: noop,
            onRefreshIntegrations: noop,
            onRefreshPolicies: noop,
          },
        },
        authPanelProps: null,
      } as never),
      container,
    );

    expect(container.textContent).not.toContain("Choose a tenant");
    expect(container.textContent).toContain("当前还没有可用租户");
    expect(container.textContent).toContain("用户");
    expect(container.textContent).toContain("团队与群组");
    expect(container.textContent).toContain("角色与权限");
  });

  it("renders enterprise overview as activity, agent usage, cost snapshot, and alerts workspaces", () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderEnterprisePortShell({
        state: { tab: "enterpriseOverview", basePath: "" },
        subnavProps: {
          tabs: ["enterpriseOverview", "enterpriseSettings"],
          activeTab: "enterpriseOverview",
          basePath: "",
          enterpriseTenantId: "acme",
          onOpenConsoleTab: noop,
        },
        isResolverSurface: false,
        resolverProps: {
          currentTenantId: "acme",
          authenticatedUser: "alice@example.com",
          options: [],
          onOpenTenant: noop,
        },
        readModel: {
          currentTenantId: "acme",
          currentTenantLabel: "Acme",
          connected: true,
          authenticatedUser: "alice@example.com",
          membershipRole: "enterprise-admin",
          memberCount: 4,
          memberUsers: ["alice@example.com", "bob@example.com"],
          adminCount: 1,
          latestInviteCode: "INVITE",
          latestInviteExpiresAt: "2026-04-20",
          agentCount: 3,
          defaultAgentId: "main",
          presenceCount: 2,
          runtimeHosts: ["runtime-a", "runtime-b"],
          sessionsCount: 6,
          nodeCount: 2,
          groupIds: ["sales", "support"],
          cronJobCount: 1,
          totalTokens: 500,
          totalCost: 4.2,
          missingCostEntries: 1,
          channelCount: 2,
          channelIds: ["slack", "telegram"],
          accountCount: 2,
          modelMode: "tenant",
          configuredProviderCount: 2,
          providerIds: ["openai", "anthropic"],
          configuredModelCount: 2,
          configuredModelIds: ["gpt-5.4", "claude-sonnet"],
          configValid: true,
          configIssueCount: 1,
          configIssueLabels: ["runtime drift"],
          meshSummary: {
            userCount: 4,
            agentCount: 0,
            groupCount: 2,
            onlineAgentCount: 0,
            activeAgentCount: 0,
            activeGroupCount: 0,
            activeAgentRate: 0,
            activeGroupRate: 0,
            totalCost: 4.2,
            totalTokens: 500,
            costPerSession: 0.7,
            sessionCount: 6,
            inefficientAssetCount: 0,
            unattributedCostCount: 1,
            unownedAssetCount: 0,
            governanceIssueCount: 0,
          },
          meshUsers: [],
          meshAgents: [],
          meshGroups: [],
          meshAnomalies: [],
          resolverOptions: [],
        },
        surfaceActions: {
          overview: { onRefresh: noop },
          organization: {
            onRefresh: noop,
            onCreateInvite: noop,
            onSubmitAuth: noop,
            onRefreshUsers: noop,
            onRefreshTeams: noop,
            onRefreshRoles: noop,
          },
          enterpriseAgents: {
            onRefresh: noop,
            onRefreshAssignments: noop,
            onRefreshTemplates: noop,
          },
          mesh: {
            onRefresh: noop,
            onRefreshOverview: noop,
            onRefreshRuntime: noop,
            onRefreshIncidents: noop,
          },
          usage: {
            onRefresh: noop,
            onRefreshBreakdown: noop,
            onRefreshHistory: noop,
          },
          settings: {
            onRefresh: noop,
            onLogout: noop,
            onRefreshIntegrations: noop,
            onRefreshPolicies: noop,
          },
        },
        authPanelProps: null,
      } as never),
      container,
    );

    expect(container.textContent).toContain("Enterprise Overview");
    expect(container.textContent).toContain("优先处理");
    expect(container.textContent).toContain("系统状态");
    expect(container.textContent).toContain("快捷入口");

    const orgLink = [...container.querySelectorAll<HTMLAnchorElement>("a")].find((link) =>
      (link.getAttribute("href") ?? "").startsWith("/enterprise/acme/organization/users"),
    );
    expect(orgLink).not.toBeNull();
    orgLink?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    expect(window.location.pathname.startsWith("/enterprise/acme/organization/users")).toBe(true);
  });

  it("renders enterprise settings as model keys, access, and policies workspaces", () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderEnterprisePortShell({
        state: { tab: "enterpriseSettings", basePath: "" },
        subnavProps: {
          tabs: ["enterpriseOverview", "enterpriseSettings"],
          activeTab: "enterpriseSettings",
          basePath: "",
          enterpriseTenantId: "acme",
          onOpenConsoleTab: noop,
        },
        isResolverSurface: false,
        resolverProps: {
          currentTenantId: "acme",
          authenticatedUser: "alice@example.com",
          options: [],
          onOpenTenant: noop,
        },
        readModel: {
          currentTenantId: "acme",
          currentTenantLabel: "Acme",
          connected: true,
          authenticatedUser: "alice@example.com",
          membershipRole: "enterprise-admin",
          memberCount: 4,
          memberUsers: ["alice@example.com", "bob@example.com"],
          adminCount: 1,
          latestInviteCode: "INVITE",
          latestInviteExpiresAt: "2026-04-20",
          agentCount: 3,
          defaultAgentId: "main",
          presenceCount: 2,
          runtimeHosts: ["runtime-a", "runtime-b"],
          sessionsCount: 6,
          nodeCount: 2,
          groupIds: ["sales", "support"],
          cronJobCount: 1,
          totalTokens: 500,
          totalCost: 4.2,
          missingCostEntries: 0,
          channelCount: 2,
          channelIds: ["slack", "telegram"],
          accountCount: 2,
          modelMode: "tenant",
          configuredProviderCount: 2,
          providerIds: ["openai", "anthropic"],
          configuredModelCount: 2,
          configuredModelIds: ["gpt-5.4", "claude-sonnet"],
          configValid: true,
          configIssueCount: 1,
          configIssueLabels: ["runtime drift"],
          identityCount: 0,
          identityAlerts: [],
          identityGovernanceStats: {
            total: 0,
            connected: 0,
            atRisk: 0,
            inUse: 0,
            unused: 0,
          },
          meshSummary: {
            userCount: 4,
            agentCount: 3,
            groupCount: 2,
            onlineAgentCount: 2,
            activeAgentCount: 2,
            activeGroupCount: 1,
            activeAgentRate: 0.67,
            activeGroupRate: 0.5,
            totalCost: 4.2,
            totalTokens: 500,
            costPerSession: 0.7,
            sessionCount: 6,
            inefficientAssetCount: 0,
            unattributedCostCount: 0,
            unownedAssetCount: 0,
            governanceIssueCount: 1,
          },
          meshUsers: [],
          meshAgents: [],
          meshGroups: [],
          meshAnomalies: [],
          resolverOptions: [],
        },
        surfaceActions: {
          overview: { onRefresh: noop },
          organization: {
            onRefresh: noop,
            onCreateInvite: noop,
            onSubmitAuth: noop,
            onRefreshUsers: noop,
            onRefreshTeams: noop,
            onRefreshRoles: noop,
          },
          enterpriseAgents: {
            onRefresh: noop,
            onRefreshAssignments: noop,
            onRefreshTemplates: noop,
          },
          mesh: {
            onRefresh: noop,
            onRefreshOverview: noop,
            onRefreshRuntime: noop,
            onRefreshIncidents: noop,
          },
          usage: {
            onRefresh: noop,
            onRefreshBreakdown: noop,
            onRefreshHistory: noop,
          },
          settings: {
            onRefresh: noop,
            onLogout: noop,
            onRefreshIntegrations: noop,
            onRefreshPolicies: noop,
          },
        },
        authPanelProps: null,
      } as never),
      container,
    );

    expect(container.textContent).toContain("管理员与访问");
    expect(container.textContent).toContain("企业信息");
    expect(container.textContent).toContain("模型管理");
    expect(container.textContent).toContain("审计与安全");
  });
});
