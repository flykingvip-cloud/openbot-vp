/**
 * 企业能力概览（CapabilityOverview）—— 企业能力中心首屏。
 *
 * 包含：
 * 1. 页面标题 "企业能力中心" + info 图标
 * 2. 副标题描述
 * 3. 右对齐操作按钮："能力贡献记录"（次要）、"能力安装管理"（主要）
 * 4. 统计仪表盘：5 张水平排列的指标卡片
 *
 * 状态处理：
 * - Loading：骨架屏占位（灰色动画条）
 * - Error：错误提示 + 重试按钮；若有缓存数据则展示缓存 + 更新时间
 * - Success：完整数据展示
 *
 * 样式：使用 enterprise-components.css 的 .capability-overview 类体系，响应主题。
 *
 * 验证需求：2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6
 */

import { html, nothing, type TemplateResult } from "lit";
import type { StatisticsDashboardData } from "../../capability/enterprise-capability/types.ts";
import { renderIcon, type IconName } from "../../icons.ts";

export type CapabilityOverviewProps = {
  stats: StatisticsDashboardData | null;
  statsLoading: boolean;
  statsError: string | null;
  lastSuccessfulLoadAt: number | null;
  onRefreshStats: () => void;
  onNavigateContributionRecords: () => void;
  onNavigateInstallManagement: () => void;
  onNavigateReviewQueue?: (() => void) | null;
  showHeader?: boolean;
  /** 紧凑模式：用于嵌入能力中心概况区（更小卡片、隐藏环比徽章）。 */
  compact?: boolean;
};

/** 统计卡片配置 */
type StatCardConfig = {
  icon: IconName;
  label: string;
  valueKey: keyof Omit<StatisticsDashboardData, "changes" | "updatedAt">;
  changeKey: keyof StatisticsDashboardData["changes"];
  /** 变化描述前缀 */
  changePrefix: string;
};

const STAT_CARDS: readonly StatCardConfig[] = [
  {
    icon: "layers",
    label: "能力总数",
    valueKey: "totalCapabilities",
    changeKey: "totalCapabilities",
    changePrefix: "较上周",
  },
  {
    icon: "checkCircle",
    label: "已发布能力",
    valueKey: "publishedCapabilities",
    changeKey: "publishedCapabilities",
    changePrefix: "较上周",
  },
  {
    icon: "users",
    label: "覆盖员工数",
    valueKey: "coveredEmployees",
    changeKey: "coveredEmployees",
    changePrefix: "较上月",
  },
  {
    icon: "cpu",
    label: "覆盖机器人数",
    valueKey: "coveredRobots",
    changeKey: "coveredRobots",
    changePrefix: "较上周",
  },
  {
    icon: "activity",
    label: "本月使用次数",
    valueKey: "monthlyUsageCount",
    changeKey: "monthlyUsageCount",
    changePrefix: "较上月",
  },
] as const;

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/** 千位分隔符格式化 */
function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

/** 格式化时间戳为 YYYY-MM-DD HH:mm */
function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 格式化变化指标文本 */
function formatChange(change: { value: number; type: "absolute" | "percentage" }): {
  text: string;
  tone: "positive" | "negative" | "neutral";
} {
  const { value, type } = change;

  if (value === 0) {
    return { text: "持平", tone: "neutral" };
  }

  const abs = Math.abs(value);
  const arrow = value > 0 ? "↑" : "↓";
  const sign = value > 0 ? "+" : "-";
  const suffix = type === "percentage" ? "%" : "";
  const tone = value > 0 ? "positive" : "negative";

  return { text: `${sign}${abs}${suffix} ${arrow}`, tone };
}

// ─── Info 图标 ────────────────────────────────────────────────────────────────

const INFO_ICON_CLASS = "capability-overview__info-svg";

// ─── 骨架屏 ───────────────────────────────────────────────────────────────────

function renderSkeletonCard(): TemplateResult {
  return html`
    <div class="capability-overview__card capability-overview__card--skeleton">
      <div class="capability-overview__skeleton-bar capability-overview__skeleton-bar--icon"></div>
      <div class="capability-overview__skeleton-bar capability-overview__skeleton-bar--label"></div>
      <div class="capability-overview__skeleton-bar capability-overview__skeleton-bar--value"></div>
      <div class="capability-overview__skeleton-bar capability-overview__skeleton-bar--change"></div>
    </div>
  `;
}

function renderSkeletonDashboard(): TemplateResult {
  return html`
    <div
      class="capability-overview__dashboard capability-overview__dashboard--loading"
    >
      ${renderSkeletonCard()}
      ${renderSkeletonCard()}
      ${renderSkeletonCard()}
      ${renderSkeletonCard()}
      ${renderSkeletonCard()}
    </div>
  `;
}

// ─── 错误状态 ──────────────────────────────────────────────────────────────────

