/**
 * Usage Trend Chart — 「使用效果分析」子页的趋势折线图组件。
 *
 * 基于 SVG 实现简单折线图（不引入 Recharts 等第三方库）。
 * 支持 7 / 30 / 90 天窗口切换。
 *
 * 落实需求：Requirements 6.4, 6.5
 */

import { html, type TemplateResult } from "lit-html";
import type {
  AnalyticsTrendSeries,
  AnalyticsWindow,
} from "../../capability/enterprise-asset-library-usage/endpoints.ts";

export type UsageTrendChartProps = {
  title: string;
  data: AnalyticsTrendSeries | null;
  window: AnalyticsWindow;
  onWindowChange: (window: AnalyticsWindow) => void;
};

const WINDOWS: AnalyticsWindow[] = [7, 30, 90];

function buildSvgPath(values: number[], width: number, height: number): string {
  if (values.length === 0) {
    return "";
  }
  const max = Math.max(...values, 1);
  const stepX = width / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  });
  return `M ${points.join(" L ")}`;
}

/**
 * 渲染趋势折线图。
 */
export function renderUsageTrendChart(props: UsageTrendChartProps): TemplateResult {
  const { title, data, window: currentWindow, onWindowChange } = props;

  return html`
    <div class="enterprise-usage-trend-chart">
      <div class="enterprise-usage-trend-chart__header">
        <h3 class="enterprise-usage-trend-chart__title">${title}</h3>
        <div class="enterprise-usage-trend-chart__windows">
          ${WINDOWS.map(
            (w) => html`
              <button
                class="enterprise-usage-trend-window ${w === currentWindow ? "enterprise-usage-trend-window--active" : ""}"
                @click=${() => onWindowChange(w)}
              >${w}天</button>
            `,
          )}
        </div>
      </div>
      ${
        data && data.values.length > 0
          ? html`
          <div class="enterprise-usage-trend-chart__plot">
            <svg viewBox="0 0 400 120" preserveAspectRatio="none">
              <path
                d="${buildSvgPath(data.values, 400, 120)}"
                fill="none"
                stroke="#3b82f6"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>
          <div class="enterprise-usage-trend-chart__axis">
            <span>${data.dates[0] ?? ""}</span>
            <span>${data.dates[data.dates.length - 1] ?? ""}</span>
          </div>
        `
          : html`
              <div class="enterprise-usage-trend-chart__empty">暂无使用数据</div>
            `
      }
    </div>
  `;
}
