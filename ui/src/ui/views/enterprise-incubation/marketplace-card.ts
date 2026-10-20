/**
 * 员工能力市场卡片（Marketplace Card）
 *
 * 展示单个平台标准能力的核心信息：
 * - 能力名称
 * - 一句话描述
 * - 使用场景标签（最多 3 个）
 * - "平台认证"徽章（certified=true 时展示）
 * - 安装按钮（已安装时禁用，显示"已安装"）
 *
 * 无障碍：
 * - 所有交互元素最小点击区域 32×32px（Requirement 13.5）
 * - 安装按钮包含 aria-label 描述操作对象
 * - 卡片使用 article + aria-label 标识
 *
 * 验证需求：7.3, 7.8, 8.1, 8.5, 12.2, 13.5
 *
 * @module marketplace-card
 */

import { html, nothing, type TemplateResult } from "lit";
import type { MarketplaceCapability } from "../../controllers/enterprise-incubation/marketplace.ts";
import {
  INCUBATION_CARD,
  INCUBATION_BADGE_GREEN,
  INCUBATION_TEXT_MUTED,
} from "./shared/styles.css.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export type MarketplaceCardProps = {
  capability: MarketplaceCapability;
  /** 当前正在安装的 skillId（用于展示 loading 状态） */
  installingSkillId: string | null;
  /** 安装按钮点击回调 */
  onInstall: (skillId: string) => void;
};

// ─── 样式常量 ─────────────────────────────────────────────────────────────────

/** 场景标签样式 */
const TAG_CLASS =
  "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600";

/** 平台认证徽章样式 */
const CERTIFIED_BADGE_CLASS = INCUBATION_BADGE_GREEN;

/** 安装按钮（正常状态） */
const INSTALL_BTN_CLASS =
  "inline-flex items-center justify-center px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors cursor-pointer min-w-[80px] min-h-[32px]";

/** 安装按钮（已安装/禁用状态） */
const INSTALL_BTN_DISABLED_CLASS =
  "inline-flex items-center justify-center px-4 py-2 rounded-md text-sm font-medium text-gray-400 bg-gray-100 border border-gray-200 cursor-not-allowed min-w-[80px] min-h-[32px]";

/** 安装按钮（加载中状态） */
const INSTALL_BTN_LOADING_CLASS =
  "inline-flex items-center justify-center px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-400 cursor-wait min-w-[80px] min-h-[32px]";

// ─── 子渲染函数 ──────────────────────────────────────────────────────────────

/**
 * 渲染使用场景标签列表（最多 3 个）。
 */
function renderScenarioTags(tags: string[]): TemplateResult | typeof nothing {
  if (tags.length === 0) {
    return nothing;
  }
  return html`
    <div class="flex flex-wrap gap-1.5 mt-2" aria-label="使用场景">
      ${tags.map((tag) => html`<span class="${TAG_CLASS}">${tag}</span>`)}
    </div>
  `;
}

/**
 * 渲染平台认证徽章。
 */
function renderCertifiedBadge(certified: boolean): TemplateResult | typeof nothing {
  if (!certified) {
    return nothing;
  }
  return html`
    <span class="${CERTIFIED_BADGE_CLASS}" aria-label="平台认证能力">
      <svg
        class="w-3 h-3 mr-1"
        fill="currentColor"
        viewBox="0 0 20 20"
        aria-hidden="true"
      >
        <path
          fill-rule="evenodd"
          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
          clip-rule="evenodd"
        />
      </svg>
      平台认证
    </span>
  `;
}

/**
 * 渲染安装按钮。
 * - installed=true → 禁用，显示"已安装"
 * - installingSkillId 匹配 → 加载中
 * - 正常 → 可点击安装
 */
function renderInstallButton(props: MarketplaceCardProps): TemplateResult {
  const { capability, installingSkillId, onInstall } = props;
  const isInstalling = installingSkillId === capability.skillId;

  if (capability.installed) {
    return html`
      <button
        type="button"
        class="${INSTALL_BTN_DISABLED_CLASS}"
        disabled
        aria-label="已安装能力：${capability.name}"
        aria-disabled="true"
      >
        已安装
      </button>
    `;
  }

  if (isInstalling) {
    return html`
      <button
        type="button"
        class="${INSTALL_BTN_LOADING_CLASS}"
        disabled
        aria-label="正在安装能力：${capability.name}"
        aria-busy="true"
      >
        <span class="inline-block w-4 h-4 mr-1.5 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
        安装中
      </button>
    `;
  }

  return html`
    <button
      type="button"
      class="${INSTALL_BTN_CLASS}"
      aria-label="安装能力：${capability.name}"
      @click=${() => onInstall(capability.skillId)}
    >
      安装
    </button>
  `;
}

// ─── 主渲染函数 ───────────────────────────────────────────────────────────────

/**
 * 渲染员工能力市场卡片。
 *
 * 卡片内容：
 * - 能力名称 + 平台认证徽章
 * - 一句话描述
 * - 使用场景标签（最多 3 个）
 * - 安装按钮（已安装时禁用）
 *
 * 验证需求：7.3, 7.8, 8.1, 8.5, 12.2, 13.5
 */
export function renderMarketplaceCard(props: MarketplaceCardProps): TemplateResult {
  const { capability } = props;

  return html`
    <article
      class="${INCUBATION_CARD}"
      style="display:flex;flex-direction:column;justify-content:space-between;min-height:180px"
      aria-label="能力：${capability.name}"
    >
      <!-- 卡片头部：名称 + 认证徽章 -->
      <div>
        <div class="flex items-start justify-between gap-2 mb-2">
          <h3 class="text-sm font-semibold text-gray-900 m-0 leading-tight">
            ${capability.name}
          </h3>
          ${renderCertifiedBadge(capability.certified)}
        </div>

        <!-- 一句话描述 -->
        <p class="${INCUBATION_TEXT_MUTED}" style="margin:0 0 8px 0;line-height:1.4">
          ${capability.description}
        </p>

        <!-- 使用场景标签 -->
        ${renderScenarioTags(capability.scenarioTags)}
      </div>

      <!-- 安装按钮 -->
      <div class="mt-3 flex justify-end">
        ${renderInstallButton(props)}
      </div>
    </article>
  `;
}
