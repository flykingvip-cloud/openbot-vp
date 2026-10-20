/**
 * 贡献记录页面（ContributionRecordsPage）
 *
 * 展示员工向企业提交能力的完整历史。
 *
 * 验证需求：10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 *
 * 样式：使用 enterprise-foundation.css + enterprise-components.css 的 class
 * 体系。仅 status badge 的状态映射保留 inline 样式，等待 status-badge 系统
 * 进一步抽象。
 */

import { html, nothing, type TemplateResult } from "lit";
import type {
  ContributionRecordListItem,
  ContributionRecordsFilters,
  ContributionRecordsSorting,
} from "../../capability/enterprise-capability/endpoints.ts";
import type { PaginationState } from "../../capability/enterprise-capability/types.ts";
import { renderPagination } from "./pagination.ts";

type ReviewStatusFilter = ContributionRecordsFilters["reviewStatus"];

export type ContributionRecordsPageProps = {
  items: ContributionRecordListItem[];
  loading: boolean;
  error: string | null;
  pagination: PaginationState;
  filters: ContributionRecordsFilters;
  sorting: ContributionRecordsSorting;
  /** 嵌入模式：省略页面外壳与标题，仅渲染筛选栏 + 表格 + 分页（用于作为子视图嵌入）。 */
  embedded?: boolean;
  onFilterChange: <K extends keyof ContributionRecordsFilters>(
    key: K,
    value: ContributionRecordsFilters[K],
  ) => void;
  onSortChange: (field: ContributionRecordsSorting["field"]) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: 10 | 20 | 50) => void;
  onViewDetail: (capabilityId: string) => void;
  /** 点击"待审核/审核中"状态徽章时跳转到审核队列。 */
  onNavigateReviewQueue: () => void;
  onBack: () => void;
};

/** 审核状态 → 语义 badge tone 映射 */
const STATUS_TONE: Record<string, "info" | "warning" | "success" | "danger" | "neutral"> = {
  待审核: "info",
  审核中: "warning",
  已通过: "success",
  已拒绝: "danger",
  需修改: "warning",
};

/** 仍在审核队列中、可点击跳转去审核的状态。 */
const REVIEWABLE_STATUSES: ReadonlySet<string> = new Set(["待审核", "审核中"]);

