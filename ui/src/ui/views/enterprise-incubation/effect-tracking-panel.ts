import { html, nothing, type TemplateResult } from "lit";
import { type EffectComparison } from "../../controllers/enterprise-incubation/effect-tracking.ts";
import {
  INCUBATION_CARD_FLAT,
  INCUBATION_SECTION_TITLE,
  INCUBATION_FLEX_BETWEEN,
  INCUBATION_FLEX_COL,
  INCUBATION_GRID_3,
  INCUBATION_STAT_CARD,
  INCUBATION_STAT_LABEL,
  INCUBATION_STAT_VALUE,
  INCUBATION_STAT_CHANGE_POSITIVE,
  INCUBATION_STAT_CHANGE_NEGATIVE,
  INCUBATION_TEXT_MUTED,
  INCUBATION_TEXT_LINK,
  INCUBATION_BADGE_BLUE,
} from "./shared/styles.css.ts";

/**
 * EffectTrackingPanel 组件属性。
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 14.6
 */
export type EffectTrackingPanelProps = {
  /** 能力 ID */
  capabilityId: string;
  /** 效果对比数据 */
  comparison: EffectComparison | null;
  /** 每日调用量趋势数据（60 天：晋升前 30 天 + 晋升后 30 天） */
  dailyTrend: { date: string; calls: number }[];
  /** 晋升日期（ISO 格式） */
  promotionDate: string | null;
  /** 数据加载中 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** "查看平台审批状态"点击回调（Requirement 14.6） */
  onNavigateToProposalStatus?: (capabilityId: string) => void;
};

/**
 * 渲染效果追踪面板。
 *
 * 包含晋升前后对比展示、折线图趋势可视化、下降警告、追踪中标注。
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 14.6**
 */
export function renderEffectTrackingPanel(props: EffectTrackingPanelProps): TemplateResult {
  const { comparison, dailyTrend, promotionDate, loading, error } = props;

  if (loading) {
    return html`
      <section class="${INCUBATION_CARD_FLAT}" aria-label="效果追踪面板">
        <h3 class="${INCUBATION_SECTION_TITLE}">效果追踪</h3>
        <div class="animate-pulse space-y-4">
          <div class="h-6 bg-gray-200 rounded w-1/3"></div>
          <div class="grid grid-cols-3 gap-4">
            <div class="h-20 bg-gray-200 rounded"></div>
            <div class="h-20 bg-gray-200 rounded"></div>
            <div class="h-20 bg-gray-200 rounded"></div>
          </div>
          <div class="h-48 bg-gray-200 rounded"></div>
        </div>
      </section>
    `;
  }

  if (error) {
    return html`
      <section class="${INCUBATION_CARD_FLAT}" aria-label="效果追踪面板">
        <h3 class="${INCUBATION_SECTION_TITLE}">效果追踪</h3>
        <p class="text-sm text-red-600" role="alert">${error}</p>
      </section>
    `;
  }

  if (!comparison) {
    return html`
      <section class="${INCUBATION_CARD_FLAT}" aria-label="效果追踪面板">
        <h3 class="${INCUBATION_SECTION_TITLE}">效果追踪</h3>
        <p class="${INCUBATION_TEXT_MUTED}">暂无效果追踪数据</p>
      </section>
    `;
  }

  return html`
    <section class="${INCUBATION_CARD_FLAT}" aria-label="效果追踪面板">
      <div class="${INCUBATION_FLEX_BETWEEN} mb-4">
        <h3 class="${INCUBATION_SECTION_TITLE} !mb-0">效果追踪</h3>
        <div class="flex items-center gap-3">
          ${renderTrackingStatus(comparison)}
          ${renderProposalStatusLink(props)}
        </div>
      </div>

      <!-- 下降警告 (Requirement 4.4) -->
      ${renderDeclineWarning(comparison)}

      <!-- 前后对比 (Requirement 4.2) -->
      ${renderBeforeAfterComparison(comparison)}

      <!-- 折线图 (Requirement 4.3) -->
      ${renderTrendChart(dailyTrend, promotionDate)}
    </section>
  `;
}

/**
 * 渲染追踪状态标注。
 * 当晋升后数据不足 30 天时，标注"追踪中"（Requirement 4.6）。
 */
function renderTrackingStatus(comparison: EffectComparison): TemplateResult | typeof nothing {
  if (comparison.isTrackingComplete) {
    return nothing;
  }
  const remainingDays = 30 - comparison.trackingDaysAfter;
  return html`
    <span class="${INCUBATION_BADGE_BLUE}" role="status" aria-label="追踪中">
      追踪中，数据将在 ${remainingDays} 天后完整
    </span>
  `;
}

