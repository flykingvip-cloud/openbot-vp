/**
 * 员工能力市场区段（Marketplace Section）
 *
 * 嵌入 Robot_Capability_Tab 的"探索更多能力"入口，员工可浏览并安装平台标准能力。
 *
 * 功能：
 * 1. 卡片网格布局展示可安装能力
 * 2. 标签筛选 + 名称搜索
 * 3. 安装流程（成功/失败反馈，3s 自动消失）
 * 4. 加载骨架屏
 * 5. 空状态提示
 * 6. "已安装"禁用状态
 * 7. 安装成功后"查看已安装能力"链接（Req 14.5）
 *
 * 验证需求：7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.1, 8.2, 8.3, 8.4, 8.5, 14.5
 *
 * @module marketplace-section
 */

import { html, nothing, type TemplateResult } from "lit";
import type { MarketplaceCapability } from "../../controllers/enterprise-incubation/marketplace.ts";
import { filterByTag, searchByName } from "../../controllers/enterprise-incubation/marketplace.ts";
import { renderMarketplaceCard } from "./marketplace-card.ts";
import {
  INCUBATION_SECTION_TITLE,
  INCUBATION_FILTER_BAR,
  INCUBATION_SEARCH_INPUT,
  INCUBATION_FILTER_SELECT,
  INCUBATION_EMPTY_STATE,
  INCUBATION_EMPTY_TITLE,
  INCUBATION_EMPTY_DESCRIPTION,
  INCUBATION_SKELETON_CARD,
  INCUBATION_GRID_3,
  INCUBATION_TEXT_LINK,
} from "./shared/styles.css.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export type MarketplaceSectionProps = {
  /** 能力列表（已经过投影处理） */
  capabilities: MarketplaceCapability[];
  /** 是否正在加载 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 当前标签筛选 */
  tagFilter: string | null;
  /** 当前搜索关键词 */
  searchQuery: string;
  /** 正在安装的 skillId */
  installingSkillId: string | null;
  /** 最近安装成功的 skillId（用于展示成功提示） */
  installSuccess: string | null;
  /** 安装失败的错误信息 */
  installError: string | null;
  /** 标签筛选变更回调 */
  onTagFilterChange: (tag: string | null) => void;
  /** 搜索关键词变更回调 */
  onSearchChange: (query: string) => void;
  /** 安装按钮点击回调 */
  onInstall: (skillId: string) => void;
  /** "查看已安装能力"链接点击回调（Req 14.5） */
  onNavigateToInstalled: () => void;
  /** 重试加载回调 */
  onRetry: () => void;
};

// ─── 样式常量 ─────────────────────────────────────────────────────────────────

/** 成功提示样式 */
const TOAST_SUCCESS_CLASS =
  "flex items-center gap-2 px-4 py-3 rounded-md bg-green-50 border border-green-200 text-sm text-green-700 mb-4";

/** 失败提示样式 */
const TOAST_ERROR_CLASS =
  "flex items-center gap-2 px-4 py-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-700 mb-4";

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

/**
 * 从能力列表中提取所有唯一的场景标签（用于筛选下拉）。
 */
function extractUniqueTags(capabilities: MarketplaceCapability[]): string[] {
  const tagSet = new Set<string>();
  for (const cap of capabilities) {
    for (const tag of cap.scenarioTags) {
      tagSet.add(tag);
    }
  }
  return [...tagSet].toSorted();
}

// ─── 骨架屏 ──────────────────────────────────────────────────────────────────

function renderSkeletonGrid(): TemplateResult {
  return html`
    <div class="${INCUBATION_GRID_3}" aria-busy="true" aria-label="能力列表加载中">
      <div class="${INCUBATION_SKELETON_CARD}" style="min-height:180px"></div>
      <div class="${INCUBATION_SKELETON_CARD}" style="min-height:180px"></div>
      <div class="${INCUBATION_SKELETON_CARD}" style="min-height:180px"></div>
      <div class="${INCUBATION_SKELETON_CARD}" style="min-height:180px"></div>
      <div class="${INCUBATION_SKELETON_CARD}" style="min-height:180px"></div>
      <div class="${INCUBATION_SKELETON_CARD}" style="min-height:180px"></div>
    </div>
  `;
}

// ─── 空状态 ──────────────────────────────────────────────────────────────────

function renderEmptyState(): TemplateResult {
  return html`
    <div class="${INCUBATION_EMPTY_STATE}" role="status">
      <span class="text-4xl mb-3 opacity-50" aria-hidden="true">🔍</span>
      <p class="${INCUBATION_EMPTY_TITLE}">当前无可安装的平台标准能力</p>
      <p class="${INCUBATION_EMPTY_DESCRIPTION}">
        平台标准能力经过认证验证，后续会有更多能力上线
      </p>
    </div>
  `;
}

// ─── 错误状态 ─────────────────────────────────────────────────────────────────

function renderErrorState(error: string, onRetry: () => void): TemplateResult {
  return html`
    <div
      class="flex flex-col items-center justify-center py-12 text-gray-500"
      role="alert"
    >
      <span class="text-4xl mb-3" aria-hidden="true">⚠️</span>
      <p class="text-base font-semibold text-gray-700 mb-2">${error}</p>
      <button
        type="button"
        class="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors cursor-pointer min-h-[32px]"
        @click=${onRetry}
      >
        重试
      </button>
    </div>
  `;
}

// ─── 安装反馈提示 ─────────────────────────────────────────────────────────────

