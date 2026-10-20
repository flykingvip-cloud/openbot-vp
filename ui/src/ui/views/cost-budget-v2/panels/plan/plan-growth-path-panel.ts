import { html, nothing, svg, type TemplateResult } from "lit";
import { t } from "../../../../../i18n/index.ts";
import type {
  CommercialOrderDetail,
  SubscriptionGetResponse,
} from "../../../../capability/cost-budget-billing/index.ts";
import type { OperationsStoreState } from "../../stores/operations-store.ts";
import {
  buildPlanGrowthPathContext,
  expandSeriesToChartWindow,
  fmtChartAxisDate,
  growthDeltaLabel,
  PLAN_GROWTH_CHART_WINDOW_PRESETS,
  resolveGrowthChartWindow,
  type PlanGrowthChartWindow,
  type PlanGrowthChartWindowPreset,
  type PlanGrowthMetricId,
  type PlanGrowthPathContext,
  type PlanGrowthTrendPoint,
} from "./plan-growth-path.ts";

export type PlanGrowthPathPanelOptions = {
  subscription: SubscriptionGetResponse;
  operations: OperationsStoreState;
  orders: readonly CommercialOrderDetail[];
  onRefresh?: () => void;
};

let activeGrowthMetric: PlanGrowthMetricId = "bots";
let activeChartWindowPreset: PlanGrowthChartWindowPreset = "subscription";

function chartWindowPresetLabel(preset: PlanGrowthChartWindowPreset): string {
  return t(`costBudget.v2.myPlan.growthPath.windowPresets.${preset}`);
}

function chartPointX(
  at: string,
  window: PlanGrowthChartWindow,
  width: number,
  padding: { left: number; right: number },
): number {
  const innerW = width - padding.left - padding.right;
  const startMs = Date.parse(window.startAt);
  const endMs = Date.parse(window.endAt);
  const pointMs = Date.parse(at);
  const span = Math.max(endMs - startMs, 1);
  const ratio = Math.max(0, Math.min(1, (pointMs - startMs) / span));
  return padding.left + ratio * innerW;
}

function chartModeHint(
  series: PlanGrowthPathContext["seriesByMetric"][PlanGrowthMetricId],
): string {
  return series.mode === "billing_cycle_usage"
    ? t("costBudget.v2.myPlan.growthPath.chartModeCredits")
    : t("costBudget.v2.myPlan.growthPath.chartModeEntitlement");
}

