/**
 * 安装管理页面（InstallManagementPage）
 *
 * 展示所有已安装的能力与机器人关联关系，支持筛选、卸载操作。
 *
 * 验证需求：9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7
 *
 * 样式：使用 enterprise-foundation.css + enterprise-components.css 体系。
 */

import { html, nothing, type TemplateResult } from "lit";
import type { InstallManagementFilters } from "../../capability/enterprise-capability/endpoints.ts";
import type {
  InstallRelation,
  PaginationState,
} from "../../capability/enterprise-capability/types.ts";
import { renderPagination } from "./pagination.ts";

type InstallSourceFilter = InstallManagementFilters["source"];
type InstallStatusFilter = InstallManagementFilters["status"];
type InstallViewMode = "byRobot" | "byCapability";
type InstallGroup = {
  key: string;
  title: string;
  subtitle: string;
  countLabel: string;
  items: InstallRelation[];
};

export type InstallManagementPageProps = {
  items: InstallRelation[];
  loading: boolean;
  error: string | null;
  pagination: PaginationState;
  filters: InstallManagementFilters;
  summary: {
    adminPushCount: number;
    employeeSelfInstallCount: number;
    coveredRobotCount: number;
    coveredCapabilityCount: number;
    coveredPositionCount: number;
  };
  viewMode: InstallViewMode;
  pendingUninstallId: string | null;
  uninstalling: boolean;
  uninstallError: string | null;
  onFilterChange: <K extends keyof InstallManagementFilters>(
    key: K,
    value: InstallManagementFilters[K],
  ) => void;
  onViewModeChange: (mode: InstallViewMode) => void;
  onPageChange: (page: number) => void;
  onBeginUninstall: (id: string) => void;
  onConfirmUninstall: () => void;
  onCancelUninstall: () => void;
  onBack: () => void;
};

/** 安装状态 → semantic badge tone */
const STATUS_TONE: Record<InstallRelation["status"], "success" | "warning" | "info"> = {
  正常运行: "success",
  已暂停: "warning",
  待更新: "info",
};

function parseInstallSourceFilter(value: string): InstallSourceFilter {
  switch (value) {
    case "管理员推送":
    case "员工自主安装":
      return value;
    default:
      return null;
  }
}

function parseInstallStatusFilter(value: string): InstallStatusFilter {
  switch (value) {
    case "正常运行":
    case "已暂停":
    case "待更新":
      return value;
    default:
      return null;
  }
}

