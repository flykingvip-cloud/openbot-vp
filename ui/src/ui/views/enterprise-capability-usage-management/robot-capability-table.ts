/**
 * Robot Capability Table — 「数字人能力视图」子页的主表格组件。
 *
 * 列：机器人名称 / 已安装能力数 / 本月调用量 / 覆盖员工数 / 成功率 / 健康状态 / Top 3 能力 / 操作
 *
 * 落实需求：Requirements 4.4, 4.5, 8.5, 11.4, 11.6, 11.7
 */

import { html, nothing, type TemplateResult } from "lit-html";
import type { RobotCapabilityUsageView } from "../../capability/runtime-projection/types.ts";
import type { RobotCapabilityViewSorting } from "../../controllers/enterprise-capability-usage-management/robot-capability-view.ts";
import { formatExecutions, formatSuccessRate } from "./shared/format.ts";

export type RobotCapabilityTableProps = {
  items: RobotCapabilityUsageView[];
  sorting: RobotCapabilityViewSorting;
  onSort: (field: RobotCapabilityViewSorting["field"]) => void;
  onViewDetail: (robotId: string) => void;
};

type ColumnDef = {
  key: string;
  label: string;
  sortable: boolean;
  sortField?: RobotCapabilityViewSorting["field"];
};

const COLUMNS: readonly ColumnDef[] = [
  { key: "robotName", label: "机器人名称", sortable: false },
  { key: "capabilityCount", label: "已安装能力数", sortable: true, sortField: "capabilityCount" },
  { key: "monthlyExecutions", label: "本月调用量", sortable: true, sortField: "monthlyExecutions" },
  { key: "employeeCoverage", label: "覆盖员工数", sortable: true, sortField: "employeeCoverage" },
  { key: "successRate", label: "成功率", sortable: true, sortField: "successRate" },
  { key: "healthStatus", label: "健康状态", sortable: false },
  { key: "topCapabilities", label: "Top 能力", sortable: false },
  { key: "actions", label: "操作", sortable: false },
] as const;

function renderSortIndicator(
  column: ColumnDef,
  sorting: RobotCapabilityViewSorting,
): TemplateResult | typeof nothing {
  if (!column.sortable || !column.sortField) {
    return nothing;
  }
  if (sorting.field !== column.sortField) {
    return html`
      <span style="color: #d1d5db; margin-left: 4px">↕</span>
    `;
  }
  return html`<span style="color: #2563eb; margin-left: 4px;">${sorting.direction === "asc" ? "↑" : "↓"}</span>`;
}

function renderHealthBadge(status: string): TemplateResult {
  let bg = "#f3f4f6";
  let color = "#4b5563";
  if (status === "效果稳定") {
    bg = "#dcfce7";
    color = "#15803d";
  } else if (status === "偶尔不理想") {
    bg = "#fef9c3";
    color = "#a16207";
  } else if (status === "建议优化") {
    bg = "#fee2e2";
    color = "#b91c1c";
  } else if (status === "已停用") {
    bg = "#e5e7eb";
    color = "#6b7280";
  }

  return html`<span style="display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; background: ${bg}; color: ${color};">${status}</span>`;
}

function renderTopCapabilities(caps: string[]): TemplateResult {
  const MAX_DISPLAY = 3;
  const displayed = caps.slice(0, MAX_DISPLAY);
  const overflow = caps.length - MAX_DISPLAY;

  return html`
    <div style="display: flex; flex-wrap: wrap; gap: 4px;">
      ${displayed.map(
        (name) =>
          html`<span style="display: inline-flex; align-items: center; padding: 2px 6px; border-radius: 4px; font-size: 11px; background: #eff6ff; color: #1d4ed8;">${name}</span>`,
      )}
      ${overflow > 0 ? html`<span style="font-size: 11px; color: #9ca3af;">+${overflow}</span>` : nothing}
    </div>
  `;
}

/**
 * 渲染机器人能力配置视图主表格。
 */
export function renderRobotCapabilityTable(props: RobotCapabilityTableProps): TemplateResult {
  const { items, sorting, onSort, onViewDetail } = props;

  return html`
    <div style="overflow-x: auto;">
      <table class="enterprise-robot-table" style="width: 100%; font-size: 13px; text-align: left; border-collapse: collapse;">
        <thead style="font-size: 11px; color: #6b7280; text-transform: uppercase; background: #f9fafb; border-bottom: 1px solid #e5e7eb;">
          <tr>
            ${COLUMNS.map(
              (col) => html`
                <th style="padding: 10px 16px; white-space: nowrap; ${col.sortable ? "cursor: pointer;" : ""}"
                    @click=${col.sortable && col.sortField ? () => onSort(col.sortField!) : nothing}>
                  ${col.label}${renderSortIndicator(col, sorting)}
                </th>
              `,
            )}
          </tr>
        </thead>
        <tbody>
          ${items.map(
            (item) => html`
              <tr style="border-bottom: 1px solid #f3f4f6; transition: background 0.1s;" @mouseenter=${(e: Event) => ((e.currentTarget as HTMLElement).style.background = "#f9fafb")} @mouseleave=${(e: Event) => ((e.currentTarget as HTMLElement).style.background = "")}>
                <td style="padding: 12px 16px; font-weight: 500; color: #111827;">${item.robotName}</td>
                <td style="padding: 12px 16px;">${item.capabilityCount}</td>
                <td style="padding: 12px 16px;">${formatExecutions(item.monthlyExecutions)}</td>
                <td style="padding: 12px 16px;">${item.employeeCoverage}</td>
                <td style="padding: 12px 16px;">${formatSuccessRate(item.successRate)}</td>
                <td style="padding: 12px 16px;">${renderHealthBadge(item.healthStatus)}</td>
                <td style="padding: 12px 16px;">${renderTopCapabilities(item.topCapabilities)}</td>
                <td style="padding: 12px 16px;">
                  <button
                    style="color: #2563eb; font-size: 12px; font-weight: 500; background: none; border: 1px solid #2563eb; border-radius: 4px; padding: 4px 10px; cursor: pointer; min-width: 32px; min-height: 32px;"
                    @click=${() => onViewDetail(item.robotId)}
                  >查看详情</button>
                </td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}