/**
 * 渲染"查看平台审批状态"链接（Requirement 14.6）。
 */
function renderProposalStatusLink(
  props: EffectTrackingPanelProps,
): TemplateResult | typeof nothing {
  if (!props.onNavigateToProposalStatus) {
    return nothing;
  }
  return html`
    <button
      type="button"
      class="${INCUBATION_TEXT_LINK}"
      @click="${() => props.onNavigateToProposalStatus!(props.capabilityId)}"
      aria-label="查看平台审批状态"
    >
      查看平台审批状态 →
    </button>
  `;
}

/**
 * 渲染效果下降警告（Requirement 4.4）。
 * 当调用量或覆盖机器人数下降超过 20% 时展示警告。
 */
function renderDeclineWarning(comparison: EffectComparison): TemplateResult | typeof nothing {
  if (!comparison.hasDeclineWarning) {
    return nothing;
  }

  const warnings: string[] = [];
  if (comparison.callsDeclineRate < -0.2) {
    const pct = Math.abs(Math.round(comparison.callsDeclineRate * 100));
    warnings.push(`调用量下降 ${pct}%`);
  }
  if (comparison.deptDeclineRate < -0.2) {
    const pct = Math.abs(Math.round(comparison.deptDeclineRate * 100));
    warnings.push(`覆盖机器人数下降 ${pct}%`);
  }

  return html`
    <div
      class="flex items-start gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-md"
      role="alert"
      aria-label="效果下降警告"
    >
      <span class="text-red-500 flex-shrink-0" aria-hidden="true">⚠</span>
      <div class="${INCUBATION_FLEX_COL} gap-1">
        <span class="text-sm font-medium text-red-700">效果下降警告</span>
        <span class="text-xs text-red-600">
          晋升后 30 天内：${warnings.join("、")}，超过 20% 阈值
        </span>
      </div>
    </div>
  `;
}

/**
 * 渲染晋升前后对比数据（Requirement 4.2）。
 * 展示调用次数、覆盖机器人数、成功率的前后对比。
 */
function renderBeforeAfterComparison(comparison: EffectComparison): TemplateResult {
  return html`
    <div class="${INCUBATION_GRID_3} mb-6" role="group" aria-label="晋升前后对比">
      ${renderComparisonCard(
        "平均调用次数",
        comparison.before30dAvgCalls,
        comparison.after30dAvgCalls,
        comparison.callsDeclineRate,
        formatNumber,
      )}
      ${renderComparisonCard(
        "覆盖机器人数",
        comparison.before30dDeptCount,
        comparison.after30dDeptCount,
        comparison.deptDeclineRate,
        formatNumber,
      )}
      ${renderComparisonCard(
        "成功率",
        comparison.before30dSuccessRate,
        comparison.after30dSuccessRate,
        comparison.after30dSuccessRate - comparison.before30dSuccessRate,
        formatPercent,
      )}
    </div>
  `;
}

/**
 * 渲染单个对比卡片。
 */
function renderComparisonCard(
  label: string,
  before: number,
  after: number,
  changeRate: number,
  formatter: (v: number) => string,
): TemplateResult {
  const isPositive = changeRate >= 0;
  const changeClass = isPositive
    ? INCUBATION_STAT_CHANGE_POSITIVE
    : INCUBATION_STAT_CHANGE_NEGATIVE;
  const changePrefix = isPositive ? "+" : "";
  const changePct = Math.round(Math.abs(changeRate) * 100);

  return html`
    <div class="${INCUBATION_STAT_CARD}" aria-label="${label}对比">
      <span class="${INCUBATION_STAT_LABEL}">${label}</span>
      <div class="flex items-baseline gap-2">
        <span class="${INCUBATION_STAT_VALUE}">${formatter(after)}</span>
        <span class="${changeClass}">
          ${changePrefix}${isPositive ? "" : "-"}${changePct}%
        </span>
      </div>
      <span class="${INCUBATION_TEXT_MUTED}">
        晋升前：${formatter(before)}
      </span>
    </div>
  `;
}

/**
 * 渲染 SVG 折线图（Requirement 4.3）。
 * 展示晋升前后 60 天的调用量趋势，晋升时间点以竖线标记。
 */
