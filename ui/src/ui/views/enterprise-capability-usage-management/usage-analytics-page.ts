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
} from "../../controllers/enterprise-capability-usage-management/usage-analytics.ts";
import { pathForTab } from "../../navigation.ts";
import { renderEmptyState } from "./shared/empty-state.ts";
import { USAGE_PAGE_CONTAINER, USAGE_SECTION_TITLE } from "./shared/styles.css.ts";
import { renderTopCapabilitiesTable } from "./top-capabilities-table.ts";
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
    <div class="animate-pulse space-y-4">
      <div class="grid grid-cols-4 gap-4">${[1, 2, 3, 4].map(
        () =>
          html`
            <div class="h-20 bg-gray-200 rounded-lg"></div>
          `,
      )}</div>
      <div class="h-40 bg-gray-200 rounded-lg"></div>
      <div class="h-40 bg-gray-200 rounded-lg"></div>
      <div class="h-32 bg-gray-200 rounded-lg"></div>
    </div>
  `;
}

/**
 * 渲染「使用效果分析」子页。
 */
export function renderUsageAnalyticsPage(props: UsageAnalyticsPageProps): TemplateResult {
  const { state, controller, basePath, tenantId } = props;
  const hasData = state.kpis !== null || state.topCapabilities.length > 0;

  return html`
    <div class="${USAGE_PAGE_CONTAINER}">
      <div class="mb-6">
        <h1 class="${USAGE_SECTION_TITLE}">使用效果分析</h1>
      </div>

      ${
        state.loading && !hasData
          ? renderSkeleton()
          : html`
        ${
          state.error
            ? html`
          <div class="bg-red-50 border border-red-200 rounded p-3 mb-4 flex items-center justify-between">
            <span class="text-sm text-red-700">${state.error}</span>
            <button class="text-sm text-red-600 font-medium" style="min-width:32px;min-height:32px;" @click=${() => controller.load()}>重试</button>
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

          ${
            state.topCapabilities.length > 0
              ? renderTopCapabilitiesTable({
                  items: state.topCapabilities,
                  onNavigateToCapability: (capabilityId) => {
                    const href = pathForTab("enterpriseCapabilityCenter", basePath, {
                      tenantId,
                      context: { capabilityId },
                    });
                    if (typeof window !== "undefined") {
                      window.history.pushState({}, "", href);
                      window.dispatchEvent(new PopStateEvent("popstate"));
                    }
                  },
                })
              : nothing
          }
        `
        }
      `
      }
    </div>
  `;
}
