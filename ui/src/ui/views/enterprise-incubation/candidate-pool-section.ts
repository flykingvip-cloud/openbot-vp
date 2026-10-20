/**
 * 候选池概览与统计卡片（Candidate Pool Section）
 *
 * 孵化中心首屏区域，包含：
 * 1. 四个统计卡片：当前候选能力数、本月新增候选数、已推荐上报数、平台已通过数
 * 2. 筛选栏：能力领域筛选器 + 排序切换（calls30d / compositeScore）
 * 3. 骨架屏加载状态
 * 4. 空状态提示（无满足条件的候选能力）
 * 5. 超时错误 + 重试按钮（10s 超时）
 *
 * 验证需求：9.3, 9.4, 1.3, 1.4, 1.5, 1.6
 */

import { html, nothing, type TemplateResult } from "lit";
import type { CapabilityDomain } from "../../capability/enterprise-capability/types.ts";
import { CAPABILITY_DOMAINS } from "../../capability/enterprise-capability/types.ts";
import type { CandidateCapability } from "../../controllers/enterprise-incubation/index.ts";
import {
  INCUBATION_STATS_GRID,
  INCUBATION_STAT_CARD,
  INCUBATION_STAT_LABEL,
  INCUBATION_STAT_VALUE,
  INCUBATION_FILTER_BAR,
  INCUBATION_FILTER_SELECT,
  INCUBATION_SKELETON_CARD,
  INCUBATION_EMPTY_STATE,
  INCUBATION_EMPTY_TITLE,
  INCUBATION_EMPTY_DESCRIPTION,
  INCUBATION_BTN_PRIMARY,
} from "./shared/styles.css.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export type CandidatePoolStats = {
  totalCandidates: number;
  newThisMonth: number;
  recommendedCount: number;
  platformApprovedCount: number;
};

export type CandidatePoolSectionProps = {
  /** 统计数据 */
  stats: CandidatePoolStats | null;
  /** 候选能力列表 */
  candidates: CandidateCapability[];
  /** 是否正在加载 */
  loading: boolean;
  /** 错误信息（超时或其他错误） */
  error: string | null;
  /** 当前领域筛选 */
  domainFilter: CapabilityDomain | null;
  /** 当前排序方式 */
  sortBy: "calls30d" | "compositeScore";
  /** 领域筛选变更回调 */
  onDomainFilterChange: (domain: CapabilityDomain | null) => void;
  /** 排序方式变更回调 */
  onSortChange: (sortBy: "calls30d" | "compositeScore") => void;
  /** 重试回调 */
  onRetry: () => void;
};

// ─── 统计卡片配置 ─────────────────────────────────────────────────────────────

type StatCardConfig = {
  icon: string;
  label: string;
  key: keyof CandidatePoolStats;
};

const STAT_CARD_CONFIGS: readonly StatCardConfig[] = [
  { icon: "🎯", label: "当前候选能力数", key: "totalCandidates" },
  { icon: "🆕", label: "本月新增候选数", key: "newThisMonth" },
  { icon: "📤", label: "已推荐上报数", key: "recommendedCount" },
  { icon: "✅", label: "平台已通过数", key: "platformApprovedCount" },
] as const;

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/** 千位分隔符格式化 */
function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

// ─── 骨架屏 ──────────────────────────────────────────────────────────────────

function renderSkeletonStats(): TemplateResult {
  return html`
    <div class="${INCUBATION_STATS_GRID}" aria-busy="true" aria-label="统计数据加载中">
      <div class="${INCUBATION_SKELETON_CARD}"></div>
      <div class="${INCUBATION_SKELETON_CARD}"></div>
      <div class="${INCUBATION_SKELETON_CARD}"></div>
      <div class="${INCUBATION_SKELETON_CARD}"></div>
    </div>
  `;
}

// ─── 空状态 ──────────────────────────────────────────────────────────────────

function renderEmptyState(): TemplateResult {
  return html`
    <div class="${INCUBATION_EMPTY_STATE}" role="status">
      <span class="enterprise-incubation-empty__emoji" aria-hidden="true">📋</span>
      <p class="${INCUBATION_EMPTY_TITLE}">当前无满足晋升候选条件的能力</p>
      <p class="${INCUBATION_EMPTY_DESCRIPTION}">
        候选条件：成熟度达到"企业认证"及以上、近 30 天调用 ≥ 100 次、覆盖机器人 ≥ 2 台、成功率 ≥ 80%
      </p>
    </div>
  `;
}

