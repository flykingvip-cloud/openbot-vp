// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeSkillReport } from "../../../capability/capability-governance/normalizer.ts";
import type { SkillStatusReport } from "../../../types.ts";
import type { PlatformPortReadModel } from "../semantic/platform-read-model.ts";
import type { PlatformSurfaceProps } from "../shared/surface.ts";
import { buildPlatformPageViewModels } from "../view-models/builders.ts";
import {
  clearPlatformCapabilitiesActionMessageForTest,
  renderPlatformCapabilitiesSurface,
} from "./page.ts";

function createReadModel(): PlatformPortReadModel {
  return {
    currentTenantId: "tenant-a",
    currentTenantLabel: "Tenant A",
    knownTenantIds: ["tenant-a"],
    tenantDirectory: [{ tenantId: "tenant-a", label: "Tenant A" }],
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
    configuredProviderCount: 1,
    providerIds: ["openai"],
    configuredModelCount: 0,
    configuredModelIds: [],
    installedCapabilityCount: 0,
    attentionItems: [],
    currentVersion: "2026.3.9",
    latestVersion: "2026.3.9",
    hasUpdateAvailable: false,
    cronEnabled: null,
    cronNextAt: null,
    operatorUser: "ops@example.com",
    operatorRole: "super_admin",
    latestInvite: null,
    runtimeAgents: [],
    runtimeBindings: [],
    runtimeTelemetry: [],
    runtimeGovernanceIssues: [],
    runtimeKpi: undefined,
  };
}