function statusBadge(status: InstallRelation["status"]): TemplateResult {
  const tone = STATUS_TONE[status];
  return html`<span class="enterprise-status-badge enterprise-status-badge--${tone}"
    >${status}</span
  >`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function displayOwner(item: InstallRelation): string {
  return item.robotOwnerEmployeeName || item.robotOwnerEmployeeEmail || "未绑定员工";
}

function displayPosition(item: InstallRelation): string {
  return item.robotPositionTitle || "未绑定岗位";
}

function displayTeam(item: InstallRelation): string {
  return item.robotTeamLabel || "未归属团队";
}

function groupItems(items: readonly InstallRelation[], viewMode: InstallViewMode): InstallGroup[] {
  const groups = new Map<string, InstallRelation[]>();
  for (const item of items) {
    const key = viewMode === "byRobot" ? item.robotId : item.capabilityId;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return [...groups.entries()].map(([key, group]) => {
    const first = group[0];
    const lead = first ?? group[0];
    const healthy = group.filter((item) => item.status === "正常运行").length;
    if (viewMode === "byRobot") {
      return {
        key,
        title: first?.robotName ?? key,
        subtitle: `${displayPosition(lead)} · ${displayOwner(lead)} · 已安装 ${group.length} 个能力，${healthy} 个正常运行`,
        countLabel: `${group.length} 个能力`,
        items: group,
      };
    }
    const robots = new Set(group.map((item) => item.robotId)).size;
    const positions = new Set(group.map((item) => item.robotPositionTitle).filter(Boolean)).size;
    return {
      key,
      title: first?.capabilityName ?? key,
      subtitle: `已被 ${robots} 个机器人安装 · 覆盖 ${positions || 0} 个岗位 · ${healthy} 个正常运行`,
      countLabel: `${robots} 个机器人`,
      items: group,
    };
  });
}

function summaryCards(summary: InstallManagementPageProps["summary"]): TemplateResult {
  return html`
    <div class="install-management-page__summary-grid">
      <article class="install-management-page__summary-card">
        <span>安装关系</span>
        <strong>${summary.adminPushCount + summary.employeeSelfInstallCount}</strong>
        <small>管理员 ${summary.adminPushCount} · 员工 ${summary.employeeSelfInstallCount}</small>
      </article>
      <article class="install-management-page__summary-card">
        <span>覆盖机器人</span>
        <strong>${summary.coveredRobotCount}</strong>
        <small>可查看每个机器人已装能力</small>
      </article>
      <article class="install-management-page__summary-card">
        <span>覆盖能力</span>
        <strong>${summary.coveredCapabilityCount}</strong>
        <small>可反查能力被哪些机器人安装</small>
      </article>
      <article class="install-management-page__summary-card">
        <span>岗位覆盖</span>
        <strong>${summary.coveredPositionCount}</strong>
        <small>按岗位/员工识别责任归属</small>
      </article>
    </div>
  `;
}

function viewModeSwitch(
  viewMode: InstallViewMode,
  onViewModeChange: (mode: InstallViewMode) => void,
) {
  const modes: Array<{ mode: InstallViewMode; label: string }> = [
    { mode: "byRobot", label: "按机器人查看" },
    { mode: "byCapability", label: "按能力查看" },
  ];
  return html`
    <div class="install-management-page__mode-switch" role="tablist" aria-label="查看维度">
      <span class="install-management-page__mode-switch-label">查看维度</span>
      ${modes.map(
        (tab) => html`
          <button
            type="button"
            role="tab"
            aria-selected=${viewMode === tab.mode ? "true" : "false"}
            class="install-management-page__mode-switch-btn ${viewMode === tab.mode ? "is-active" : ""}"
            @click=${() => onViewModeChange(tab.mode)}
          >
            ${tab.label}
          </button>
        `,
      )}
    </div>
  `;
}

function renderRelationItem(
  item: InstallRelation,
  viewMode: InstallViewMode,
  onBeginUninstall: (id: string) => void,
): TemplateResult {
  const primary = viewMode === "byRobot" ? item.capabilityName : item.robotName;
  const secondary =
    viewMode === "byRobot"
      ? `${item.source} · 安装于 ${formatTime(item.installedAt)}`
      : `${displayPosition(item)} · ${displayOwner(item)} · ${displayTeam(item)}`;
  return html`
    <div class="install-management-page__relation">
      <div class="install-management-page__relation-main">
        <span class="install-management-page__relation-title">${primary}</span>
        <span class="install-management-page__relation-subtitle">${secondary}</span>
      </div>
      <div class="install-management-page__relation-tags">
        ${
          viewMode === "byRobot"
            ? html`
              <span class="install-management-page__tag">${displayPosition(item)}</span>
              <span class="install-management-page__tag">${displayOwner(item)}</span>
            `
            : html`
              <span class="install-management-page__tag">${item.source}</span>
              <span class="install-management-page__tag">${formatTime(item.installedAt)}</span>
            `
        }
        ${
          item.robotRoleCode
            ? html`<span class="install-management-page__tag">${item.robotRoleCode}</span>`
            : nothing
        }
      </div>
      ${statusBadge(item.status)}
      <button
        type="button"
        class="enterprise-btn enterprise-btn--danger"
        @click=${() => onBeginUninstall(item.id)}
      >
        卸载
      </button>
    </div>
  `;
}

function renderGroups(
  items: readonly InstallRelation[],
  viewMode: InstallViewMode,
  onBeginUninstall: (id: string) => void,
): TemplateResult {
  const groups = groupItems(items, viewMode);
  return html`
    <div class="install-management-page__groups">
      ${groups.map((group) => {
        const abnormalCount = group.items.filter((item) => item.status !== "正常运行").length;
        const hasAbnormal = abnormalCount > 0;
        return html`
          <details
            class="install-management-page__group ${hasAbnormal ? "install-management-page__group--attention" : ""}"
            aria-label=${group.title}
            ?open=${hasAbnormal}
          >
            <summary class="install-management-page__group-summary">
              <div class="install-management-page__group-summary-main">
                <h2>${group.title}</h2>
                <p>${group.subtitle}</p>
              </div>
              <div class="install-management-page__group-summary-meta">
                ${
                  hasAbnormal
                    ? html`<span
                        class="install-management-page__group-attention-badge"
                        title="存在已暂停或待更新的能力"
                        >${abnormalCount} 项需关注</span
                      >`
                    : nothing
                }
                <span class="install-management-page__group-count">${group.countLabel}</span>
                <span class="install-management-page__group-hint">展开查看明细</span>
                <span class="install-management-page__group-chevron" aria-hidden="true">⌄</span>
              </div>
            </summary>
            <div class="install-management-page__relations">
              ${group.items.map((item) => renderRelationItem(item, viewMode, onBeginUninstall))}
            </div>
          </details>
        `;
      })}
    </div>
  `;
}

export function renderInstallManagementPage(props: InstallManagementPageProps): TemplateResult {
  const {
    items,
    loading,
    error,
    pagination,
    filters,
    summary,
    viewMode,
    pendingUninstallId,
    uninstalling,
    uninstallError,
    onFilterChange,
    onViewModeChange,
    onPageChange,
    onBeginUninstall,
    onConfirmUninstall,
    onCancelUninstall,
    onBack,
  } = props;
  const pendingItem = pendingUninstallId ? items.find((r) => r.id === pendingUninstallId) : null;

  return html`
    <div class="install-management-page enterprise-page">
      <div class="enterprise-page__content">
        <header class="enterprise-page-header-row">
          <button type="button" class="enterprise-back-btn" @click=${onBack}>← 返回</button>
          <h1 class="enterprise-page-header-row__title">能力安装管理</h1>
        </header>

        ${summaryCards(summary)}

        <div class="enterprise-filter-bar">
          <input
            type="text"
            class="enterprise-filter-bar__input"
            placeholder="搜索能力名称"
            .value=${filters.capabilityNameQuery}
            @input=${(e: Event) =>
              onFilterChange("capabilityNameQuery", (e.target as HTMLInputElement).value)}
          />
          <input
            type="text"
            class="enterprise-filter-bar__input"
            placeholder="搜索机器人名称"
            .value=${filters.robotNameQuery}
            @input=${(e: Event) =>
              onFilterChange("robotNameQuery", (e.target as HTMLInputElement).value)}
          />
          <select
            class="enterprise-filter-bar__select"
            .value=${filters.source ?? ""}
            @change=${(e: Event) =>
              onFilterChange(
                "source",
                parseInstallSourceFilter((e.target as HTMLSelectElement).value),
              )}
          >
            <option value="">全部来源</option>
            <option value="管理员推送">管理员推送</option>
            <option value="员工自主安装">员工自主安装</option>
          </select>
          <select
            class="enterprise-filter-bar__select"
            .value=${filters.status ?? ""}
            @change=${(e: Event) =>
              onFilterChange(
                "status",
                parseInstallStatusFilter((e.target as HTMLSelectElement).value),
              )}
            >
            <option value="">全部状态</option>
            <option value="正常运行">正常运行</option>
            <option value="已暂停">已暂停</option>
            <option value="待更新">待更新</option>
          </select>
          ${viewModeSwitch(viewMode, onViewModeChange)}
        </div>

        ${
          loading
            ? html`
                <div class="enterprise-empty-message">加载中...</div>
              `
            : error
              ? html`<div class="enterprise-empty-message">${error}</div>`
              : items.length === 0
                ? html`
                    <div class="enterprise-empty-message">暂无安装记录</div>
                  `
                : renderGroups(items, viewMode, onBeginUninstall)
        }
        ${
          !loading
            ? renderPagination({
                currentPage: pagination.currentPage,
                pageSize: pagination.pageSize,
                totalItems: pagination.totalItems,
                onPageChange,
                onPageSizeChange: () => {},
              })
            : nothing
        }
        ${
          pendingItem
            ? html`
              <div
                class="install-management-page__dialog-overlay"
                @click=${(e: Event) => {
                  if (e.target === e.currentTarget) {
                    onCancelUninstall();
                  }
                }}
              >
                <div class="install-management-page__dialog">
                  <h3 class="install-management-page__dialog-title">确认卸载</h3>
                  <p class="install-management-page__dialog-text">
                    机器人「${pendingItem.robotName}」将失去能力「${pendingItem.capabilityName}」
                  </p>
                  <div class="install-management-page__dialog-impact">
                    <div class="install-management-page__dialog-impact-title">此操作将影响 1 个机器人</div>
                    <ul class="install-management-page__dialog-impact-list">
                      <li><span>负责人</span><strong>${displayOwner(pendingItem)}</strong></li>
                      <li><span>岗位</span><strong>${displayPosition(pendingItem)}</strong></li>
                      <li><span>团队</span><strong>${displayTeam(pendingItem)}</strong></li>
                      <li><span>当前状态</span><strong>${pendingItem.status}</strong></li>
                      <li><span>安装来源</span><strong>${pendingItem.source}</strong></li>
                    </ul>
                    <p class="install-management-page__dialog-impact-note">
                      卸载后该机器人将立即无法调用此能力，相关任务可能受影响。此操作不可自动撤销。
                    </p>
                  </div>
                  ${
                    uninstallError
                      ? html`<p class="install-management-page__dialog-error">${uninstallError}</p>`
                      : nothing
                  }
                  <div class="install-management-page__dialog-actions">
                    <button
                      type="button"
                      class="enterprise-btn enterprise-btn--ghost"
                      @click=${onCancelUninstall}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      class="enterprise-btn enterprise-btn--danger"
                      .disabled=${uninstalling}
                      @click=${onConfirmUninstall}
                    >
                      ${uninstalling ? "卸载中..." : "确认卸载"}
                    </button>
                  </div>
                </div>
              </div>
            `
            : nothing
        }
      </div>
    </div>
  `;
}
