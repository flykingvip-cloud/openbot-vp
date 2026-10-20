/**
 * 企业能力中心主页面（EnterpriseCapabilityCenterPage）
 *
 * 布局：
 * 1. 标准模块抬头 + 概况与待办
 * 2. 主工作区 Tab：全部技能 / MCP / 贡献排行 / 安装与运行 / 孵化中心
 *
 * @module enterprise-capability-center-page
 */

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../i18n/index.ts";
import type {
  StatisticsDashboardData,
  ContributionPerformanceItem,
} from "../../capability/enterprise-capability/types.ts";
import { buildEnterpriseContributorLeaderboardSections } from "../asset-incubation-leaderboards-vm.ts";
import { renderAssetLeaderboardSection } from "../asset-incubation-leaderboards.ts";
import { type EnterpriseKpiItem, renderEnterpriseKpiGrid } from "../enterprise-kpi-card.ts";
import { renderEnterpriseModuleHeader } from "../enterprise-module-header.ts";
import {
  type EnterpriseSegmentedNavItem,
  renderEnterpriseSegmentedNav,
} from "../enterprise-segmented-nav.ts";
import { renderCapabilityOverview, type CapabilityOverviewProps } from "./capability-overview.ts";
import {
  renderCapabilityCenterSkillsTab,
  type CapabilityCenterSkillsTabProps,
} from "./enterprise-capability-center-skills-tab.ts";
import { renderMcpDiscoveryPanel, type McpDiscoveryPanelProps } from "./mcp-discovery-panel.ts";

export type CapabilityCenterMainTab =
  | "skills"
  | "mcp"
  | "leaderboard"
  | "install"
  | "robots"
  | "jobs"
  | "analytics"
  | "governance"
  | "incubation";

export type EnterpriseCapabilityCenterPageProps = {
  stats: StatisticsDashboardData | null;
  statsLoading: boolean;
  statsError: string | null;
  lastSuccessfulLoadAt: number | null;
  onRefreshStats: () => void;
  onNavigateReviewQueue?: (() => void) | null;
  pendingReviewCount?: number | null;
  incubationCandidateCount?: number | null;
  installCoverageLabel?: string | null;
  /**
   * 状态卡（基线 KPI 卡组）下钻链接。状态卡迁移为 `renderEnterpriseKpiGrid`，
   * 通过 `<a href>` + 宿主 surface 的点击委托实现导航（替代旧的 onClick 回调）。
   */
  reviewQueueHref: string;
  skillsHref: string;
  installHref: string;
  incubationHref: string;
  activeTab: CapabilityCenterMainTab;
  onTabChange: (tab: CapabilityCenterMainTab) => void;
  skillsTab: CapabilityCenterSkillsTabProps;
  mcpTab: CapabilityCenterSkillsTabProps;
  /** 候选 MCP / 待映射工具。只在 MCP 页签渲染，主操作是映射或申请授权。 */
  mcpDiscovery: McpDiscoveryPanelProps;
  monthlyTopContributors: ContributionPerformanceItem[];
  contributorsError?: string | null;
  onRetryContributors?: () => void;
  onViewContributionPerformance: () => void;
  installManagementPanel: TemplateResult | typeof nothing;
  /** 机器人视图子页（运行时使用投影），来自原「能力应用管理」。 */
  robotsPanel: TemplateResult | typeof nothing;
  /** 岗位机器人定时任务子页。 */
  jobsPanel: TemplateResult | typeof nothing;
  /** 效果分析子页，来自原「能力应用管理」。 */
  analyticsPanel: TemplateResult | typeof nothing;
  /** 应用治理子页，来自原「能力应用管理」。 */
  governancePanel: TemplateResult | typeof nothing;
  incubationPanel: TemplateResult | typeof nothing;
};

function buildOverviewProps(props: EnterpriseCapabilityCenterPageProps): CapabilityOverviewProps {
  return {
    stats: props.stats,
    statsLoading: props.statsLoading,
    statsError: props.statsError,
    lastSuccessfulLoadAt: props.lastSuccessfulLoadAt,
    onRefreshStats: props.onRefreshStats,
    onNavigateContributionRecords: () => {},
    onNavigateInstallManagement: () => {},
    onNavigateReviewQueue: props.onNavigateReviewQueue,
    showHeader: false,
    compact: true,
  };
}

