import { html, nothing } from "lit";
import { t } from "../../../../i18n/index.ts";
import { renderIcon } from "../../../icons.ts";
import { pathForTab } from "../../../navigation.ts";
import {
  type EnterpriseKpiItem,
  renderEnterpriseKpiGrid,
} from "../../../views/enterprise-kpi-card.ts";
import { renderEnterpriseModuleHeader } from "../../../views/enterprise-module-header.ts";
import { formatCost } from "../../../views/usage-metrics.ts";
import { resolveEnterpriseConnectionView } from "../enterprise-connection-copy.ts";
import { renderEnterpriseIdentityBindingSummaryCard } from "./enterprise-identity-binding-summary-card.ts";
import {
  followDelegatedPortHref,
  isGatewayAuthIssue,
  renderMeshBadge,
  resolveGatewayAuthRecoveryHint,
} from "./enterprise-surface-shared.ts";
import type { EnterpriseSurfaceProps } from "./enterprise-surface-types.ts";
import "./enterprise-system-notices-card.ts";
import "../../../supervisor/supervisor-node-binding-requests-card.ts";

/**
 * 企业总览信息架构（自上而下四层，每个事实只出现一次）：
 * 1. 告警层 —— 仅基础设施/策略级异常（不含已在 P0 出现的运营积压）；
 * 2. 指标层 —— KPI 快照是全页唯一的指标出现位置，异常值带警示色并可下钻；
 * 3. 行动层 —— 「优先处理」紧凑行动行 + 治理队列次级积压（与 P0 互斥去重）；
 * 4. 参考层 —— 侧栏「系统状态 / 快捷入口」承载连接、节点、模型等健康清单。
 */