// ─── 超时错误 ─────────────────────────────────────────────────────────────────

function renderErrorState(error: string, onRetry: () => void): TemplateResult {
  return html`
    <div
      class="enterprise-empty enterprise-incubation-error"
      role="alert"
    >
      <span class="enterprise-incubation-empty__emoji" aria-hidden="true">⚠️</span>
      <p class="${INCUBATION_EMPTY_TITLE}">${error}</p>
      <button
        type="button"
        class="${INCUBATION_BTN_PRIMARY}"
        @click=${onRetry}
      >
        重试
      </button>
    </div>
  `;
}

// ─── 统计卡片 ─────────────────────────────────────────────────────────────────

function renderStatCard(config: StatCardConfig, stats: CandidatePoolStats): TemplateResult {
  const value = stats[config.key];
  return html`
    <div class="${INCUBATION_STAT_CARD}">
      <span aria-hidden="true">${config.icon}</span>
      <span class="${INCUBATION_STAT_LABEL}">${config.label}</span>
      <span class="${INCUBATION_STAT_VALUE}">${formatNumber(value)}</span>
    </div>
  `;
}

function renderStatsGrid(stats: CandidatePoolStats): TemplateResult {
  return html`
    <div class="${INCUBATION_STATS_GRID}" aria-label="候选池统计概览">
      ${STAT_CARD_CONFIGS.map((config) => renderStatCard(config, stats))}
    </div>
  `;
}

// ─── 筛选栏 ──────────────────────────────────────────────────────────────────

function renderFilterBar(props: CandidatePoolSectionProps): TemplateResult {
  return html`
    <div class="${INCUBATION_FILTER_BAR}">
      <select
        class="${INCUBATION_FILTER_SELECT}"
        aria-label="按能力领域筛选"
        .value=${props.domainFilter ?? ""}
        @change=${(e: Event) => {
          const value = (e.target as HTMLSelectElement).value;
          props.onDomainFilterChange(value ? (value as CapabilityDomain) : null);
        }}
      >
        <option value="">全部领域</option>
        ${CAPABILITY_DOMAINS.map((domain) => html`<option value=${domain}>${domain}</option>`)}
      </select>

      <select
        class="${INCUBATION_FILTER_SELECT}"
        aria-label="排序方式"
        .value=${props.sortBy}
        @change=${(e: Event) => {
          const value = (e.target as HTMLSelectElement).value as "calls30d" | "compositeScore";
          props.onSortChange(value);
        }}
      >
        <option value="calls30d">按近 30 天调用量排序</option>
        <option value="compositeScore">按综合分排序</option>
      </select>
    </div>
  `;
}

// ─── 主渲染函数 ───────────────────────────────────────────────────────────────

/**
 * 渲染候选池概览区域。
 *
 * 状态处理：
 * - loading=true 且无数据：展示骨架屏
 * - error 非空：展示错误提示 + 重试按钮
 * - candidates 为空：展示空状态
 * - 正常：展示统计卡片 + 筛选栏
 *
 * **Validates: Requirements 9.3, 9.4, 1.3, 1.4, 1.5, 1.6**
 */
export function renderCandidatePoolSection(props: CandidatePoolSectionProps): TemplateResult {
  return html`
    <section class="enterprise-section enterprise-incubation-pool" aria-label="候选池概览">
      ${renderSectionContent(props)}
    </section>
  `;
}

function renderSectionContent(props: CandidatePoolSectionProps): TemplateResult {
  // Loading state: show skeleton screen (Requirement 1.4)
  if (props.loading && props.stats === null) {
    return renderSkeletonStats();
  }

  // Error state: show error + retry (Requirement 1.5)
  if (props.error !== null) {
    return renderErrorState(props.error, props.onRetry);
  }

  // Empty state: no candidates (Requirement 1.6)
  if (!props.loading && props.candidates.length === 0) {
    return html`
      ${props.stats !== null ? renderStatsGrid(props.stats) : nothing}
      ${renderFilterBar(props)}
      ${renderEmptyState()}
    `;
  }

  // Normal state: stats + filter bar (Requirements 9.3, 9.4)
  return html`
    ${props.stats !== null ? renderStatsGrid(props.stats) : nothing}
    ${renderFilterBar(props)}
  `;
}
