/**
 * 查看全部能力页面（AllCapabilitiesPage）
 *
 * 企业能力中心"查看全部能力"页面壳层，组合三个子组件：
 *   - QuickEntrySidebar（左侧 200px 固定宽度侧边栏）
 *   - AssetFilterBar（右侧主内容区顶部筛选栏）
 *   - AssetTable（右侧主内容区数据表格 + 分页）
 *
 * 布局：
 * - 页面标题 "全部能力" + 返回按钮（← 返回企业能力中心）
 * - 水平两栏：左侧 QuickEntrySidebar（200px）+ 右侧主内容区（flex:1）
 * - 主内容区垂直：AssetFilterBar → AssetTable（含分页）
 *
 * 样式：使用 enterprise-foundation.css + enterprise-components.css 类体系。
 *
 * 验证需求：2.7, 3.6, 16.1–16.6, 19.6
 *
 * @module enterprise-asset-library/all-capabilities-page
 */

import { html, type TemplateResult } from "lit";
import type {
  AssetListFilters,
  EnterpriseAssetListItem,
  PaginationState,
  SidebarEntry,
} from "../../capability/enterprise-capability/types.ts";
import { renderAssetFilterBar } from "./asset-filter-bar.ts";
import { renderAssetTable } from "./asset-table.ts";
import { renderQuickEntrySidebar } from "./quick-entry-sidebar.ts";

// ─── Public Types ────────────────────────────────────────────────────────────

export type AllCapabilitiesPageProps = {
  /** 当前激活的侧边栏入口 */
  sidebarEntry: SidebarEntry;
  /** 侧边栏入口切换回调 */
  onSidebarEntryChange: (entry: SidebarEntry) => void;
  /** 筛选器当前状态 */
  filters: AssetListFilters;
  /** 可用使用场景列表（供筛选下拉） */
  availableScenarios: string[];
  /** 可用适用对象列表（供筛选下拉） */
  availableTargets: string[];
  /** 筛选器变更回调 */
  onFilterChange: <K extends keyof AssetListFilters>(key: K, value: AssetListFilters[K]) => void;
  /** 重置筛选器回调 */
  onReset: () => void;
  /** 能力资产列表数据 */
  items: EnterpriseAssetListItem[];
  /** 加载状态 */
  loading: boolean;
  /** 错误信息（null 表示无错误） */
  error: string | null;
  /** 分页状态 */
  pagination: PaginationState;
  /** 推送到岗位能力市场回调 */
  onInstallToRobot: (capabilityId: string) => void;
  /** 查看详情回调 */
  onViewDetail: (capabilityId: string) => void;
  /** 翻页回调 */
  onPageChange: (page: number) => void;
  /** 每页条数变更回调 */
  onPageSizeChange: (size: 10 | 20 | 50) => void;
  /** 返回上一页回调 */
  onBack: () => void;
};

/**
 * 渲染"查看全部能力"页面。
 *
 * **Validates: Requirements 2.7, 3.6, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 19.6**
 */
export function renderAllCapabilitiesPage(props: AllCapabilitiesPageProps): TemplateResult {
  return html`
    <div class="enterprise-page all-capabilities-page">
      <div class="enterprise-page__content">
        <header class="all-capabilities-page__header">
          <button
            type="button"
            class="all-capabilities-page__back-btn enterprise-back-btn"
            @click=${props.onBack}
            aria-label="返回企业能力中心"
          >
            ← 返回企业能力中心
          </button>
          <h1 class="all-capabilities-page__title">全部能力</h1>
        </header>

        <div class="all-capabilities-page__layout">
          ${renderQuickEntrySidebar({
            activeEntry: props.sidebarEntry,
            onEntryChange: props.onSidebarEntryChange,
          })}

          <main class="all-capabilities-page__main">
            ${renderAssetFilterBar({
              filters: props.filters,
              availableScenarios: props.availableScenarios,
              availableTargets: props.availableTargets,
              onFilterChange: props.onFilterChange,
              onReset: props.onReset,
            })}
            ${renderAssetTable({
              items: props.items,
              loading: props.loading,
              error: props.error,
              pagination: props.pagination,
              onInstallToRobot: props.onInstallToRobot,
              onViewDetail: props.onViewDetail,
              onPageChange: props.onPageChange,
              onPageSizeChange: props.onPageSizeChange,
            })}
          </main>
        </div>
      </div>
    </div>
  `;
}
