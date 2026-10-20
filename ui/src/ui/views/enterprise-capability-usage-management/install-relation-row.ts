/**
 * Install Relation Row — 「能力安装管理」双视角子页表格行。
 */

import { html, type TemplateResult } from "lit-html";
import type { InstallRelationEnhanced } from "../../capability/runtime-projection/types.ts";
import { formatExecutions, formatSuccessRate } from "./shared/format.ts";

export type InstallRelationRowProps = {
  item: InstallRelationEnhanced;
  primaryLabel: string;
  onUninstall: (installRelationId: string) => void;
};

export function renderInstallRelationRow(props: InstallRelationRowProps): TemplateResult {
  const { item, primaryLabel, onUninstall } = props;
  return html`
    <tr>
      <td>${primaryLabel}</td>
      <td>${item.source}</td>
      <td>${formatExecutions(item.usageStats.executions30d)}</td>
      <td>${formatSuccessRate(item.usageStats.successRate)}</td>
      <td>${item.status}</td>
      <td>
        <button
          class="enterprise-usage-btn enterprise-usage-btn--ghost"
          type="button"
          @click=${() => onUninstall(item.id)}
        >
          卸载
        </button>
      </td>
    </tr>
  `;
}
