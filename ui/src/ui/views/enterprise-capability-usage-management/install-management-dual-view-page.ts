/**
 * Install Management Dual View Page — 「能力安装管理」双视角子页。
 *
 * 顶部 Tabs（按机器人 / 按能力）+ KPI 区 + 筛选栏 + 分组表格 + 分页 + 卸载对话框
 *
 * 落实需求：Requirements 5.1–5.9
 */

import { html, nothing, type TemplateResult } from "lit-html";
import type { InstallRelationEnhanced } from "../../capability/runtime-projection/types.ts";
import type {
  InstallManagementDualViewController,
  InstallManagementDualViewState,
  InstallViewMode,
} from "../../controllers/enterprise-capability-usage-management/install-management-dual-view.ts";
import { renderInstallRelationRow } from "./install-relation-row.ts";
import { renderEmptyState } from "./shared/empty-state.ts";
import { renderFilterBar, renderSearchInput, renderSelect } from "./shared/filter-bar.ts";
import { renderKpiCard } from "./shared/kpi-card.ts";
import {
  USAGE_PAGE_CONTAINER,
  USAGE_PAGINATION_CONTAINER,
  USAGE_TABLE_CONTAINER,
} from "./shared/styles.css.ts";

export type InstallManagementDualViewPageProps = {
  state: InstallManagementDualViewState;
  controller: InstallManagementDualViewController;
};

const SOURCE_OPTIONS = [
  { label: "全部来源", value: "" },
  { label: "员工沉淀", value: "员工沉淀" },
  { label: "企业发布", value: "企业发布" },
] as const;

const STATUS_OPTIONS = [
  { label: "全部状态", value: "" },
  { label: "正常", value: "正常" },
  { label: "待优化", value: "待优化" },
] as const;

function renderTabs(
  state: InstallManagementDualViewState,
  controller: InstallManagementDualViewController,
): TemplateResult {
  const tabs: { label: string; mode: InstallViewMode }[] = [
    { label: "按机器人", mode: "byRobot" },
    { label: "按能力", mode: "byCapability" },
  ];
  return html`
    <div class="enterprise-usage-subtabs" role="tablist">
      ${tabs.map(
        (tab) => html`
          <button
            role="tab"
            aria-selected=${String(state.viewMode === tab.mode)}
            class="enterprise-usage-subtab ${state.viewMode === tab.mode ? "enterprise-usage-subtab--active" : ""}"
            @click=${() => controller.changeViewMode(tab.mode)}
          >${tab.label}</button>
        `,
      )}
    </div>
  `;
}

function renderKpis(state: InstallManagementDualViewState): TemplateResult {
  const { totalRelations, coveredRobots, coveredCapabilities } = state.summary;
  return html`
    <div class="enterprise-usage-kpi-grid--3">
      ${renderKpiCard({ title: "总安装关系数", value: String(totalRelations) })}
      ${renderKpiCard({ title: "覆盖机器人数", value: String(coveredRobots) })}
      ${renderKpiCard({ title: "覆盖能力数", value: String(coveredCapabilities) })}
    </div>
  `;
}

function renderFilters(
  state: InstallManagementDualViewState,
  controller: InstallManagementDualViewController,
): TemplateResult {
  return renderFilterBar(html`
    ${renderSearchInput({
      placeholder: "搜索能力名称",
      value: state.filters.capabilityNameQuery,
      onInput: (v) => controller.updateFilter({ capabilityNameQuery: v }),
    })}
    ${renderSearchInput({
      placeholder: "搜索机器人名称",
      value: state.filters.robotNameQuery,
      onInput: (v) => controller.updateFilter({ robotNameQuery: v }),
    })}
    ${renderSelect({
      options: SOURCE_OPTIONS as unknown as readonly { label: string; value: string }[],
      value: state.filters.source ?? "",
      onChange: (v) =>
        controller.updateFilter({ source: (v || null) as "员工沉淀" | "企业发布" | null }),
    })}
    ${renderSelect({
      options: STATUS_OPTIONS as unknown as readonly { label: string; value: string }[],
      value: state.filters.status ?? "",
      onChange: (v) => controller.updateFilter({ status: (v || null) as "正常" | "待优化" | null }),
    })}
  `);
}

