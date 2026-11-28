// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { renderPlatformPortShell } from "./platform-shell.ts";

function noop() {
  return undefined;
}

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

function createChannelsProps() {
  return {
    connected: true,
    loading: false,
    snapshot: {
      channelMeta: [],
      channelOrder: [],
      channelLabels: {},
      channelAccounts: {},
      channels: {},
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

function createPlatformAgentsModel() {
  const now = Date.now();
  return {
    state: { tab: "platformAgents", basePath: "" },
    subnavProps: {
      tabs: ["platformDashboard", "platformAgents"],
      activeTab: "platformAgents",
      basePath: "",
      onOpenConsoleTab: noop,
    },
    channelsProps: createChannelsProps(),
    readModel: {
      currentTenantId: "acme",
      currentTenantLabel: "Acme",
      knownTenantIds: ["acme", "globex"],
      tenantDirectory: [
        { tenantId: "acme", label: "Acme" },
        { tenantId: "globex", label: "Globex" },
      ],
      enterpriseDirectory: [{ tenantId: "acme", label: "Acme" }],
      agentDirectory: [],
      modelDirectory: [],
      gatewayCatalogModels: [],
      taskPlanDirectory: [],
      routingPolicyDirectory: [],
      gatewayCatalogCount: 0,
      defaultModelPrimary: null,
      defaultModelFallbacks: [],
      defaultImageModelPrimary: null,
      allowlistedModelRefs: [],
      allowlistEntries: [],
      aliasCount: 0,
      providerHealthDirectory: [],
      agentCount: 2,
      featureMethodCount: 0,
      channelCount: 0,
      channelIds: [],
      accountCount: 0,
      connectedAccountCount: 0,
      nodeCount: 1,
      presenceCount: 1,
      runtimeHosts: [],
      sessionsCount: 2,
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
      modelMode: null,
      configuredProviderCount: 0,
      providerIds: [],
      configuredModelCount: 0,
      configuredModelIds: [],
      installedCapabilityCount: 0,
      attentionItems: [],
      currentVersion: "2026.3.9",
      latestVersion: "2026.3.9",
      hasUpdateAvailable: false,
      cronEnabled: null,
      cronNextAt: null,
      operatorUser: "alice@example.com",
      operatorRole: "operator",
      latestInvite: null,
      runtimeAgents: [
        {
          runtimeAgentId: "rt-aegis-1",
          name: "Aegis",
          runtimeVersion: "2026.3.9",
          lifecycle: "deployed",
          health: "healthy",
          tenantCoverage: ["acme", "globex"],
          boundCapabilityCount: 3,
          activeSessionCount: 2,
          resourceUsage: {
            cpuPercent: 32,
            memoryPercent: 48,
            tokenBudgetUsedPercent: 12,
          },
          deployedAt: now - 86_400_000,
          lastActiveAt: now - 2_000,
        },
        {
          runtimeAgentId: "rt-upbeyond-1",
          name: "UPBEYOND",
          runtimeVersion: "2026.3.9",
          lifecycle: "deployed",
          health: "healthy",
          tenantCoverage: ["acme"],
          boundCapabilityCount: 1,
          activeSessionCount: 0,
          resourceUsage: {
            cpuPercent: 12,
            memoryPercent: 24,
            tokenBudgetUsedPercent: 8,
          },
          deployedAt: now - 172_800_000,
          lastActiveAt: now - 604_800_000,
        },
      ],
      runtimeBindings: [
        {
          bindingId: "binding-1",
          runtimeAgentId: "rt-aegis-1",
          capabilityId: "urn:openclaw:skill:web-search@1.2.0",
          capabilityVersion: "1.2.0",
          bindingType: "platform-default",
          routingPriority: 90,
          loadStrategy: "lazy",
          bindingState: "active",
          healthStatus: "healthy",
          invocationMetrics: {
            calls7d: 120,
            successRate7d: 0.98,
            avgLatencyMs: 120,
            p95LatencyMs: 180,
            errorCount7d: 2,
            tokenConsumption7d: 2300,
          },
          policy: {
            sandbox: "strict",
            resourceQuota: "medium",
            hotReloadable: true,
          },
          fallbackBindingId: null,
          createdAt: now - 86_400_000,
          updatedAt: now - 3_600_000,
        },
        {
          bindingId: "binding-2",
          runtimeAgentId: "rt-upbeyond-1",
          capabilityId: "urn:openclaw:skill:xurl@1.0.0",
          capabilityVersion: "1.0.0",
          bindingType: "tenant-installed",
          routingPriority: 30,
          loadStrategy: "on-demand",
          bindingState: "active",
          healthStatus: "healthy",
          invocationMetrics: {
            calls7d: 8,
            successRate7d: 0.92,
            avgLatencyMs: 340,
            p95LatencyMs: 520,
            errorCount7d: 1,
            tokenConsumption7d: 900,
          },
          policy: {
            sandbox: "strict",
            resourceQuota: "small",
            hotReloadable: true,
          },
          fallbackBindingId: null,
          createdAt: now - 172_800_000,
          updatedAt: now - 7_200_000,
        },
        {
          // Cross-tenant fixture: same web-search capability also installed on
          // rt-upbeyond-1 (which only covers `acme`). With binding-1 attached
          // to rt-aegis-1 (covers `acme` + `globex`), the capability rolls up
          // into 2 distinct tenant buckets: `acme` (2 agents) and `globex`
          // (1 agent). Acme should sort above globex by total calls.
          bindingId: "binding-3",
          runtimeAgentId: "rt-upbeyond-1",
          capabilityId: "urn:openclaw:skill:web-search@1.2.0",
          capabilityVersion: "1.2.0",
          bindingType: "tenant-installed",
          routingPriority: 80,
          loadStrategy: "lazy",
          bindingState: "degraded",
          healthStatus: "degraded",
          invocationMetrics: {
            calls7d: 60,
            successRate7d: 0.85,
            avgLatencyMs: 520,
            p95LatencyMs: 900,
            errorCount7d: 9,
            tokenConsumption7d: 1700,
          },
          policy: {
            sandbox: "strict",
            resourceQuota: "small",
            hotReloadable: true,
          },
          fallbackBindingId: null,
          createdAt: now - 86_400_000,
          updatedAt: now - 1_800_000,
        },
      ],
      runtimeTelemetry: [],
      runtimeGovernanceIssues: [],
      runtimeKpi: undefined,
    },
    pageViewModels: {
      dashboard: {} as never,
      tenants: {} as never,
      capabilities: {} as never,
      models: {} as never,
      agents: {} as never,
      advanced: {} as never,
      systemSettings: {} as never,
    },
    surfaceActions: {
      dashboard: { onRefresh: noop },
      tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
      capabilities: {
        onRefresh: noop,
        onRefreshCatalog: noop,
        onRefreshInstalled: noop,
        onRefreshSetupHealth: noop,
        onSubmitExternalProposal: noop,
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
      systemSettings: { onRefresh: noop },
    },
  } as unknown as Parameters<typeof renderPlatformPortShell>[0];
}

describe("platform capability shell rerender", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  it("hides the platform login entry card when a platform admin session exists", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const model = {
      ...createPlatformAgentsModel(),
      state: {
        ...createPlatformAgentsModel().state,
        hello: {
          auth: {
            provider: "trusted-proxy",
            user: "ops@example.com",
            role: "operator",
            scopes: ["operator.admin"],
          },
        },
        platformAuthState: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          sessionKind: "platform-admin",
          session: {
            provider: "trusted-proxy",
            user: "ops@example.com",
            role: "operator",
            scopes: ["operator.admin"],
          },
        },
      },
    } as never;

    render(renderPlatformPortShell(model), container);

    const text = container.textContent ?? "";
    expect(text).not.toContain("平台登录入口");
    expect(text).not.toContain("当前未检测到平台管理员会话");
  });

  it("switches internal capability tabs inside the platform shell", () => {
    const container = document.createElement("div");
    document.body.append(container);
    window.history.replaceState({}, "", "/platform/capabilities#platform-capabilities:health");

    const model = {
      state: { tab: "platformCapabilities", basePath: "" },
      subnavProps: {
        tabs: ["platformDashboard", "platformCapabilities"],
        activeTab: "platformCapabilities",
        basePath: "",
        onOpenConsoleTab: noop,
      },
      channelsProps: createChannelsProps(),
      readModel: {
        currentTenantId: "acme",
        currentTenantLabel: "Acme",
        knownTenantIds: ["acme"],
        tenantDirectory: [{ tenantId: "acme", label: "Acme" }],
        enterpriseDirectory: [],
        agentDirectory: [],
        modelDirectory: [],
        gatewayCatalogModels: [],
        taskPlanDirectory: [],
        routingPolicyDirectory: [],
        gatewayCatalogCount: 0,
        defaultModelPrimary: null,
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
        nodeCount: 0,
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
        modelMode: null,
        configuredProviderCount: 0,
        providerIds: [],
        configuredModelCount: 0,
        configuredModelIds: [],
        installedCapabilityCount: 0,
        attentionItems: [],
        currentVersion: "1.0.0",
        latestVersion: "1.0.0",
        hasUpdateAvailable: false,
        cronEnabled: null,
        cronNextAt: null,
        operatorUser: "alice@example.com",
        operatorRole: "operator",
        latestInvite: null,
        runtimeAgents: [],
        runtimeBindings: [],
        runtimeTelemetry: [],
        runtimeGovernanceIssues: [],
        runtimeKpi: undefined,
      },
      pageViewModels: {
        dashboard: {} as never,
        tenants: {} as never,
        capabilities: {
          summary: [],
          summaryMetrics: {
            totalInCatalog: 0,
            totalInstalled: 0,
            tenantsCovered: 0,
            healthScoreLabel: "1 项提示",
            healthTone: "warn",
            attentionCount: 1,
            criticalCount: 0,
          },
          categories: [],
          catalogItems: [],
          installedItems: [],
          distributionRows: [],
          healthItemsV2: [
            {
              id: "issue-1",
              title: "camsnap",
              subtitle: "最近 7 天无调用",
              category: "vision",
              categoryLabel: "图像视觉",
              severity: "info",
              issueKind: "stale",
              meta: "需要确认是否继续保留",
            },
          ],
          setupNotes: [],
          setupChecklist: [],
          discoveredItems: [],
          discoveredCounts: {
            proposed: 0,
            underReview: 0,
            withFindings: 0,
            rejected: 0,
            total: 0,
          },
          registeredItems: [],
          activeItems: [],
          healthItems: [],
          skillsProps: null,
          snapshot: { proposals: [], registry: [], metrics: [] },
        },
        models: {} as never,
        agents: {} as never,
        advanced: {} as never,
        systemSettings: {} as never,
      },
      surfaceActions: {
        dashboard: { onRefresh: noop },
        tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
        capabilities: {
          onRefresh: noop,
          onRefreshCatalog: noop,
          onRefreshInstalled: noop,
          onRefreshSetupHealth: noop,
          onSubmitExternalProposal: noop,
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
        systemSettings: { onRefresh: noop },
      },
    } as never;

    render(renderPlatformPortShell(model), container);

    expect(container.querySelector(".platform-capabilities__tab.is-active")?.textContent).toContain(
      "健康问题",
    );
    expect(container.textContent).toContain("最近 7 天无调用");

    const catalogTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".platform-capabilities__tab"),
    ).find((node) => node.textContent?.includes("全部能力"));
    expect(catalogTab).toBeDefined();
    const popSpy = vi.fn();
    window.addEventListener("popstate", popSpy);
    catalogTab?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    window.removeEventListener("popstate", popSpy);
    render(renderPlatformPortShell(model), container);

    expect(popSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#platform-capabilities:catalog");
    expect(container.querySelector(".platform-capabilities__tab.is-active")?.textContent).toContain(
      "全部能力",
    );
    expect(container.textContent).toContain("尚无能力目录数据");
  });

  it("renders the platform agents page with Chinese labels and management actions", () => {
    const container = document.createElement("div");
    document.body.append(container);
    window.history.replaceState({}, "", "/platform/agents");

    const model = createPlatformAgentsModel();

    render(renderPlatformPortShell(model), container);

    expect(container.textContent).toContain("资产管理");
    expect(container.textContent).toContain("租户实例 / 运行版本");
    expect(container.textContent).toContain("健康状态");
    expect(container.textContent).toContain("Aegis");
    // Secondary metadata line stacks runtime version + encoded runtimeAgentId so
    // operators can copy it. The cleaned tenant/instance label still appears
    // on the primary line above (asserted by the "Aegis" check).
    expect(container.textContent).toContain("rt-aegis-1");
    expect(container.textContent).not.toContain("Runtime Catalog");

    const bindingsTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".platform-module-tab"),
    ).find((node) => node.textContent?.includes("能力绑定"));
    expect(bindingsTab).toBeDefined();
    const popSpy = vi.fn();
    window.addEventListener("popstate", popSpy);
    bindingsTab?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    window.removeEventListener("popstate", popSpy);
    render(renderPlatformPortShell(model), container);

    expect(popSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#agent-runtime:bindings");
    // Dual-view bindings page must expose both view-mode buttons and the search input.
    const viewSwitchButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".platform-agents-controls__view-btn"),
    ).map((node) => node.textContent?.trim());
    expect(viewSwitchButtons).toContain("按代理查看");
    expect(viewSwitchButtons).toContain("按能力查看");
    expect(container.querySelector(".platform-agents-controls__search input")).toBeTruthy();

    // The agent group should be expanded by default and reveal binding rows.
    expect(container.textContent).toContain("Web Search");
    expect(container.textContent).toContain("Xurl");

    // Each binding row exposes the three inline actions (启用 / 停用 / 设主能力).
    const inlineActionGroups = container.querySelectorAll<HTMLElement>(
      ".platform-agents-bindings__row-actions",
    );
    expect(inlineActionGroups.length).toBeGreaterThan(0);
    const firstRowButtons = Array.from(
      inlineActionGroups[0].querySelectorAll<HTMLButtonElement>("button"),
    );
    expect(firstRowButtons.map((b) => b.textContent?.trim())).toEqual(["启用", "停用", "设主能力"]);
    // Binding mutations have no RPC yet, so every inline action stays disabled.
    expect(firstRowButtons[0]?.disabled).toBe(true);
    expect(firstRowButtons[1]?.disabled).toBe(true);
    expect(firstRowButtons[1]?.title).toContain("网关未连接，绑定变更不可执行");

    // Switching to "按能力查看" must regroup by capability and update group headers.
    const capabilityViewBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".platform-agents-controls__view-btn"),
    ).find((node) => node.textContent?.includes("按能力查看"));
    expect(capabilityViewBtn).toBeDefined();
    capabilityViewBtn?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    render(renderPlatformPortShell(model), container);

    // Hash stays on bindings; capability-grouped headers still surface the capability names.
    expect(window.location.hash).toBe("#agent-runtime:bindings");
    expect(container.textContent).toContain("Web Search");
    expect(container.textContent).toContain("Xurl");

    // Platform-analysis tenant buckets must appear nested inside each capability
    // group. The tenant directory shipped above advertises Acme + Globex; the
    // web-search capability fixture spans both, so we expect both labels to surface.
    expect(container.querySelectorAll(".platform-agents-tenant-bucket").length).toBeGreaterThan(0);
    const tenantBucketTitles = Array.from(
      container.querySelectorAll<HTMLElement>(".platform-agents-tenant-bucket__title"),
    ).map((el) => el.textContent?.trim());
    expect(tenantBucketTitles).toContain("Acme");
    expect(tenantBucketTitles).toContain("Globex");

    // The capability-level header now exposes "覆盖企业 / 装载机器人 / 7 日错误" instead
    // of the old "使用代理 / 覆盖租户 / 装载条数" labels.
    expect(container.textContent).toContain("覆盖企业");
    expect(container.textContent).toContain("装载机器人");
    expect(container.textContent).toContain("7 日错误");
  });
});
