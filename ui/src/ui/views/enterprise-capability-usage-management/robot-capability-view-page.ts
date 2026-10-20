/**
 * Robot Capability View Page — 「机器人能力视图」子页外框。
 *
 * 编排：Page Header → 4 KPI 卡片 → 筛选栏 → robot-capability-table → Pagination → robot-detail-panel
 *
 * 落实需求：Requirements 4.1, 4.2, 4.3, 4.5, 4.6
 */

import { html, nothing, type TemplateResult } from "lit-html";
import type { HealthStatus } from "../../capability/runtime-projection/types.ts";
import type {
  RobotCapabilityViewController,
  RobotCapabilityViewState,
} from "../../controllers/enterprise-capability-usage-management/robot-capability-view.ts";
import { renderRobotCapabilityTable } from "./robot-capability-table.ts";
import { renderRobotDetailPanel } from "./robot-detail-panel.ts";
import { renderEmptyState } from "./shared/empty-state.ts";
import { renderFilterBar, renderSearchInput, renderSelect } from "./shared/filter-bar.ts";
import { formatExecutions, formatSuccessRate } from "./shared/format.ts";
import { renderKpiCard } from "./shared/kpi-card.ts";
import { USAGE_KPI_GRID, USAGE_PAGINATION_CONTAINER } from "./shared/styles.css.ts";

export type RobotCapabilityViewPageProps = {
  state: RobotCapabilityViewState;
  controller: RobotCapabilityViewController;
};

const HEALTH_STATUS_OPTIONS: readonly { label: string; value: string }[] = [
  { label: "全部状态", value: "" },
  { label: "效果稳定", value: "效果稳定" },
  { label: "偶尔不理想", value: "偶尔不理想" },
  { label: "建议优化", value: "建议优化" },
  { label: "已停用", value: "已停用" },
];

const EXECUTIONS_RANGE_OPTIONS: readonly { label: string; value: string }[] = [
  { label: "全部", value: "全部" },
  { label: "< 100", value: "<100" },
  { label: "100 - 1000", value: "100-1000" },
  { label: "> 1000", value: ">1000" },
];

const PAGE_SIZE_OPTIONS: readonly { label: string; value: string }[] = [
  { label: "10 条/页", value: "10" },
  { label: "20 条/页", value: "20" },
  { label: "50 条/页", value: "50" },
];

function renderKpis(state: RobotCapabilityViewState): TemplateResult {
  if (!state.kpis) {
    return nothing as unknown as TemplateResult;
  }
  const { totalRobots, totalMonthlyExecutions, totalEmployeeCoverage, averageSuccessRate } =
    state.kpis;
  return html`
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px;">
      ${renderKpiCard({ title: "机器人总数", value: String(totalRobots) })}
      ${renderKpiCard({ title: "本月总调用量", value: formatExecutions(totalMonthlyExecutions) })}
      ${renderKpiCard({ title: "覆盖员工总数", value: String(totalEmployeeCoverage) })}
      ${renderKpiCard({ title: "平均成功率", value: formatSuccessRate(averageSuccessRate) })}
    </div>
  `;
}

function renderFilters(
  state: RobotCapabilityViewState,
  controller: RobotCapabilityViewController,
): TemplateResult {
  return renderFilterBar(html`
    ${renderSearchInput({
      placeholder: "搜索机器人名称",
      value: state.filters.nameQuery,
      onInput: (value) => controller.updateFilter({ nameQuery: value }),
    })}
    ${renderSelect({
      options: HEALTH_STATUS_OPTIONS,
      value: state.filters.healthStatus ?? "",
      onChange: (value) =>
        controller.updateFilter({
          healthStatus: (value || null) as HealthStatus | null,
        }),
    })}
    ${renderSelect({
      options: EXECUTIONS_RANGE_OPTIONS,
      value: state.filters.monthlyExecutionsRange,
      onChange: (value) =>
        controller.updateFilter({
          monthlyExecutionsRange: value as "全部" | "<100" | "100-1000" | ">1000",
        }),
    })}
  `);
}

