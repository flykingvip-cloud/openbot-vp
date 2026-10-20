/**
 * 分页控件（Pagination）
 *
 * 企业能力中心列表底部使用的分页控件，水平排布三段：
 *   ┌─ 左：总数文本（"共 N 项能力资产" / 默认 "共 N 项"）
 *   ├─ 中：上一页 / 页码按钮（含省略号）/ 下一页
 *   └─ 右：每页条数选择器（10 / 20 / 50）
 *
 * 该组件为纯渲染函数（pure render function）：
 * - 不持有内部状态（currentPage / pageSize / totalItems 全部由调用方传入）
 * - 不直接访问任何 controller / store；通过 `onPageChange` 与 `onPageSizeChange`
 *   两个回调向调用方上报变更
 *
 * 样式：使用 enterprise-components.css 的 .pagination 类体系，响应主题切换。
 *
 * 渲染契约：
 * - `totalItems === 0` → 仅渲染左侧总数文本（"共 0 项"）与右侧每页条数选择器
 * - `totalPages = Math.max(1, Math.ceil(totalItems / pageSize))`
 * - 上一页按钮在 `currentPage === 1` 时禁用；下一页按钮在边界时禁用
 * - 当前页按钮高亮，其他页按钮为透明底 + 灰色边框
 * - 所有可点击元素最小尺寸 32×32 像素（无障碍合规，需求 18.8）
 *
 * 验证需求：
 * - 3.6  分页表格 + 总数 + 页码导航 + 每页条数（10 / 20 / 50）
 * - 17.1 分页控件结构（总数文本 + 页码导航 + 每页条数选择器）
 * - 17.2 每页条数 10 / 20 / 50，默认 10
 * - 18.8 所有可点击交互元素最小点击区域 ≥ 32×32 像素
 */

import { html, nothing, type TemplateResult } from "lit";

/** 分页支持的每页条数（与 PaginationState.pageSize 严格一致） */
export type PaginationPageSize = 10 | 20 | 50;

export type PaginationProps = {
  /** 当前页码（1-based）；总是被 `clamp(1, totalPages)` 修正 */
  currentPage: number;
  /** 每页条数 */
  pageSize: PaginationPageSize;
  /** 总条目数（≥ 0） */
  totalItems: number;
  /**
   * 可选总数标签文案，例如 "共 128 项能力资产"。
   * 不提供时退回到通用的 "共 N 项"。
   */
  totalLabel?: string;
  /** 页码变更回调 */
  onPageChange: (page: number) => void;
  /** 每页条数变更回调 */
  onPageSizeChange: (size: PaginationPageSize) => void;
};

/** 中间页码导航最多展示的"页码槽位数"（含首尾） */
const MAX_VISIBLE_SLOTS = 7;

/** 中间窗口宽度（围绕 currentPage 的 ±2，共 5 项） */
const WINDOW_HALF = 2;

/** 支持的每页条数枚举（用于 select 渲染） */
const PAGE_SIZE_OPTIONS: readonly PaginationPageSize[] = [10, 20, 50] as const;

/** 用于在 visible-pages 数组中表示省略号的标记。 */
type EllipsisMarker = "ellipsis";

/**
 * 计算给定 totalItems 与 pageSize 下的总页数。
 *
 * - `totalItems <= 0` → 返回 1（UI 至少保留第 1 页占位）
 * - 其他情况 → `Math.ceil(totalItems / pageSize)`
 */
export function computeTotalPages(totalItems: number, pageSize: PaginationPageSize): number {
  if (totalItems <= 0) {
    return 1;
  }
  return Math.ceil(totalItems / pageSize);
}

/**
 * 计算页码导航中需要展示的元素序列（含省略号占位）。
 */
export function computeVisiblePages(
  currentPage: number,
  totalPages: number,
): readonly (number | EllipsisMarker)[] {
  if (totalPages <= MAX_VISIBLE_SLOTS) {
    const pages: number[] = [];
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i);
    }
    return pages;
  }

  const windowStart = Math.max(2, currentPage - WINDOW_HALF);
  const windowEnd = Math.min(totalPages - 1, currentPage + WINDOW_HALF);

  const result: (number | EllipsisMarker)[] = [1];
  if (windowStart > 2) {
    result.push("ellipsis");
  }
  for (let i = windowStart; i <= windowEnd; i++) {
    result.push(i);
  }
  if (windowEnd < totalPages - 1) {
    result.push("ellipsis");
  }
  result.push(totalPages);
  return result;
}

