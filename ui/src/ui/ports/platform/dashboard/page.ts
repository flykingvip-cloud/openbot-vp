import { html, nothing } from "lit";
import { renderIcon, type IconName } from "../../../icons.ts";
import { pathForTab } from "../../../navigation.ts";
import { buildPlatformEnterpriseLeaderboardSections } from "../../../views/asset-incubation-leaderboards-vm.ts";
import { renderAssetLeaderboardSection } from "../../../views/asset-incubation-leaderboards.ts";
import { renderOperationalIdentityGovernancePanel } from "../../../views/operational-identity-governance-panel.ts";
import { isPlatformShellPending, renderPlatformSummaryPending } from "../shared/summary-pending.ts";
import { followPortHref } from "../shared/surface.ts";
import type { PlatformSurfaceProps } from "../shared/surface.ts";
import type {
  DashboardAttentionItemVM,
  DashboardHealthIndicatorVM,
  DashboardMetricVM,
  DashboardQuickActionVM,
  DashboardSignalVM,
  DashboardVM,
  PlatformLinkVM,
  PlatformListItemVM,
  PlatformStatVM,
} from "../view-models/types.ts";

type HealthTone = DashboardHealthIndicatorVM["tone"];

const METRIC_ICON_MAP: Record<DashboardMetricVM["icon"], IconName> = {
  tenants: "building",
  runtime: "server",
  sessions: "activity",
  cost: "dollarSign",
  models: "cpu",
  capabilities: "puzzle",
  attention: "bell",
  version: "gauge",
};

const QUICK_ACTION_ICON_MAP: Record<DashboardQuickActionVM["icon"], IconName> = {
  tenants: "building",
  models: "cpu",
  capabilities: "puzzle",
  agents: "brain",
  advanced: "server",
  systemSettings: "settings",
  creation: "sparkles",
  report: "barChart",
  audit: "shieldCheck",
};

const HEALTH_ICON_MAP: Record<DashboardHealthIndicatorVM["id"], IconName> = {
  runtime: "server",
  providers: "cpu",
  channels: "cable",
  errorRate: "alertTriangle",
  costAttribution: "dollarSign",
  version: "gauge",
};

const CATEGORY_ICON_MAP: Record<DashboardAttentionItemVM["category"], IconName> = {
  tenant: "building",
  model: "cpu",
  runtime: "server",
  channel: "cable",
  cost: "dollarSign",
  version: "gauge",
  security: "shieldCheck",
};

function toneFromMetric(tone: DashboardMetricVM["valueTone"]): string {
  return tone;
}

function toneFromHealth(tone: HealthTone): string {
  return tone === "neutral" ? "" : tone;
}

function renderTrendChip(trend: DashboardMetricVM["trend"]) {
  if (!trend) {
    return nothing;
  }
  const icon =
    trend.direction === "up" ? "trendingUp" : trend.direction === "down" ? "trendingDown" : "minus";
  return html`
    <span class="platform-dashboard__trend platform-dashboard__trend--${trend.direction} is-${trend.tone}">
      ${renderIcon(icon, "platform-dashboard__trend-icon")}
      <span>${trend.label}</span>
    </span>
  `;
}

function renderHealthBar(vm: DashboardVM) {
  return html`
    <section class="platform-dashboard__health-bar is-${vm.overallHealthTone}" aria-label="平台健康状态">
      <div class="platform-dashboard__health-summary">
        <span class="platform-dashboard__health-dot" aria-hidden="true"></span>
        <div class="platform-dashboard__health-summary-copy">
          <span class="platform-dashboard__health-label">${vm.overallHealthLabel}</span>
          ${
            vm.updatedAtLabel
              ? html`<span class="platform-dashboard__health-stamp">更新于 ${vm.updatedAtLabel}</span>`
              : nothing
          }
        </div>
      </div>
      <div class="platform-dashboard__health-indicators" role="list">
        ${vm.health.map((indicator) => renderHealthIndicator(indicator))}
      </div>
    </section>
  `;
}

function renderHealthIndicator(indicator: DashboardHealthIndicatorVM) {
  const body = html`
    <span class="platform-dashboard__health-indicator-icon is-${toneFromHealth(indicator.tone)}">
      ${renderIcon(HEALTH_ICON_MAP[indicator.id], "platform-dashboard__health-indicator-svg")}
    </span>
    <span class="platform-dashboard__health-indicator-body">
      <span class="platform-dashboard__health-indicator-label">${indicator.label}</span>
      <span class="platform-dashboard__health-indicator-value is-${toneFromHealth(indicator.tone)}">
        ${indicator.value}
      </span>
      <span class="platform-dashboard__health-indicator-meta">${indicator.meta}</span>
    </span>
  `;
  if (!indicator.href) {
    return html`
      <div class="platform-dashboard__health-indicator is-${toneFromHealth(indicator.tone)}" role="listitem">
        ${body}
      </div>
    `;
  }
  return html`
    <a
      class="platform-dashboard__health-indicator is-${toneFromHealth(indicator.tone)}"
      role="listitem"
      href=${indicator.href}
      @click=${(event: MouseEvent) => followPortHref(event, indicator.href!)}
    >
      ${body}
    </a>
  `;
}

