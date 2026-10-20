import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../i18n/index.ts";
import type {
  PositionAttributionResponse,
  PositionAttributionRow,
} from "../../capability/cost-budget-billing/index.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";
import type { EnterpriseMeshAgent } from "../../ports/enterprise/semantic/enterprise-read-model.ts";
import {
  formatReportPeriodLabel,
  type PositionReportPeriodPreset,
} from "./cost-budget-position-report-period.ts";

export type CostBudgetPositionReportProps = {
  client: GatewayBrowserClient | null;
  positionAttribution: PositionAttributionResponse | null;
  meshAgents: EnterpriseMeshAgent[];
  loading: boolean;
  exportBusy: boolean;
  loadError: string | null;
  hasActiveSubscription: boolean;
  periodPreset: PositionReportPeriodPreset;
  customPeriodStart: string;
  customPeriodEnd: string;
  fmtMoney: (cents: number | null | undefined) => string;
  onPeriodPresetChange: (preset: PositionReportPeriodPreset) => void;
  onCustomPeriodChange: (start: string, end: string) => void;
  onReload: () => void;
  onExportSummary: () => void;
  onExportDaily: () => void;
  collapsedRowIds: ReadonlySet<string>;
  onToggleRowCollapse: (orgSeatId: string) => void;
};

function isPositionRowExpanded(orgSeatId: string, collapsedRowIds: ReadonlySet<string>): boolean {
  return !collapsedRowIds.has(orgSeatId);
}

function resolveAgentLabel(meshAgents: EnterpriseMeshAgent[], agentId: string): string {
  const mesh = meshAgents.find((entry) => entry.agentId === agentId);
  return mesh?.name?.trim() || agentId;
}

function renderAgentSubRows(
  row: PositionAttributionRow,
  props: CostBudgetPositionReportProps,
): TemplateResult {
  if (row.agents.length === 0 && row.unallocatedAgentUsageQuantity === 0) {
    return html`
      <tr class="cost-budget-position-report__agent-row">
        <td colspan="2"></td>
        <td colspan="7" class="enterprise-hint">${t("costBudget.positionReport.noAgents")}</td>
      </tr>
    `;
  }
  const agentRows = row.agents.map(
    (agent) => html`
      <tr class="cost-budget-position-report__agent-row" data-testid=${`position-agent-${row.orgSeatId}-${agent.agentId}`}>
        <td colspan="2"></td>
        <td class="cost-budget-position-report__agent-indent">
          <span class="enterprise-hint">↳</span>
          ${resolveAgentLabel(props.meshAgents, agent.agentId)}
          <div class="enterprise-hint">${agent.agentId}</div>
        </td>
        <td>—</td>
        <td>—</td>
        <td>—</td>
        <td>${agent.usageQuantity}</td>
        <td>${props.fmtMoney(agent.usageCostCents)}</td>
        <td>${props.fmtMoney(agent.usageCostCents)}</td>
        <td>
          ${(() => {
            const mesh = props.meshAgents.find((entry) => entry.agentId === agent.agentId);
            if (!mesh || mesh.totalTokens === 0) {
              return html`
                <span class="enterprise-hint">—</span>
              `;
            }
            return html`
              <span class="enterprise-hint"
                >${t("costBudget.positionReport.sessionEstimate", {
                  tokens: String(mesh.totalTokens),
                  cost: mesh.totalCost.toFixed(2),
                })}</span
              >
            `;
          })()}
        </td>
      </tr>
    `,
  );
  const unallocated =
    row.unallocatedAgentUsageQuantity > 0
      ? html`
          <tr class="cost-budget-position-report__agent-row">
            <td colspan="2"></td>
            <td class="cost-budget-position-report__agent-indent">
              <span class="enterprise-hint">↳</span>
              ${t("costBudget.positionReport.unallocatedUsage")}
            </td>
            <td>—</td>
            <td>—</td>
            <td>${row.unallocatedAgentUsageQuantity}</td>
            <td>${props.fmtMoney(row.unallocatedAgentUsageCostCents)}</td>
            <td>${props.fmtMoney(row.unallocatedAgentUsageCostCents)}</td>
            <td></td>
          </tr>
        `
      : nothing;
  return html`${agentRows}${unallocated}`;
}

