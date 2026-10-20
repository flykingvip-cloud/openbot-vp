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
} from "../../controllers/enterprise-asset-library-usage/robot-capability-view.ts";
import { renderRobotCapabilityTable } from "./robot-capability-table.ts";
import { renderRobotDetailPanel } from "./robot-detail-panel.ts";
import { renderEmptyState } from "./shared/empty-state.ts";
import { renderFilterBar, renderSearchInput, renderSelect } from "./shared/filter-bar.ts";
import { USAGE_PAGE_CONTAINER, USAGE_PAGINATION_CONTAINER } from "./shared/styles.css.ts";

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
      <span class="enterprise-usage-pagination__total">共 ${totalItems} 条</span>
      <div class="enterprise-usage-pagination__controls">
        <button
          class="enterprise-usage-btn enterprise-usage-btn--ghost"
          ?disabled=${currentPage <= 1}
          @click=${() => controller.changePage(currentPage - 1)}
        >上一页</button>
        <span class="enterprise-usage-pagination__page">${currentPage} / ${totalPages}</span>
        <button
          class="enterprise-usage-btn enterprise-usage-btn--ghost"
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
    <div class="enterprise-usage-skeleton">
      <div class="enterprise-usage-skeleton__block enterprise-usage-skeleton__block--sm"></div>
      ${[1, 2, 3, 4, 5].map(
        () =>
          html`
            <div class="enterprise-usage-skeleton__block enterprise-usage-skeleton__block--sm"></div>
          `,
      )}
    </div>
  `;
}

function renderError(message: string, controller: RobotCapabilityViewController): TemplateResult {
  return html`
    <div class="enterprise-usage-error">
      <span>${message}</span>
      <button class="enterprise-usage-error__retry" @click=${() => controller.load()}>重试</button>
    </div>
  `;
}

/**
 * 渲染「数字人能力视图」子页。
 */
export function renderRobotCapabilityViewPage(props: RobotCapabilityViewPageProps): TemplateResult {
  const { state, controller } = props;

  return html`
    <div class="${USAGE_PAGE_CONTAINER}">
      ${
        state.loading && state.items.length === 0
          ? renderSkeleton()
          : html`
        ${state.error ? renderError(state.error, controller) : nothing}
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
