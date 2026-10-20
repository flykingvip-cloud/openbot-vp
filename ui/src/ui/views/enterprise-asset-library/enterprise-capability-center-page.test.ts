// @vitest-environment jsdom
import { html, nothing, render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type {
  ContributionPerformanceItem,
  DomainDistribution,
  EnterpriseAssetListItem,
  StatisticsDashboardData,
} from "../../capability/enterprise-capability/types.ts";
import {
  renderEnterpriseCapabilityCenterPage,
  type EnterpriseCapabilityCenterPageProps,
} from "./enterprise-capability-center-page.ts";
import type { CapabilityCenterSkillsTabProps } from "./enterprise-capability-center-skills-tab.ts";
import type { McpDiscoveryPanelProps } from "./mcp-discovery-panel.ts";

function createMockStats(): StatisticsDashboardData {
  return {
    totalCapabilities: 128,
    publishedCapabilities: 96,
    coveredEmployees: 1520,
    coveredRobots: 45,
    monthlyUsageCount: 23456,
    changes: {
      totalCapabilities: { value: 12, type: "absolute" },
      publishedCapabilities: { value: 5, type: "absolute" },
      coveredEmployees: { value: 15, type: "percentage" },
      coveredRobots: { value: -3, type: "absolute" },
      monthlyUsageCount: { value: 27, type: "percentage" },
    },
    updatedAt: Date.now(),
  };
}

function createMockDomains(): DomainDistribution[] {
  return [
    {
      domain: "销售",
      capabilityCount: 12,
      representativeCapabilities: ["客户跟进", "报价生成"],
      coverageRate: 85,
    },
    {
      domain: "HR",
      capabilityCount: 8,
      representativeCapabilities: ["简历筛选"],
      coverageRate: 60,
    },
  ];
}

function createMockContributors(): ContributionPerformanceItem[] {
  return [
    {
      employeeId: "emp-1",
      employeeName: "李四",
      department: "销售部",
      totalContributions: 15,
      approvedCount: 12,
      approvalRate: 80,
      averageMaturityLevel: 4,
      totalReuseRobots: 8,
      totalReuseEmployees: 30,
      averageSuccessRate: 92,
    },
  ];
}

function createMockSkillsTab(
  overrides?: Partial<CapabilityCenterSkillsTabProps>,
): CapabilityCenterSkillsTabProps {
  return {
    filters: {
      searchQuery: "",
      usageScenario: null,
      applicableTarget: null,
      domain: null,
      maturity: null,
      healthStatus: null,
      onlyInstallable: false,
    },
    domains: createMockDomains(),
    availableScenarios: ["销售管理", "HR招聘"],
    onDomainSelect: vi.fn(),
    onScenarioSelect: vi.fn(),
    onSearchChange: vi.fn(),
    sorting: { field: "maturity", direction: "desc" },
    onSortChange: vi.fn(),
    items: [] as EnterpriseAssetListItem[],
    loading: false,
    error: null,
    pagination: { currentPage: 1, pageSize: 10, totalItems: 0 },
    onInstallToRobot: vi.fn(),
    onViewDetail: vi.fn(),
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    ...overrides,
  };
}

function createDiscoveryProps(overrides?: Partial<McpDiscoveryPanelProps>): McpDiscoveryPanelProps {
  return {
    loading: false,
    error: null,
    disconnected: false,
    remoteToolsList: "unavailable",
    gap: "remote_tools_list_unavailable",
    items: [],
    mapHref: "/enterprise/acme/data-governance/overview?edc=capabilities",
    authorizeHref: "/enterprise/acme/data-governance/overview?edc=authorization",
    onRetry: vi.fn(),
    ...overrides,
  };
}

function createDefaultProps(
  overrides?: Partial<EnterpriseCapabilityCenterPageProps>,
): EnterpriseCapabilityCenterPageProps {
  return {
    stats: createMockStats(),
    statsLoading: false,
    statsError: null,
    lastSuccessfulLoadAt: null,
    onRefreshStats: vi.fn(),
    onNavigateReviewQueue: vi.fn(),
    reviewQueueHref: "/enterprise/acme/capabilities/review-queue",
    skillsHref: "/enterprise/acme/capabilities",
    installHref: "/enterprise/acme/capabilities?tab=install",
    incubationHref: "/enterprise/acme/capabilities?tab=incubation",
    pendingReviewCount: 2,
    incubationCandidateCount: 4,
    installCoverageLabel: "45 个机器人",
    activeTab: "skills",
    onTabChange: vi.fn(),
    skillsTab: createMockSkillsTab(),
    mcpTab: createMockSkillsTab({ variant: "mcp" }),
    mcpDiscovery: createDiscoveryProps(),
    monthlyTopContributors: createMockContributors(),
    onViewContributionPerformance: vi.fn(),
    installManagementPanel: html`
      <div class="test-install-management-panel"></div>
    `,
    robotsPanel: html`
      <div class="test-robots-panel"></div>
    `,
    jobsPanel: html`
      <div class="test-jobs-panel"></div>
    `,
    analyticsPanel: html`
      <div class="test-analytics-panel"></div>
    `,
    governancePanel: html`
      <div class="test-governance-panel"></div>
    `,
    incubationPanel: nothing,
    ...overrides,
  };
}

function renderToContainer(props: EnterpriseCapabilityCenterPageProps): HTMLElement {
  const container = document.createElement("div");
  render(renderEnterpriseCapabilityCenterPage(props), container);
  return container;
}

describe("renderEnterpriseCapabilityCenterPage — layout", () => {
  it("renders the page root container with enterprise-page foundation class", () => {
    const container = renderToContainer(createDefaultProps());
    const page = container.querySelector(".enterprise-capability-center-page") as HTMLElement;
    expect(page).not.toBeNull();
    expect(page.classList.contains("enterprise-page")).toBe(true);
  });

  it("renders merged metrics block before the main workspace", () => {
    const container = renderToContainer(createDefaultProps());
    const sections = Array.from(
      container.querySelector(".enterprise-capability-center-page__sections")?.children ?? [],
    );
    const classIndex = (className: string) =>
      sections.findIndex((section) => section.classList.contains(className));

    expect(sections[0]?.classList.contains("enterprise-module-header")).toBe(true);
    expect(classIndex("enterprise-capability-center-page__metrics")).toBeGreaterThan(0);
    expect(classIndex("enterprise-capability-center-page__metrics")).toBeLessThan(
      classIndex("enterprise-capability-center-page__workspace"),
    );
    expect(container.querySelector(".enterprise-capability-center-page__overview")).toBeNull();
    expect(container.querySelector(".enterprise-capability-center-page__workbench")).toBeNull();
    expect(container.querySelector(".enterprise-capability-center-page__flow")).toBeNull();
  });
});

describe("renderEnterpriseCapabilityCenterPage — main tabs", () => {
  it("renders main workspace tabs in lifecycle order with merged install+runtime tab", () => {
    const container = renderToContainer(createDefaultProps());
    const tabs = container.querySelectorAll(".enterprise-segmented-nav__tab");
    expect(tabs.length).toBe(8);
    expect(tabs[0]?.textContent?.trim()).toBe("全部技能");
    expect(tabs[1]?.textContent?.trim()).toBe("MCP");
    expect(tabs[2]?.textContent?.trim()).toBe("贡献排行");
    expect(tabs[3]?.textContent?.trim()).toBe("孵化中心");
    expect(tabs[4]?.textContent?.trim()).toBe("安装与运行");
    expect(tabs[5]?.textContent?.trim()).toBe("定时任务");
    expect(tabs[6]?.textContent?.trim()).toBe("效果分析");
    expect(tabs[7]?.textContent?.trim()).toBe("应用治理");
    expect(container.querySelector(".enterprise-module-header")).not.toBeNull();
    expect(container.querySelector(".enterprise-capability-center-page__hero")).toBeNull();
    expect(container.textContent).not.toContain("进入审核队列");
    expect(container.textContent).not.toContain("能力贡献记录");
  });

  it("merged install+runtime tab stays active for both install and robots routes", () => {
    const installContainer = renderToContainer(createDefaultProps({ activeTab: "install" }));
    const installTab = Array.from(
      installContainer.querySelectorAll(".enterprise-segmented-nav__tab"),
    ).find((tab) => tab.textContent?.trim() === "安装与运行");
    expect(installTab?.getAttribute("aria-selected")).toBe("true");

    const robotsContainer = renderToContainer(createDefaultProps({ activeTab: "robots" }));
    const robotsTab = Array.from(
      robotsContainer.querySelectorAll(".enterprise-segmented-nav__tab"),
    ).find((tab) => tab.textContent?.trim() === "安装与运行");
    expect(robotsTab?.getAttribute("aria-selected")).toBe("true");
  });

  it("merged tab renders install/runtime sub-view switch and the active sub-panel", () => {
    const installContainer = renderToContainer(createDefaultProps({ activeTab: "install" }));
    expect(installContainer.querySelector("#install-runtime")).not.toBeNull();
    const subTabs = Array.from(
      installContainer.querySelectorAll("#install-runtime .enterprise-segmented-nav__tab"),
    );
    expect(subTabs.map((t) => t.textContent?.trim())).toEqual(["安装关系", "运行表现"]);
    // install sub-view active → install panel shown
    expect(installContainer.querySelector(".test-install-management-panel")).not.toBeNull();
    expect(installContainer.querySelector(".test-robots-panel")).toBeNull();

    // robots route → runtime sub-view active → robots panel shown
    const robotsContainer = renderToContainer(createDefaultProps({ activeTab: "robots" }));
    expect(robotsContainer.querySelector(".test-robots-panel")).not.toBeNull();
    expect(robotsContainer.querySelector(".test-install-management-panel")).toBeNull();
  });

  it("calls onTabChange when a main tab is clicked", () => {
    const onTabChange = vi.fn();
    const container = renderToContainer(createDefaultProps({ onTabChange }));
    const tabs = container.querySelectorAll<HTMLButtonElement>(".enterprise-segmented-nav__tab");
    tabs[1]?.click();
    expect(onTabChange).toHaveBeenCalledWith("mcp");
    tabs[2]?.click();
    expect(onTabChange).toHaveBeenCalledWith("leaderboard");
  });

  it("renders mcp tab panel when activeTab is mcp", () => {
    const container = renderToContainer(createDefaultProps({ activeTab: "mcp" }));
    expect(container.querySelector("#mcp")).not.toBeNull();
    expect(container.querySelector("#skills")).toBeNull();
    expect(container.querySelector(".mcp-discovery")).not.toBeNull();
    const discoveryLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(".mcp-discovery a"),
    ).map((link) => link.textContent?.trim());
    expect(discoveryLinks).toEqual(["去映射"]);
    expect(container.textContent).toContain(
      "还没有企业 MCP。员工在我的资产中提交 MCP，审核通过后会出现在这里。",
    );
  });

  it("keeps MCP discovery off the skills tab", () => {
    const container = renderToContainer(createDefaultProps({ activeTab: "skills" }));
    expect(container.querySelector(".mcp-discovery")).toBeNull();
  });

  it("renders skills tab panel by default", () => {
    const container = renderToContainer(createDefaultProps());
    expect(container.querySelector("#skills")).not.toBeNull();
    expect(container.querySelector("#leaderboard")).toBeNull();
  });

  it("renders leaderboard panel when activeTab is leaderboard", () => {
    const container = renderToContainer(createDefaultProps({ activeTab: "leaderboard" }));
    expect(container.querySelector("#leaderboard")).not.toBeNull();
    expect(container.textContent).toContain("创作者榜");
    expect(container.textContent).toContain("李四");
  });
});