function renderMetricCard(metric: DashboardMetricVM) {
  const cardToneClass = metric.valueTone;
  return html`
    <a
      class="platform-dashboard__metric-card is-${cardToneClass}"
      href=${metric.href}
      @click=${(event: MouseEvent) => followPortHref(event, metric.href)}
    >
      <div class="platform-dashboard__metric-leading">
        <span class="platform-dashboard__metric-icon is-${cardToneClass}">
          ${renderIcon(METRIC_ICON_MAP[metric.icon], "platform-dashboard__metric-icon-svg")}
        </span>
        <div class="platform-dashboard__metric-label">${metric.label}</div>
      </div>
      <div class="platform-dashboard__metric-trailing">
        <div class="platform-dashboard__metric-trailing-head">
          <div class="platform-dashboard__metric-value is-${toneFromMetric(metric.valueTone)}">
            ${metric.value}
          </div>
          ${renderTrendChip(metric.trend)}
        </div>
        <div class="platform-dashboard__metric-meta">${metric.meta}</div>
      </div>
    </a>
  `;
}

function renderAttentionGroup(
  severity: DashboardAttentionItemVM["severity"],
  items: DashboardAttentionItemVM[],
) {
  if (items.length === 0) {
    return nothing;
  }
  const severityLabel = severity === "critical" ? "严重" : severity === "warning" ? "预警" : "提示";
  const severityIcon: IconName =
    severity === "critical" ? "alertTriangle" : severity === "warning" ? "alertCircle" : "info";
  return html`
    <div class="platform-dashboard__attention-group is-${severity}">
      <div class="platform-dashboard__attention-group-heading">
        ${renderIcon(severityIcon, "platform-dashboard__attention-group-icon")}
        <span class="platform-dashboard__attention-group-label">${severityLabel}</span>
        <span class="platform-dashboard__attention-group-count">${items.length}</span>
      </div>
      <div class="platform-dashboard__attention-group-list">
        ${items.map((item) => renderAttentionItem(item))}
      </div>
    </div>
  `;
}

function renderAttentionItem(item: DashboardAttentionItemVM) {
  return html`
    <article class="platform-dashboard__attention-item is-${item.severity}">
      <span class="platform-dashboard__attention-icon is-${item.severity}">
        ${renderIcon(CATEGORY_ICON_MAP[item.category], "platform-dashboard__attention-icon-svg")}
      </span>
      <div class="platform-dashboard__attention-body">
        <div class="platform-dashboard__attention-row">
          <div class="platform-dashboard__attention-title">${item.title}</div>
          ${
            item.meta
              ? html`<span class="platform-dashboard__attention-meta">${item.meta}</span>`
              : nothing
          }
        </div>
        <div class="platform-dashboard__attention-subtitle">${item.subtitle}</div>
        ${
          item.actions.length > 0
            ? html`
                <div class="platform-dashboard__attention-actions">
                  ${item.actions.map(
                    (action) => html`
                      <a
                        class="platform-dashboard__attention-action ${
                          action.kind === "primary" ? "is-primary" : ""
                        }"
                        href=${action.href}
                        @click=${(event: MouseEvent) => followPortHref(event, action.href)}
                      >
                        <span>${action.label}</span>
                        ${
                          action.kind === "primary"
                            ? renderIcon("arrowRight", "platform-dashboard__attention-action-icon")
                            : nothing
                        }
                      </a>
                    `,
                  )}
                </div>
              `
            : nothing
        }
      </div>
    </article>
  `;
}

function renderAttentionEmpty() {
  return html`
    <div class="platform-dashboard__attention-empty">
      ${renderIcon("checkCircle", "platform-dashboard__attention-empty-icon")}
      <div class="platform-dashboard__attention-empty-copy">
        <div class="platform-dashboard__attention-empty-title">平台运行良好</div>
        <div class="platform-dashboard__attention-empty-sub">当前没有需要人工处理的关注项</div>
      </div>
    </div>
  `;
}