function renderPeriodControls(props: CostBudgetPositionReportProps): TemplateResult {
  const period = props.positionAttribution;
  return html`
    <div class="cost-budget-position-report__toolbar" data-testid="position-report-toolbar">
      <div class="cost-budget-position-report__period">
        <label class="enterprise-hint">${t("costBudget.positionReport.periodLabel")}</label>
        <select
          data-testid="position-report-period-preset"
          .value=${props.periodPreset}
          @change=${(e: Event) =>
            props.onPeriodPresetChange(
              (e.target as HTMLSelectElement).value as PositionReportPeriodPreset,
            )}
        >
          <option value="cycle">${t("costBudget.positionReport.periodCycle")}</option>
          <option value="7d">${t("costBudget.positionReport.period7d")}</option>
          <option value="30d">${t("costBudget.positionReport.period30d")}</option>
          <option value="custom">${t("costBudget.positionReport.periodCustom")}</option>
        </select>
        ${
          props.periodPreset === "custom"
            ? html`
                <input
                  type="date"
                  data-testid="position-report-custom-start"
                  .value=${props.customPeriodStart}
                  @change=${(e: Event) =>
                    props.onCustomPeriodChange(
                      (e.target as HTMLInputElement).value,
                      props.customPeriodEnd,
                    )}
                />
                <input
                  type="date"
                  data-testid="position-report-custom-end"
                  .value=${props.customPeriodEnd}
                  @change=${(e: Event) =>
                    props.onCustomPeriodChange(
                      props.customPeriodStart,
                      (e.target as HTMLInputElement).value,
                    )}
                />
              `
            : nothing
        }
        ${
          period
            ? html`<span class="enterprise-hint"
                >${formatReportPeriodLabel(period.cycleStart, period.cycleEnd)}</span
              >`
            : nothing
        }
        <button
          type="button"
          class="btn btn--sm"
          data-testid="position-report-reload"
          ?disabled=${!props.client || props.loading}
          @click=${() => props.onReload()}
        >
          ${t("costBudget.positionReport.reload")}
        </button>
      </div>
      <div class="cost-budget-position-report__export">
        <button
          type="button"
          class="btn btn--sm"
          data-testid="position-report-export-summary"
          ?disabled=${!props.client || props.exportBusy || props.loading}
          @click=${() => props.onExportSummary()}
        >
          ${t("costBudget.positionReport.exportSummary")}
        </button>
        <button
          type="button"
          class="btn btn--sm"
          data-testid="position-report-export-daily"
          ?disabled=${!props.client || props.exportBusy || props.loading}
          @click=${() => props.onExportDaily()}
        >
          ${t("costBudget.positionReport.exportDaily")}
        </button>
      </div>
    </div>
  `;
}

function formatPositionReportLoadError(message: string): string {
  if (/unknown method:\s*billing\.attribution-by-position/i.test(message)) {
    return t("costBudget.positionReport.loadErrorGatewayStale");
  }
  return t("costBudget.positionReport.loadError", { message });
}

