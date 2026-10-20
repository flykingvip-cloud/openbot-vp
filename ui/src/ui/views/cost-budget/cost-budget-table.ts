/**
 * T17：成本与预算模块键值表 — 复用 enterprise-table 基线。
 */

import { html, nothing, type TemplateResult } from "lit";

/** Lit 渲染片段：允许返回 `nothing` 表示不渲染。 */
export type CostBudgetTemplate = TemplateResult | typeof nothing;

export type CostBudgetKeyValueRow = {
  label: string;
  value: string;
  testId?: string;
};

export function renderCostBudgetKeyValueTable(
  rows: readonly CostBudgetKeyValueRow[],
  options?: { testId?: string; caption?: string },
): CostBudgetTemplate {
  if (rows.length === 0) {
    return nothing;
  }
  return html`
    <div class="enterprise-table-wrap" data-testid=${options?.testId ?? nothing}>
      ${
        options?.caption
          ? html`<div class="enterprise-table-wrap__caption">${options.caption}</div>`
          : nothing
      }
      <table class="enterprise-table">
        <tbody>
          ${rows.map(
            (row) => html`
              <tr data-testid=${row.testId ?? nothing}>
                <th scope="row">${row.label}</th>
                <td>${row.value}</td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}
