/**
 * Usage Analytics Page — 「使用效果分析」子页外框。
 *
 * 编排：Page Header → KPI 卡片 → 30 天调用趋势 → 能力复用增长 → Top 排行
 *
 * 落实需求：Requirements 6.1, 6.8, 6.10
 */

import { html, nothing, type TemplateResult } from "lit-html";
import type {
  UsageAnalyticsController,
  UsageAnalyticsState,
} from "../../controllers/enterprise-asset-library-usage/usage-analytics.ts";
import { renderEmptyState } from "./shared/empty-state.ts";
import { USAGE_PAGE_CONTAINER } from "./shared/styles.css.ts";
import { renderUsageAnalyticsKpiCards } from "./usage-analytics-kpi-cards.ts";
import { renderUsageTrendChart } from "./usage-trend-chart.ts";

export type UsageAnalyticsPageProps = {
  state: UsageAnalyticsState;
  controller: UsageAnalyticsController;
  basePath: string;
  tenantId: string;
};

function renderSkeleton(): TemplateResult {
  return html`
    <div class="enterprise-usage-skeleton">
      <div class="enterprise-usage-skeleton__kpis">
        ${[1, 2, 3, 4].map(
          () =>
            html`
              <div class="enterprise-usage-skeleton__block"></div>
            `,
        )}
      </div>
      <div class="enterprise-usage-skeleton__block enterprise-usage-skeleton__block--tall"></div>
      <div class="enterprise-usage-skeleton__block enterprise-usage-skeleton__block--tall"></div>
      <div class="enterprise-usage-skeleton__block"></div>
    </div>
  `;
}

/**
 * 渲染「使用效果分析」子页。
 */
export function renderUsageAnalyticsPage(props: UsageAnalyticsPageProps): TemplateResult {
  const { state, controller } = props;
  const hasData = state.kpis !== null || state.topCapabilities.length > 0;

  return html`
    <div class="${USAGE_PAGE_CONTAINER}">
      ${
        state.loading && !hasData
          ? renderSkeleton()
          : html`
        ${
          state.error
            ? html`
          <div class="enterprise-usage-error">
            <span>${state.error}</span>
            <button class="enterprise-usage-error__retry" @click=${() => controller.load()}>重试</button>
          </div>
        `
            : nothing
        }

        ${state.kpis ? renderUsageAnalyticsKpiCards(state.kpis) : nothing}

        ${
          !hasData && !state.loading
            ? renderEmptyState("暂无使用数据")
            : html`
          ${renderUsageTrendChart({
            title: "调用量趋势",
            data: state.trendExecutions,
            window: state.window,
            onWindowChange: (w) => controller.changeWindow(w),
          })}

          ${renderUsageTrendChart({
            title: "能力复用增长",
            data: state.trendCapabilityReuse,
            window: state.window,
            onWindowChange: (w) => controller.changeWindow(w),
          })}
        `
        }
      `
      }
    </div>
  `;
}
