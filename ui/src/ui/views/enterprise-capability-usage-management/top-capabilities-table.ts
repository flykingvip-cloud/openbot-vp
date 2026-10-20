/**
 * Top Capabilities Table — 「使用效果分析」子页的 Top 能力排行表格。
 *
 * 列：能力名称 / 本月调用量 / 成功率 / 覆盖机器人数
 * 行点击 → 跳转至能力详情页
 *
 * 落实需求：Requirements 6.6, 6.7
 */

import { html, type TemplateResult } from "lit-html";
import type { AnalyticsTopCapability } from "../../capability/enterprise-capability-usage-management/endpoints.ts";
import { formatExecutions, formatSuccessRate } from "./shared/format.ts";
import { USAGE_TABLE_CONTAINER } from "./shared/styles.css.ts";

export type TopCapabilitiesTableProps = {
  items: AnalyticsTopCapability[];
  onNavigateToCapability: (capabilityId: string) => void;
};

/**
 * 渲染 Top 能力排行表格。
 */
export function renderTopCapabilitiesTable(props: TopCapabilitiesTableProps): TemplateResult {
  const { items, onNavigateToCapability } = props;

  return html`
    <div class="enterprise-usage-section enterprise-usage-top-capabilities">
      <h3 class="enterprise-usage-section__title">Top 能力排行</h3>
      <div class="${USAGE_TABLE_CONTAINER}">
        <table class="enterprise-usage-data-table">
          <thead>
            <tr>
              <th>能力名称</th>
              <th>本月调用量</th>
              <th>成功率</th>
              <th>覆盖机器人数</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(
              (item) => html`
                <tr
                  class="enterprise-usage-data-table__row--clickable"
                  @click=${() => onNavigateToCapability(item.capabilityId)}
                >
                  <td class="enterprise-usage-data-table__link">${item.capabilityName}</td>
                  <td>${formatExecutions(item.monthlyExecutions)}</td>
                  <td>${formatSuccessRate(item.successRate)}</td>
                  <td>${item.coveredRobots}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
