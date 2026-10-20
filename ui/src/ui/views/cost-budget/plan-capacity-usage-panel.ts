/**
 * 购后 Capacity 用量条（天花板 vs 当前使用）。
 */

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../i18n/index.ts";

export type CapacityUsageRow = {
  id: string;
  label: string;
  used: number;
  limit: number;
  unlimited?: boolean;
};

export function capacityUsageRatio(used: number, limit: number): number | null {
  if (limit <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, used / limit));
}

function formatUsage(used: number, limit: number, unlimited?: boolean): string {
  if (unlimited || limit <= 0) {
    return `${used} / ${t("costBudget.resourcesPanel.unlimited")}`;
  }
  return `${used} / ${limit}`;
}

function toneClass(ratio: number | null): string {
  if (ratio == null) {
    return "";
  }
  if (ratio >= 1) {
    return "is-danger";
  }
  if (ratio >= 0.8) {
    return "is-warn";
  }
  return "";
}

function compactBarToneClass(ratio: number | null): string {
  if (ratio == null) {
    return "";
  }
  if (ratio >= 1) {
    return "is-danger";
  }
  if (ratio >= 0.8) {
    return "is-warn";
  }
  return "is-normal";
}

function compactUsagePctLabel(row: CapacityUsageRow, ratio: number | null): string {
  if (ratio == null) {
    return "";
  }
  const pct = Math.round(ratio * 100);
  if (row.id === "credits" && pct < 1 && row.limit > 0) {
    return t("costBudget.v2.overviewSnapshot.forecastCard.usageVeryLow");
  }
  return `${pct}%`;
}

export function renderPlanCapacityUsagePanel(rows: readonly CapacityUsageRow[]): TemplateResult {
  if (rows.length === 0) {
    return html``;
  }
  return html`
    <section class="cost-budget-capacity-usage" data-testid="plan-capacity-usage">
      <h4 class="cost-budget-capacity-usage__title">${t("costBudget.v2.overviewSnapshot.currentUsageTitle")}</h4>
      <div class="cost-budget-capacity-usage__grid">
        ${rows.map((row) => {
          const ratio =
            row.unlimited || row.limit <= 0 ? null : capacityUsageRatio(row.used, row.limit);
          const pct = ratio == null ? 0 : Math.round(ratio * 100);
          return html`
            <div class="cost-budget-capacity-usage__row" data-testid="capacity-usage-${row.id}">
              <div class="cost-budget-capacity-usage__head">
                <span>${row.label}</span>
                <span class="cost-budget-capacity-usage__value"
                  >${formatUsage(row.used, row.limit, row.unlimited)}</span
                >
              </div>
              ${
                ratio != null
                  ? html`
                      <div
                        class="cost-budget-capacity-usage__bar ${toneClass(ratio)}"
                        role="progressbar"
                        aria-valuenow=${pct}
                        aria-valuemin="0"
                        aria-valuemax="100"
                      >
                        <span style=${`width: ${pct}%`}></span>
                      </div>
                    `
                  : html`
                      <div class="cost-budget-capacity-usage__bar is-unlimited"></div>
                    `
              }
            </div>
          `;
        })}
      </div>
    </section>
  `;
}

/** Compact capacity rows for overview forecast card (name + value + % + slim bar). */
export function renderCompactPlanCapacityUsagePanel(
  rows: readonly CapacityUsageRow[],
): TemplateResult {
  if (rows.length === 0) {
    return html``;
  }
  return html`
    <div class="cost-budget-capacity-usage--compact" data-testid="plan-capacity-usage-compact">
      ${rows.map((row) => {
        const ratio =
          row.unlimited || row.limit <= 0 ? null : capacityUsageRatio(row.used, row.limit);
        const pct = ratio == null ? 0 : Math.round(ratio * 100);
        const pctLabel = compactUsagePctLabel(row, ratio);
        return html`
          <div class="cost-budget-capacity-usage__row" data-testid="capacity-usage-${row.id}">
            <div class="cost-budget-capacity-usage__head cost-budget-capacity-usage__head--compact">
              <span class="cost-budget-capacity-usage__label">${row.label}</span>
              <span class="cost-budget-capacity-usage__value tabular-nums"
                >${formatUsage(row.used, row.limit, row.unlimited)}</span
              >
              ${pctLabel ? html`<span class="cost-budget-capacity-usage__pct tabular-nums">${pctLabel}</span>` : nothing}
            </div>
            ${
              ratio != null
                ? html`
                    <div
                      class="cost-budget-capacity-usage__bar cost-budget-capacity-usage__bar--compact ${compactBarToneClass(ratio)}"
                      role="progressbar"
                      aria-valuenow=${pct}
                      aria-valuemin="0"
                      aria-valuemax="100"
                    >
                      <span style=${`width: ${Math.max(pct, ratio > 0 && pct === 0 ? 2 : 0)}%`}></span>
                    </div>
                  `
                : html`
                    <div
                      class="cost-budget-capacity-usage__bar cost-budget-capacity-usage__bar--compact is-unlimited"
                    ></div>
                  `
            }
          </div>
        `;
      })}
    </div>
  `;
}

export function buildSubscribedCapacityUsageRows(input: {
  assignedSeats: number;
  seatLimit: number;
  usedBots: number;
  botLimit: number;
  concurrencyUsed: number;
  concurrencyLimit: number;
  creditsConsumed: number | null;
  creditsLimit: number | null;
}): CapacityUsageRow[] {
  const rows: CapacityUsageRow[] = [
    {
      id: "seats",
      label: t("costBudget.planCapacity.teamMembers"),
      used: input.assignedSeats,
      limit: input.seatLimit,
    },
    {
      id: "bots",
      label: t("costBudget.planCapacity.aiEmployees"),
      used: input.usedBots,
      limit: input.botLimit,
    },
    {
      id: "concurrency",
      label: t("costBudget.planCapacity.concurrentRuns"),
      used: input.concurrencyUsed,
      limit: input.concurrencyLimit,
    },
  ];
  if (input.creditsLimit != null && input.creditsLimit > 0) {
    rows.push({
      id: "credits",
      label: t("costBudget.planCapacity.monthlyCredits"),
      used: input.creditsConsumed ?? 0,
      limit: input.creditsLimit,
    });
  }
  return rows;
}