function renderGroupedTable(
  state: InstallManagementDualViewState,
  controller: InstallManagementDualViewController,
): TemplateResult {
  const groups =
    state.viewMode === "byRobot" ? controller.groupByRobot() : controller.groupByCapability();

  if (groups.size === 0) {
    return renderEmptyState("暂无安装关系");
  }

  const entries = [...groups.entries()];
  return html`
    <div class="${USAGE_TABLE_CONTAINER}">
      ${entries.map(([groupKey, items]) => {
        const groupLabel =
          state.viewMode === "byRobot"
            ? (items[0]?.robotName ?? groupKey)
            : (items[0]?.capabilityName ?? groupKey);
        return html`
          <div class="enterprise-install-group">
            <h4 class="enterprise-install-group__title">${groupLabel}</h4>
            <table class="enterprise-usage-data-table">
              <thead>
                <tr>
                  <th>${state.viewMode === "byRobot" ? "能力名称" : "机器人名称"}</th>
                  <th>来源</th>
                  <th>本月调用量</th>
                  <th>成功率</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${items.map((item: InstallRelationEnhanced) =>
                  renderInstallRelationRow({
                    item,
                    primaryLabel:
                      state.viewMode === "byRobot" ? item.capabilityName : item.robotName,
                    onUninstall: (id) => controller.requestUninstall(id),
                  }),
                )}
              </tbody>
            </table>
          </div>
        `;
      })}
    </div>
  `;
}

function renderUninstallDialog(
  state: InstallManagementDualViewState,
  controller: InstallManagementDualViewController,
): TemplateResult {
  if (!state.pendingUninstallId) {
    return nothing as unknown as TemplateResult;
  }
  const item = state.items.find((i) => i.id === state.pendingUninstallId);
  if (!item) {
    return nothing as unknown as TemplateResult;
  }

  return html`
    <div class="enterprise-usage-confirm-backdrop enterprise-install-uninstall-dialog">
      <div class="enterprise-usage-confirm-dialog">
        <h3 class="enterprise-usage-confirm-dialog__title">确认卸载</h3>
        <div class="enterprise-usage-confirm-dialog__rows">
          <p>机器人：<strong>${item.robotName}</strong></p>
          <p>能力：<strong>${item.capabilityName}</strong></p>
          <p>状态：<strong>${item.status}</strong></p>
          <p>来源：<strong>${item.source}</strong></p>
        </div>
        ${state.uninstallError ? html`<p class="enterprise-usage-confirm-dialog__error">${state.uninstallError}</p>` : nothing}
        <div class="enterprise-usage-confirm-dialog__footer">
          <button
            class="enterprise-usage-btn enterprise-usage-btn--ghost"
            @click=${() => controller.cancelUninstall()}
            ?disabled=${state.uninstalling}
          >取消</button>
          <button
            class="enterprise-usage-btn enterprise-usage-btn--danger"
            @click=${() => controller.confirmUninstall()}
            ?disabled=${state.uninstalling}
          >${state.uninstalling ? "卸载中..." : "确认卸载"}</button>
        </div>
      </div>
    </div>
  `;
}

function renderPagination(
  state: InstallManagementDualViewState,
  controller: InstallManagementDualViewController,
): TemplateResult {
  const { currentPage, pageSize, totalItems } = state.pagination;
  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  return html`
    <div class="${USAGE_PAGINATION_CONTAINER}">
      <span class="enterprise-usage-pagination__total">共 ${totalItems} 条</span>
      <div class="enterprise-usage-pagination__controls">
        <button class="enterprise-usage-btn enterprise-usage-btn--ghost" ?disabled=${currentPage <= 1} @click=${() => controller.changePage(currentPage - 1)}>上一页</button>
        <span class="enterprise-usage-pagination__page">${currentPage} / ${totalPages}</span>
        <button class="enterprise-usage-btn enterprise-usage-btn--ghost" ?disabled=${currentPage >= totalPages} @click=${() => controller.changePage(currentPage + 1)}>下一页</button>
      </div>
    </div>
  `;
}

/**
 * 渲染「能力安装管理」双视角子页。
 */
export function renderInstallManagementDualViewPage(
  props: InstallManagementDualViewPageProps,
): TemplateResult {
  const { state, controller } = props;

  return html`
    <div class="${USAGE_PAGE_CONTAINER}">
      ${renderTabs(state, controller)}
      ${renderKpis(state)}
      ${renderFilters(state, controller)}

      ${
        state.loading && state.items.length === 0
          ? html`<div class="enterprise-usage-skeleton">${[1, 2, 3].map(
              () =>
                html`
                  <div class="enterprise-usage-skeleton__block"></div>
                `,
            )}</div>`
          : html`
          ${state.error ? html`<div class="enterprise-usage-error">${state.error}</div>` : nothing}
          ${renderGroupedTable(state, controller)}
          ${state.items.length > 0 ? renderPagination(state, controller) : nothing}
        `
      }

      ${renderUninstallDialog(state, controller)}
    </div>
  `;
}
