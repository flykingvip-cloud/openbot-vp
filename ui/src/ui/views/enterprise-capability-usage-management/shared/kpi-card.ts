/**
 * KPI Card — 「能力使用管理」模块的 KPI 卡片组件。
 *
 * 使用 inline style 确保在 lit-html 模板中正确渲染（项目不扫描 lit 模板中的 Tailwind 类）。
 */

import { html, type TemplateResult } from "lit-html";

export type KpiCardProps = {
  title: string;
  value: string;
  subtitle?: string;
  trend?: number;
  trendFormat?: "percentage" | "absolute";
};

function renderTrend(trend: number | undefined, format: "percentage" | "absolute"): TemplateResult {
  if (trend === undefined || trend === null) {
    return html``;
  }
  if (trend === 0) {
    return html`
      <span style="font-size: 12px; color: #9ca3af; margin-left: 8px">持平</span>
    `;
  }
  const isPositive = trend > 0;
  const arrow = isPositive ? "↑" : "↓";
  const color = isPositive ? "#16a34a" : "#dc2626";
  const display =
    format === "percentage" ? `${Math.abs(trend * 100).toFixed(1)}%` : `${Math.abs(trend)}`;
  return html`<span style="font-size: 12px; color: ${color}; margin-left: 8px;">${arrow} ${display}</span>`;
}

export function renderKpiCard(props: KpiCardProps): TemplateResult {
  const { title, value, subtitle, trend, trendFormat = "percentage" } = props;
  return html`
    <div style="background: white; border-radius: 8px; border: 1px solid #e5e7eb; padding: 16px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); min-width: 0;">
      <p style="font-size: 11px; font-weight: 500; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin: 0;">${title}</p>
      <div style="margin-top: 4px; display: flex; align-items: baseline;">
        <p style="font-size: 24px; font-weight: 600; color: #111827; margin: 0;">${value}</p>
        ${renderTrend(trend, trendFormat)}
      </div>
      ${subtitle ? html`<p style="margin-top: 4px; font-size: 12px; color: #9ca3af;">${subtitle}</p>` : html``}
    </div>
  `;
}