/**
 * 状态卡（KPI 即筛选器）映射到基线 KPI 卡组。
 * 旧的 `renderStatusCard`（`__status-card` 专用样式 + onClick 回调）已收敛为 `renderEnterpriseKpiGrid`：
 * tone 表达紧急度（urgent→danger / ready→ok / neutral），href 承载下钻导航，drilldown 提供无障碍标签。
 */
function buildStatusKpis(props: EnterpriseCapabilityCenterPageProps): EnterpriseKpiItem[] {
  const pendingReviewValue =
    typeof props.pendingReviewCount === "number" ? `${props.pendingReviewCount} 项` : "—";
  const publishedValue = `${props.stats?.publishedCapabilities ?? "—"} 项`;
  const installValue =
    props.installCoverageLabel ?? `${props.stats?.coveredRobots ?? "—"} 个机器人`;
  const incubationValue =
    typeof props.incubationCandidateCount === "number"
      ? `${props.incubationCandidateCount} 项`
      : "—";

  return [
    {
      label: "待审核承接单",
      value: pendingReviewValue,
      tone: "danger",
      href: props.reviewQueueHref,
      drilldown: "立即审核",
    },
    {
      label: "已发布企业资产",
      value: publishedValue,
      tone: "ok",
      href: props.skillsHref,
      drilldown: "查看技能列表",
    },
    {
      label: "安装覆盖",
      value: installValue,
      tone: "neutral",
      href: props.installHref,
      drilldown: "管理安装",
    },
    {
      label: "孵化候选",
      value: incubationValue,
      tone: "neutral",
      href: props.incubationHref,
      drilldown: "进入孵化",
    },
  ];
}

function renderMetricsSummary(props: EnterpriseCapabilityCenterPageProps): TemplateResult {
  // KPI 卡组（renderEnterpriseKpiGrid）是唯一的统计层；capability-overview
  // 只在还没有任何统计数据时提供骨架屏 / 错误重试占位，
  // 避免同一批指标以两套卡片重复出现（卡中卡 + 指标重复）。
  const showOverviewPlaceholder = props.stats === null;
  return html`
    <section class="enterprise-capability-center-page__metrics" aria-label="概况与待办">
      ${showOverviewPlaceholder ? renderCapabilityOverview(buildOverviewProps(props)) : nothing}
      ${renderEnterpriseKpiGrid(buildStatusKpis(props))}
    </section>
  `;
}

/** 「安装与运行」合并 Tab 覆盖的两个路由子视图。 */
const INSTALL_RUNTIME_ROUTES: ReadonlySet<CapabilityCenterMainTab> =
  new Set<CapabilityCenterMainTab>(["install", "robots"]);

function isInstallRuntimeTab(tab: CapabilityCenterMainTab): boolean {
  return INSTALL_RUNTIME_ROUTES.has(tab);
}

function renderMainTabs(props: EnterpriseCapabilityCenterPageProps): TemplateResult {
  // 「安装与运行」是合并 Tab：内部用子视图在 install / robots 两个路由间切换。
  const items: EnterpriseSegmentedNavItem[] = [
    // 资产域：目录 → 贡献 → 孵化
    { id: "skills", label: "全部技能", active: props.activeTab === "skills" },
    { id: "mcp", label: "MCP", active: props.activeTab === "mcp" },
    { id: "leaderboard", label: "贡献排行", active: props.activeTab === "leaderboard" },
    { id: "incubation", label: "孵化中心", active: props.activeTab === "incubation" },
    // 运行域：安装与运行（合并）→ 定时任务 → 效果
    { id: "install", label: "安装与运行", active: isInstallRuntimeTab(props.activeTab) },
    { id: "jobs", label: "定时任务", active: props.activeTab === "jobs" },
    { id: "analytics", label: "效果分析", active: props.activeTab === "analytics" },
    // 治理域
    { id: "governance", label: "应用治理", active: props.activeTab === "governance" },
  ];
  return renderEnterpriseSegmentedNav(items, (id) =>
    props.onTabChange(id as CapabilityCenterMainTab),
  );
}

