/**
 * Usage Analytics KPI Cards — 「使用效果分析」子页的 KPI 卡片组件（含环比箭头）。
 *
 * 落实需求：Requirements 6.2, 6.3
 */

import { html, type TemplateResult } from "lit-html";
import type { AnalyticsKpis } from "../../capability/enterprise-capability-usage-management/endpoints.ts";
import { formatExecutions, formatSuccessRate } from "./shared/format.ts";
import { renderKpiCard } from "./shared/kpi-card.ts";
import { USAGE_KPI_GRID } from "./shared/styles.css.ts";

export function renderUsageAnalyticsKpiCards(kpis: AnalyticsKpis): TemplateResult {
  return html`
    <div class="${USAGE_KPI_GRID}">
      ${renderKpiCard({
        title: "本月总调用量",
        value: formatExecutions(kpis.totalMonthlyExecutions.current),
        trend: kpis.totalMonthlyExecutions.previousMonthPercentage,
        trendFormat: "percentage",
      })}
      ${renderKpiCard({
        title: "覆盖机器人数",
        value: String(kpis.coveredRobots.current),
        trend: kpis.coveredRobots.previousMonthPercentage,
        trendFormat: "percentage",
      })}
      ${renderKpiCard({
        title: "覆盖员工数",
        value: String(kpis.coveredEmployees.current),
        trend: kpis.coveredEmployees.previousMonthPercentage,
        trendFormat: "percentage",
      })}
      ${renderKpiCard({
        title: "平均成功率",
        value: formatSuccessRate(kpis.averageSuccessRate.current),
        trend: kpis.averageSuccessRate.previousMonthPercentage,
        trendFormat: "percentage",
      })}
    </div>
  `;
}