function renderInstallSuccessToast(
  successSkillId: string,
  capabilities: MarketplaceCapability[],
  onNavigateToInstalled: () => void,
): TemplateResult {
  const cap = capabilities.find((c) => c.skillId === successSkillId);
  const name = cap?.name ?? "能力";
  return html`
    <div class="${TOAST_SUCCESS_CLASS}" role="status" aria-live="polite">
      <span aria-hidden="true">✅</span>
      <span>"${name}" 安装成功</span>
      <a
        class="${INCUBATION_TEXT_LINK}"
        href="#"
        @click=${(e: Event) => {
          e.preventDefault();
          onNavigateToInstalled();
        }}
        style="margin-left:auto;min-width:32px;min-height:32px;display:inline-flex;align-items:center"
      >查看已安装能力</a>
    </div>
  `;
}

function renderInstallErrorToast(error: string): TemplateResult {
  return html`
    <div class="${TOAST_ERROR_CLASS}" role="alert" aria-live="assertive">
      <span aria-hidden="true">❌</span>
      <span>安装未成功，请稍后重试</span>
      <span class="text-xs text-red-500 ml-2">${error}</span>
    </div>
  `;
}

// ─── 筛选栏 ──────────────────────────────────────────────────────────────────

function renderFilterBar(props: MarketplaceSectionProps): TemplateResult {
  const allTags = extractUniqueTags(props.capabilities);

  return html`
    <div class="${INCUBATION_FILTER_BAR}">
      <!-- 名称搜索 -->
      <input
        type="search"
        class="${INCUBATION_SEARCH_INPUT}"
        placeholder="搜索能力名称…"
        aria-label="按能力名称搜索"
        .value=${props.searchQuery}
        @input=${(e: Event) => {
          const value = (e.target as HTMLInputElement).value;
          props.onSearchChange(value);
        }}
        style="min-height:32px"
      />

      <!-- 标签筛选 -->
      <select
        class="${INCUBATION_FILTER_SELECT}"
        aria-label="按使用场景筛选"
        .value=${props.tagFilter ?? ""}
        @change=${(e: Event) => {
          const value = (e.target as HTMLSelectElement).value;
          props.onTagFilterChange(value || null);
        }}
        style="min-height:32px"
      >
        <option value="">全部场景</option>
        ${allTags.map((tag) => html`<option value=${tag}>${tag}</option>`)}
      </select>
    </div>
  `;
}

// ─── 卡片网格 ────────────────────────────────────────────────────────────────

function renderCardGrid(props: MarketplaceSectionProps): TemplateResult {
  // Apply filters
  let filtered = filterByTag(props.capabilities, props.tagFilter);
  filtered = searchByName(filtered, props.searchQuery);

  if (filtered.length === 0) {
    return html`
      <div class="${INCUBATION_EMPTY_STATE}" role="status">
        <span class="text-4xl mb-3 opacity-50" aria-hidden="true">📭</span>
        <p class="${INCUBATION_EMPTY_TITLE}">没有匹配的能力</p>
        <p class="${INCUBATION_EMPTY_DESCRIPTION}">
          尝试调整筛选条件或搜索关键词
        </p>
      </div>
    `;
  }

  return html`
    <div class="${INCUBATION_GRID_3}" role="list" aria-label="可安装能力列表">
      ${filtered.map(
        (cap) => html`
          <div role="listitem">
            ${renderMarketplaceCard({
              capability: cap,
              installingSkillId: props.installingSkillId,
              onInstall: props.onInstall,
            })}
          </div>
        `,
      )}
    </div>
  `;
}

// ─── 主渲染函数 ───────────────────────────────────────────────────────────────

/**
 * 渲染员工能力市场区段。
 *
 * 状态处理：
 * - loading=true：展示骨架屏（Req 7.6）
 * - error 非空：展示错误提示 + 重试按钮
 * - capabilities 为空：展示空状态（Req 7.7）
 * - 正常：展示筛选栏 + 卡片网格
 *
 * 安装反馈：
 * - installSuccess 非空：展示成功提示 + "查看已安装能力"链接（Req 8.2, 14.5）
 * - installError 非空：展示失败提示（Req 8.4）
 *
 * 验证需求：7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.1, 8.2, 8.3, 8.4, 8.5, 14.5
 */
export function renderMarketplaceSection(props: MarketplaceSectionProps): TemplateResult {
  return html`
    <section aria-label="探索更多能力" class="mt-6">
      <h2 class="${INCUBATION_SECTION_TITLE}">探索更多能力</h2>
      <p class="text-sm text-gray-500 mb-4">
        浏览经过平台认证的标准能力，一键安装到你的机器人
      </p>

      ${renderSectionContent(props)}
    </section>
  `;
}

function renderSectionContent(props: MarketplaceSectionProps): TemplateResult {
  // Loading state: skeleton grid (Req 7.6)
  if (props.loading) {
    return renderSkeletonGrid();
  }

  // Error state (Req 8.4 for install errors handled separately)
  if (props.error !== null) {
    return renderErrorState(props.error, props.onRetry);
  }

  // Empty state: no capabilities available (Req 7.7)
  if (props.capabilities.length === 0) {
    return renderEmptyState();
  }

  // Normal state: filter bar + feedback toasts + card grid
  return html`
    ${renderFilterBar(props)}

    <!-- Install feedback toasts (3s auto-dismiss handled by controller) -->
    ${
      props.installSuccess
        ? renderInstallSuccessToast(
            props.installSuccess,
            props.capabilities,
            props.onNavigateToInstalled,
          )
        : nothing
    }
    ${props.installError ? renderInstallErrorToast(props.installError) : nothing}

    ${renderCardGrid(props)}
  `;
}
