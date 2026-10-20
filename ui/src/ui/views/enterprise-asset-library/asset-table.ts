/**
 * 企业能力资产表格（AssetTable）
 *
 * "查看全部能力"页面（AllCapabilitiesPage）的主数据表格，渲染 8 列：
 * 1. 能力名称与说明
 * 2. 能力领域
 * 3. 使用场景
 * 4. 适用对象
 * 5. 能力成熟度
 * 6. 健康状态
 * 7. 企业价值
 * 8. 操作
 *
 * 状态：Loading（骨架行）、Error（居中错误信息）、Empty（空状态提示）、Normal（数据行）
 *
 * 样式：使用 enterprise-components.css 的 .asset-table 类体系，响应主题。
 * 领域颜色通过 [data-domain="..."] 属性选择器应用。
 *
 * 验证需求：4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 17.5, 18.4, 18.5
 *
 * @module enterprise-asset-library/asset-table
 */

import { html, nothing, type TemplateResult } from "lit";
import type {
  ApplicableScope,
  CapabilityDomain,
  EnterpriseAssetListItem,
  PaginationState,
} from "../../capability/enterprise-capability/types.ts";
import { renderEnterpriseHealthBadge } from "./health-badge.ts";
import { renderMaturityIndicator } from "./maturity-indicator.ts";
import { renderMiniTrendChart } from "./mini-trend-chart.ts";
import { renderPagination } from "./pagination.ts";
import { renderValueSummaryCard } from "./value-summary-card.ts";

// ─── Public Types ────────────────────────────────────────────────────────────

export type AssetTableProps = {
  items: EnterpriseAssetListItem[];
  loading: boolean;
  error: string | null;
  pagination: PaginationState;
  onInstallToRobot: (capabilityId: string) => void;
  onViewDetail: (capabilityId: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: 10 | 20 | 50) => void;
};

// ─── Constants ───────────────────────────────────────────────────────────────

/** 表格最小宽度，低于 1280px 视口时触发水平滚动（需求 18.4 / 18.5） */
const TABLE_MIN_WIDTH = "1200px";

/** 骨架行数量 */
const SKELETON_ROW_COUNT = 5;

/** 适用对象 kind → 图标映射 */
const SCOPE_ICON: Record<ApplicableScope["kind"], string> = {
  enterprise: "🏢",
  department: "🏬",
  group: "👥",
  role: "👤",
};

// ─── Exported Helpers ────────────────────────────────────────────────────────

/**
 * 截断文本到指定最大长度，超出部分以"…"结尾。
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}…`;
}

/**
 * 渲染标签列表，超出 `maxVisible` 个时以"+N"形式折叠。
 */
