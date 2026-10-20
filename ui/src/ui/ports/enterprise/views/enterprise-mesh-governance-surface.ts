/* oxlint-disable no-unused-vars -- Phase 4 Ops/Perf embeds supersede legacy ranking/detail helpers; keep for rollback until follow-up cleanup. */
import { html, nothing } from "lit";
import "../../../capability/ai-workforce-governance/pages/assets-page.ts";
import "../../../capability/ai-workforce-governance/pages/ranking-page.ts";
import { t } from "../../../../i18n/index.ts";
import { setGovernanceApiClient } from "../../../capability/ai-workforce-governance/services/governanceApi.ts";
import { pathForTab, routeContextFromPath } from "../../../navigation.ts";
import {
  type EnterpriseKpiItem,
  renderEnterpriseKpiGrid,
} from "../../../views/enterprise-kpi-card.ts";
import { renderEnterpriseModuleHeader } from "../../../views/enterprise-module-header.ts";
import { formatCost, formatTokens } from "../../../views/usage-metrics.ts";
import { formatEnterpriseStatusLabel } from "../enterprise-connection-copy.ts";
import {
  DEFAULT_GOVERNANCE_CONFIG,
  detectGovernanceIssues,
  type GovernanceAgentInput,
  type GovernanceGroupInput,
} from "../governance/index.ts";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import {
  resolveOrganizationDigitalHumanName,
  resolveOrganizationHumanLabel,
  resolveOrganizationSeatDisplayName,
} from "./enterprise-organization-display-label.ts";
import { renderMeshAssetControls } from "./enterprise-pending-controls-panel.ts";
import {
  formatPercent,
  followDelegatedPortHref,
  followPortHref,
  renderOwnershipTransferEditor,
  renderEnterpriseDataNotice,
  renderEnterpriseSeatLimitNotice,
  shouldProceed,
} from "./enterprise-surface-shared.ts";
import type {
  EnterpriseSurfaceProps,
  MeshAgentRankMode,
  MeshGroupRankMode,
  MeshQueueFilter,
  MeshRankView,
  MeshUserRankMode,
} from "./enterprise-surface-types.ts";
import { renderMeshGraphsPanel } from "./mesh-graphs-panel.ts";

type MeshWorkbenchTab = "operations" | "performance";

type MeshUserRow = EnterprisePortReadModel["meshUsers"][number];
type MeshAgentRow = EnterprisePortReadModel["meshAgents"][number];
type MeshGroupRow = EnterprisePortReadModel["meshGroups"][number];
type MeshAnomalyRow = EnterprisePortReadModel["meshAnomalies"][number];

function formatOptionalCost(value: number | null | undefined) {
  return formatCost(value ?? 0);
}

function meshOwnershipLabel(value: string) {
  switch (value) {
    case "owned":
      return "已记录";
    case "ambiguous":
      return "创建人不清";
    default:
      return "未记录";
  }
}

function meshAttributionLabel(value: string) {
  switch (value) {
    case "attributed":
      return "正式归因";
    case "partial":
      return "推导归因";
    default:
      return "未归因";
  }
}

function meshGovernanceLabel(value: string) {
  switch (value) {
    case "restricted":
      return "已限制";
    case "paused":
      return "已暂停";
    case "watch":
      return "观察";
    default:
      return "正常";
  }
}

function meshBudgetLabel(value: string) {
  switch (value) {
    case "warning":
      return "接近预算";
    case "exceeded":
      return "已超预算";
    case "normal":
      return "正常";
    default:
      return "未设置";
  }
}

function renderMeshBadge(label: string, tone: "neutral" | "ok" | "warn" | "danger" = "neutral") {
  return html`<span class="enterprise-mesh-badge enterprise-mesh-badge--${tone}">${label}</span>`;
}

function meshQueueLabel(value: MeshQueueFilter) {
  switch (value) {
    case "restrict":
      return "待限制";
    case "owner":
      return "待补创建人";
    case "attribution":
      return "待补归因";
    default:
      return "待复核成本";
  }
}

function meshQueueDescription(value: MeshQueueFilter) {
  switch (value) {
    case "restrict":
      return "当前仅显示已进入限制态或已具备限制前提的对象。";
    case "owner":
      return "当前仅显示创建人缺失或记录不清的对象。";
    case "attribution":
      return "当前仅显示成本归因仍不完整的对象。";
    default:
      return "当前仅显示需要继续复核成本和运行质量的对象。";
  }
}

function resolveMeshQueueFilter(search: string): MeshQueueFilter | null {
  const value = new URLSearchParams(search).get("queue");
  return value === "restrict" || value === "owner" || value === "attribution" || value === "review"
    ? value
    : null;
}

function resolveMeshRankView(search: string): MeshRankView {
  const value = new URLSearchParams(search).get("rankView");
  return value === "governance" || value === "agent" || value === "group" ? value : "governance";
}

function resolveMeshUserRankMode(search: string): MeshUserRankMode {
  const value = new URLSearchParams(search).get("userRank");
  return value === "efficiency" || value === "stability" ? value : "impact";
}

function resolveMeshAgentRankMode(search: string): MeshAgentRankMode {
  const value = new URLSearchParams(search).get("agentRank");
  return value === "efficiency" || value === "stability" ? value : "impact";
}

function resolveMeshGroupRankMode(search: string): MeshGroupRankMode {
  const value = new URLSearchParams(search).get("groupRank");
  return value === "efficiency" || value === "stability" ? value : "impact";
}