function renderAttentionPanel(vm: DashboardVM) {
  const critical = vm.attention.filter((item) => item.severity === "critical");
  const warnings = vm.attention.filter((item) => item.severity === "warning");
  const infos = vm.attention.filter((item) => item.severity === "info");
  return html`
    <section class="platform-dashboard__panel platform-dashboard__panel--attention" aria-label="平台关注项">
      <header class="platform-dashboard__panel-header">
        <div class="platform-dashboard__panel-heading">
          <div class="platform-dashboard__panel-title-group">
            <div class="platform-dashboard__panel-title">平台关注项</div>
            <div class="platform-dashboard__panel-badge is-${
              vm.attentionCounts.critical > 0
                ? "critical"
                : vm.attentionCounts.warning > 0
                  ? "warning"
                  : vm.attentionCounts.info > 0
                    ? "info"
                    : "ok"
            }">
              ${vm.attentionCounts.total}
            </div>
          </div>
        </div>
      </header>
      <div class="platform-dashboard__attention-body">
        ${
          vm.attention.length === 0
            ? renderAttentionEmpty()
            : html`
                ${renderAttentionGroup("critical", critical)}
                ${renderAttentionGroup("warning", warnings)}
                ${renderAttentionGroup("info", infos)}
              `
        }
      </div>
    </section>
  `;
}

function renderQuickActions(vm: DashboardVM) {
  return html`
    <section class="platform-dashboard__panel" aria-label="快速入口">
      <header class="platform-dashboard__panel-header">
        <div class="platform-dashboard__panel-heading">
          <div class="platform-dashboard__panel-title-group">
            <div class="platform-dashboard__panel-title">快速入口</div>
          </div>
        </div>
      </header>
      <div class="platform-dashboard__quick-grid">
        ${vm.quickActions.map((action) => renderQuickAction(action))}
      </div>
    </section>
  `;
}

function renderQuickAction(action: DashboardQuickActionVM) {
  return html`
    <a
      class="platform-dashboard__quick-card is-${action.emphasis}"
      href=${action.href}
      @click=${(event: MouseEvent) => followPortHref(event, action.href)}
    >
      <span class="platform-dashboard__quick-icon is-${action.emphasis}">
        ${renderIcon(QUICK_ACTION_ICON_MAP[action.icon], "platform-dashboard__quick-icon-svg")}
      </span>
      <span class="platform-dashboard__quick-copy">
        <span class="platform-dashboard__quick-label">${action.label}</span>
        <span class="platform-dashboard__quick-description">${action.description}</span>
      </span>
      ${renderIcon("arrowUpRight", "platform-dashboard__quick-arrow")}
    </a>
  `;
}

function renderSignalCard(signal: DashboardSignalVM) {
  const toneClass = signal.tone === "neutral" ? "" : signal.tone;
  return html`
    <article class="platform-dashboard__signal-card is-${toneClass}">
      <div class="platform-dashboard__signal-label">${signal.label}</div>
      <div class="platform-dashboard__signal-value is-${toneClass}">${signal.value}</div>
      <div class="platform-dashboard__signal-meta">${signal.meta}</div>
    </article>
  `;
}

function renderSignalsPanel(vm: DashboardVM) {
  return html`
    <section class="platform-dashboard__panel" aria-label="平台观察">
      <header class="platform-dashboard__panel-header">
        <div class="platform-dashboard__panel-heading">
          <div class="platform-dashboard__panel-title-group">
            <div class="platform-dashboard__panel-title">平台观察</div>
          </div>
        </div>
      </header>
      <div class="platform-dashboard__signal-grid">
        ${vm.signals.map((signal) => renderSignalCard(signal))}
      </div>
    </section>
  `;
}

function renderContributionLeaderboards(sections: DashboardVM["contributionLeaderboards"]) {
  if (!sections || sections.length === 0) {
    return nothing;
  }
  return html`
    <section class="platform-dashboard__panel" aria-label="资产孵化贡献榜">
      <header class="platform-dashboard__panel-header">
        <div class="platform-dashboard__panel-heading">
          <div class="platform-dashboard__panel-title-group">
            <div class="platform-dashboard__panel-title">资产孵化贡献榜</div>
          </div>
        </div>
      </header>
      <div class="platform-dashboard__stack">
        ${sections.map((section) => renderAssetLeaderboardSection(section))}
      </div>
    </section>
  `;
}

function renderOperationalIdentityGovernanceSummary(props: PlatformSurfaceProps) {
  return props.operationalIdentityGovernancePanel
    ? renderOperationalIdentityGovernancePanel(props.operationalIdentityGovernancePanel)
    : nothing;
}

function isLegacyDashboard(vm: ReturnType<typeof getDashboardVM>): vm is LegacyDashboardVM {
  return "legacyOnly" in vm;
}

type LegacyDashboardVM = {
  legacyOnly: true;
  metrics: PlatformStatVM[];
  attention: PlatformListItemVM[];
  quickLinks: PlatformLinkVM[];
  contributionLeaderboards: NonNullable<DashboardVM["contributionLeaderboards"]>;
};