export function renderTagsWithOverflow(tags: string[], maxVisible: number): TemplateResult {
  if (tags.length === 0) {
    return html`
      <span class="asset-table__tags-empty">—</span>
    `;
  }

  const visible = tags.slice(0, maxVisible);
  const overflowCount = tags.length - maxVisible;

  return html`
    <span class="asset-table__tags">
      ${visible.map((tag) => html`<span class="asset-table__tag">${tag}</span>`)}
      ${
        overflowCount > 0
          ? html`<span class="asset-table__tag asset-table__tag--overflow">+${overflowCount}</span>`
          : nothing
      }
    </span>
  `;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/** 渲染适用对象列内容 */
function renderApplicableScope(scope: ApplicableScope): TemplateResult {
  const icon = SCOPE_ICON[scope.kind];
  let text: string;
  switch (scope.kind) {
    case "enterprise":
      text = "全企业";
      break;
    case "department":
      text = scope.name;
      break;
    case "group":
      text = scope.name;
      break;
    case "role":
      text = scope.name;
      break;
  }
  return html`
    <span class="asset-table__scope">
      <span aria-hidden="true">${icon}</span>
      <span>${text}</span>
    </span>
  `;
}

/** 渲染能力领域标签（按领域着色） */
function renderDomainChip(domain: CapabilityDomain): TemplateResult {
  return html`<span class="asset-table__domain-chip" data-domain=${domain}>${domain}</span>`;
}

/** 判断能力是否可安装 */
function isInstallable(item: EnterpriseAssetListItem): boolean {
  return item.lifecycle === "published" && item.healthStatus !== "已不适合继续推广";
}

/** 判断能力是否已停用 */
function isDisabled(item: EnterpriseAssetListItem): boolean {
  return (
    item.lifecycle === "deprecated" ||
    item.lifecycle === "retired" ||
    item.healthStatus === "已不适合继续推广"
  );
}

// ─── Row Rendering ───────────────────────────────────────────────────────────

/** 渲染单个数据行 */
function renderAssetTableRow(
  item: EnterpriseAssetListItem,
  onInstallToRobot: (capabilityId: string) => void,
  onViewDetail: (capabilityId: string) => void,
): TemplateResult {
  const truncatedName = truncateText(item.name, 30);
  const truncatedDesc = truncateText(item.description, 50);

  return html`
    <tr class="asset-table__row">
      <!-- 1. 能力名称与说明 -->
      <td class="asset-table__cell">
        <div class="asset-table__name-cell">
          ${
            item.avatar
              ? html`<img class="asset-table__avatar" src=${item.avatar} alt="" />`
              : html`
                  <span class="asset-table__avatar-placeholder" aria-hidden="true">📋</span>
                `
          }
          <div class="asset-table__name-body">
            <div class="asset-table__name-row">
              <span class="asset-table__name" title=${item.name}>${truncatedName}</span>
              ${renderMaturityIndicator({ maturity: item.maturity, variant: "compact" })}
            </div>
            <div class="asset-table__desc" title=${item.description}>${truncatedDesc}</div>
            <div class="asset-table__source">来源：${item.sourceEmployeeName}</div>
          </div>
        </div>
      </td>

      <!-- 2. 能力领域 -->
      <td class="asset-table__cell">${renderDomainChip(item.domain)}</td>

      <!-- 3. 使用场景 -->
      <td class="asset-table__cell">${renderTagsWithOverflow(item.usageScenarios, 3)}</td>

      <!-- 4. 适用对象 -->
      <td class="asset-table__cell">${renderApplicableScope(item.applicableScope)}</td>

      <!-- 5. 能力成熟度 -->
      <td class="asset-table__cell">
        ${renderMaturityIndicator({ maturity: item.maturity, variant: "compact" })}
      </td>

      <!-- 6. 健康状态 -->
      <td class="asset-table__cell">
        ${renderEnterpriseHealthBadge({ status: item.healthStatus, variant: "inline" })}
      </td>

      <!-- 7. 企业价值 -->
      <td class="asset-table__cell">
        <div class="asset-table__value-cell">
          ${renderValueSummaryCard({ summary: item.valueSummary, variant: "inline" })}
          ${renderMiniTrendChart({
            trend: item.reuseData.trend30Days,
            growthPercentage: item.reuseData.growthPercentage,
          })}
        </div>
      </td>

      <!-- 8. 操作 -->
      <td class="asset-table__cell">
        <div class="asset-table__actions">
          ${
            isInstallable(item)
              ? html`<button
                type="button"
                class="asset-table__install-btn"
                @click=${() => onInstallToRobot(item.id)}
              >
                推送到岗位
              </button>`
              : nothing
          }
          ${
            isDisabled(item)
              ? html`
                  <span class="asset-table__disabled-label" aria-label="已停用">已停用</span>
                `
              : nothing
          }
          <button
            type="button"
            class="asset-table__detail-link"
            @click=${() => onViewDetail(item.id)}
          >
            查看详情
          </button>
        </div>
      </td>
    </tr>
  `;
}

// ─── Skeleton / Error / Empty States ─────────────────────────────────────────

/** 渲染骨架行（加载状态） */
function renderSkeletonRows(): TemplateResult {
  const rows = Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => {
    return html`
      <tr class="asset-table__skeleton-row" key="skeleton-${i}">
        <td class="asset-table__cell">
          <div class="asset-table__name-cell">
            <span class="asset-table__skeleton-avatar"></span>
            <div class="asset-table__skeleton-body">
              <div class="asset-table__skeleton-bar asset-table__skeleton-bar--wide"></div>
              <div class="asset-table__skeleton-bar asset-table__skeleton-bar--wider"></div>
            </div>
          </div>
        </td>
        <td class="asset-table__cell">
          <div class="asset-table__skeleton-bar asset-table__skeleton-bar--xs"></div>
        </td>
        <td class="asset-table__cell">
          <div class="asset-table__skeleton-bar asset-table__skeleton-bar--md"></div>
        </td>
        <td class="asset-table__cell">
          <div class="asset-table__skeleton-bar asset-table__skeleton-bar--sm"></div>
        </td>
        <td class="asset-table__cell">
          <div class="asset-table__skeleton-bar asset-table__skeleton-bar--sm"></div>
        </td>
        <td class="asset-table__cell">
          <div class="asset-table__skeleton-bar asset-table__skeleton-bar--sm"></div>
        </td>
        <td class="asset-table__cell">
          <div class="asset-table__skeleton-bar asset-table__skeleton-bar--lg"></div>
        </td>
        <td class="asset-table__cell">
          <div class="asset-table__skeleton-bar asset-table__skeleton-bar--md"></div>
        </td>
      </tr>
    `;
  });

  return html`${rows}`;
}