function parseReviewStatusFilter(value: string): ReviewStatusFilter {
  switch (value) {
    case "待审核":
    case "审核中":
    case "已通过":
    case "已拒绝":
    case "需修改":
      return value;
    default:
      return null;
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function statusBadge(status: string, onNavigateReviewQueue: () => void): TemplateResult {
  const tone = STATUS_TONE[status] ?? "neutral";
  if (REVIEWABLE_STATUSES.has(status)) {
    // 待审核/审核中:徽章可点击 → 进入审核队列(阻止冒泡,避免触发整行的详情跳转)。
    return html`<button
      type="button"
      class="enterprise-status-badge enterprise-status-badge--${tone} contribution-records-page__status-action"
      title="去审核队列处理"
      @click=${(event: Event) => {
        event.stopPropagation();
        onNavigateReviewQueue();
      }}
    >${status}</button>`;
  }
  return html`<span
    class="enterprise-status-badge enterprise-status-badge--${tone}"
  >${status}</span>`;
}

/** 提交员工显示名兜底：空值或来源标识时回退为可读文案，避免直接展示来源 key。 */
function displayContributorName(item: ContributionRecordListItem): string {
  const name = item.contribution.employeeName?.trim();
  if (name) {
    return name;
  }
  return "未具名贡献者";
}

function sortableHeader(
  label: string,
  field: ContributionRecordsSorting["field"],
  sorting: ContributionRecordsSorting,
  onSortChange: (field: ContributionRecordsSorting["field"]) => void,
): TemplateResult {
  const isActive = sorting.field === field;
  const directionLabel = sorting.direction === "asc" ? "升序" : "降序";
  return html`
    <th
      class="contribution-records-page__sortable-th ${isActive ? "is-active" : ""}"
      aria-sort=${isActive ? (sorting.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        class="contribution-records-page__sort-button"
        title=${isActive ? `${label}，当前${directionLabel}，点击切换排序` : `按${label}排序`}
        @click=${(event: Event) => {
          event.stopPropagation();
          onSortChange(field);
        }}
      >
        <span>${label}</span>
        <span class="contribution-records-page__sort-icon" aria-hidden="true">
          ${isActive ? (sorting.direction === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  `;
}

export function renderContributionRecordsPage(props: ContributionRecordsPageProps): TemplateResult {
  const {
    items,
    loading,
    error,
    pagination,
    filters,
    sorting,
    embedded,
    onFilterChange,
    onSortChange,
    onPageChange,
    onPageSizeChange,
    onViewDetail,
    onNavigateReviewQueue,
    onBack,
  } = props;

  const body = html`
    <div class="enterprise-filter-bar">
      <input
        type="text"
        class="enterprise-filter-bar__input"
        placeholder="搜索员工"
        .value=${filters.employeeId ?? ""}
        @input=${(e: Event) =>
          onFilterChange("employeeId", (e.target as HTMLInputElement).value || null)}
      />
      <select
        class="enterprise-filter-bar__select"
        .value=${filters.reviewStatus ?? ""}
        @change=${(e: Event) =>
          onFilterChange(
            "reviewStatus",
            parseReviewStatusFilter((e.target as HTMLSelectElement).value),
          )}
      >
        <option value="">全部状态</option>
        <option value="待审核">待审核</option>
        <option value="审核中">审核中</option>
        <option value="已通过">已通过</option>
        <option value="已拒绝">已拒绝</option>
        <option value="需修改">需修改</option>
      </select>
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
                <div class="enterprise-empty-message">暂无贡献记录</div>
              `
            : html`
              <div class="contribution-records-page__table-shell">
                <table class="contribution-records-page__table">
                  <colgroup>
                    <col class="contribution-records-page__col-time" />
                    <col class="contribution-records-page__col-employee" />
                    <col class="contribution-records-page__col-capability" />
                    <col class="contribution-records-page__col-robot" />
                    <col class="contribution-records-page__col-status" />
                  </colgroup>
                  <thead>
                    <tr>
                      ${sortableHeader("提交时间", "submittedAt", sorting, onSortChange)}
                      ${sortableHeader("提交员工", "employeeName", sorting, onSortChange)}
                      <th>能力名称</th>
                      <th>来源机器人</th>
                      ${sortableHeader("审核状态", "reviewStatus", sorting, onSortChange)}
                    </tr>
                  </thead>
                  <tbody>
                    ${items.map(
                      (item) => html`
                        <tr
                          class="contribution-records-page__row"
                          @click=${() => onViewDetail(item.capabilityId)}
                        >
                          <td class="contribution-records-page__cell-time">
                            ${formatTime(item.contribution.timestamp)}
                          </td>
                          <td class="contribution-records-page__cell-employee">
                            ${displayContributorName(item)}
                          </td>
                          <td class="contribution-records-page__cell-title">
                            ${item.capabilityName}
                          </td>
                          <td class="contribution-records-page__cell-robot">
                            ${item.sourceRobotName}
                          </td>
                          <td class="contribution-records-page__cell-status">
                            ${statusBadge(item.reviewStatus, onNavigateReviewQueue)}
                          </td>
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              </div>
            `
    }
    ${
      !loading
        ? renderPagination({
            currentPage: pagination.currentPage,
            pageSize: pagination.pageSize,
            totalItems: pagination.totalItems,
            onPageChange,
            onPageSizeChange,
          })
        : nothing
    }
  `;

  if (embedded) {
    return html`<div class="contribution-records-page contribution-records-page--embedded">
      <div class="contribution-records-page__body">${body}</div>
    </div>`;
  }

  return html`
    <div class="contribution-records-page enterprise-page">
      <div class="enterprise-page__content">
        <header class="enterprise-page-header-row">
          <button type="button" class="enterprise-back-btn" @click=${onBack}>← 返回</button>
          <h1 class="enterprise-page-header-row__title">能力贡献记录</h1>
        </header>
        <div class="contribution-records-page__body">${body}</div>
      </div>
    </div>
  `;
}