function getDashboardVM(props: PlatformSurfaceProps): DashboardVM | LegacyDashboardVM {
  if (props.pageViewModels?.dashboard) {
    return props.pageViewModels.dashboard;
  }
  const { readModel, basePath } = props;
  const contributionLeaderboards = buildPlatformEnterpriseLeaderboardSections({
    enterprises: readModel.enterpriseDirectory.map((entry) => ({
      tenantId: entry.tenantId,
      label: entry.label,
      status: entry.status,
      contributionSummary: entry.contributionSummary,
    })),
    installedCapabilityCount: readModel.installedCapabilityCount,
    runtimeHostCount: readModel.runtimeHosts.length,
    attentionCount: readModel.attentionItems.length,
  });
  return {
    legacyOnly: true,
    metrics: [],
    attention: readModel.attentionItems.map((item) => ({
      title: item,
      subtitle: "平台关注项",
      meta: "attention",
      href: pathForTab("platformAdvanced", basePath),
    })),
    quickLinks: [
      { label: "租户管理", path: pathForTab("platformTenants", basePath) },
      { label: "能力管理", path: pathForTab("platformCapabilities", basePath) },
      { label: "模型管理", path: pathForTab("platformModels", basePath) },
      { label: "资产管理", path: pathForTab("platformAgents", basePath) },
      { label: "高级控制", path: pathForTab("platformAdvanced", basePath) },
      { label: "系统设置", path: pathForTab("platformSystemSettings", basePath) },
    ],
    contributionLeaderboards,
  };
}

function renderLegacyDashboard(vm: LegacyDashboardVM, props: PlatformSurfaceProps) {
  return html`
    <section class="platform-dashboard platform-dashboard--legacy">
      <div class="platform-dashboard__main-panel">
        <div class="platform-dashboard__panel-title">核心入口</div>
        <div class="platform-dashboard__quick-grid">
          ${vm.quickLinks.map(
            (link) => html`
              <a
                class="platform-dashboard__quick-card is-default"
                href=${link.path}
                @click=${(event: MouseEvent) => followPortHref(event, link.path)}
              >
                <span class="platform-dashboard__quick-copy">
                  <span class="platform-dashboard__quick-label">${link.label}</span>
                </span>
                ${renderIcon("arrowUpRight", "platform-dashboard__quick-arrow")}
              </a>
            `,
          )}
        </div>
      </div>
      ${
        vm.attention.length > 0
          ? html`
              <div class="platform-dashboard__panel">
                <div class="platform-dashboard__panel-title">平台关注项</div>
                <div class="platform-dashboard__attention-body">
                  ${vm.attention.map(
                    (item) => html`
                      <a
                        class="platform-dashboard__attention-item is-info"
                        href=${item.href ?? pathForTab("platformAdvanced", props.basePath)}
                        @click=${(event: MouseEvent) =>
                          followPortHref(
                            event,
                            item.href ?? pathForTab("platformAdvanced", props.basePath),
                          )}
                      >
                        <span class="platform-dashboard__attention-icon is-info">
                          ${renderIcon("alertCircle", "platform-dashboard__attention-icon-svg")}
                        </span>
                        <div class="platform-dashboard__attention-body">
                          <div class="platform-dashboard__attention-title">${item.title}</div>
                          <div class="platform-dashboard__attention-subtitle">${item.subtitle}</div>
                        </div>
                      </a>
                    `,
                  )}
                </div>
              </div>
            `
          : nothing
      }
      ${renderOperationalIdentityGovernanceSummary(props)}
      ${renderContributionLeaderboards(vm.contributionLeaderboards)}
    </section>
  `;
}

export function renderPlatformDashboardSurface(props: PlatformSurfaceProps) {
  if (isPlatformShellPending(props.readModel)) {
    return html`
      <section class="platform-dashboard">${renderPlatformSummaryPending("平台总览")}</section>
    `;
  }
  const vm = getDashboardVM(props);
  if (isLegacyDashboard(vm)) {
    return renderLegacyDashboard(vm, props);
  }

  return html`
    <section class="platform-dashboard">
      ${renderHealthBar(vm)}
      <div class="platform-dashboard__metric-grid">
        ${vm.metrics.map((metric) => renderMetricCard(metric))}
      </div>
      <div class="platform-dashboard__shell">
        <div class="platform-dashboard__main">
          ${renderAttentionPanel(vm)}
          ${renderQuickActions(vm)}
          ${renderContributionLeaderboards(vm.contributionLeaderboards)}
        </div>
        <div class="platform-dashboard__side">
          ${renderSignalsPanel(vm)}
          ${renderOperationalIdentityGovernanceSummary(props)}
        </div>
      </div>
    </section>
  `;
}