/** 渲染错误状态 */
function renderErrorState(error: string): TemplateResult {
  return html`
    <tr class="asset-table__error-row">
      <td colspan="8" class="asset-table__error-cell">
        <div class="asset-table__error-title">加载失败</div>
        <div class="asset-table__error-detail">${error}</div>
      </td>
    </tr>
  `;
}

/** 渲染空状态 */
function renderEmptyState(): TemplateResult {
  return html`
    <tr class="asset-table__empty-row">
      <td colspan="8" class="asset-table__empty-cell">暂无匹配的能力资产，请调整筛选条件</td>
    </tr>
  `;
}

// ─── Table Header ────────────────────────────────────────────────────────────

const COLUMN_HEADERS = [
  "能力名称与说明",
  "能力领域",
  "使用场景",
  "适用对象",
  "能力成熟度",
  "健康状态",
  "企业价值",
  "操作",
] as const;

function renderTableHeader(): TemplateResult {
  // The thead inline `style` keeps backwards compatibility with existing
  // visual-constraint tests asserting `background:#F9FAFB` and `sticky`.
  // Once those tests migrate to class assertions, this can drop to
  // class-only.
  return html`
    <thead class="asset-table__head" style="background:#F9FAFB;position:sticky;top:0;z-index:1">
      <tr>
        ${COLUMN_HEADERS.map((header) => html`<th class="asset-table__th">${header}</th>`)}
      </tr>
    </thead>
  `;
}

// ─── Main Render Function ────────────────────────────────────────────────────

/**
 * 渲染企业能力资产表格。
 *
 * 验证需求：4.1–4.10, 17.5, 18.4, 18.5
 */
export function renderAssetTable(props: AssetTableProps): TemplateResult {
  const { items, loading, error, pagination, onInstallToRobot, onViewDetail } = props;

  let bodyContent: TemplateResult;

  if (loading) {
    bodyContent = renderSkeletonRows();
  } else if (error !== null) {
    bodyContent = renderErrorState(error);
  } else if (items.length === 0) {
    bodyContent = renderEmptyState();
  } else {
    bodyContent = html`${items.map((item) =>
      renderAssetTableRow(item, onInstallToRobot, onViewDetail),
    )}`;
  }

  // The table inline min-width and wrapper overflow-x are kept inline so the
  // existing visual-constraint tests (asserting `table.style.minWidth` and
  // `wrapper.style.overflowX`) continue to pass during migration. The CSS
  // class also enforces these so we have defense-in-depth.
  return html`
    <div class="asset-table-wrapper" style="overflow-x:auto">
      <table class="asset-table" style="min-width:${TABLE_MIN_WIDTH}" role="table">
        ${renderTableHeader()}
        <tbody class="asset-table__body">${bodyContent}</tbody>
      </table>
    </div>
    ${
      !loading
        ? renderPagination({
            currentPage: pagination.currentPage,
            pageSize: pagination.pageSize,
            totalItems: pagination.totalItems,
            totalLabel: `共 ${pagination.totalItems} 项能力资产`,
            onPageChange: props.onPageChange,
            onPageSizeChange: props.onPageSizeChange,
          })
        : nothing
    }
  `;
}