function appendMeshSearchToHref(
  href: string,
  params: {
    queue?: "restrict" | "owner" | "attribution" | "review" | null;
    rankView?: "governance" | "user" | "agent" | "group" | null;
    userRank?: "impact" | "efficiency" | "stability" | null;
    agentRank?: "impact" | "efficiency" | "stability" | null;
    groupRank?: "impact" | "efficiency" | "stability" | null;
  },
): string {
  try {
    const parsed = new URL(href, "http://localhost");
    if (params.queue) {
      parsed.searchParams.set("queue", params.queue);
    }
    if (params.rankView) {
      parsed.searchParams.set("rankView", params.rankView);
    }
    if (params.userRank) {
      parsed.searchParams.set("userRank", params.userRank);
    }
    if (params.agentRank) {
      parsed.searchParams.set("agentRank", params.agentRank);
    }
    if (params.groupRank) {
      parsed.searchParams.set("groupRank", params.groupRank);
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const search = new URLSearchParams();
    if (params.queue) {
      search.set("queue", params.queue);
    }
    if (params.rankView) {
      search.set("rankView", params.rankView);
    }
    if (params.userRank) {
      search.set("userRank", params.userRank);
    }
    if (params.agentRank) {
      search.set("agentRank", params.agentRank);
    }
    if (params.groupRank) {
      search.set("groupRank", params.groupRank);
    }
    const suffix = search.toString();
    return suffix ? `${href}${href.includes("?") ? "&" : "?"}${suffix}` : href;
  }
}

const PRIORITY_EMPTY_COPY = "当前没有阻断项，治理积压可在下方队列继续跟进。";

type PriorityRow = {
  label: string;
  href?: string;
  onAction?: () => unknown;
  tone?: "danger" | "warn" | "neutral";
};

type OverviewIssue = {
  tone: "warning" | "error";
  message: string;
  actionLabel: string;
  onAction?: () => unknown;
  href?: string;
  linkLabel?: string;
  linkHref?: string;
};

function renderPriorityRows(rows: PriorityRow[]) {
  return html`
    <div class="enterprise-overview-priority-list">
      ${rows.map((row) => {
        const interactive = Boolean(row.href || row.onAction);
        const tone = row.tone === "danger" ? "is-danger" : row.tone === "warn" ? "is-warn" : "";
        // 行栈 + 细分隔线：card 分区内不再嵌套 .enterprise-card（避免卡中卡）。
        const className = [
          "enterprise-overview-row",
          interactive ? "enterprise-overview-row--interactive" : "",
          "enterprise-overview-priority-row",
          tone,
        ]
          .filter(Boolean)
          .join(" ");
        const content = html`
          <div class="enterprise-overview-priority-row__main">
            ${renderMeshBadge(
              row.tone === "danger" ? "阻断项" : row.tone === "warn" ? "待复核" : "观察",
              row.tone === "danger" ? "danger" : row.tone === "warn" ? "warn" : "neutral",
            )}
            <span class="enterprise-overview-priority-row__label">${row.label}</span>
          </div>
          ${renderIcon("chevronRight", "enterprise-overview-priority-row__chevron")}
        `;
        return row.href
          ? html`<a class=${className} href=${row.href}>${content}</a>`
          : row.onAction
            ? html`<button class=${className} type="button" @click=${() => row.onAction?.()}>
                ${content}
              </button>`
            : html`<div class=${className}>${content}</div>`;
      })}
    </div>
  `;
}

/**
 * 收集页面级告警（按严重程度排序）。
 * 告警层只承载 P0 行动层未覆盖的事项，避免与「优先处理」重复。
 */
function collectOverviewIssues(props: EnterpriseSurfaceProps, basePath: string): OverviewIssue[] {
  const enterprise = props.authPanelProps?.state?.enterprise;
  const issues: OverviewIssue[] = [];

  const connection = resolveEnterpriseConnectionView({
    connected: props.readModel.connected,
    connectionPhase: props.readModel.connectionPhase,
    lastError: props.readModel.lastError,
    payloadReady: props.readModel.enterprisePayloadReady,
    authIssue: isGatewayAuthIssue(props.readModel.lastError),
  });
  if (connection.showBanner) {
    const gatewayAuthIssue = isGatewayAuthIssue(props.readModel.lastError);
    const recoveryHint = resolveGatewayAuthRecoveryHint({
      authMode: props.readModel.bootstrapAuthMode,
      hasPlatformSession: Boolean(props.readModel.authenticatedUser),
    });
    issues.push({
      tone: "error",
      message: gatewayAuthIssue
        ? `Gateway 认证未完成：${recoveryHint}`
        : `企业数据未连接：${connection.bannerBody}`,
      actionLabel: "立即刷新",
      onAction: () => props.actions.overview.onRefresh(),
      linkLabel: "查看设置",
      linkHref: pathForTab("enterpriseSettings", basePath, {
        tenantId: props.readModel.currentTenantId,
      }),
    });
  }

  if (props.readModel.configIssueCount > 0) {
    issues.push({
      tone: "warning",
      message: `${props.readModel.configIssueCount} 个策略问题待处理`,
      actionLabel: "查看策略",
      href: pathForTab("enterpriseSettings", basePath, {
        tenantId: props.readModel.currentTenantId,
      }),
    });
  }

  if (enterprise?.status === "trial" && enterprise.seatUsed >= enterprise.seatQuota) {
    issues.push({
      tone: "warning",
      message: "试用席位已满，新增成员前需要扩容或释放席位。",
      actionLabel: "管理席位",
      href: pathForTab("enterpriseOrganization", basePath, {
        tenantId: props.readModel.currentTenantId,
      }),
      linkLabel: "查看升级",
      linkHref: enterprise.upgradeUrl,
    });
  }

  return issues;
}

/** 告警横幅：只渲染最严重的一条；没有异常时整条不渲染，把首屏让给指标与行动层。 */
function renderOverviewAlert(issues: OverviewIssue[]) {
  const issue = issues[0];
  if (!issue) {
    return nothing;
  }
  return html`
    <section class="enterprise-overview-alert is-${issue.tone}" role="status">
      <div class="enterprise-overview-alert__message">
        <span class="enterprise-command-status__badge">
          ${issue.tone === "error" ? "严重" : "警告"}
        </span>
        <span class="enterprise-command-status__message">${issue.message}</span>
      </div>
      <div class="enterprise-overview-alert__actions">
        ${
          issue.href
            ? html`<a class="btn btn--sm" href=${issue.href}>${issue.actionLabel}</a>`
            : html`<button class="btn btn--sm" type="button" @click=${() => issue.onAction?.()}>
                ${issue.actionLabel}
              </button>`
        }
        ${
          issue.linkHref && issue.linkLabel
            ? html`<a class="enterprise-command-status__link" href=${issue.linkHref}
                >${issue.linkLabel}</a
              >`
            : nothing
        }
      </div>
    </section>
  `;
}

export function renderEnterpriseOverviewSurface(props: EnterpriseSurfaceProps, basePath: string) {
  const { readModel } = props;
  const tenantId = readModel.currentTenantId;
  const connection = resolveEnterpriseConnectionView({
    connected: readModel.connected,
    connectionPhase: readModel.connectionPhase,
    lastError: readModel.lastError,
    payloadReady: readModel.enterprisePayloadReady,
    authIssue: isGatewayAuthIssue(readModel.lastError),
  });
  const quietLoading = connection.phase === "loading" && readModel.enterprisePayloadReady !== true;
  const activeMembers = readModel.memberSummaries.filter(
    (member) => member.status === "active",
  ).length;
  const uncoveredAgents = Math.max(
    readModel.meshSummary.agentCount - readModel.meshSummary.onlineAgentCount,
    0,
  );
  // 全页统一的成本归因口径：取使用记录缺口与机巢归因缺口的较大值，避免数字分叉。
  const unattributedEntries = Math.max(
    readModel.missingCostEntries,
    readModel.meshSummary.unattributedCostCount,
  );
  const issues = collectOverviewIssues(props, basePath);
  const governanceHref = (queue?: "restrict" | "owner" | "attribution" | "review") =>
    appendMeshSearchToHref(pathForTab("enterpriseMesh", basePath, { tenantId }), {
      rankView: "governance",
      queue: queue ?? null,
    });

  const kpis: EnterpriseKpiItem[] = [
    {
      label: "激活成员",
      value: quietLoading ? "…" : `${activeMembers} / ${readModel.memberCount}`,
      href: pathForTab("enterpriseOrganization", basePath, { tenantId }),
      tone: readModel.memberCount > 0 && activeMembers === 0 ? "warn" : "neutral",
    },
    {
      label: "在线代理",
      value: quietLoading
        ? "…"
        : `${readModel.meshSummary.onlineAgentCount} / ${readModel.meshSummary.agentCount}`,
      href: appendMeshSearchToHref(pathForTab("enterpriseMesh", basePath, { tenantId }), {
        rankView: "agent",
      }),
      tone:
        readModel.meshSummary.agentCount > 0 && readModel.meshSummary.onlineAgentCount === 0
          ? "warn"
          : "neutral",
    },
    {
      label: "活跃协作组",
      value: quietLoading
        ? "…"
        : `${readModel.meshSummary.activeGroupCount} / ${readModel.meshSummary.groupCount}`,
      href: appendMeshSearchToHref(pathForTab("enterpriseMesh", basePath, { tenantId }), {
        rankView: "group",
      }),
    },
    {
      label: "本月成本",
      value: quietLoading ? "…" : formatCost(readModel.totalCost),
      href: pathForTab("enterpriseUsage", basePath, { tenantId }),
    },
  ];

  const p0Rows: PriorityRow[] = [
    ...(readModel.vacantSeatCount > 0
      ? [
          {
            label: `${readModel.vacantSeatCount} 个岗位未绑定成员`,
            href: pathForTab("enterpriseOrganization", basePath, { tenantId }),
            tone: "danger" as const,
          },
        ]
      : []),
    ...(uncoveredAgents > 0
      ? [
          {
            label: `${uncoveredAgents} 个机器人无运行覆盖`,
            href: pathForTab("enterpriseCapabilityCenter", basePath, {
              tenantId,
              context: { enterpriseCapabilityRoute: "robots" },
            }),
            tone: "danger" as const,
          },
        ]
      : []),
    ...(unattributedEntries > 0
      ? [
          {
            label: `${unattributedEntries} 条成本未归因`,
            href: pathForTab("enterpriseUsage", basePath, { tenantId }),
            tone: "danger" as const,
          },
        ]
      : []),
  ];

  const queueRows = [
    {
      label: "高成本异常",
      count: readModel.meshSummary.inefficientAssetCount,
      tone: "danger" as const,
      href: governanceHref("review"),
    },
    ...(unattributedEntries === 0
      ? [
          {
            label: "归因缺失",
            count: 0,
            tone: "warn" as const,
            href: governanceHref("attribution"),
          },
        ]
      : []),
    {
      label: "创建人缺失",
      count: readModel.meshSummary.unownedAssetCount,
      tone: "warn" as const,
      href: governanceHref("owner"),
    },
  ];

  const settingsBaseHref = pathForTab("enterpriseSettings", basePath, { tenantId });
  const settingsSecurityHref = `${settingsBaseHref}/security`;
  const settingsIdentityBindingsHref = `${settingsBaseHref}/identity-bindings`;
  const quickActions = [
    {
      label: "邀请激活",
      href: `${pathForTab("enterpriseOrganization", basePath, { tenantId })}?organizationInvite=1`,
    },
    {
      label: "分配岗位",
      href: pathForTab("enterpriseOrganization", basePath, { tenantId }),
    },
    {
      label: "运营身份监管",
      href: settingsSecurityHref,
    },
  ];

  const assetLifecycleRows = [
    {
      label: "员工贡献审核",
      metric: "待承接",
      href: pathForTab("enterpriseCapabilityCenter", basePath, {
        tenantId,
        context: { enterpriseCapabilityRoute: "review-queue" },
      }),
      tone: "warn" as const,
    },
    {
      label: "企业正式资产",
      metric: "资产库",
      href: pathForTab("enterpriseCapabilityCenter", basePath, {
        tenantId,
        context: { enterpriseCapabilityRoute: "all" },
      }),
      tone: "neutral" as const,
    },
    {
      label: "能力安装与反馈",
      metric: `${readModel.meshSummary.agentCount} 个机器人`,
      href: pathForTab("enterpriseCapabilityCenter", basePath, {
        tenantId,
        context: { enterpriseCapabilityRoute: "install-management" },
      }),
      tone: "neutral" as const,
    },
    {
      label: "孵化与平台上架",
      metric: "高潜评估",
      href: pathForTab("enterpriseCapabilityCenter", basePath, {
        tenantId,
        context: { enterpriseCapabilityRoute: "incubation" },
      }),
      tone: "neutral" as const,
    },
  ];

  return html`
    <div class="enterprise-surface enterprise-surface--overview" @click=${followDelegatedPortHref}>
      ${renderOverviewAlert(issues)}
      <section class="enterprise-overview-shell">
        ${renderEnterpriseModuleHeader({
          title: t("tabs.enterpriseOverview"),
        })}
        <section class="enterprise-overview-snapshot" aria-label="关键指标">
          ${renderEnterpriseKpiGrid(kpis)}
        </section>

        <section class="enterprise-overview-grid">
          <div class="enterprise-overview-grid__main">
            <section class="enterprise-overview-section enterprise-card">
              <div class="enterprise-overview-section__head">
                <div class="enterprise-overview-section__title">优先处理</div>
                <span class="enterprise-command-card__count">${p0Rows.length}</span>
              </div>
              ${
                p0Rows.length
                  ? renderPriorityRows(p0Rows)
                  : html`<div class="enterprise-empty">${PRIORITY_EMPTY_COPY}</div>`
              }
              <div class="enterprise-overview-queue">
                <div class="enterprise-overview-queue__head">
                  <span class="enterprise-overview-queue__title">治理队列</span>
                  <a class="enterprise-command-status__link" href=${governanceHref()}>
                    进入治理队列
                  </a>
                </div>
                <div class="enterprise-overview-queue__rows">
                  ${queueRows.map(
                    (row) => html`
                      <a
                        class="enterprise-overview-row enterprise-overview-row--interactive enterprise-overview-queue-row"
                        href=${row.href}
                      >
                        <span class="enterprise-overview-queue-row__label">${row.label}</span>
                        ${renderMeshBadge(`${row.count} 项`, row.count > 0 ? row.tone : "neutral")}
                      </a>
                    `,
                  )}
                </div>
              </div>
            </section>

            ${renderEnterpriseIdentityBindingSummaryCard({
              readModel,
              tenantId,
              detailHref: settingsIdentityBindingsHref,
              refreshing: readModel.operationalIdentityBusy,
              onRefresh: () => {
                if (tenantId) {
                  void props.actions.settings.onRefreshIdentities(tenantId);
                }
              },
              onMarkRead: () =>
                props.identityManagementEditor.onMarkEmployeeBindingActivityRead?.(),
            })}

            <supervisor-node-binding-requests-card
              .client=${props.client ?? null}
              .tenantId=${tenantId}
              .detailHref=${settingsSecurityHref}
            ></supervisor-node-binding-requests-card>

            <enterprise-system-notices-card
              .client=${props.client ?? null}
              .tenantId=${tenantId}
              .detailHref=${pathForTab("enterpriseUsage", basePath, { tenantId })}
            ></enterprise-system-notices-card>

            <section class="enterprise-overview-section enterprise-card">
              <div class="enterprise-overview-section__head">
                <div class="enterprise-overview-section__title">资产闭环</div>
                <a
                  class="enterprise-command-status__link"
                  href=${pathForTab("enterpriseCapabilityCenter", basePath, { tenantId })}
                >
                  进入能力中心
                </a>
              </div>
              <div class="enterprise-overview-asset-loop">
                ${assetLifecycleRows.map(
                  (row) => html`
                    <a
                      class="enterprise-overview-row enterprise-overview-row--interactive enterprise-overview-asset-row ${
                        row.tone === "warn" ? "is-warn" : ""
                      }"
                      href=${row.href}
                    >
                      <strong>${row.label}</strong>
                      <span>${row.metric}</span>
                    </a>
                  `,
                )}
              </div>
            </section>
          </div>

          <div class="enterprise-overview-grid__side">
            <section class="enterprise-overview-section enterprise-card">
              <div class="enterprise-overview-section__head">
                <div class="enterprise-overview-section__title">系统状态</div>
              </div>
              <div class="enterprise-overview-status-list">
                <div class="enterprise-overview-status-row">
                  <span>企业数据</span>
                  ${renderMeshBadge(connection.label, connection.tone)}
                </div>
                <div class="enterprise-overview-status-row">
                  <span>运行节点</span>
                  ${renderMeshBadge(
                    `${readModel.presenceCount} 个在线`,
                    readModel.presenceCount > 0 ? "ok" : "warn",
                  )}
                </div>
                <div class="enterprise-overview-status-row">
                  <span>模型配置</span>
                  ${renderMeshBadge(
                    readModel.configuredProviderCount > 0
                      ? `${readModel.configuredProviderCount} 个提供方`
                      : "未登记",
                    readModel.configuredProviderCount > 0 ? "ok" : "warn",
                  )}
                </div>
                <div class="enterprise-overview-status-row">
                  <span>策略状态</span>
                  ${renderMeshBadge(
                    readModel.configIssueCount > 0
                      ? `${readModel.configIssueCount} 项待处理`
                      : "正常",
                    readModel.configIssueCount > 0 ? "warn" : "ok",
                  )}
                </div>
              </div>
            </section>

            <section class="enterprise-overview-section enterprise-card">
              <div class="enterprise-overview-section__head">
                <div class="enterprise-overview-section__title">快捷入口</div>
              </div>
              <div class="enterprise-overview-quick-list">
                ${quickActions.map(
                  (action) => html`
                    <a class="enterprise-overview-quick-action" href=${action.href}
                      >${action.label}</a
                    >
                  `,
                )}
              </div>
            </section>
          </div>
        </section>
      </section>
    </div>
  `;
}