/**
 * 渲染单个页码按钮。
 */
function renderPageButton(
  page: number,
  isActive: boolean,
  onPageChange: (page: number) => void,
): TemplateResult {
  const cls = isActive
    ? "pagination__page-button pagination__page-button--active"
    : "pagination__page-button";
  return html`
    <button
      type="button"
      class=${cls}
      aria-label="第 ${page} 页"
      aria-current=${isActive ? "page" : "false"}
      @click=${() => {
        if (!isActive) {
          onPageChange(page);
        }
      }}
    >
      ${page}
    </button>
  `;
}

/** 渲染省略号占位 */
function renderEllipsis(): TemplateResult {
  return html`
    <span class="pagination__ellipsis" aria-hidden="true">…</span>
  `;
}

/** 渲染上一页 / 下一页按钮 */
function renderStepButton(
  direction: "prev" | "next",
  disabled: boolean,
  targetPage: number,
  onPageChange: (page: number) => void,
): TemplateResult {
  const label = direction === "prev" ? "上一页" : "下一页";
  const symbol = direction === "prev" ? "‹" : "›";
  return html`
    <button
      type="button"
      class="pagination__step-button pagination__step-button--${direction} ${
        disabled ? "pagination__step-button--disabled" : ""
      }"
      aria-label=${label}
      ?disabled=${disabled}
      @click=${() => {
        if (!disabled) {
          onPageChange(targetPage);
        }
      }}
    >
      ${symbol}
    </button>
  `;
}

/** 渲染每页条数选择器 */
function renderPageSizeSelect(
  pageSize: PaginationPageSize,
  onPageSizeChange: (size: PaginationPageSize) => void,
): TemplateResult {
  return html`
    <label class="pagination__page-size">
      <span class="pagination__page-size-label">每页</span>
      <select
        class="pagination__page-size-select"
        aria-label="每页条数"
        .value=${String(pageSize)}
        @change=${(event: Event) => {
          const target = event.currentTarget as HTMLSelectElement;
          const next = Number.parseInt(target.value, 10) as PaginationPageSize;
          if (next === 10 || next === 20 || next === 50) {
            onPageSizeChange(next);
          }
        }}
      >
        ${PAGE_SIZE_OPTIONS.map(
          (size) => html`
            <option value=${String(size)} ?selected=${size === pageSize}>${size} 条/页</option>
          `,
        )}
      </select>
    </label>
  `;
}

/**
 * 渲染分页控件。
 */
export function renderPagination(props: PaginationProps): TemplateResult {
  const safeTotal = Math.max(0, props.totalItems);
  const totalPages = computeTotalPages(safeTotal, props.pageSize);
  const safeCurrentPage = Math.min(Math.max(1, props.currentPage), totalPages);

  const totalText = props.totalLabel ?? `共 ${safeTotal} 项`;

  // 空集合：仅左侧总数 + 右侧每页条数选择器
  if (safeTotal === 0) {
    return html`
      <nav class="pagination pagination--empty" aria-label="分页导航">
        <span class="pagination__total">${totalText}</span>
        <span class="pagination__spacer" aria-hidden="true"></span>
        ${renderPageSizeSelect(props.pageSize, props.onPageSizeChange)}
      </nav>
    `;
  }

  const visiblePages = computeVisiblePages(safeCurrentPage, totalPages);
  const prevDisabled = safeCurrentPage === 1;
  const nextDisabled = safeCurrentPage === totalPages;

  return html`
    <nav class="pagination" aria-label="分页导航">
      <span class="pagination__total">${totalText}</span>
      <div class="pagination__nav">
        ${renderStepButton("prev", prevDisabled, safeCurrentPage - 1, props.onPageChange)}
        ${visiblePages.map((slot) =>
          typeof slot === "number"
            ? renderPageButton(slot, slot === safeCurrentPage, props.onPageChange)
            : renderEllipsis(),
        )}
        ${renderStepButton("next", nextDisabled, safeCurrentPage + 1, props.onPageChange)}
      </div>
      ${renderPageSizeSelect(props.pageSize, props.onPageSizeChange)}
      ${nothing}
    </nav>
  `;
}