function renderErrorState(props: CapabilityOverviewProps): TemplateResult {
  return html`
    <div class="capability-overview__error">
      <p class="capability-overview__error-text">
        ${props.statsError ?? "数据加载失败"}
      </p>
      <button
        class="capability-overview__retry-btn enterprise-btn enterprise-btn--primary"
        @click=${props.onRefreshStats}
        type="button"
      >
        重试
      </button>
      ${
        props.lastSuccessfulLoadAt !== null
          ? html`<p class="capability-overview__cache-hint">
            数据更新时间：${formatTimestamp(props.lastSuccessfulLoadAt)}
          </p>`
          : nothing
      }
    </div>
  `;
}

// ─── 统计卡片 ──────────────────────────────────────────────────────────────────

function renderStatCard(
  config: StatCardConfig,
  stats: StatisticsDashboardData,
  compact: boolean,
): TemplateResult {
  const value = stats[config.valueKey];
  const change = stats.changes[config.changeKey];
  const { text: changeText, tone } = formatChange(change);

  const changeLabel = change.value === 0 ? changeText : `${config.changePrefix} ${changeText}`;

  return html`
    <div class="capability-overview__card">
      ${renderIcon(config.icon, "capability-overview__card-icon")}
      <span class="capability-overview__card-label">${config.label}</span>
      <span class="capability-overview__card-value">${formatNumber(value)}</span>
      ${
        compact
          ? nothing
          : html`<span
              class="capability-overview__card-change capability-overview__card-change--${tone}"
            >
              ${changeLabel}
            </span>`
      }
    </div>
  `;
}

function renderStatsDashboard(stats: StatisticsDashboardData, compact: boolean): TemplateResult {
  return html`
    <div class="capability-overview__dashboard">
      ${STAT_CARDS.map((config) => renderStatCard(config, stats, compact))}
    </div>
  `;
}

// ─── 主渲染函数 ───────────────────────────────────────────────────────────────

/**
 * 渲染企业能力概览（首屏）。
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6**
 */
export function renderCapabilityOverview(props: CapabilityOverviewProps): TemplateResult {
  return html`
    <section
      class="capability-overview ${props.compact ? "capability-overview--compact" : ""}"
      aria-label="企业能力概览"
    >
      ${props.showHeader === false ? nothing : renderCapabilityOverviewHeader(props)}
      ${renderDashboardContent(props)}
    </section>
  `;
}

export function renderCapabilityOverviewHeader(props: CapabilityOverviewProps): TemplateResult {
  return html`
    <header class="capability-overview__header">
      <div class="capability-overview__copy">
        <div class="capability-overview__eyebrow">能力概览</div>
        <div class="capability-overview__title-row">
          <h1 class="capability-overview__title">企业能力中心</h1>
          <span class="capability-overview__info-icon">${renderIcon("info", INFO_ICON_CLASS)}</span>
        </div>
        <p class="capability-overview__subtitle">
          查看当前能力资产规模、覆盖范围与使用活跃度，适合先做全局判断，再进入安装与贡献管理。
        </p>
      </div>
      <div class="capability-overview__actions">
        ${
          props.onNavigateReviewQueue
            ? html`
                <button
                  class="capability-overview__btn enterprise-btn enterprise-btn--ghost"
                  @click=${props.onNavigateReviewQueue}
                  type="button"
                >
                  审核队列
                </button>
              `
            : nothing
        }
        <button
          class="capability-overview__btn capability-overview__btn--secondary enterprise-btn enterprise-btn--secondary"
          @click=${props.onNavigateContributionRecords}
          type="button"
        >
          能力贡献记录
        </button>
        <button
          class="capability-overview__btn capability-overview__btn--primary enterprise-btn enterprise-btn--primary"
          @click=${props.onNavigateInstallManagement}
          type="button"
        >
          能力安装管理
        </button>
      </div>
    </header>
  `;
}

/**
 * 根据加载状态选择仪表盘内容：loading / error（含缓存回退）/ success。
 */
function renderDashboardContent(props: CapabilityOverviewProps): TemplateResult {
  const compact = props.compact === true;
  if (props.statsLoading && props.stats === null) {
    return renderSkeletonDashboard();
  }

  if (props.statsError !== null && props.stats === null) {
    return renderErrorState(props);
  }

  if (props.statsError !== null && props.stats !== null) {
    return html`
      ${renderStatsDashboard(props.stats, compact)}
      <div class="capability-overview__stale-notice">
        <p class="capability-overview__cache-hint">
          数据更新时间：${formatTimestamp(props.lastSuccessfulLoadAt ?? props.stats.updatedAt)}
        </p>
        <button
          class="capability-overview__retry-btn capability-overview__retry-btn--inline"
          @click=${props.onRefreshStats}
          type="button"
        >
          重试
        </button>
      </div>
    `;
  }

  if (props.stats !== null) {
    return renderStatsDashboard(props.stats, compact);
  }

  return renderSkeletonDashboard();
}