function buildLinePath(
  points: readonly PlanGrowthTrendPoint[],
  window: PlanGrowthChartWindow,
  width: number,
  height: number,
  padding: { top: number; right: number; bottom: number; left: number },
): string {
  if (points.length === 0) {
    return "";
  }
  const innerH = height - padding.top - padding.bottom;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  if (points.length === 1) {
    const x = chartPointX(points[0].at, window, width, padding);
    const y = padding.top + innerH / 2;
    return `M ${padding.left} ${y} L ${padding.left + (width - padding.left - padding.right)} ${y} M ${x} ${y}`;
  }

  return points
    .map((point, index) => {
      const x = chartPointX(point.at, window, width, padding);
      const normalized = (point.value - min) / range;
      const y = padding.top + innerH * (1 - normalized);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function buildAreaPath(
  linePath: string,
  points: readonly PlanGrowthTrendPoint[],
  window: PlanGrowthChartWindow,
  width: number,
  height: number,
  padding: { bottom: number; left: number; right: number },
): string {
  if (!linePath || points.length === 0) {
    return "";
  }
  const innerW = width - padding.left - padding.right;
  const lastX =
    points.length === 1
      ? padding.left + innerW / 2
      : chartPointX(points[points.length - 1].at, window, width, padding);
  const baseY = height - padding.bottom;
  const firstX =
    points.length === 1
      ? padding.left + innerW / 2
      : chartPointX(points[0].at, window, width, padding);
  return `${linePath} L ${lastX.toFixed(2)} ${baseY} L ${firstX} ${baseY} Z`;
}

function renderGrowthChart(
  series: PlanGrowthPathContext["seriesByMetric"][PlanGrowthMetricId],
  window: PlanGrowthChartWindow,
  context: PlanGrowthPathContext,
  metricId: PlanGrowthMetricId,
  subscription: SubscriptionGetResponse,
): TemplateResult {
  const points = expandSeriesToChartWindow(series.points, window, {
    mode: series.mode,
    metricId,
    milestones: context.milestones,
    subscription,
  });
  if (points.length === 0) {
    const emptyKey =
      series.mode === "billing_cycle_usage"
        ? "costBudget.v2.myPlan.growthPath.creditsChartEmpty"
        : "costBudget.v2.myPlan.growthPath.chartEmpty";
    return html`
      <div class="cost-budget-v2-growth-path__chart-empty" data-testid="plan-growth-chart-empty">
        ${t(emptyKey)}
      </div>
    `;
  }

  const width = 480;
  const height = 200;
  const padding = { top: 16, right: 12, bottom: 28, left: 12 };
  const linePath = buildLinePath(points, window, width, height, padding);
  const areaPath = buildAreaPath(linePath, points, window, width, height, padding);
  const delta = growthDeltaLabel(points, { mode: series.mode });
  const latest = points[points.length - 1];
  const chartValue =
    series.mode === "billing_cycle_usage" && latest?.quota != null && latest.quota > 0
      ? `${latest.value} / ${latest.quota}`
      : String(latest?.value ?? 0);

  return html`
    <div class="cost-budget-v2-growth-path__chart" data-testid="plan-growth-chart">
      <p class="cost-budget-v2-growth-path__chart-mode" data-testid="plan-growth-chart-mode">
        ${chartModeHint(series)}
      </p>
      <div class="cost-budget-v2-growth-path__chart-meta">
        <div>
          <span class="cost-budget-v2-growth-path__chart-value">${chartValue}</span>
          <span class="cost-budget-v2-growth-path__chart-unit">${series.unit}</span>
          ${series.detail ? html`<span class="cost-budget-v2-growth-path__chart-detail">${series.detail}</span>` : nothing}
        </div>
        ${delta ? html`<span class="cost-budget-v2-growth-path__chart-delta">${delta}</span>` : nothing}
      </div>
      <svg
        class="cost-budget-v2-growth-path__chart-svg"
        viewBox="0 0 ${width} ${height}"
        role="img"
        aria-label=${series.label}
      >
        <path class="cost-budget-v2-growth-path__chart-area" d=${areaPath}></path>
        <path class="cost-budget-v2-growth-path__chart-line" d=${linePath}></path>
        ${points.map((point) => {
          const innerH = height - padding.top - padding.bottom;
          const x = chartPointX(point.at, window, width, padding);
          const values = points.map((entry) => entry.value);
          const min = Math.min(...values);
          const max = Math.max(...values);
          const range = max - min || 1;
          const y = padding.top + innerH * (1 - (point.value - min) / range);
          return svg`<circle class="cost-budget-v2-growth-path__chart-dot" cx=${x} cy=${y} r="3.5"></circle>`;
        })}
      </svg>
      <div class="cost-budget-v2-growth-path__chart-axis" data-testid="plan-growth-chart-axis">
        <span>${fmtChartAxisDate(window.startAt, window)}</span>
        <span>${fmtChartAxisDate(window.endAt, window)}</span>
      </div>
    </div>
  `;
}

function selectGrowthMetric(id: PlanGrowthMetricId, onRefresh?: () => void): void {
  activeGrowthMetric = id;
  onRefresh?.();
}

function selectChartWindowPreset(
  preset: PlanGrowthChartWindowPreset,
  onRefresh?: () => void,
): void {
  activeChartWindowPreset = preset;
  onRefresh?.();
}

export function renderPlanGrowthPathPanel(options: PlanGrowthPathPanelOptions): TemplateResult {
  if (options.operations.loading && !options.operations.loadAttempted) {
    return html`
      <section class="enterprise-card cost-budget-v2-growth-path" data-testid="cost-budget-v2-growth-path">
        <div class="enterprise-empty muted" data-testid="plan-growth-loading">
          ${t("costBudget.v2.myPlan.growthPath.loading")}
        </div>
      </section>
    `;
  }

  const context = buildPlanGrowthPathContext({
    subscription: options.subscription,
    operations: options.operations,
    orders: options.orders,
  });

  if (!context) {
    return html`
      <section class="enterprise-card cost-budget-v2-growth-path" data-testid="cost-budget-v2-growth-path">
        <div class="enterprise-hint">${t("costBudget.v2.myPlan.growthPath.empty")}</div>
      </section>
    `;
  }

  const metricIds: PlanGrowthMetricId[] = ["bots", "concurrency", "credits", "tiers", "seats"];
  const activeSeries = context.seriesByMetric[activeGrowthMetric];
  const chartWindow = resolveGrowthChartWindow(
    context.subscriptionCreatedAt,
    activeChartWindowPreset,
  );
  const onRefresh = options.onRefresh;

  return html`
    <section class="enterprise-card cost-budget-v2-growth-path" data-testid="cost-budget-v2-growth-path">
      <header class="cost-budget-v2-growth-path__head">
        <h3 class="enterprise-section-title">${t("costBudget.v2.myPlan.growthPath.title")}</h3>
        <p class="enterprise-hint">${t("costBudget.v2.myPlan.growthPath.subtitle")}</p>
      </header>

      <div class="cost-budget-v2-growth-path__summary" data-testid="plan-growth-summary">
        ${context.summaries.map(
          (item) => html`
            <button
              type="button"
              class="cost-budget-v2-growth-path__summary-item ${activeGrowthMetric === item.id ? "is-active" : ""}"
              data-testid="plan-growth-summary-${item.id}"
              aria-pressed=${String(activeGrowthMetric === item.id)}
              @click=${() => selectGrowthMetric(item.id, onRefresh)}
            >
              <span class="cost-budget-v2-growth-path__summary-label">${item.label}</span>
              <strong class="cost-budget-v2-growth-path__summary-value">${item.value}</strong>
              ${
                item.subValue
                  ? html`<span class="cost-budget-v2-growth-path__summary-field">${item.subValue}</span>`
                  : nothing
              }
            </button>
          `,
        )}
      </div>

      <nav class="cost-budget-v2-growth-path__tabs" role="tablist" data-testid="plan-growth-tabs">
        ${metricIds.map(
          (id) => html`
            <button
              type="button"
              class="cost-budget-v2-growth-path__tab ${activeGrowthMetric === id ? "is-active" : ""}"
              role="tab"
              aria-selected=${String(activeGrowthMetric === id)}
              data-testid="plan-growth-tab-${id}"
              @click=${() => selectGrowthMetric(id, onRefresh)}
            >
              ${context.seriesByMetric[id].label}
            </button>
          `,
        )}
      </nav>

      <div
        class="cost-budget-v2-growth-path__window-presets"
        role="group"
        aria-label=${t("costBudget.v2.myPlan.growthPath.windowPresetsLabel")}
        data-testid="plan-growth-window-presets"
      >
        ${PLAN_GROWTH_CHART_WINDOW_PRESETS.map(
          (preset) => html`
            <button
              type="button"
              class="cost-budget-v2-growth-path__window-preset ${activeChartWindowPreset === preset ? "is-active" : ""}"
              data-testid="plan-growth-window-${preset}"
              @click=${() => selectChartWindowPreset(preset, onRefresh)}
            >
              ${chartWindowPresetLabel(preset)}
            </button>
          `,
        )}
      </div>

      ${renderGrowthChart(
        activeSeries,
        chartWindow,
        context,
        activeGrowthMetric,
        options.subscription,
      )}
    </section>
  `;
}

/** 测试用：重置 Tab 状态。 */
export function __resetPlanGrowthPathPanelForTest(): void {
  activeGrowthMetric = "bots";
  activeChartWindowPreset = "subscription";
}