describe("renderEnterpriseCapabilityCenterPage — workbench", () => {
  it("renders four actionable status KPI cards with updated labels", () => {
    const container = renderToContainer(createDefaultProps({ pendingReviewCount: 2 }));
    const text = container.textContent ?? "";

    expect(text).toContain("待审核承接单");
    expect(text).toContain("已发布企业资产");
    expect(text).toContain("安装覆盖");
    expect(text).toContain("孵化候选");
    expect(text).toContain("2 项");
    // 基线迁移（任务 14.2）：状态卡收敛为 renderEnterpriseKpiGrid（.enterprise-kpi-card），
    // 旧的 __status-card 专用结构已删除。
    expect(container.querySelectorAll(".enterprise-kpi-grid .enterprise-kpi-card")).toHaveLength(4);
    expect(
      container.querySelector(".enterprise-capability-center-page__status-card--compact"),
    ).toBeNull();
    expect(container.textContent).not.toContain("员工端新提交的资产");
  });

  it("renders status KPI cards as drill-down links to review queue, skills, install, and incubation", () => {
    const container = renderToContainer(
      createDefaultProps({
        reviewQueueHref: "/enterprise/acme/capabilities/review-queue",
        skillsHref: "/enterprise/acme/capabilities",
        installHref: "/enterprise/acme/capabilities?tab=install",
        incubationHref: "/enterprise/acme/capabilities?tab=incubation",
      }),
    );

    const cardByLabel = (label: string) =>
      Array.from(container.querySelectorAll<HTMLAnchorElement>("a.enterprise-kpi-card")).find(
        (card) => card.getAttribute("aria-label") === label,
      );

    expect(cardByLabel("立即审核")?.getAttribute("href")).toBe(
      "/enterprise/acme/capabilities/review-queue",
    );
    expect(cardByLabel("查看技能列表")?.getAttribute("href")).toBe("/enterprise/acme/capabilities");
    expect(cardByLabel("管理安装")?.getAttribute("href")).toBe(
      "/enterprise/acme/capabilities?tab=install",
    );
    expect(cardByLabel("进入孵化")?.getAttribute("href")).toBe(
      "/enterprise/acme/capabilities?tab=incubation",
    );
  });
});