function renderLeaderboardTab(props: EnterpriseCapabilityCenterPageProps): TemplateResult {
  const sections = buildEnterpriseContributorLeaderboardSections(props.monthlyTopContributors);
  return html`
    <div
      id="leaderboard"
      class="enterprise-capability-center-page__leaderboard-tab"
      role="tabpanel"
    >
      <div class="enterprise-capability-center-page__leaderboard-head">
        <button type="button" class="btn" @click=${props.onViewContributionPerformance}>
          查看完整贡献绩效
        </button>
      </div>
      ${
        props.contributorsError
          ? html`
              <div class="enterprise-skill-list__message enterprise-skill-list__message--error" role="alert">
                <strong>${props.contributorsError}</strong>
                ${
                  props.onRetryContributors
                    ? html`<button type="button" class="btn btn--sm" @click=${props.onRetryContributors}>
                        重试
                      </button>`
                    : nothing
                }
              </div>
            `
          : nothing
      }
      <div class="enterprise-capability-center-page__leaderboard-grid">
        ${sections.map((section) => renderAssetLeaderboardSection(section))}
      </div>
    </div>
  `;
}

function renderInstallRuntimeTab(props: EnterpriseCapabilityCenterPageProps): TemplateResult {
  // 子视图：安装关系（install）/ 运行表现（robots）。沿用既有 onTabChange 切换底层路由。
  const activeSubView: CapabilityCenterMainTab =
    props.activeTab === "robots" ? "robots" : "install";
  const subItems: EnterpriseSegmentedNavItem[] = [
    { id: "install", label: "安装关系", active: activeSubView === "install" },
    { id: "robots", label: "运行表现", active: activeSubView === "robots" },
  ];
  return html`
    <div
      id="install-runtime"
      class="enterprise-capability-center-page__install-tab"
      role="tabpanel"
      aria-label="安装与运行"
    >
      ${renderEnterpriseSegmentedNav(subItems, (id) =>
        props.onTabChange(id as CapabilityCenterMainTab),
      )}
      <div class="enterprise-capability-center-page__install-runtime-panel">
        ${activeSubView === "robots" ? props.robotsPanel : props.installManagementPanel}
      </div>
    </div>
  `;
}

function renderMainTabPanel(props: EnterpriseCapabilityCenterPageProps): TemplateResult {
  switch (props.activeTab) {
    case "leaderboard":
      return renderLeaderboardTab(props);
    case "install":
    case "robots":
      return renderInstallRuntimeTab(props);
    case "analytics":
      return html`
        <div
          id="analytics"
          class="enterprise-capability-center-page__analytics-tab"
          role="tabpanel"
          aria-label="效果分析"
        >
          ${props.analyticsPanel}
        </div>
      `;
    case "jobs":
      return html`
        <div
          id="jobs"
          class="enterprise-capability-center-page__analytics-tab"
          role="tabpanel"
          aria-label="定时任务"
        >
          ${props.jobsPanel}
        </div>
      `;
    case "governance":
      return html`
        <div
          id="governance"
          class="enterprise-capability-center-page__governance-tab"
          role="tabpanel"
          aria-label="应用治理"
        >
          ${props.governancePanel}
        </div>
      `;
    case "incubation":
      return html`
        <div
          id="incubation"
          class="enterprise-capability-center-page__incubation-tab"
          role="tabpanel"
        >
          ${props.incubationPanel}
        </div>
      `;
    case "mcp":
      return html`
        ${renderMcpDiscoveryPanel(props.mcpDiscovery)}
        ${renderCapabilityCenterSkillsTab({ ...props.mcpTab, variant: "mcp" })}
      `;
    case "skills":
    default:
      return renderCapabilityCenterSkillsTab(props.skillsTab);
  }
}

/**
 * 渲染企业能力中心主页面。
 */
export function renderEnterpriseCapabilityCenterPage(
  props: EnterpriseCapabilityCenterPageProps,
): TemplateResult {
  return html`
    <div class="enterprise-page enterprise-capability-center-page">
      <div class="enterprise-page__content enterprise-capability-center-page__content">
        <div class="enterprise-page__sections enterprise-capability-center-page__sections">
          ${renderEnterpriseModuleHeader({
            title: t("tabs.enterpriseCapabilityCenter"),
            subtitle: t("subtitles.enterpriseCapabilityCenter"),
            refresh: { onRefresh: props.onRefreshStats, pending: props.statsLoading },
          })}
          ${renderMetricsSummary(props)}
          <section class="enterprise-capability-center-page__workspace" aria-label="技能与运营">
            ${renderMainTabs(props)}
            <div class="enterprise-capability-center-page__panel">${renderMainTabPanel(props)}</div>
          </section>
        </div>
      </div>
    </div>
  `;
}