function appendMeshSearchToHref(
  href: string,
  params: {
    meshTab?: MeshWorkbenchTab | null;
    queue?: MeshQueueFilter | null;
    rankView?: MeshRankView | null;
    userRank?: MeshUserRankMode | null;
    agentRank?: MeshAgentRankMode | null;
    groupRank?: MeshGroupRankMode | null;
  },
): string {
  try {
    const parsed = new URL(href, "http://localhost");
    if (params.meshTab) {
      parsed.searchParams.set("meshTab", params.meshTab);
    } else {
      parsed.searchParams.delete("meshTab");
    }
    if (params.queue) {
      parsed.searchParams.set("queue", params.queue);
    } else {
      parsed.searchParams.delete("queue");
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
    if (params.meshTab) {
      search.set("meshTab", params.meshTab);
    }
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

function meshGovernancePriority(value: string): number {
  switch (value) {
    case "restricted":
      return 4;
    case "watch":
      return 3;
    case "paused":
      return 2;
    default:
      return 1;
  }
}

function meshBudgetPriority(value: string): number {
  switch (value) {
    case "exceeded":
      return 4;
    case "warning":
      return 3;
    case "none":
      return 2;
    default:
      return 1;
  }
}

function meshOwnershipPriority(value: string): number {
  switch (value) {
    case "unowned":
      return 3;
    case "ambiguous":
      return 2;
    default:
      return 1;
  }
}

function meshAttributionPriority(value: string): number {
  switch (value) {
    case "unattributed":
      return 3;
    case "partial":
      return 2;
    default:
      return 1;
  }
}

function meshSeverityPriority(value: string): number {
  return value === "critical" ? 2 : 1;
}

function meshGovernanceTone(value: string): "ok" | "warn" | "danger" {
  switch (value) {
    case "restricted":
      return "danger";
    case "watch":
    case "paused":
      return "warn";
    default:
      return "ok";
  }
}

function meshAttributionTone(value: string): "ok" | "warn" | "danger" {
  switch (value) {
    case "unattributed":
      return "danger";
    case "partial":
      return "warn";
    default:
      return "ok";
  }
}

function meshRuntimeTone(value: MeshAgentRow["status"]): "ok" | "warn" {
  return value === "online" ? "ok" : "warn";
}

type MeshJudgmentItem = {
  label: string;
  value: string | number;
  priority: number;
};

function renderMeshJudgmentList(items: MeshJudgmentItem[]) {
  const ordered = [...items].toSorted((left, right) => right.priority - left.priority);
  return html`
    <div class="enterprise-mesh-mini-list">
      <div class="enterprise-mesh-mini-list__title">关键判断</div>
      ${ordered.map(
        (item) => html`
          <div class="enterprise-mesh-mini-link">
            <span>${item.label}</span>
            <strong>${String(item.value)}</strong>
          </div>
        `,
      )}
    </div>
  `;
}

function sortMeshUsers(users: MeshUserRow[], mode: MeshUserRankMode): MeshUserRow[] {
  const score = (user: MeshUserRow) => {
    switch (mode) {
      case "efficiency":
        return (
          (user.sessionCount * 40 + user.ownedAgentCount * 8 + user.ownedGroupCount * 10) /
            Math.max(user.totalCost, 1) -
          user.incidentCount * 18
        );
      case "stability":
        return (
          user.sessionCount * 14 +
          (user.ownedAgentCount + user.ownedGroupCount) * 6 -
          user.incidentCount * 40 -
          user.totalCost
        );
      default:
        return (
          user.sessionCount * 20 +
          user.ownedAgentCount * 8 +
          user.ownedGroupCount * 10 -
          user.incidentCount * 24 -
          user.totalCost * 2
        );
    }
  };
  return [...users].toSorted(
    (left, right) =>
      score(right) - score(left) ||
      left.incidentCount - right.incidentCount ||
      right.sessionCount - left.sessionCount ||
      right.totalCost - left.totalCost ||
      right.ownedAgentCount - left.ownedAgentCount ||
      right.ownedGroupCount - left.ownedGroupCount ||
      left.displayLabel.localeCompare(right.displayLabel),
  );
}

function sortMeshAgents(agents: MeshAgentRow[], mode: MeshAgentRankMode): MeshAgentRow[] {
  const score = (agent: MeshAgentRow) => {
    switch (mode) {
      case "efficiency":
        return (
          (agent.sessionCount * 42 + agent.groupCount * 8) / Math.max(agent.totalCost, 1) -
          agent.errorCount * 15 -
          meshGovernancePriority(agent.governanceStatus) * 6
        );
      case "stability":
        return (
          (agent.status === "online" ? 40 : 0) +
          agent.sessionCount * 10 -
          agent.errorCount * 28 -
          meshGovernancePriority(agent.governanceStatus) * 14 -
          meshBudgetPriority(agent.budgetStatus) * 6
        );
      default:
        return (
          agent.sessionCount * 22 +
          agent.groupCount * 8 -
          agent.errorCount * 18 -
          agent.totalCost * 3 -
          meshGovernancePriority(agent.governanceStatus) * 6
        );
    }
  };
  return [...agents].toSorted(
    (left, right) =>
      score(right) - score(left) ||
      right.sessionCount - left.sessionCount ||
      left.errorCount - right.errorCount ||
      right.totalCost - left.totalCost ||
      meshGovernancePriority(left.governanceStatus) -
        meshGovernancePriority(right.governanceStatus) ||
      left.name.localeCompare(right.name),
  );
}

function sortMeshGroups(groups: MeshGroupRow[], mode: MeshGroupRankMode): MeshGroupRow[] {
  const score = (group: MeshGroupRow) => {
    switch (mode) {
      case "efficiency":
        return (
          (group.sessionCount * 44 + group.agentCount * 8 + group.memberCount * 5) /
            Math.max(group.totalCost, 1) -
          group.incidentCount * 16 -
          meshGovernancePriority(group.governanceStatus) * 6
        );
      case "stability":
        return (
          group.sessionCount * 10 +
          group.agentCount * 8 +
          group.memberCount * 6 -
          group.incidentCount * 26 -
          meshGovernancePriority(group.governanceStatus) * 14 -
          meshAttributionPriority(group.costAttributionStatus) * 6
        );
      default:
        return (
          group.sessionCount * 24 +
          group.agentCount * 8 +
          group.memberCount * 5 -
          group.incidentCount * 20 -
          group.totalCost * 2.5 -
          meshGovernancePriority(group.governanceStatus) * 6
        );
    }
  };
  return [...groups].toSorted(
    (left, right) =>
      score(right) - score(left) ||
      right.sessionCount - left.sessionCount ||
      left.incidentCount - right.incidentCount ||
      right.totalCost - left.totalCost ||
      meshGovernancePriority(left.governanceStatus) -
        meshGovernancePriority(right.governanceStatus) ||
      left.name.localeCompare(right.name),
  );
}

function renderMeshRankSwitcher(params: {
  modes: Array<{ value: "impact" | "efficiency" | "stability"; label: string }>;
  current: "impact" | "efficiency" | "stability";
  baseHref: string;
  queue: MeshQueueFilter | null;
  rankView: MeshRankView;
  userRank: MeshUserRankMode;
  agentRank: MeshAgentRankMode;
  groupRank: MeshGroupRankMode;
  queryKey: "userRank" | "agentRank" | "groupRank";
}) {
  return html`
    <div class="enterprise-rank-switch">
      ${params.modes.map((mode) => {
        const href = appendMeshSearchToHref(params.baseHref, {
          queue: params.queue,
          rankView: params.rankView,
          userRank: params.queryKey === "userRank" ? mode.value : params.userRank,
          agentRank: params.queryKey === "agentRank" ? mode.value : params.agentRank,
          groupRank: params.queryKey === "groupRank" ? mode.value : params.groupRank,
        } as {
          queue?: MeshQueueFilter | null;
          rankView?: MeshRankView | null;
          userRank?: MeshUserRankMode | null;
          agentRank?: MeshAgentRankMode | null;
          groupRank?: MeshGroupRankMode | null;
        });
        return html`
          <a
            class="enterprise-rank-switch__item ${params.current === mode.value ? "is-active" : ""}"
            href=${href}
            @click=${(event: MouseEvent) => followPortHref(event, href)}
          >
            ${mode.label}
          </a>
        `;
      })}
    </div>
  `;
}

function renderMeshWorkbenchTabs(params: {
  current: MeshRankView;
  baseHref: string;
  queue: MeshQueueFilter | null;
  userRank: MeshUserRankMode;
  agentRank: MeshAgentRankMode;
  groupRank: MeshGroupRankMode;
}) {
  const tabs: Array<{ value: MeshRankView; label: string }> = [
    { value: "governance", label: "治理队列" },
    { value: "user", label: "员工排名" },
    { value: "agent", label: "机器人排名" },
    { value: "group", label: "协作小组排名" },
  ];
  return html`
    <div data-mesh-panel="ranking-tabs">
      <div class="enterprise-rank-tabs" role="tablist" aria-label="机巢治理工作台分类">
        ${tabs.map((tab) => {
          const href = appendMeshSearchToHref(params.baseHref, {
            queue: tab.value === "governance" ? params.queue : null,
            rankView: tab.value,
            userRank: params.userRank,
            agentRank: params.agentRank,
            groupRank: params.groupRank,
          });
          return html`
            <a
              role="tab"
              aria-selected=${String(params.current === tab.value)}
              class="enterprise-rank-tabs__item ${params.current === tab.value ? "is-active" : ""}"
              href=${href}
              @click=${(event: MouseEvent) => followPortHref(event, href)}
            >
              ${tab.label}
            </a>
          `;
        })}
      </div>
    </div>
  `;
}

function matchesMeshQueueAgent(agent: MeshAgentRow, queueFilter: MeshQueueFilter): boolean {
  switch (queueFilter) {
    case "restrict":
      return agent.governanceStatus === "restricted";
    case "owner":
      return agent.creatorStatus !== "owned";
    case "attribution":
      return agent.costAttributionStatus !== "attributed";
    case "review":
      return (
        agent.governanceStatus === "watch" ||
        agent.governanceStatus === "paused" ||
        agent.errorCount > 0 ||
        (agent.totalCost > 0 && agent.sessionCount <= 1)
      );
  }
}

function matchesMeshQueueGroup(group: MeshGroupRow, queueFilter: MeshQueueFilter): boolean {
  switch (queueFilter) {
    case "restrict":
      return group.governanceStatus === "restricted";
    case "owner":
      return group.creatorStatus !== "owned";
    case "attribution":
      return group.costAttributionStatus !== "attributed";
    case "review":
      return (
        group.governanceStatus === "watch" ||
        group.governanceStatus === "paused" ||
        group.incidentCount > 0 ||
        (group.totalCost > 0 && group.sessionCount <= 1)
      );
  }
}

function filterMeshUsers(
  users: MeshUserRow[],
  agents: MeshAgentRow[],
  groups: MeshGroupRow[],
  queueFilter: MeshQueueFilter | null,
) {
  if (!queueFilter) {
    return users;
  }
  return users.filter((user) => {
    const ownedAgents = agents.filter(
      (entry) => entry.creatorUser === user.user && matchesMeshQueueAgent(entry, queueFilter),
    );
    const ownedGroups = groups.filter(
      (entry) => entry.creatorUser === user.user && matchesMeshQueueGroup(entry, queueFilter),
    );
    return ownedAgents.length > 0 || ownedGroups.length > 0;
  });
}

function buildMeshAnomalyView(readModel: EnterprisePortReadModel) {
  const governanceByTarget = new Map<string, string>();
  for (const agent of readModel.meshAgents) {
    governanceByTarget.set(`agent:${agent.agentId}`, agent.governanceStatus);
  }
  for (const group of readModel.meshGroups) {
    governanceByTarget.set(`group:${group.groupId}`, group.governanceStatus);
  }
  for (const user of readModel.meshUsers) {
    const issueCount =
      (user.ownedAgentCount === 0 ? 1 : 0) +
      (user.totalCost > 0 && user.sessionCount <= 1 ? 1 : 0) +
      (user.incidentCount > 0 ? 1 : 0);
    governanceByTarget.set(
      `user:${user.user}`,
      issueCount >= 2 ? "watch" : issueCount === 1 ? "paused" : "normal",
    );
  }

  const aggregated = new Map<
    string,
    MeshAnomalyRow & {
      issueCount: number;
      reasons: string[];
      metas: string[];
      governanceStatus: string;
    }
  >();

  for (const item of readModel.meshAnomalies) {
    const key = item.targetId ? `${item.kind}:${item.targetId}` : `${item.kind}:${item.id}`;
    const current = aggregated.get(key);
    if (!current) {
      aggregated.set(key, {
        ...item,
        issueCount: 1,
        reasons: [item.reason],
        metas: item.meta ? [item.meta] : [],
        governanceStatus: governanceByTarget.get(key) ?? "watch",
      });
      continue;
    }
    current.issueCount += 1;
    if (!current.reasons.includes(item.reason)) {
      current.reasons.push(item.reason);
    }
    if (item.meta && !current.metas.includes(item.meta)) {
      current.metas.push(item.meta);
    }
    if (meshSeverityPriority(item.severity) > meshSeverityPriority(current.severity)) {
      current.severity = item.severity;
    }
  }

  return [...aggregated.values()]
    .toSorted(
      (left, right) =>
        meshSeverityPriority(right.severity) - meshSeverityPriority(left.severity) ||
        meshGovernancePriority(right.governanceStatus) -
          meshGovernancePriority(left.governanceStatus) ||
        right.issueCount - left.issueCount ||
        left.title.localeCompare(right.title),
    )
    .slice(0, 8)
    .map((item) => ({
      ...item,
      reasonSummary:
        item.reasons.length > 1
          ? `${item.reasons[0]}；另有 ${item.reasons.length - 1} 项治理问题`
          : (item.reasons[0] ?? item.reason),
      metaSummary:
        item.issueCount > 1
          ? `${item.issueCount} 项问题 · ${item.metas[0] ?? item.meta}`
          : (item.metas[0] ?? item.meta),
    }));
}

function classifyMeshQueue(
  item: ReturnType<typeof buildMeshAnomalyView>[number],
): "restrict" | "owner" | "attribution" | "review" {
  if (item.governanceStatus === "restricted") {
    return "restrict";
  }
  if (item.reasons.some((reason) => reason.includes("负责人") || reason.includes("创建人"))) {
    return "owner";
  }
  if (item.reasons.some((reason) => reason.includes("归因"))) {
    return "attribution";
  }
  return "review";
}

function renderMeshUserDistribution(readModel: EnterprisePortReadModel, basePath: string) {
  const search = typeof window !== "undefined" ? window.location.search : "";
  const queueFilter = null;
  const rankView = resolveMeshRankView(search);
  const rankMode = resolveMeshUserRankMode(search);
  const agentRankMode = resolveMeshAgentRankMode(search);
  const groupRankMode = resolveMeshGroupRankMode(search);
  const users = sortMeshUsers(
    filterMeshUsers(readModel.meshUsers, readModel.meshAgents, readModel.meshGroups, queueFilter),
    rankMode,
  );
  const baseHref = typeof window !== "undefined" ? window.location.pathname : "";
  return html`
    <section class="enterprise-panel" data-mesh-panel="users">
      <div class="enterprise-panel__header">
        <div>
          <div class="enterprise-panel__title">员工使用排名</div>
        </div>
        ${renderMeshBadge(`${readModel.meshSummary.userCount} 人`, "neutral")}
      </div>
      ${renderMeshRankSwitcher({
        modes: [
          { value: "impact", label: "使用成效" },
          { value: "efficiency", label: "成本效率" },
          { value: "stability", label: "异常最少" },
        ],
        current: rankMode,
        baseHref,
        queue: queueFilter,
        rankView,
        userRank: rankMode,
        agentRank: agentRankMode,
        groupRank: groupRankMode,
        queryKey: "userRank",
      })}
      <div class="enterprise-data-table-wrap">
        <table class="enterprise-data-table">
          <thead>
            <tr>
              <th>排名</th>
              <th>用户</th>
              <th>角色</th>
              <th>资产</th>
              <th>会话</th>
              <th>成本</th>
              <th>风险</th>
            </tr>
          </thead>
          <tbody>
            ${
              users.length === 0
                ? html`
                    <tr>
                      <td colspan="7">当前没有可见企业用户。</td>
                    </tr>
                  `
                : users.map(
                    (user, index) => html`
                      <tr>
                        <td>${index + 1}</td>
                        <td>
                          <a
                            class="enterprise-data-table__strong"
                            href=${appendMeshSearchToHref(
                              pathForTab("enterpriseMesh", basePath, {
                                tenantId: readModel.currentTenantId,
                                context: {
                                  userId: user.user,
                                  sourcePort: "enterprise",
                                  sourcePage: "enterpriseMesh",
                                },
                              }),
                              {
                                queue: queueFilter,
                                rankView,
                                userRank: rankMode,
                                agentRank: agentRankMode,
                                groupRank: groupRankMode,
                              },
                            )}
                          >
                            ${user.displayLabel}
                          </a>
                          <div class="enterprise-data-table__sub">${user.user}</div>
                        </td>
                        <td>${user.role}</td>
                        <td>${user.ownedAgentCount} 机器人 · ${user.ownedGroupCount} 协作组</td>
                        <td>${user.sessionCount}</td>
                        <td>${formatOptionalCost(user.totalCost)}</td>
                        <td>
                          ${
                            user.incidentCount > 0
                              ? renderMeshBadge(`${user.incidentCount} 异常`, "warn")
                              : user.ownedAgentCount + user.ownedGroupCount === 0
                                ? renderMeshBadge("无资产", "neutral")
                                : renderMeshBadge("稳定", "ok")
                          }
                        </td>
                      </tr>
                    `,
                  )
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderMeshAgentPerformance(readModel: EnterprisePortReadModel, basePath: string) {
  const search = typeof window !== "undefined" ? window.location.search : "";
  const queueFilter = null;
  const rankView = resolveMeshRankView(search);
  const userRankMode = resolveMeshUserRankMode(search);
  const rankMode = resolveMeshAgentRankMode(search);
  const groupRankMode = resolveMeshGroupRankMode(search);
  const agents = sortMeshAgents(
    queueFilter
      ? readModel.meshAgents.filter((agent) => matchesMeshQueueAgent(agent, queueFilter))
      : readModel.meshAgents,
    rankMode,
  );
  const baseHref = typeof window !== "undefined" ? window.location.pathname : "";
  return html`
    <section class="enterprise-panel" data-mesh-panel="agents">
      <div class="enterprise-panel__header">
        <div>
          <div class="enterprise-panel__title">机器人排名</div>
        </div>
        ${renderMeshBadge(`${formatPercent(readModel.meshSummary.activeAgentRate)} 活跃`, "ok")}
      </div>
      ${renderMeshRankSwitcher({
        modes: [
          { value: "impact", label: "运行成效" },
          { value: "efficiency", label: "成本效率" },
          { value: "stability", label: "稳定性" },
        ],
        current: rankMode,
        baseHref,
        queue: queueFilter,
        rankView,
        userRank: userRankMode,
        agentRank: rankMode,
        groupRank: groupRankMode,
        queryKey: "agentRank",
      })}
      <div class="enterprise-data-table-wrap">
        <table class="enterprise-data-table">
          <thead>
            <tr>
              <th>排名</th>
              <th>机器人</th>
              <th>归属岗位</th>
              <th>当前负责人</th>
              <th>治理</th>
              <th>会话</th>
              <th>成本</th>
              <th>风险</th>
            </tr>
          </thead>
          <tbody>
            ${
              agents.length === 0
                ? html`
                    <tr>
                      <td colspan="8">当前没有可见机器人资产。</td>
                    </tr>
                  `
                : agents.map((agent, index) => {
                    const humanName = resolveOrganizationHumanLabel(agent.name);
                    const digitalName =
                      humanName && humanName !== agent.agentId
                        ? humanName
                        : resolveOrganizationDigitalHumanName(agent.ownership.positionLabel || "");
                    const positionName = resolveOrganizationSeatDisplayName(
                      agent.ownership.positionLabel || "",
                    );
                    const managerName =
                      resolveOrganizationHumanLabel(agent.ownership.currentManagerLabel) ??
                      "未绑定成员";
                    return html`
                      <tr>
                        <td>${index + 1}</td>
                        <td>
                          <a
                            class="enterprise-data-table__strong"
                            href=${appendMeshSearchToHref(
                              pathForTab("enterpriseMesh", basePath, {
                                tenantId: readModel.currentTenantId,
                                context: {
                                  agentId: agent.agentId,
                                  sourcePort: "enterprise",
                                  sourcePage: "enterpriseMesh",
                                },
                              }),
                              {
                                queue: queueFilter,
                                rankView,
                                userRank: userRankMode,
                                agentRank: rankMode,
                                groupRank: groupRankMode,
                              },
                            )}
                          >
                            ${digitalName}
                          </a>
                        </td>
                        <td>${positionName}</td>
                        <td>${managerName}</td>
                        <td>
                          ${renderMeshBadge(meshGovernanceLabel(agent.governanceStatus), meshGovernanceTone(agent.governanceStatus))}
                        </td>
                        <td>${agent.sessionCount}</td>
                        <td>${formatOptionalCost(agent.totalCost)}</td>
                        <td>
                          ${
                            agent.errorCount > 0
                              ? renderMeshBadge(`${agent.errorCount} 错误`, "warn")
                              : agent.costAttributionStatus !== "attributed"
                                ? renderMeshBadge(
                                    meshAttributionLabel(agent.costAttributionStatus),
                                    meshAttributionTone(agent.costAttributionStatus),
                                  )
                                : renderMeshBadge(agent.status, meshRuntimeTone(agent.status))
                          }
                        </td>
                      </tr>
                    `;
                  })
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderMeshGroupPerformance(readModel: EnterprisePortReadModel, basePath: string) {
  const search = typeof window !== "undefined" ? window.location.search : "";
  const queueFilter = null;
  const rankView = resolveMeshRankView(search);
  const userRankMode = resolveMeshUserRankMode(search);
  const agentRankMode = resolveMeshAgentRankMode(search);
  const rankMode = resolveMeshGroupRankMode(search);
  const groups = sortMeshGroups(
    queueFilter
      ? readModel.meshGroups.filter((group) => matchesMeshQueueGroup(group, queueFilter))
      : readModel.meshGroups,
    rankMode,
  );
  const baseHref = typeof window !== "undefined" ? window.location.pathname : "";
  return html`
    <section class="enterprise-panel" data-mesh-panel="groups">
      <div class="enterprise-panel__header">
        <div>
          <div class="enterprise-panel__title">协作小组排名</div>
        </div>
        ${renderMeshBadge(`${formatPercent(readModel.meshSummary.activeGroupRate)} 活跃`, "ok")}
      </div>
      ${renderMeshRankSwitcher({
        modes: [
          { value: "impact", label: "协同产出" },
          { value: "efficiency", label: "成本效率" },
          { value: "stability", label: "风险最少" },
        ],
        current: rankMode,
        baseHref,
        queue: queueFilter,
        rankView,
        userRank: userRankMode,
        agentRank: agentRankMode,
        groupRank: rankMode,
        queryKey: "groupRank",
      })}
      <div class="enterprise-data-table-wrap">
        <table class="enterprise-data-table">
          <thead>
            <tr>
              <th>排名</th>
              <th>协作小组</th>
              <th>归属岗位</th>
              <th>当前负责人</th>
              <th>治理</th>
              <th>成员</th>
              <th>会话</th>
              <th>成本</th>
              <th>风险</th>
            </tr>
          </thead>
          <tbody>
            ${
              groups.length === 0
                ? html`
                    <tr>
                      <td colspan="9">当前没有可见协作小组。</td>
                    </tr>
                  `
                : groups.map(
                    (group, index) => html`
                      <tr>
                        <td>${index + 1}</td>
                        <td>
                          <a
                            class="enterprise-data-table__strong"
                            href=${appendMeshSearchToHref(
                              pathForTab("enterpriseMesh", basePath, {
                                tenantId: readModel.currentTenantId,
                                context: {
                                  groupId: group.groupId,
                                  sourcePort: "enterprise",
                                  sourcePage: "enterpriseMesh",
                                },
                              }),
                              {
                                queue: queueFilter,
                                rankView,
                                userRank: userRankMode,
                                agentRank: agentRankMode,
                                groupRank: rankMode,
                              },
                            )}
                          >
                            ${group.name}
                          </a>
                          <div class="enterprise-data-table__sub">
                            ${meshGovernanceLabel(group.governanceStatus)}
                          </div>
                        </td>
                        <td>${group.ownership.positionLabel}</td>
                        <td>${group.ownership.currentManagerLabel}</td>
                        <td>
                          ${renderMeshBadge(meshGovernanceLabel(group.governanceStatus), meshGovernanceTone(group.governanceStatus))}
                        </td>
                        <td>${group.memberCount}</td>
                        <td>${group.sessionCount}</td>
                        <td>${formatOptionalCost(group.totalCost)}</td>
                        <td>
                          ${
                            group.incidentCount > 0
                              ? renderMeshBadge(`${group.incidentCount} 异常`, "warn")
                              : group.costAttributionStatus !== "attributed"
                                ? renderMeshBadge(
                                    meshAttributionLabel(group.costAttributionStatus),
                                    meshAttributionTone(group.costAttributionStatus),
                                  )
                                : renderMeshBadge(`${group.agentCount} 机器人`, "neutral")
                          }
                        </td>
                      </tr>
                    `,
                  )
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderActiveMeshRankingPanel(readModel: EnterprisePortReadModel, basePath: string) {
  const search = typeof window !== "undefined" ? window.location.search : "";
  const rankView = resolveMeshRankView(search);
  switch (rankView) {
    case "governance":
      return nothing;
    case "agent":
      return renderMeshAgentPerformance(readModel, basePath);
    case "group":
      return renderMeshGroupPerformance(readModel, basePath);
    default:
      return renderMeshUserDistribution(readModel, basePath);
  }
}

function renderMeshActionCards(
  cards: Array<{
    title: string;
    subtitle?: string;
    href: string;
    tone?: "primary" | "danger";
  }>,
) {
  return html`
    <div class="enterprise-mesh-card-grid">
      ${cards.map(
        (card) => html`
          <a
            class="enterprise-mesh-card enterprise-mesh-card--${card.tone ?? "neutral"}"
            href=${card.href}
          >
            <strong>${card.title}</strong>
            ${card.subtitle ? html`<span>${card.subtitle}</span>` : nothing}
          </a>
        `,
      )}
    </div>
  `;
}

function ownershipActionButtons(params: {
  assetType: "agent" | "group";
  tenantId: string | null;
  subjectId: string;
  subjectLabel: string;
  currentManagerUserId: string;
  currentManagerLabel: string;
  positionId: string;
  positionLabel: string;
  nextCandidateUserId: string | null;
  ownershipTransferEditor: EnterpriseSurfaceProps["ownershipTransferEditor"];
  actions: EnterpriseSurfaceProps["actions"];
}) {
  if (!params.tenantId) {
    return nothing;
  }
  const revokeLabel = params.assetType === "agent" ? "解绑机器人归属" : "解绑小组归属";
  const transferLabel = params.assetType === "agent" ? "转移机器人归属" : "转移小组归属";
  return html`
    <div
      class="enterprise-mesh-owner-actions"
      style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px;"
    >
      <button
        class="btn btn--sm"
        type="button"
        @click=${async () => {
          if (
            !shouldProceed(
              `确认解绑当前${params.assetType === "agent" ? "机器人" : "协作小组"}归属吗？`,
            )
          ) {
            return;
          }
          if (!params.tenantId) {
            return;
          }
          await params.actions.mesh.onRevokeOwnership(
            params.tenantId,
            params.assetType,
            params.subjectId,
            params.currentManagerUserId,
            params.currentManagerLabel,
            "manual revoke from enterprise mesh",
          );
        }}
      >
        ${revokeLabel}
      </button>
      <button
        class="btn btn--sm btn--primary"
        type="button"
        ?disabled=${!params.nextCandidateUserId}
        @click=${async () => {
          if (!params.nextCandidateUserId) {
            return;
          }
          if (!params.tenantId) {
            return;
          }
          params.ownershipTransferEditor.onOpen({
            tenantId: params.tenantId,
            subjectKind: params.assetType,
            subjectId: params.subjectId,
            subjectLabel: params.subjectLabel,
            positionId: params.positionId,
            positionLabel: params.positionLabel,
            currentManagerUserId: params.currentManagerUserId,
            currentManagerLabel: params.currentManagerLabel,
            suggestedUserId: params.nextCandidateUserId,
          });
        }}
      >
        ${transferLabel}
      </button>
    </div>
  `;
}

function renderMeshOwnerPanel(params: {
  readModel: EnterprisePortReadModel;
  basePath: string;
  title: string;
  currentCreatorUser: string | null;
  currentCreatorLabel: string | null;
  assetType: "agent" | "group";
}) {
  const candidates = [...params.readModel.memberSummaries]
    .toSorted((left, right) => {
      const score = (entry: (typeof params.readModel.memberSummaries)[number]) => {
        let value = 0;
        if (entry.user === params.currentCreatorUser) {
          value += 100;
        }
        if (entry.membershipRole === "enterprise-admin") {
          value += 20;
        }
        if (entry.status === "active") {
          value += 10;
        }
        if (entry.seatTitle) {
          value += 5;
        }
        return value;
      };
      return score(right) - score(left);
    })
    .slice(0, 4);

  return html`
    <div class="enterprise-mesh-mini-list">
      <div class="enterprise-mesh-mini-list__title">创建人记录面板</div>
      <div class="enterprise-mesh-owner-state">
        <span>当前创建人</span>
        <strong>${params.currentCreatorLabel ?? "未记录"}</strong>
      </div>
      <div class="enterprise-mesh-note">
        ${params.title}
        当前只提供创建人记录的治理建议和确认路径。正式记录应在组织页完成，确保岗位、权限和审计关系同步更新。
      </div>
      <div class="enterprise-mesh-owner-grid">
        ${candidates.map((member) => {
          const href = pathForTab("enterpriseOrganization", params.basePath, {
            tenantId: params.readModel.currentTenantId,
            context: {
              userId: member.user,
              sourcePort: "enterprise",
              sourcePage: "enterpriseMesh",
            },
          });
          const badges = [
            member.membershipRole === "enterprise-admin" ? "管理员" : "成员",
            member.seatTitle ?? "未绑定岗位",
            member.status === "active" ? "正常" : formatEnterpriseStatusLabel(member.status),
          ];
          const recommendation =
            member.user === params.currentCreatorUser
              ? "当前创建人"
              : member.membershipRole === "enterprise-admin"
                ? "优先候选：管理员可复核创建记录"
                : member.seatTitle
                  ? "候选：已绑定岗位席位，可作为创建记录参考"
                  : "候选：需先确认岗位与权限";
          return html`
            <a
              class="enterprise-mesh-owner-card ${member.user === params.currentCreatorUser ? "is-current" : ""}"
              href=${href}
              @click=${(event: MouseEvent) => followPortHref(event, href)}
            >
              <div class="enterprise-mesh-owner-card__head">
                <strong>${member.displayLabel}</strong>
                ${member.user === params.currentCreatorUser ? renderMeshBadge("当前创建人", "ok") : nothing}
              </div>
              <div class="enterprise-data-table__sub">${member.user}</div>
              <div class="enterprise-mesh-owner-card__badges">
                ${badges.map((label) => renderMeshBadge(label))}
              </div>
              <div class="enterprise-mesh-owner-card__reason">${recommendation}</div>
              <span class="enterprise-mesh-owner-card__cta">
                ${params.assetType === "agent" ? "前往组织页确认机器人创建人" : "前往组织页确认小组创建人"}
              </span>
            </a>
          `;
        })}
      </div>
    </div>
  `;
}

function governanceBadgeTone(value: string): "ok" | "warn" | "danger" {
  switch (value) {
    case "paused":
      return "danger";
    case "restricted":
    case "watch":
      return "warn";
    default:
      return "ok";
  }
}

function budgetBadgeTone(value: string): "ok" | "warn" | "danger" {
  switch (value) {
    case "exceeded":
      return "danger";
    case "warning":
    case "none":
      return "warn";
    default:
      return "ok";
  }
}

function renderGovernancePlanPanel(params: {
  readModel: EnterprisePortReadModel;
  basePath: string;
  assetType: "agent" | "group";
  assetId: string;
  title: string;
  governanceStatus: string;
  budgetStatus: string;
  creatorStatus: string;
  costAttributionStatus: string;
}) {
  const hasCreator = params.creatorStatus === "owned";
  const hasFormalAttribution = params.costAttributionStatus === "attributed";
  const canBudget =
    hasCreator &&
    hasFormalAttribution &&
    (params.governanceStatus === "normal" || params.governanceStatus === "watch");
  const nextStep = !hasCreator
    ? "先补创建人记录，再进入预算限制或暂停评估。"
    : !hasFormalAttribution
      ? "先补正式归因，再判断预算是否需要收紧。"
      : params.budgetStatus === "none"
        ? "先建立预算基线，再进入限制预算或暂停预案。"
        : params.budgetStatus === "warning" || params.budgetStatus === "exceeded"
          ? "可以进入限制预算评估，并同步检查是否需要限制对象能力。"
          : "当前更适合保持观察，只有出现异常时再进入限制或暂停。";

  const actionCards = [
    {
      title: params.budgetStatus === "none" ? "建立预算基线" : "复核预算状态",
      subtitle: canBudget
        ? "当前已满足预算治理前提，可在设置页继续建立或调整预算阈值。"
        : "预算治理前仍需补创建人记录或正式归因。",
      href: pathForTab("enterpriseSettings", params.basePath, {
        tenantId: params.readModel.currentTenantId,
      }),
      tone: canBudget ? ("primary" as const) : undefined,
    },
  ];

  return html`
    <div class="enterprise-mesh-mini-list">
      <div class="enterprise-mesh-mini-list__title">预算与限制预案</div>
      <div class="enterprise-mesh-governance-grid">
        <div class="enterprise-mesh-governance-card">
          <span>治理状态</span>
          ${renderMeshBadge(
            meshGovernanceLabel(params.governanceStatus),
            governanceBadgeTone(params.governanceStatus),
          )}
        </div>
        <div class="enterprise-mesh-governance-card">
          <span>预算状态</span>
          ${renderMeshBadge(
            meshBudgetLabel(params.budgetStatus),
            budgetBadgeTone(params.budgetStatus),
          )}
        </div>
        <div class="enterprise-mesh-governance-card">
          <span>预算前提</span>
          ${renderMeshBadge(canBudget ? "可进入预算治理" : "前提未完成", canBudget ? "ok" : "warn")}
        </div>
      </div>
      <div class="enterprise-mesh-note">${params.title}：${nextStep}</div>
      ${renderMeshActionCards(actionCards)}
      ${renderMeshAssetControls({
        client: meshGatewayClient,
        assetType: params.assetType,
        assetId: params.assetId,
      })}
    </div>
  `;
}

function renderMeshAgentGrowthPath(
  readModel: EnterprisePortReadModel,
  basePath: string,
  agent: MeshAgentRow,
) {
  const capabilityHref = pathForTab("enterpriseUsageManagement", basePath, {
    tenantId: readModel.currentTenantId,
    context: {
      agentId: agent.agentId,
      sourcePort: "enterprise",
      sourcePage: "enterpriseMesh",
    },
  });
  const items = [
    {
      label: "能力配置",
      value: "进入查看",
      description: "查看已安装能力、Top 能力和运行反馈。",
      href: capabilityHref,
    },
    {
      label: "运行成长",
      value: `${agent.sessionCount} 会话`,
      description: agent.errorCount > 0 ? `${agent.errorCount} 个错误待复核` : "当前运行稳定。",
      href: pathForTab("enterpriseUsage", basePath, {
        tenantId: readModel.currentTenantId,
        context: {
          agentId: agent.agentId,
          sourcePort: "enterprise",
          sourcePage: "enterpriseMesh",
        },
      }),
    },
    {
      label: "协作扩展",
      value: `${agent.groupCount} 小组`,
      description: "观察机器人是否已被复用到协作小组。",
      href: appendMeshSearchToHref(
        pathForTab("enterpriseMesh", basePath, {
          tenantId: readModel.currentTenantId,
        }),
        { rankView: "group" },
      ),
    },
    {
      label: "治理阶段",
      value: meshGovernanceLabel(agent.governanceStatus),
      description: "结合创建人、归因和预算状态判断下一步。",
      href: appendMeshSearchToHref(
        pathForTab("enterpriseMesh", basePath, {
          tenantId: readModel.currentTenantId,
          context: {
            agentId: agent.agentId,
            sourcePort: "enterprise",
            sourcePage: "enterpriseMesh",
          },
        }),
        { rankView: "governance" },
      ),
    },
  ];

  return html`
    <div class="enterprise-mesh-growth-path">
      <div class="enterprise-mesh-mini-list__title">能力成长路径</div>
      <div class="enterprise-mesh-growth-path__grid">
        ${items.map(
          (item) => html`
            <a class="enterprise-mesh-growth-path__item" href=${item.href}>
              <span>${item.label}</span>
              <strong>${item.value}</strong>
              <small>${item.description}</small>
            </a>
          `,
        )}
      </div>
    </div>
  `;
}

function renderMeshUserDetail(
  readModel: EnterprisePortReadModel,
  basePath: string,
  userId: string,
) {
  const search = typeof window !== "undefined" ? window.location.search : "";
  const queueFilter = resolveMeshQueueFilter(search);
  const rankView = resolveMeshRankView(search);
  const userRankMode = resolveMeshUserRankMode(search);
  const agentRankMode = resolveMeshAgentRankMode(search);
  const groupRankMode = resolveMeshGroupRankMode(search);
  const user = readModel.meshUsers.find((entry) => entry.user === userId);
  if (!user) {
    return html`
      <section class="enterprise-panel enterprise-panel--secondary">
        <div class="enterprise-panel__header">
          <div>
            <div class="enterprise-panel__title">对象详情</div>
            <div class="enterprise-panel__subtitle">当前深链的用户对象不存在或暂无可见数据。</div>
          </div>
        </div>
      </section>
    `;
  }
  const ownedAgents = readModel.meshAgents.filter((entry) => entry.creatorUser === user.user);
  const ownedGroups = readModel.meshGroups.filter((entry) => entry.creatorUser === user.user);
  const governanceRiskCount = ownedAgents.filter(
    (entry) => entry.governanceStatus !== "normal",
  ).length;
  const totalAssets = ownedAgents.length + ownedGroups.length;
  const judgments: MeshJudgmentItem[] = [
    {
      label: "异常数",
      value: user.incidentCount,
      priority: user.incidentCount > 0 ? 4 : 1,
    },
    {
      label: "高风险机器人",
      value: governanceRiskCount,
      priority: governanceRiskCount > 0 ? 3 : 1,
    },
    {
      label: "名下资产",
      value: totalAssets,
      priority: totalAssets === 0 ? 2 : 1,
    },
    {
      label: "总令牌",
      value: formatTokens(user.totalTokens),
      priority: 0,
    },
  ];
  return html`
    <section class="enterprise-panel enterprise-panel--secondary">
      <div class="enterprise-panel__header">
        <div>
          <div class="enterprise-panel__title">用户资产明细</div>
        </div>
        ${renderMeshBadge(user.role)}
      </div>
      <div class="enterprise-mesh-kpi-grid">
        <div>
          <span>机器人</span>
          <strong>${user.ownedAgentCount}</strong>
        </div>
        <div>
          <span>协作小组</span>
          <strong>${user.ownedGroupCount}</strong>
        </div>
        <div>
          <span>会话</span>
          <strong>${user.sessionCount}</strong>
        </div>
        <div>
          <span>成本</span>
          <strong>${formatOptionalCost(user.totalCost)}</strong>
        </div>
      </div>
      ${
        queueFilter
          ? html`<div class="enterprise-mesh-note">
              ${meshQueueLabel(queueFilter)}：${meshQueueDescription(queueFilter)}
            </div>`
          : nothing
      }
      ${renderMeshJudgmentList(judgments)}
      ${renderMeshActionCards([
        {
          title: "查看组织档案",
          href: pathForTab("enterpriseOrganization", basePath, {
            tenantId: readModel.currentTenantId,
            context: {
              userId: user.user,
              sourcePort: "enterprise",
              sourcePage: "enterpriseMesh",
            },
          }),
          tone: "primary",
        },
        {
          title: "查看名下机器人",
          href: ownedAgents.length
            ? appendMeshSearchToHref(
                pathForTab("enterpriseMesh", basePath, {
                  tenantId: readModel.currentTenantId,
                  context: {
                    agentId: ownedAgents[0].agentId,
                    sourcePort: "enterprise",
                    sourcePage: "enterpriseMesh",
                  },
                }),
                {
                  queue: queueFilter,
                  rankView,
                  userRank: userRankMode,
                  agentRank: agentRankMode,
                  groupRank: groupRankMode,
                },
              )
            : pathForTab("enterpriseUsageManagement", basePath, {
                tenantId: readModel.currentTenantId,
              }),
        },
        {
          title: "查看名下协作小组",
          href: ownedGroups.length
            ? appendMeshSearchToHref(
                pathForTab("enterpriseMesh", basePath, {
                  tenantId: readModel.currentTenantId,
                  context: {
                    groupId: ownedGroups[0].groupId,
                    sourcePort: "enterprise",
                    sourcePage: "enterpriseMesh",
                  },
                }),
                {
                  queue: queueFilter,
                  rankView,
                  userRank: userRankMode,
                  agentRank: agentRankMode,
                  groupRank: groupRankMode,
                },
              )
            : appendMeshSearchToHref(
                pathForTab("enterpriseMesh", basePath, {
                  tenantId: readModel.currentTenantId,
                }),
                {
                  rankView: "group",
                  groupRank: groupRankMode,
                },
              ),
        },
        {
          title: "查看成本明细",
          href: pathForTab("enterpriseUsage", basePath, {
            tenantId: readModel.currentTenantId,
            context: {
              userId: user.user,
              sourcePort: "enterprise",
              sourcePage: "enterpriseMesh",
            },
          }),
        },
      ])}
    </section>
  `;
}

function renderMeshAgentDetail(
  readModel: EnterprisePortReadModel,
  basePath: string,
  agentId: string,
  ownershipTransferEditor: EnterpriseSurfaceProps["ownershipTransferEditor"],
  actions: EnterpriseSurfaceProps["actions"],
) {
  const queueFilter =
    typeof window !== "undefined" ? resolveMeshQueueFilter(window.location.search) : null;
  const agent = readModel.meshAgents.find((entry) => entry.agentId === agentId);
  if (!agent) {
    return html`
      <section class="enterprise-panel enterprise-panel--secondary">
        <div class="enterprise-panel__header">
          <div>
            <div class="enterprise-panel__title">对象详情</div>
            <div class="enterprise-panel__subtitle">当前深链的机器人对象不存在或暂无可见数据。</div>
          </div>
        </div>
      </section>
    `;
  }
  const actionCards = [
    {
      title: agent.creatorLabel ? "复核创建人" : "记录创建人",
      href: pathForTab("enterpriseOrganization", basePath, {
        tenantId: readModel.currentTenantId,
      }),
      tone: agent.creatorLabel ? ("primary" as const) : ("danger" as const),
    },
    {
      title: "查看运行明细",
      href: agent.runtimeHost
        ? pathForTab("platformAdvanced", basePath, {
            context: {
              runtimeId: agent.runtimeHost,
              tenantId: readModel.currentTenantId ?? undefined,
              sourcePort: "enterprise",
              sourcePage: "enterpriseMesh",
            },
          })
        : pathForTab("enterpriseUsageManagement", basePath, {
            tenantId: readModel.currentTenantId,
            context: {
              agentId: agent.agentId,
              sourcePort: "enterprise",
              sourcePage: "enterpriseMesh",
            },
          }),
    },
    {
      title: "查看成本明细",
      href: pathForTab("enterpriseUsage", basePath, {
        tenantId: readModel.currentTenantId,
        context: {
          agentId: agent.agentId,
          sourcePort: "enterprise",
          sourcePage: "enterpriseMesh",
        },
      }),
    },
    {
      title: "查看机器人明细",
      href: pathForTab("enterpriseUsageManagement", basePath, {
        tenantId: readModel.currentTenantId,
        context: {
          agentId: agent.agentId,
          sourcePort: "enterprise",
          sourcePage: "enterpriseMesh",
        },
      }),
    },
  ];
  const judgments: MeshJudgmentItem[] = [
    {
      label: "创建人状态",
      value: meshOwnershipLabel(agent.creatorStatus),
      priority: meshOwnershipPriority(agent.creatorStatus),
    },
    {
      label: "成本归因",
      value: meshAttributionLabel(agent.costAttributionStatus),
      priority: meshAttributionPriority(agent.costAttributionStatus),
    },
    {
      label: "预算状态",
      value: meshBudgetLabel(agent.budgetStatus),
      priority: meshBudgetPriority(agent.budgetStatus),
    },
    {
      label: "运行质量",
      value: agent.errorCount > 0 ? `${agent.errorCount} 个错误` : "当前稳定",
      priority: agent.errorCount > 0 ? 4 : agent.status === "offline" ? 2 : 1,
    },
  ];
  return html`
    <section class="enterprise-panel enterprise-panel--secondary">
      <div class="enterprise-panel__header">
        <div>
          <div class="enterprise-panel__title">机器人治理明细</div>
        </div>
        ${renderMeshBadge(meshGovernanceLabel(agent.governanceStatus), agent.governanceStatus === "normal" ? "ok" : "warn")}
      </div>
      <div class="enterprise-mesh-kpi-grid">
        <div>
          <span>创建人</span>
          <strong>${agent.creatorLabel ?? "未记录"}</strong>
        </div>
        <div>
          <span>运行状态</span>
          <strong>${agent.status}</strong>
        </div>
        <div>
          <span>会话</span>
          <strong>${agent.sessionCount}</strong>
        </div>
        <div>
          <span>成本</span>
          <strong>${formatOptionalCost(agent.totalCost)}</strong>
        </div>
      </div>
      ${
        queueFilter
          ? html`<div class="enterprise-mesh-note">
              ${meshQueueLabel(queueFilter)}：${meshQueueDescription(queueFilter)}
            </div>`
          : nothing
      }
      ${renderMeshJudgmentList(judgments)} ${renderMeshActionCards(actionCards)}
      ${renderMeshAgentGrowthPath(readModel, basePath, agent)}
      ${renderMeshOwnerPanel({
        readModel,
        basePath,
        title: agent.name,
        currentCreatorUser: agent.creatorUser,
        currentCreatorLabel: agent.creatorLabel,
        assetType: "agent",
      })}
      ${ownershipActionButtons({
        assetType: "agent",
        tenantId: readModel.currentTenantId,
        subjectId: agent.agentId,
        subjectLabel: agent.name,
        currentManagerUserId: agent.ownership.currentManagerUserId,
        currentManagerLabel: agent.ownership.currentManagerLabel,
        positionId: agent.ownership.positionId,
        positionLabel: agent.ownership.positionLabel,
        nextCandidateUserId:
          readModel.memberSummaries.find(
            (entry) => entry.user !== agent.ownership.currentManagerUserId && entry.seatTitle,
          )?.user ?? null,
        ownershipTransferEditor,
        actions,
      })}
      ${renderGovernancePlanPanel({
        readModel,
        basePath,
        assetType: "agent",
        assetId: agent.agentId,
        title: agent.name,
        governanceStatus: agent.governanceStatus,
        budgetStatus: agent.budgetStatus,
        creatorStatus: agent.creatorStatus,
        costAttributionStatus: agent.costAttributionStatus,
      })}
    </section>
  `;
}

function renderMeshGroupDetail(
  readModel: EnterprisePortReadModel,
  basePath: string,
  groupId: string,
  ownershipTransferEditor: EnterpriseSurfaceProps["ownershipTransferEditor"],
  actions: EnterpriseSurfaceProps["actions"],
) {
  const queueFilter =
    typeof window !== "undefined" ? resolveMeshQueueFilter(window.location.search) : null;
  const group = readModel.meshGroups.find((entry) => entry.groupId === groupId);
  if (!group) {
    return html`
      <section class="enterprise-panel enterprise-panel--secondary">
        <div class="enterprise-panel__header">
          <div>
            <div class="enterprise-panel__title">对象详情</div>
            <div class="enterprise-panel__subtitle">当前深链的协作小组对象不存在或暂无可见数据。</div>
          </div>
        </div>
      </section>
    `;
  }
  const actionCards = [
    {
      title: group.creatorLabel ? "复核创建人" : "记录创建人",
      href: pathForTab("enterpriseOrganization", basePath, {
        tenantId: readModel.currentTenantId,
      }),
      tone: group.creatorLabel ? ("primary" as const) : ("danger" as const),
    },
    {
      title: "查看成员关系",
      href: pathForTab("enterpriseOrganization", basePath, {
        tenantId: readModel.currentTenantId,
      }),
    },
    {
      title: "查看成本明细",
      href: pathForTab("enterpriseUsage", basePath, {
        tenantId: readModel.currentTenantId,
        context: {
          groupId: group.groupId,
          sourcePort: "enterprise",
          sourcePage: "enterpriseMesh",
        },
      }),
    },
  ];
  const judgments: MeshJudgmentItem[] = [
    {
      label: "创建人状态",
      value: meshOwnershipLabel(group.creatorStatus),
      priority: meshOwnershipPriority(group.creatorStatus),
    },
    {
      label: "归因状态",
      value: meshAttributionLabel(group.costAttributionStatus),
      priority: meshAttributionPriority(group.costAttributionStatus),
    },
    {
      label: "预算状态",
      value: meshBudgetLabel(group.budgetStatus),
      priority: meshBudgetPriority(group.budgetStatus),
    },
    {
      label: "治理状态",
      value: meshGovernanceLabel(group.governanceStatus),
      priority: meshGovernancePriority(group.governanceStatus),
    },
  ];
  return html`
    <section class="enterprise-panel enterprise-panel--secondary">
      <div class="enterprise-panel__header">
        <div>
          <div class="enterprise-panel__title">协作小组治理明细</div>
        </div>
        ${renderMeshBadge(meshAttributionLabel(group.costAttributionStatus), group.costAttributionStatus === "attributed" ? "ok" : "warn")}
      </div>
      <div class="enterprise-mesh-kpi-grid">
        <div>
          <span>创建人</span>
          <strong>${group.creatorLabel ?? "未记录"}</strong>
        </div>
        <div>
          <span>成员</span>
          <strong>${group.memberCount}</strong>
        </div>
        <div>
          <span>机器人</span>
          <strong>${group.agentCount}</strong>
        </div>
        <div>
          <span>成本</span>
          <strong>${formatOptionalCost(group.totalCost)}</strong>
        </div>
      </div>
      ${
        queueFilter
          ? html`<div class="enterprise-mesh-note">
              ${meshQueueLabel(queueFilter)}：${meshQueueDescription(queueFilter)}
            </div>`
          : nothing
      }
      ${renderMeshJudgmentList(judgments)} ${renderMeshActionCards(actionCards)}
      ${renderMeshOwnerPanel({
        readModel,
        basePath,
        title: group.name,
        currentCreatorUser: group.creatorUser,
        currentCreatorLabel: group.creatorLabel,
        assetType: "group",
      })}
      ${ownershipActionButtons({
        assetType: "group",
        tenantId: readModel.currentTenantId,
        subjectId: group.groupId,
        subjectLabel: group.name,
        currentManagerUserId: group.ownership.currentManagerUserId,
        currentManagerLabel: group.ownership.currentManagerLabel,
        positionId: group.ownership.positionId,
        positionLabel: group.ownership.positionLabel,
        nextCandidateUserId:
          readModel.memberSummaries.find(
            (entry) => entry.user !== group.ownership.currentManagerUserId && entry.seatTitle,
          )?.user ?? null,
        ownershipTransferEditor,
        actions,
      })}
      ${renderGovernancePlanPanel({
        readModel,
        basePath,
        assetType: "group",
        assetId: group.groupId,
        title: group.name,
        governanceStatus: group.governanceStatus,
        budgetStatus: group.budgetStatus,
        creatorStatus: group.creatorStatus,
        costAttributionStatus: group.costAttributionStatus,
      })}
    </section>
  `;
}

function renderMeshDetailPanel(
  readModel: EnterprisePortReadModel,
  basePath: string,
  routeContext: ReturnType<typeof routeContextFromPath>,
  ownershipTransferEditor: EnterpriseSurfaceProps["ownershipTransferEditor"],
  actions: EnterpriseSurfaceProps["actions"],
) {
  const search = typeof window !== "undefined" ? window.location.search : "";
  const queueFilter = resolveMeshQueueFilter(search);
  const rankView = resolveMeshRankView(search);
  if (!routeContext) {
    const subtitle =
      rankView === "agent"
        ? "从左侧机器人列表选择一个对象，查看创建人、运行状态、成本和治理动作。"
        : rankView === "group"
          ? "从左侧协作小组列表选择一个对象，查看成员、归因、预算和治理动作。"
          : rankView === "user"
            ? "从左侧员工排名选择一个用户，查看名下机器人、协作小组与成本明细。"
            : queueFilter
              ? `${meshQueueLabel(queueFilter)} 队列已启用。从左侧对象进入后，这里会自动带上对应治理上下文。`
              : "从左侧异常对象进入后，这里会展示对应治理明细。";
    return html`
      <section class="enterprise-panel enterprise-panel--secondary">
        <div class="enterprise-panel__header">
          <div>
            <div class="enterprise-panel__title">对象详情</div>
          </div>
        </div>
        <div class="enterprise-mesh-note">${subtitle}</div>
      </section>
    `;
  }
  if (routeContext.userId) {
    return renderMeshUserDetail(readModel, basePath, routeContext.userId);
  }
  if (routeContext.agentId) {
    return renderMeshAgentDetail(
      readModel,
      basePath,
      routeContext.agentId,
      ownershipTransferEditor,
      actions,
    );
  }
  if (routeContext.groupId) {
    return renderMeshGroupDetail(
      readModel,
      basePath,
      routeContext.groupId,
      ownershipTransferEditor,
      actions,
    );
  }
  return html`
    <section class="enterprise-panel enterprise-panel--secondary">
      <div class="enterprise-panel__header">
        <div>
          <div class="enterprise-panel__title">对象详情</div>
        </div>
      </div>
      <div class="enterprise-mesh-note">当前对象暂时没有可展示的治理详情。</div>
    </section>
  `;
}

function renderMeshReasonActionsPanel(
  readModel: EnterprisePortReadModel,
  basePath: string,
  routeContext: ReturnType<typeof routeContextFromPath>,
) {
  const search = typeof window !== "undefined" ? window.location.search : "";
  const rankView = resolveMeshRankView(search);

  // 计算三级治理 KPI（待处置 / 待复核 / 待优化）
  const anomalies = buildMeshAnomalyView(readModel);
  const criticalCount = anomalies.filter(
    (item) => item.governanceStatus === "restricted" || item.severity === "critical",
  ).length;
  const warningCount = anomalies.filter(
    (item) =>
      item.governanceStatus !== "restricted" &&
      item.severity !== "critical" &&
      item.governanceStatus === "watch",
  ).length;
  const infoCount = anomalies.length - criticalCount - warningCount;

  const meshHref = pathForTab("enterpriseMesh", basePath, {
    tenantId: readModel.currentTenantId,
  });
  const defaultCards = [
    {
      title: "进入待处置",
      href: appendMeshSearchToHref(meshHref, { rankView: "governance" }),
      tone: criticalCount > 0 ? ("danger" as const) : undefined,
    },
    {
      title: "进入待复核",
      href: appendMeshSearchToHref(meshHref, { rankView: "governance" }),
      tone: warningCount > 0 ? ("primary" as const) : undefined,
    },
    {
      title: "查看成本总览",
      href: pathForTab("enterpriseUsage", basePath, {
        tenantId: readModel.currentTenantId,
      }),
    },
  ];

  if (!routeContext) {
    const title = rankView === "governance" ? "治理状态与下一步" : "下一步";
    const defaultGrid =
      rankView === "governance"
        ? html`
            <div class="enterprise-mesh-kpi-grid">
              <div>
                <span>待处置</span>
                <strong>${criticalCount}</strong>
              </div>
              <div>
                <span>待复核</span>
                <strong>${warningCount}</strong>
              </div>
              <div>
                <span>待优化</span>
                <strong>${infoCount}</strong>
              </div>
              <div>
                <span>合计</span>
                <strong>${anomalies.length}</strong>
              </div>
            </div>
          `
        : html`
            <div class="enterprise-mesh-kpi-grid">
              <div>
                <span>用户</span>
                <strong>${readModel.meshSummary.userCount}</strong>
              </div>
              <div>
                <span>机器人</span>
                <strong>${readModel.meshSummary.agentCount}</strong>
              </div>
              <div>
                <span>协作小组</span>
                <strong>${readModel.meshSummary.groupCount}</strong>
              </div>
              <div>
                <span>总成本</span>
                <strong>${formatOptionalCost(readModel.meshSummary.totalCost)}</strong>
              </div>
            </div>
          `;
    const defaultNote =
      rankView === "governance"
        ? "优先从治理队列选择异常对象，再进入对象详情和后续动作。"
        : "从左侧列表选择一个对象。";
    const cards =
      rankView === "governance"
        ? defaultCards
        : rankView === "agent"
          ? [
              {
                title: "查看机器人排名",
                href: appendMeshSearchToHref(
                  pathForTab("enterpriseMesh", basePath, {
                    tenantId: readModel.currentTenantId,
                  }),
                  { rankView: "agent" },
                ),
              },
              {
                title: "进入治理队列",
                href: appendMeshSearchToHref(
                  pathForTab("enterpriseMesh", basePath, {
                    tenantId: readModel.currentTenantId,
                  }),
                  { rankView: "governance" },
                ),
                tone:
                  readModel.meshSummary.governanceIssueCount > 0 ? ("danger" as const) : undefined,
              },
              {
                title: "查看成本总览",
                href: pathForTab("enterpriseUsage", basePath, {
                  tenantId: readModel.currentTenantId,
                }),
              },
            ]
          : rankView === "group"
            ? [
                {
                  title: "查看协作小组排名",
                  href: appendMeshSearchToHref(
                    pathForTab("enterpriseMesh", basePath, {
                      tenantId: readModel.currentTenantId,
                    }),
                    { rankView: "group" },
                  ),
                },
                {
                  title: "进入治理队列",
                  href: appendMeshSearchToHref(
                    pathForTab("enterpriseMesh", basePath, {
                      tenantId: readModel.currentTenantId,
                    }),
                    { rankView: "governance" },
                  ),
                  tone:
                    readModel.meshSummary.governanceIssueCount > 0
                      ? ("danger" as const)
                      : undefined,
                },
                {
                  title: "查看成本总览",
                  href: pathForTab("enterpriseUsage", basePath, {
                    tenantId: readModel.currentTenantId,
                  }),
                },
              ]
            : [
                {
                  title: "查看员工排名",
                  href: appendMeshSearchToHref(
                    pathForTab("enterpriseMesh", basePath, {
                      tenantId: readModel.currentTenantId,
                    }),
                    { rankView: "user" },
                  ),
                },
                {
                  title: "进入治理队列",
                  href: appendMeshSearchToHref(
                    pathForTab("enterpriseMesh", basePath, {
                      tenantId: readModel.currentTenantId,
                    }),
                    { rankView: "governance" },
                  ),
                  tone:
                    readModel.meshSummary.governanceIssueCount > 0
                      ? ("danger" as const)
                      : undefined,
                },
                {
                  title: "查看成本总览",
                  href: pathForTab("enterpriseUsage", basePath, {
                    tenantId: readModel.currentTenantId,
                  }),
                },
              ];
    return html`
      <section class="enterprise-panel enterprise-panel--secondary">
        <div class="enterprise-panel__header">
          <div>
            <div class="enterprise-panel__title">${title}</div>
          </div>
        </div>
        ${defaultGrid}
        ${rankView === "governance" ? html`<div class="enterprise-mesh-note">${defaultNote}</div>` : nothing}
        ${renderMeshActionCards(cards)}
      </section>
    `;
  }

  const queueHref = appendMeshSearchToHref(
    pathForTab("enterpriseMesh", basePath, {
      tenantId: readModel.currentTenantId,
    }),
    { rankView: "governance" },
  );

  if (routeContext.agentId) {
    const agent = readModel.meshAgents.find((entry) => entry.agentId === routeContext.agentId);
    if (!agent) {
      return nothing;
    }
    return html`
      <section class="enterprise-panel enterprise-panel--secondary">
        <div class="enterprise-panel__header">
          <div>
            <div class="enterprise-panel__title">异常原因与下一步</div>
          </div>
        </div>
        <div class="enterprise-mesh-kpi-grid">
          <div>
            <span>创建人</span>
            <strong>${meshOwnershipLabel(agent.creatorStatus)}</strong>
          </div>
          <div>
            <span>归因</span>
            <strong>${meshAttributionLabel(agent.costAttributionStatus)}</strong>
          </div>
          <div>
            <span>治理</span>
            <strong>${meshGovernanceLabel(agent.governanceStatus)}</strong>
          </div>
          <div>
            <span>预算</span>
            <strong>${meshBudgetLabel(agent.budgetStatus)}</strong>
          </div>
        </div>
        ${renderMeshActionCards([
          {
            title: agent.creatorLabel ? "复核创建人" : "记录创建人",
            href: pathForTab("enterpriseOrganization", basePath, {
              tenantId: readModel.currentTenantId,
            }),
            tone: agent.creatorStatus !== "owned" ? ("danger" as const) : undefined,
          },
          {
            title: "查看成本明细",
            href: pathForTab("enterpriseUsage", basePath, {
              tenantId: readModel.currentTenantId,
              context: {
                agentId: agent.agentId,
                sourcePort: "enterprise",
                sourcePage: "enterpriseMesh",
              },
            }),
          },
          {
            title: "返回治理队列",
            href: queueHref,
          },
        ])}
      </section>
    `;
  }

  if (routeContext.groupId) {
    const group = readModel.meshGroups.find((entry) => entry.groupId === routeContext.groupId);
    if (!group) {
      return nothing;
    }
    return html`
      <section class="enterprise-panel enterprise-panel--secondary">
        <div class="enterprise-panel__header">
          <div>
            <div class="enterprise-panel__title">异常原因与下一步</div>
          </div>
        </div>
        <div class="enterprise-mesh-kpi-grid">
          <div>
            <span>创建人</span>
            <strong>${meshOwnershipLabel(group.creatorStatus)}</strong>
          </div>
          <div>
            <span>归因</span>
            <strong>${meshAttributionLabel(group.costAttributionStatus)}</strong>
          </div>
          <div>
            <span>治理</span>
            <strong>${meshGovernanceLabel(group.governanceStatus)}</strong>
          </div>
          <div>
            <span>预算</span>
            <strong>${meshBudgetLabel(group.budgetStatus)}</strong>
          </div>
        </div>
        ${renderMeshActionCards([
          {
            title: group.creatorLabel ? "复核创建人" : "记录创建人",
            href: pathForTab("enterpriseOrganization", basePath, {
              tenantId: readModel.currentTenantId,
            }),
            tone: group.creatorStatus !== "owned" ? ("danger" as const) : undefined,
          },
          {
            title: "查看成本明细",
            href: pathForTab("enterpriseUsage", basePath, {
              tenantId: readModel.currentTenantId,
              context: {
                groupId: group.groupId,
                sourcePort: "enterprise",
                sourcePage: "enterpriseMesh",
              },
            }),
          },
          {
            title: "返回治理队列",
            href: queueHref,
          },
        ])}
      </section>
    `;
  }

  if (routeContext.userId) {
    const user = readModel.meshUsers.find((entry) => entry.user === routeContext.userId);
    if (!user) {
      return nothing;
    }
    return html`
      <section class="enterprise-panel enterprise-panel--secondary">
        <div class="enterprise-panel__header">
          <div>
            <div class="enterprise-panel__title">异常原因与下一步</div>
          </div>
        </div>
        <div class="enterprise-mesh-kpi-grid">
          <div>
            <span>名下机器人</span>
            <strong>${user.ownedAgentCount}</strong>
          </div>
          <div>
            <span>名下小组</span>
            <strong>${user.ownedGroupCount}</strong>
          </div>
          <div>
            <span>异常数</span>
            <strong>${user.incidentCount}</strong>
          </div>
          <div>
            <span>成本</span>
            <strong>${formatOptionalCost(user.totalCost)}</strong>
          </div>
        </div>
        ${renderMeshActionCards([
          {
            title: "查看员工排名",
            href: appendMeshSearchToHref(
              pathForTab("enterpriseMesh", basePath, {
                tenantId: readModel.currentTenantId,
              }),
              { rankView: "user" },
            ),
          },
          {
            title: "查看成本明细",
            href: pathForTab("enterpriseUsage", basePath, {
              tenantId: readModel.currentTenantId,
              context: {
                userId: user.user,
                sourcePort: "enterprise",
                sourcePage: "enterpriseMesh",
              },
            }),
          },
          {
            title: "刷新用户资产",
            href: queueHref,
          },
        ])}
      </section>
    `;
  }

  return nothing;
}

// ─── Mesh Governance Redesign: Module Header + Three-Level Queue ──────────────

/**
 * 治理队列指标：统一为基线 KPI 卡组（renderEnterpriseKpiGrid），
 * tone 表达级别（critical→danger / warning→warn / info→neutral），
 * href 承载下钻；导航由 surface 根节点的 followDelegatedPortHref 委托处理。
 */
function renderMeshGovernanceKpi(params: {
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  basePath: string;
  tenantId: string | null;
}) {
  const meshHref = pathForTab("enterpriseMesh", params.basePath, { tenantId: params.tenantId });
  const items: EnterpriseKpiItem[] = [
    {
      label: "待处置",
      value: `${params.criticalCount} 项`,
      tone: "danger",
      href: appendMeshSearchToHref(meshHref, {
        meshTab: "operations",
        rankView: "governance",
        queue: "restrict",
      }),
      drilldown: "进入运营页的待处置队列",
    },
    {
      label: "待复核",
      value: `${params.warningCount} 项`,
      tone: "warn",
      href: appendMeshSearchToHref(meshHref, {
        meshTab: "operations",
        rankView: "governance",
        queue: "review",
      }),
      drilldown: "进入运营页的待复核队列",
    },
    {
      label: "待优化",
      value: `${params.infoCount} 项`,
      tone: "neutral",
      href: appendMeshSearchToHref(meshHref, { meshTab: "operations", rankView: "governance" }),
      drilldown: "进入运营页的治理队列",
    },
  ];
  return html`
    <section class="enterprise-mesh-governance-kpi" aria-label="治理队列">
      ${renderEnterpriseKpiGrid(items, { variant: "compact" })}
    </section>
  `;
}

/**
 * 机巢对象总览：统一为基线 KPI 卡组。本月成本从旧紧凑页眉迁移到这里，
 * 与其他页面级指标同层展示（totalCost > 0 时染 warn 提示成本发生）。
 */
function renderMeshObjectOverview(
  readModel: EnterprisePortReadModel,
  basePath: string,
  options?: {
    agentsPending?: boolean;
    groupsPending?: boolean;
  },
) {
  const meshHref = pathForTab("enterpriseMesh", basePath, {
    tenantId: readModel.currentTenantId,
  });
  const agentMetric = options?.agentsPending ? "—" : `${readModel.meshSummary.agentCount} 个`;
  const groupMetric = options?.groupsPending ? "—" : `${readModel.meshSummary.groupCount} 个`;
  const items: EnterpriseKpiItem[] = [
    {
      label: "企业成员",
      value: `${readModel.meshSummary.userCount} 人`,
    },
    {
      label: "员工创建机器人",
      value: agentMetric,
      href: appendMeshSearchToHref(meshHref, { meshTab: "performance", rankView: "agent" }),
      drilldown: "查看机器人绩效排名",
    },
    {
      label: "协作小组",
      value: groupMetric,
      href: appendMeshSearchToHref(meshHref, { meshTab: "performance", rankView: "group" }),
      drilldown: "查看协作小组绩效排名",
    },
    {
      label: "成长观察",
      value: `${readModel.meshSummary.governanceIssueCount} 项`,
      href: appendMeshSearchToHref(meshHref, { meshTab: "operations", rankView: "governance" }),
      drilldown: "查看运营异常",
    },
    {
      label: "本月成本",
      value: formatCost(readModel.meshSummary.totalCost),
      tone: readModel.meshSummary.totalCost > 0 ? "warn" : "neutral",
    },
  ];

  return html`
    <section class="enterprise-mesh-object-overview" aria-label="机巢对象总览">
      ${renderEnterpriseKpiGrid(items, { variant: "compact" })}
    </section>
  `;
}

type GovernanceQueueLevel = "critical" | "warning" | "info";

function governanceLevelLabel(level: GovernanceQueueLevel): string {
  switch (level) {
    case "critical":
      return "待处置";
    case "warning":
      return "待复核";
    case "info":
      return "待优化";
  }
}

function governanceLevelTone(level: GovernanceQueueLevel): string {
  switch (level) {
    case "critical":
      return "danger";
    case "warning":
      return "warn";
    case "info":
      return "neutral";
  }
}

function renderGovernanceQueuePanel(readModel: EnterprisePortReadModel, basePath: string) {
  const anomalies = buildMeshAnomalyView(readModel);
  const search = typeof window !== "undefined" ? window.location.search : "";
  const rankView = resolveMeshRankView(search);
  const userRankMode = resolveMeshUserRankMode(search);
  const agentRankMode = resolveMeshAgentRankMode(search);
  const groupRankMode = resolveMeshGroupRankMode(search);

  // Classify anomalies into three levels based on governance status
  const criticalItems = anomalies.filter(
    (item) => item.governanceStatus === "restricted" || item.severity === "critical",
  );
  const warningItems = anomalies.filter(
    (item) =>
      item.governanceStatus !== "restricted" &&
      item.severity !== "critical" &&
      item.governanceStatus === "watch",
  );
  const infoItems = anomalies.filter(
    (item) =>
      item.governanceStatus !== "restricted" &&
      item.severity !== "critical" &&
      item.governanceStatus !== "watch",
  );

  const levels: Array<{ level: GovernanceQueueLevel; items: typeof anomalies }> = [
    { level: "critical", items: criticalItems },
    { level: "warning", items: warningItems },
    { level: "info", items: infoItems },
  ];

  return html`
    <section class="enterprise-panel enterprise-panel--critical" data-mesh-panel="governance-queue">
      <div class="enterprise-panel__header">
        <div>
          <div class="enterprise-panel__title">治理队列</div>
          <div class="enterprise-panel__subtitle">按紧急程度分级的运营异常，优先处理待处置项。</div>
        </div>
        ${renderMeshBadge(`${anomalies.length} 项`, anomalies.length > 0 ? "danger" : "ok")}
      </div>
      <div class="enterprise-mesh-governance-levels">
        ${levels.map(({ level, items }) => {
          if (items.length === 0) {
            // 空队列折叠为单行
            return html`
              <div
                class="enterprise-mesh-governance-level enterprise-mesh-governance-level--collapsed"
              >
                <span class="enterprise-mesh-governance-level__title"
                  >${governanceLevelLabel(level)}</span
                >
                <span class="enterprise-mesh-governance-level__count">0 项</span>
              </div>
            `;
          }
          return html`
            <section
              class="enterprise-mesh-governance-level enterprise-mesh-governance-level--${governanceLevelTone(level)}"
            >
              <div class="enterprise-mesh-governance-level__header">
                <span class="enterprise-mesh-governance-level__title"
                  >${governanceLevelLabel(level)}</span
                >
                ${renderMeshBadge(`${items.length} 项`, governanceLevelTone(level) as "danger" | "warn" | "neutral" | "ok")}
              </div>
              <div class="enterprise-mesh-stack">
                ${items.map((item) => {
                  const href =
                    item.kind === "agent" && item.targetId
                      ? appendMeshSearchToHref(
                          pathForTab("enterpriseMesh", basePath, {
                            tenantId: readModel.currentTenantId,
                            context: {
                              agentId: item.targetId,
                              sourcePort: "enterprise",
                              sourcePage: "enterpriseMesh",
                            },
                          }),
                          {
                            queue: classifyMeshQueue(item),
                            rankView,
                            userRank: userRankMode,
                            agentRank: agentRankMode,
                            groupRank: groupRankMode,
                          },
                        )
                      : item.kind === "group" && item.targetId
                        ? appendMeshSearchToHref(
                            pathForTab("enterpriseMesh", basePath, {
                              tenantId: readModel.currentTenantId,
                              context: {
                                groupId: item.targetId,
                                sourcePort: "enterprise",
                                sourcePage: "enterpriseMesh",
                              },
                            }),
                            {
                              queue: classifyMeshQueue(item),
                              rankView,
                              userRank: userRankMode,
                              agentRank: agentRankMode,
                              groupRank: groupRankMode,
                            },
                          )
                        : null;
                  const content = html`
                    <div class="enterprise-mesh-row__body">
                      <div class="enterprise-mesh-row__title">${item.title}</div>
                      <div class="enterprise-mesh-row__sub">${item.reasonSummary}</div>
                    </div>
                    <div class="enterprise-mesh-row__meta">${item.metaSummary}</div>
                  `;
                  return href
                    ? html`
                        <a
                          class="enterprise-mesh-row enterprise-mesh-row--${item.severity}"
                          data-mesh-anomaly-id=${item.id}
                          href=${href}
                          @click=${(event: MouseEvent) => followPortHref(event, href)}
                        >
                          ${content}
                        </a>
                      `
                    : html`
                        <div
                          class="enterprise-mesh-row enterprise-mesh-row--${item.severity}"
                          data-mesh-anomaly-id=${item.id}
                        >
                          ${content}
                        </div>
                      `;
                })}
              </div>
            </section>
          `;
        })}
      </div>
    </section>
  `;
}

function resolveMeshWorkbenchTab(search: string): MeshWorkbenchTab {
  const value = new URLSearchParams(search).get("meshTab");
  return value === "performance" ? "performance" : "operations";
}

function fallbackOwnership(agent: MeshAgentRow): GovernanceAgentInput["ownership"] {
  return (
    agent.ownership ?? {
      positionId: "unassigned",
      positionLabel: "未分配岗位",
      createdByUserId: agent.creatorUser ?? "unknown",
      createdByUserLabel: agent.creatorLabel ?? agent.creatorUser ?? "未知",
      currentManagerUserId: agent.creatorUser ?? "unknown",
      currentManagerLabel: agent.creatorLabel ?? agent.creatorUser ?? "未知",
      createdAt: new Date(0).toISOString(),
    }
  );
}

function mapMeshAgentsForEngine(agents: MeshAgentRow[]): GovernanceAgentInput[] {
  const now = Date.now();
  return agents.map((agent) => {
    const lastActiveAt = agent.lastActiveAt;
    const offlineHours =
      agent.status === "offline" && typeof lastActiveAt === "number"
        ? Math.max(0, (now - lastActiveAt) / (60 * 60 * 1000))
        : 0;
    const dailyCost = agent.totalCost;
    return {
      agentId: agent.agentId,
      name: agent.name,
      ownership: fallbackOwnership(agent),
      status: agent.status,
      consecutiveErrors: agent.errorCount,
      offlineHours,
      hasActiveSessions: agent.sessionCount > 0,
      errorRate7d: agent.sessionCount > 0 ? Math.min(1, agent.errorCount / agent.sessionCount) : 0,
      successRate7d:
        agent.sessionCount > 0
          ? Math.max(0, 1 - Math.min(1, agent.errorCount / agent.sessionCount))
          : 1,
      previousSuccessRate7d: 1,
      dailyCost,
      avgDailyCost7d: dailyCost / 7,
      monthlyCost: dailyCost,
      budgetLimit: agent.budgetLimit,
      costPerSession: agent.sessionCount > 0 ? agent.totalCost / agent.sessionCount : 0,
      peerAvgCostPerSession: 0,
      lastSessionAt: lastActiveAt,
      deployedAt: null,
      sessionCount7d: agent.sessionCount,
      hasSensitiveContentViolation: false,
      hasPermissionViolation: false,
    };
  });
}

function mapMeshGroupsForEngine(groups: MeshGroupRow[]): GovernanceGroupInput[] {
  return groups.map((group) => ({
    groupId: group.groupId,
    name: group.name,
    ownership: group.ownership ?? {
      positionId: "unassigned",
      positionLabel: "未分配岗位",
      createdByUserId: group.creatorUser ?? "unknown",
      createdByUserLabel: group.creatorLabel ?? group.creatorUser ?? "未知",
      currentManagerUserId: group.creatorUser ?? "unknown",
      currentManagerLabel: group.creatorLabel ?? group.creatorUser ?? "未知",
      createdAt: new Date(0).toISOString(),
    },
    members: [],
    errorRate7d: 0,
    monthlyCost: group.totalCost,
    budgetLimit: group.budgetLimit,
    lastSessionAt: group.lastActiveAt ?? null,
    sessionCount30d: group.sessionCount,
  }));
}

function renderMeshOpsPerfTabs(params: {
  current: MeshWorkbenchTab;
  baseHref: string;
  queue: MeshQueueFilter | null;
  rankView: MeshRankView;
  userRank: MeshUserRankMode;
  agentRank: MeshAgentRankMode;
  groupRank: MeshGroupRankMode;
}) {
  const tabs: Array<{ value: MeshWorkbenchTab; label: string }> = [
    { value: "operations", label: "运营" },
    { value: "performance", label: "绩效" },
  ];
  return html`
    <div
      class="enterprise-mesh-ops-perf-tabs"
      data-mesh-panel="ops-perf-tabs"
      role="tablist"
      aria-label="机巢工作台"
    >
      ${tabs.map((tab) => {
        const href = appendMeshSearchToHref(params.baseHref, {
          meshTab: tab.value,
          queue: tab.value === "operations" ? params.queue : null,
          rankView: params.rankView,
          userRank: params.userRank,
          agentRank: params.agentRank,
          groupRank: params.groupRank,
        } as {
          meshTab?: MeshWorkbenchTab | null;
          queue?: MeshQueueFilter | null;
          rankView?: MeshRankView | null;
          userRank?: MeshUserRankMode | null;
          agentRank?: MeshAgentRankMode | null;
          groupRank?: MeshGroupRankMode | null;
        });
        return html`
          <a
            role="tab"
            aria-selected=${String(params.current === tab.value)}
            class="enterprise-mesh-ops-perf-tabs__item ${params.current === tab.value ? "is-active" : ""}"
            href=${href}
            @click=${(event: MouseEvent) => followPortHref(event, href)}
          >
            ${tab.label}
          </a>
        `;
      })}
    </div>
  `;
}

let meshGatewayClient: EnterpriseSurfaceProps["client"] = null;

export function renderMeshGovernanceSurface(props: EnterpriseSurfaceProps, basePath: string) {
  meshGatewayClient = props.client;
  setGovernanceApiClient(props.client ?? null);
  const { readModel, actions } = props;
  const search = typeof window !== "undefined" ? window.location.search : "";
  const queueFilter = resolveMeshQueueFilter(search);
  const rankView = resolveMeshRankView(search);
  const userRank = resolveMeshUserRankMode(search);
  const agentRank = resolveMeshAgentRankMode(search);
  const groupRank = resolveMeshGroupRankMode(search);
  const meshTab = resolveMeshWorkbenchTab(search);
  const baseHref = typeof window !== "undefined" ? window.location.pathname : "";

  // Phase 4: KPI from governance-engine; fall back to anomaly view if engine is empty.
  const engineIssues = detectGovernanceIssues(
    mapMeshAgentsForEngine(readModel.meshAgents),
    mapMeshGroupsForEngine(readModel.meshGroups),
    DEFAULT_GOVERNANCE_CONFIG,
  );
  const anomalies = buildMeshAnomalyView(readModel);
  const criticalCount =
    engineIssues.filter((item) => item.level === "critical").length ||
    anomalies.filter(
      (item) => item.governanceStatus === "restricted" || item.severity === "critical",
    ).length;
  const warningCount =
    engineIssues.filter((item) => item.level === "warning").length ||
    anomalies.filter(
      (item) =>
        item.governanceStatus !== "restricted" &&
        item.severity !== "critical" &&
        item.governanceStatus === "watch",
    ).length;
  const infoCount =
    engineIssues.filter((item) => item.level === "info").length ||
    Math.max(0, anomalies.length - criticalCount - warningCount);

  const seatLimitNotice = renderEnterpriseSeatLimitNotice({ authPanelProps: props.authPanelProps });
  const dataNotice = renderEnterpriseDataNotice(readModel);
  const agentsPending = props.agentsList == null && readModel.meshAgents.length === 0;
  const groupsPending =
    props.collaborationSpacesResult == null && readModel.meshGroups.length === 0;

  return html`
    <div
      class="enterprise-surface enterprise-surface--mesh enterprise-surface--mesh-flat"
      @click=${followDelegatedPortHref}
    >
      ${seatLimitNotice} ${dataNotice}
      ${renderEnterpriseModuleHeader({
        title: t("tabs.enterpriseMesh"),
        refresh: { onRefresh: () => actions.mesh.onRefreshRuntime() },
      })}
      ${renderMeshObjectOverview(readModel, basePath, { agentsPending, groupsPending })}
      ${renderMeshGovernanceKpi({
        criticalCount,
        warningCount,
        infoCount,
        basePath,
        tenantId: readModel.currentTenantId,
      })}
      ${renderMeshOpsPerfTabs({
        current: meshTab,
        baseHref,
        queue: queueFilter,
        rankView,
        userRank,
        agentRank,
        groupRank,
      })}
      ${
        meshTab === "operations"
          ? html`
              <section class="enterprise-mesh-ops-panel" data-mesh-panel="operations-assets">
                <governance-assets-page
                  .embedMode=${true}
                  .readModel=${readModel}
                  .agentsList=${props.agentsList ?? null}
                  .collaborationSpacesResult=${props.collaborationSpacesResult ?? null}
                ></governance-assets-page>
              </section>
            `
          : html`
              <section class="enterprise-mesh-ops-panel" data-mesh-panel="performance-ranking">
                <governance-ranking-page
                  .rankingType=${rankView === "group" ? "group" : "bot"}
                  .readModel=${readModel}
                  .agentsList=${props.agentsList ?? null}
                  .collaborationSpacesResult=${props.collaborationSpacesResult ?? null}
                ></governance-ranking-page>
              </section>
              <section class="enterprise-mesh-ops-panel" data-mesh-panel="performance-graphs">
                ${renderMeshGraphsPanel({
                  readModel,
                  basePath,
                  agentsList: props.agentsList ?? null,
                  collaborationSpacesResult: props.collaborationSpacesResult ?? null,
                })}
              </section>
            `
      }
      <div class="enterprise-surface__full">${renderOwnershipTransferEditor(props)}</div>
    </div>
  `;
}