function renderTrendChart(
  dailyTrend: { date: string; calls: number }[],
  promotionDate: string | null,
): TemplateResult {
  if (dailyTrend.length === 0) {
    return html`
      <div class="py-8 text-center ${INCUBATION_TEXT_MUTED}">暂无趋势数据</div>
    `;
  }

  const chartWidth = 720;
  const chartHeight = 200;
  const paddingX = 40;
  const paddingY = 24;
  const plotWidth = chartWidth - paddingX * 2;
  const plotHeight = chartHeight - paddingY * 2;

  const maxCalls = Math.max(...dailyTrend.map((d) => d.calls), 1);
  const minCalls = 0;
  const range = maxCalls - minCalls || 1;

  // Build polyline points
  const points = dailyTrend.map((d, i) => {
    const x = paddingX + (i / Math.max(dailyTrend.length - 1, 1)) * plotWidth;
    const y = paddingY + plotHeight - ((d.calls - minCalls) / range) * plotHeight;
    return `${x},${y}`;
  });
  const polylinePoints = points.join(" ");

  // Find promotion date x position
  let promotionX: number | null = null;
  if (promotionDate) {
    const promoIdx = dailyTrend.findIndex((d) => d.date === promotionDate);
    if (promoIdx >= 0) {
      promotionX = paddingX + (promoIdx / Math.max(dailyTrend.length - 1, 1)) * plotWidth;
    }
  }

  // Y-axis labels
  const yLabels = [0, Math.round(maxCalls / 2), maxCalls];

  return html`
    <div class="${INCUBATION_FLEX_COL} gap-2">
      <span class="text-sm font-medium text-gray-700">调用量趋势（60 天）</span>
      <div class="overflow-x-auto">
        <svg
          viewBox="0 0 ${chartWidth} ${chartHeight}"
          class="w-full max-w-[720px] h-auto"
          role="img"
          aria-label="晋升前后 60 天调用量趋势折线图"
        >
          <!-- Y-axis grid lines and labels -->
          ${yLabels.map((val) => {
            const y = paddingY + plotHeight - ((val - minCalls) / range) * plotHeight;
            return html`
              <line
                x1="${paddingX}"
                y1="${y}"
                x2="${paddingX + plotWidth}"
                y2="${y}"
                stroke="#e5e7eb"
                stroke-width="1"
              />
              <text
                x="${paddingX - 8}"
                y="${y + 4}"
                text-anchor="end"
                class="text-[10px] fill-gray-400"
              >
                ${val}
              </text>
            `;
          })}

          <!-- Trend line -->
          <polyline
            points="${polylinePoints}"
            fill="none"
            stroke="#2563eb"
            stroke-width="2"
            stroke-linejoin="round"
            stroke-linecap="round"
          />

          <!-- Promotion date vertical marker -->
          ${
            promotionX !== null
              ? html`
                <line
                  x1="${promotionX}"
                  y1="${paddingY}"
                  x2="${promotionX}"
                  y2="${paddingY + plotHeight}"
                  stroke="#f59e0b"
                  stroke-width="2"
                  stroke-dasharray="4 3"
                />
                <text
                  x="${promotionX}"
                  y="${paddingY - 6}"
                  text-anchor="middle"
                  class="text-[10px] fill-amber-600 font-medium"
                >
                  晋升
                </text>
              `
              : nothing
          }

          <!-- X-axis labels (first, middle, last) -->
          ${
            dailyTrend.length > 0
              ? html`
                <text
                  x="${paddingX}"
                  y="${chartHeight - 4}"
                  text-anchor="start"
                  class="text-[10px] fill-gray-400"
                >
                  ${dailyTrend[0].date}
                </text>
                <text
                  x="${paddingX + plotWidth}"
                  y="${chartHeight - 4}"
                  text-anchor="end"
                  class="text-[10px] fill-gray-400"
                >
                  ${dailyTrend[dailyTrend.length - 1].date}
                </text>
              `
              : nothing
          }
        </svg>
      </div>
      <div class="flex items-center gap-4 ${INCUBATION_TEXT_MUTED}">
        <span class="flex items-center gap-1">
          <span class="inline-block w-3 h-0.5 bg-blue-600" aria-hidden="true"></span>
          调用量
        </span>
        ${
          promotionDate
            ? html`
                <span class="flex items-center gap-1">
                  <span class="inline-block w-3 h-0.5 bg-amber-500 border-dashed" aria-hidden="true"></span>
                  晋升时间点
                </span>
              `
            : nothing
        }
      </div>
    </div>
  `;
}

// ─── 格式化工具 ──────────────────────────────────────────────────────────────

function formatNumber(value: number): string {
  if (value >= 10000) {
    return `${(value / 10000).toFixed(1)}万`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return String(Math.round(value));
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