function createSkillsReport(): SkillStatusReport {
  return {
    workspaceDir: "/tmp/workspace",
    managedSkillsDir: "/tmp/managed",
    skills: [
      {
        name: "github",
        description: "GitHub operations via gh",
        source: "openclaw-bundled",
        filePath: "~/.openclaw/skills/github/SKILL.md",
        baseDir: "~/.openclaw/skills",
        skillKey: "github",
        bundled: true,
        always: false,
        disabled: false,
        blockedByAllowlist: false,
        eligible: true,
        requirements: { bins: ["gh"], env: [], config: [], os: [] },
        missing: { bins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      },
      {
        name: "camsnap",
        description: "RTSP ONVIF image capture for cameras",
        source: "workspace",
        filePath: "/tmp/workspace/camsnap/SKILL.md",
        baseDir: "/tmp/workspace",
        skillKey: "camsnap",
        bundled: false,
        always: false,
        disabled: false,
        blockedByAllowlist: false,
        eligible: true,
        requirements: { bins: [], env: [], config: [], os: [] },
        missing: { bins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      },
    ],
  };
}

function createProps(): PlatformSurfaceProps {
  const readModel = createReadModel();
  const skillsReport = createSkillsReport();
  const snapshot = normalizeSkillReport(skillsReport, { now: () => "2026-05-10T00:00:00.000Z" });
  const pageViewModels = buildPlatformPageViewModels({
    basePath: "/platform",
    readModel,
    channelsProps: {} as never,
    authPanelProps: null,
    skillsProps: {
      loading: false,
      report: skillsReport,
      error: null,
      canManage: true,
      readOnlyReason: null,
      filter: "",
      edits: {},
      busyKey: null,
      messages: {},
      onFilterChange: () => {},
      onRefresh: () => {},
      onToggle: () => {},
      onEdit: () => {},
      onSaveKey: () => {},
      onInstall: () => {},
    } as never,
    instancesProps: null,
    configDirty: false,
    configSaving: false,
    capabilityGovernanceSnapshot: snapshot,
  });

  return {
    tab: "platformCapabilities",
    basePath: "/platform",
    readModel,
    channelsProps: {} as never,
    skillsProps: pageViewModels.capabilities.skillsProps ?? undefined,
    instancesProps: undefined,
    authPanelProps: null,
    pageViewModels,
    actions: {
      dashboard: { onRefresh: async () => {} },
      tenants: {
        onRefresh: async () => {},
        onRefreshDirectory: async () => {},
        onRefreshCoverage: async () => {},
      },
      capabilities: {
        onRefresh: async () => {},
        onRefreshCatalog: async () => {},
        onRefreshInstalled: async () => {},
        onRefreshSetupHealth: async () => {},
        onResolveRemoteImport: async () => [],
        onDiscover: async () => {},
        onSubmitExternalProposal: async () => {},
        onApproveProposal: async () => ({ ok: true as const }),
        onRejectProposal: async () => ({
          ok: false as const,
          message: "拒绝失败，提案状态未改变。",
        }),
        onPromoteDistribution: async () => {},
        onRevokeDistribution: async () => {},
        onDeprecate: async () => {},
        onRetire: async () => {},
        onUpdateManifest: async () => {},
        onRefreshEnterpriseSubmissions: async () => ({
          submissions: [],
          total: 0,
          pendingCount: 0,
          reviewingCount: 0,
        }),
        onReviewEnterpriseSubmission: async () => null as never,
        onPublishEnterpriseSubmission: async () => {},
        onRejectEnterpriseSubmission: async () => {},
        onReturnEnterpriseSubmission: async () => {},
        onApproveEnterpriseOnlySubmission: async () => {},
      },
      models: {
        onRefresh: async () => {},
        onRefreshPool: async () => {},
        onRefreshCatalog: async () => {},
        onProbeHealth: async () => {},
        onRefreshPolicies: async () => {},
        onRefreshOverrides: async () => {},
      },
      platformAgents: {
        onRefresh: async () => {},
        onRefreshFleet: async () => {},
        onRefreshWorkspaces: async () => {},
      },
      advanced: {
        onRefresh: async () => {},
        onRefreshChannels: async () => {},
        onRefreshInstances: async () => {},
        onRefreshUsage: async () => {},
      },
      systemSettings: { onRefresh: async () => {} },
      skills: {
        onRefresh: async () => {},
        onToggle: async () => {},
        onEdit: () => {},
        onSaveKey: async () => {},
        onInstall: async () => {},
      },
      instances: { onRefresh: async () => {} },
    } as never,
  };
}

describe("platform capabilities category routing", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    clearPlatformCapabilitiesActionMessageForTest();
    window.history.replaceState({}, "", "/platform/capabilities");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("updates hash and restores selected category from direct link", () => {
    const props = createProps();
    const container = document.createElement("div");
    document.body.append(container);

    render(renderPlatformCapabilitiesSurface(props), container);

    const visionChip = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".platform-capabilities__category-chip"),
    ).find((button) => button.textContent?.includes("图像视觉"));
    expect(visionChip).toBeDefined();

    visionChip?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    render(renderPlatformCapabilitiesSurface(props), container);
    expect(window.location.hash).toBe("#platform-capabilities:catalog?category=vision");
    expect(container.textContent).toContain("camsnap");
    expect(container.textContent).not.toContain("github");

    window.history.replaceState(
      {},
      "",
      "/platform/capabilities#platform-capabilities:catalog?category=code",
    );
    render(renderPlatformCapabilitiesSurface(props), container);

    const activeChip = container.querySelector<HTMLButtonElement>(
      '.platform-capabilities__category-chip[aria-selected="true"]',
    );
    expect(activeChip?.textContent).toContain("开发工具");
    expect(container.textContent).toContain("github");
    expect(container.textContent).not.toContain("camsnap");
  });

  it("keeps tab and category counts aligned with visible capability cards", () => {
    const props = createProps();
    const container = document.createElement("div");
    document.body.append(container);

    render(renderPlatformCapabilitiesSurface(props), container);

    const catalogTabCount = container.querySelector(
      ".platform-capabilities__tab.is-active .platform-capabilities__tab-count",
    );
    expect(catalogTabCount?.textContent?.trim()).toBe("2");

    const visionChip = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".platform-capabilities__category-chip"),
    ).find((button) => button.textContent?.includes("图像视觉"));
    expect(visionChip).toBeDefined();
    expect(
      visionChip?.querySelector(".platform-capabilities__category-chip-count")?.textContent?.trim(),
    ).toBe("1");

    visionChip?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    render(renderPlatformCapabilitiesSurface(props), container);

    const filteredCatalogTabCount = container.querySelector(
      ".platform-capabilities__tab.is-active .platform-capabilities__tab-count",
    );
    expect(filteredCatalogTabCount?.textContent?.trim()).toBe("2");
    const cardTitles = Array.from(
      container.querySelectorAll(".platform-capabilities__card-title"),
    ).map((node) => node.textContent?.trim());
    expect(cardTitles).toEqual(["camsnap"]);
  });

  it("keeps top-level tab counts aligned with the opened tab content", () => {
    const props = createProps();
    const container = document.createElement("div");
    document.body.append(container);

    render(renderPlatformCapabilitiesSurface(props), container);

    const openTab = (label: string) => {
      const button = Array.from(
        container.querySelectorAll<HTMLButtonElement>(".platform-capabilities__tab"),
      ).find((node) => node.textContent?.includes(label));
      expect(button).toBeDefined();
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      render(renderPlatformCapabilitiesSurface(props), container);
      return button;
    };

    const activeTabCount = () =>
      container
        .querySelector(".platform-capabilities__tab.is-active .platform-capabilities__tab-count")
        ?.textContent?.trim();

    expect(activeTabCount()).toBe("2");
    expect(container.querySelectorAll(".platform-capabilities__card").length).toBe(2);

    const topLevelCounts = () =>
      Array.from(container.querySelectorAll(".platform-capabilities__tab-count")).map((node) =>
        node.textContent?.trim(),
      );

    expect(topLevelCounts()).toEqual(["2", "2", "1", "0", "1", "0"]);

    openTab("已安装");
    expect(activeTabCount()).toBe("2");
    expect(container.querySelectorAll(".platform-capabilities__card").length).toBe(2);
    expect(topLevelCounts()).toEqual(["2", "2", "1", "0", "1", "0"]);

    openTab("待审阅");
    expect(activeTabCount()).toBe("1");
    expect(container.querySelectorAll(".platform-capabilities__discovery-item").length).toBe(1);
    expect(topLevelCounts()).toEqual(["2", "2", "1", "0", "1", "0"]);

    openTab("租户分发");
    expect(activeTabCount()).toBe("1");
    expect(container.querySelectorAll(".platform-capabilities__distribution-card").length).toBe(1);
    expect(topLevelCounts()).toEqual(["2", "2", "1", "0", "1", "0"]);

    openTab("健康问题");
    expect(activeTabCount()).toBe("0");
    expect(container.querySelectorAll(".platform-capabilities__health-item").length).toBe(0);
    expect(container.textContent).toContain("部署健康良好");
    expect(topLevelCounts()).toEqual(["2", "2", "1", "0", "1", "0"]);
  });

  it("renders health issues without redundant severity group headers in the all view", () => {
    const props = createProps();
    props.pageViewModels!.capabilities.healthItemsV2 = [
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
    ];
    const container = document.createElement("div");
    document.body.append(container);

    render(renderPlatformCapabilitiesSurface(props), container);

    const healthTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".platform-capabilities__tab"),
    ).find((node) => node.textContent?.includes("健康问题"));
    expect(healthTab).toBeDefined();
    healthTab?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    render(renderPlatformCapabilitiesSurface(props), container);

    expect(container.querySelector(".platform-capabilities__health-group-header")).toBeNull();
    expect(container.querySelectorAll(".platform-capabilities__health-item").length).toBe(1);
    expect(container.textContent).toContain("camsnap");
    expect(container.textContent).not.toContain("严重 10");
    expect(container.textContent).not.toContain("预警 33");
  });

  it("renders standard asset detail tabs and persists the selected detail tab in the hash", () => {
    const props = createProps();
    const container = document.createElement("div");
    document.body.append(container);

    render(renderPlatformCapabilitiesSurface(props), container);

    const githubCardButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".platform-capabilities__card-title-action"),
    ).find((button) => button.textContent?.includes("github"));
    expect(githubCardButton).toBeDefined();

    githubCardButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    render(renderPlatformCapabilitiesSurface(props), container);

    expect(container.textContent).toContain("定义");
    expect(container.textContent).toContain("安装与分发");

    const filesTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".asset-detail-tabs__tab"),
    ).find((button) => button.textContent?.includes("文件"));
    expect(filesTab).toBeDefined();

    filesTab?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    render(renderPlatformCapabilitiesSurface(props), container);

    expect(window.location.hash).toContain("#platform-capability:");
    expect(window.location.hash).toContain("detail=files");
    expect(container.textContent).toContain("~/.openclaw/skills/github/SKILL.md");
  });

  it("renders a runtime event timeline in the runtime tab", () => {
    const props = createProps();
    const container = document.createElement("div");
    document.body.append(container);

    render(renderPlatformCapabilitiesSurface(props), container);

    const githubCardButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".platform-capabilities__card-title-action"),
    ).find((button) => button.textContent?.includes("github"));
    githubCardButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    render(renderPlatformCapabilitiesSurface(props), container);

    const runtimeTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".asset-detail-tabs__tab"),
    ).find((button) => button.textContent?.includes("运行时"));
    expect(runtimeTab).toBeDefined();

    runtimeTab?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    render(renderPlatformCapabilitiesSurface(props), container);

    const text = container.textContent ?? "";
    expect(text).toContain("运行事件");
    expect(text).toContain("已接通");
    expect(text).toContain("github");
  });

  it("renders actionable content in the add capability dialog across the new user-facing tabs", async () => {
    const props = createProps();
    props.actions.capabilities.onResolveRemoteImport = async () => [];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    props.pageViewModels!.capabilities.discoveredItems = [
      {
        proposalId: "proposal:ext:notion",
        capabilityId: "urn:openclaw:skill:notion@1.0.0",
        title: "notion",
        subtitle: "发现到一项办公协同能力",
        status: "proposed",
        statusLabel: "待审阅",
        sourceLabel: "外部发现",
        trustTier: "external",
        riskLevel: "medium",
        findingCount: 1,
        highestFindingSeverity: "medium",
        submittedAt: "2026-05-10T00:00:00.000Z",
      },
    ];
    const container = document.createElement("div");
    document.body.append(container);

    render(renderPlatformCapabilitiesSurface(props), container);

    const openButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (node) => node.textContent?.includes("添加能力"),
    );
    expect(openButton).toBeDefined();
    openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    render(renderPlatformCapabilitiesSurface(props), container);

    expect(container.textContent).toContain("能力市场");
    expect(container.textContent).toContain("本地导入");
    expect(container.textContent).toContain("GitHub / URL");
    expect(container.textContent).toContain("能力市场");
    expect(container.textContent).not.toContain("企业能力");
    expect(container.textContent).not.toContain("来源管理");

    const marketTab = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (node) => node.textContent?.includes("能力市场"),
    );
    expect(marketTab).toBeDefined();
    marketTab?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    render(renderPlatformCapabilitiesSurface(props), container);
    expect(container.textContent).toContain("能力市场");
    expect(container.textContent).toContain("搜索并选择可安装能力");
    expect(container.querySelector('input[placeholder*="搜索能力"]')).not.toBeNull();
    expect(
      container.textContent?.includes("刷新市场") ||
        container.textContent?.includes("搜索") ||
        container.textContent?.includes("加载中…"),
    ).toBe(true);

    const localTab = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (node) => node.textContent?.includes("本地导入"),
    );
    expect(localTab).toBeDefined();
    localTab?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    render(renderPlatformCapabilitiesSurface(props), container);
    expect(container.textContent).toContain("本地文件");
    expect(container.textContent).toContain("选择文件");

    const remoteTab = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (node) => node.textContent?.includes("GitHub / URL"),
    );
    expect(remoteTab).toBeDefined();
    remoteTab?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    render(renderPlatformCapabilitiesSurface(props), container);
    expect(container.querySelector('input[placeholder*="GitHub 仓库"]')).not.toBeNull();
    expect(
      container.textContent?.includes("解析") || container.textContent?.includes("解析中…"),
    ).toBe(true);
    const remoteInput = container.querySelector<HTMLInputElement>(
      'input[placeholder*="GitHub 仓库"]',
    );
    expect(remoteInput).not.toBeNull();
    if (remoteInput) {
      remoteInput.value = "https://github.com/openclaw/skill-weather";
      remoteInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    render(renderPlatformCapabilitiesSurface(props), container);
    expect(remoteInput?.value).toBe("https://github.com/openclaw/skill-weather");

    if (remoteInput) {
      remoteInput.value = "https://github.com/anthropics/skills/tree/main/skills/skill-creator";
      remoteInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    render(renderPlatformCapabilitiesSurface(props), container);

    const parseButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (node) => node.textContent?.includes("解析"),
    );
    expect(parseButton).toBeDefined();
    parseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    render(renderPlatformCapabilitiesSurface(props), container);

    expect(container.textContent).toContain("提交到发现池");
    expect(container.textContent).toContain("Skill Creator");

    const createTab = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (node) => node.textContent?.includes("本地导入"),
    );
    expect(createTab).toBeDefined();
    createTab?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    render(renderPlatformCapabilitiesSurface(props), container);
    expect(container.textContent).toContain("本地文件");
    expect(container.textContent).toContain("选择文件");
  });

  it("hides approve actions for approved proposals and fires them for pending review", async () => {
    const props = createProps();
    const approve = vi.fn(async (_proposalId: string, _reviewerId?: string) => ({
      ok: true as const,
    }));
    const reject = vi.fn(async (_proposalId: string, _reviewerId: string, _note: string) => ({
      ok: false as const,
      message: "拒绝失败，提案状态未改变。",
    }));
    props.actions.capabilities.onApproveProposal = (proposalId, reviewerId) =>
      approve(proposalId, reviewerId);
    props.actions.capabilities.onRejectProposal = (proposalId, reviewerId, note) =>
      reject(proposalId, reviewerId, note);
    props.pageViewModels!.capabilities.discoveredItems = [
      {
        proposalId: "proposal:workbuddy",
        capabilityId: "urn:openclaw:skill:workbuddy-to-openbot-migration@1.0.0",
        title: "WorkBuddy",
        subtitle: "already approved",
        status: "approved",
        statusLabel: "已批准",
        sourceLabel: "个人目录",
        trustTier: "user",
        riskLevel: "medium",
        findingCount: 0,
        highestFindingSeverity: null,
        submittedAt: "2026-05-10T00:00:00.000Z",
      },
      {
        proposalId: "proposal:pending-skill",
        capabilityId: "urn:openclaw:skill:pending@1.0.0",
        title: "Pending Skill",
        subtitle: "waiting for review",
        status: "proposed",
        statusLabel: "待审阅",
        sourceLabel: "个人目录",
        trustTier: "user",
        riskLevel: "low",
        findingCount: 0,
        highestFindingSeverity: null,
        submittedAt: "2026-05-10T00:00:00.000Z",
      },
    ];
    const container = document.createElement("div");
    document.body.append(container);

    const openTab = (label: string) => {
      const button = Array.from(
        container.querySelectorAll<HTMLButtonElement>(".platform-capabilities__tab"),
      ).find((node) => node.textContent?.includes(label));
      expect(button).toBeDefined();
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      render(renderPlatformCapabilitiesSurface(props), container);
    };

    render(renderPlatformCapabilitiesSurface(props), container);
    openTab("待审阅");

    expect(container.textContent).not.toContain("WorkBuddy");
    expect(container.textContent).not.toContain("已批准");
    expect(container.textContent).toContain("Pending Skill");
    expect(container.textContent).toContain("待审阅");
    expect(
      container
        .querySelector(".platform-capabilities__tab.is-active .platform-capabilities__tab-count")
        ?.textContent?.trim(),
    ).toBe("1");

    const approveButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((button) => button.textContent?.trim() === "批准");
    const rejectButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((button) => button.textContent?.trim() === "拒绝");
    expect(approveButtons).toHaveLength(1);
    expect(rejectButtons).toHaveLength(1);
    expect(approveButtons[0]?.disabled).toBe(false);

    approveButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      render(renderPlatformCapabilitiesSurface(props), container);
      expect(container.textContent).toContain("已批准能力提案：Pending Skill");
    });
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve).toHaveBeenCalledWith("proposal:pending-skill", "platform-ui");

    const rejectButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "拒绝",
    );
    rejectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      render(renderPlatformCapabilitiesSurface(props), container);
      expect(container.textContent).toContain("拒绝失败，提案状态未改变。");
    });
    expect(reject).toHaveBeenCalledWith(
      "proposal:pending-skill",
      "platform-ui",
      "不纳入当前平台目录",
    );
    expect(container.textContent).not.toContain("已拒绝能力提案：Pending Skill");
  });
});