export function renderCostBudgetPositionReportPanel(
  props: CostBudgetPositionReportProps,
): TemplateResult {
  const attribution = props.positionAttribution;
  const subscribed =
    attribution?.subscribed === true || (props.hasActiveSubscription && !props.loadError);
  return html`
    <div
      class="cost-budget-seats-panel cost-budget-position-report"
      data-testid="position-report-panel"
    >
      ${renderPeriodControls(props)}
      ${
        props.loading
          ? html`<div class="enterprise-empty">${t("costBudget.positionReport.loading")}</div>`
          : props.loadError && !attribution
            ? html`<div class="enterprise-empty" data-testid="position-report-error">
                ${formatPositionReportLoadError(props.loadError)}
                <div class="enterprise-page__actions" style="margin-top: 12px;">
                  <button
                    type="button"
                    class="btn btn--sm"
                    data-testid="position-report-retry"
                    ?disabled=${!props.client}
                    @click=${() => props.onReload()}
                  >
                    ${t("costBudget.positionReport.reload")}
                  </button>
                </div>
              </div>`
            : !subscribed
              ? html`<div class="enterprise-empty">${t("costBudget.positionReport.needSubscription")}</div>`
              : !attribution || attribution.rows.length === 0
                ? html`<div class="enterprise-empty">${t("costBudget.positionReport.empty")}</div>`
                : html`
                  <div class="cost-budget-seat-governance-summary" data-testid="position-report-summary">
                    <span
                      >${t("costBudget.positionReport.summarySeat", {
                        amount: props.fmtMoney(attribution.summary.seatCostCents),
                      })}</span
                    >
                    <span class="cost-budget-seat-governance-summary__sep">·</span>
                    <span
                      >${t("costBudget.positionReport.summaryUsage", {
                        amount: props.fmtMoney(attribution.summary.usageCostCents),
                      })}</span
                    >
                    <span class="cost-budget-seat-governance-summary__sep">·</span>
                    <strong
                      >${t("costBudget.positionReport.summaryTotal", {
                        amount: props.fmtMoney(attribution.summary.totalCostCents),
                      })}</strong
                    >
                    <span class="cost-budget-seat-governance-summary__sep">·</span>
                    <span class="enterprise-hint">${t("costBudget.positionReport.billingHint")}</span>
                  </div>
                  <div class="cost-budget-seat-table-wrap">
                    <table class="cost-budget-seat-table cost-budget-seat-table--governance" data-testid="position-report-table">
                      <thead>
                        <tr>
                          <th>${t("costBudget.allocation.listColDepartment")}</th>
                          <th>${t("costBudget.allocation.listColPosition")}</th>
                          <th>${t("costBudget.allocation.listColMember")}</th>
                          <th>${t("costBudget.allocation.listColRole")}</th>
                          <th>${t("costBudget.positionReport.colSeatCost")}</th>
                          <th>${t("costBudget.allocation.listColUsage")}</th>
                          <th>${t("costBudget.allocation.listColUsageCost")}</th>
                          <th>${t("costBudget.allocation.listColTotal")}</th>
                          <th>${t("costBudget.positionReport.colSessionEstimate")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${attribution.rows.map((row) => {
                          const expanded = isPositionRowExpanded(
                            row.orgSeatId,
                            props.collapsedRowIds,
                          );
                          return html`
                            <tr data-testid=${`position-row-${row.orgSeatId}`}>
                              <td>${row.teamLabel}</td>
                              <td><strong>${row.positionTitle}</strong></td>
                              <td>${row.memberUserId ?? "—"}</td>
                              <td>${row.billingRole ?? "—"}</td>
                              <td>${props.fmtMoney(row.seatCostCents)}</td>
                              <td>${row.usageQuantity}</td>
                              <td>${props.fmtMoney(row.usageCostCents)}</td>
                              <td><strong>${props.fmtMoney(row.totalCostCents)}</strong></td>
                              <td>
                                <button
                                  type="button"
                                  class="cost-budget-position-report__toggle ${expanded ? "is-expanded" : ""}"
                                  data-testid=${`position-row-toggle-${row.orgSeatId}`}
                                  aria-expanded=${expanded ? "true" : "false"}
                                  @click=${() => props.onToggleRowCollapse(row.orgSeatId)}
                                >
                                  <span class="cost-budget-position-report__toggle-icon" aria-hidden="true"
                                    >${expanded ? "▾" : "▸"}</span
                                  >
                                  ${
                                    expanded
                                      ? t("costBudget.positionReport.collapseAgents")
                                      : t("costBudget.positionReport.expandAgents")
                                  }
                                </button>
                              </td>
                            </tr>
                            ${expanded ? renderAgentSubRows(row, props) : nothing}
                          `;
                        })}
                      </tbody>
                    </table>
                  </div>
                `
      }
    </div>
  `;
}