function renderPagination(
  state: RobotCapabilityViewState,
  controller: RobotCapabilityViewController,
): TemplateResult {
  const { currentPage, pageSize, totalItems } = state.pagination;
  const totalPages = Math.ceil(totalItems / pageSize) || 1;

  return html`
    <div class="${USAGE_PAGINATION_CONTAINER}">
      <span class="text-sm text-gray-500">共 ${totalItems} 条</span>
      <div class="flex items-center gap-2">
        <button
          class="px-2 py-1 text-sm border rounded disabled:opacity-50"
          style="min-width: 32px; min-height: 32px;"
          ?disabled=${currentPage <= 1}
          @click=${() => controller.changePage(currentPage - 1)}
        >上一页</button>
        <span class="text-sm text-gray-600">${currentPage} / ${totalPages}</span>
        <button
          class="px-2 py-1 text-sm border rounded disabled:opacity-50"
          style="min-width: 32px; min-height: 32px;"
          ?disabled=${currentPage >= totalPages}
          @click=${() => controller.changePage(currentPage + 1)}
        >下一页</button>
        ${renderSelect({
          options: PAGE_SIZE_OPTIONS,
          value: String(pageSize),
          onChange: (value) => controller.changePageSize(Number(value) as 10 | 20 | 50),
        })}
      </div>
    </div>
  `;
}

function renderSkeleton(): TemplateResult {
  return html`
    <div class="animate-pulse space-y-4">
      <div class="${USAGE_KPI_GRID}">
        ${[1, 2, 3, 4].map(
          () =>
            html`
              <div class="h-20 bg-gray-200 rounded-lg"></div>
            `,
        )}
      </div>
      <div class="h-8 bg-gray-200 rounded w-1/3"></div>
      ${[1, 2, 3, 4, 5].map(
        () =>
          html`
            <div class="h-12 bg-gray-100 rounded"></div>
          `,
      )}
    </div>
  `;
}

function renderError(message: string, controller: RobotCapabilityViewController): TemplateResult {
  return html`
    <div class="enterprise-usage-error bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
      <span class="text-sm text-red-700">${message}</span>
      <button
        class="text-sm text-red-600 font-medium hover:text-red-800"
        style="min-width: 32px; min-height: 32px;"
        @click=${() => controller.load()}
      >重试</button>
    </div>
  `;
}

/**
 * 渲染「数字人能力视图」子页。
 */
export function renderRobotCapabilityViewPage(props: RobotCapabilityViewPageProps): TemplateResult {
  const { state, controller } = props;

  return html`
    <div style="padding: 0 24px;">
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 22px; font-weight: 700; color: #111827; margin: 0 0 6px 0; letter-spacing: -0.01em;">机器人能力配置视图</h2>
        <p style="font-size: 15px; color: #4b5563; margin: 0; line-height: 1.6;">按机器人查看已安装能力、使用效果、覆盖员工和反馈回流情况。</p>
      </div>

      ${
        state.loading && state.items.length === 0
          ? renderSkeleton()
          : html`
        ${state.error ? renderError(state.error, controller) : nothing}
        ${renderKpis(state)}
        ${renderFilters(state, controller)}
        ${
          state.items.length > 0
            ? html`
            ${renderRobotCapabilityTable({
              items: state.items,
              sorting: state.sorting,
              onSort: (field) => controller.changeSort(field),
              onViewDetail: (robotId) => controller.openDetail(robotId),
            })}
            ${renderPagination(state, controller)}
          `
            : !state.loading
              ? renderEmptyState("当前筛选条件下没有匹配的机器人")
              : nothing
        }
      `
      }

      ${
        state.detail.open
          ? renderRobotDetailPanel({
              data: state.detail.data,
              loading: state.detail.loading,
              onClose: () => controller.closeDetail(),
            })
          : nothing
      }
    </div>
  `;
}