describe("renderEnterpriseCapabilityCenterPage — KPI overview", () => {
  it("keeps renderEnterpriseKpiGrid as the only stats layer once data is loaded", () => {
    const container = renderToContainer(createDefaultProps());
    const metrics = container.querySelector(".enterprise-capability-center-page__metrics");
    expect(metrics).not.toBeNull();
    // 指标去重：数据就绪后不再渲染 capability-overview__card 统计卡，
    // KPI 卡组（.enterprise-kpi-grid）是唯一统计层。
    expect(metrics!.querySelectorAll(".capability-overview__card").length).toBe(0);
    expect(metrics!.querySelectorAll(".enterprise-kpi-grid .enterprise-kpi-card").length).toBe(4);
    expect(metrics!.textContent).not.toContain("先看企业能力资产总量");
    expect(metrics!.textContent).not.toContain("按优先级处理审核");
  });

  it("falls back to the capability overview skeleton while stats are loading", () => {
    const container = renderToContainer(createDefaultProps({ stats: null, statsLoading: true }));
    const metrics = container.querySelector(".enterprise-capability-center-page__metrics");
    expect(metrics).not.toBeNull();
    expect(
      metrics!.querySelectorAll(".capability-overview__card--skeleton").length,
    ).toBeGreaterThan(0);
  });

  it("falls back to the capability overview error state with retry when stats fail", () => {
    const onRefreshStats = vi.fn();
    const container = renderToContainer(
      createDefaultProps({
        stats: null,
        statsLoading: false,
        statsError: "加载失败",
        onRefreshStats,
      }),
    );
    const metrics = container.querySelector(".enterprise-capability-center-page__metrics");
    expect(metrics).not.toBeNull();
    expect(metrics!.textContent).toContain("加载失败");
    const retry = metrics!.querySelector<HTMLButtonElement>(".capability-overview__retry-btn");
    expect(retry).not.toBeNull();
    retry?.click();
    expect(onRefreshStats).toHaveBeenCalled();
  });
});
