import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../../i18n/index.ts";
import type { AnalyticsResponse } from "../../../../capability/cost-budget-billing/index.ts";
import {
  AOR_METERING_KEYS,
  GOVERNANCE_METERING_KEYS,
} from "../../../cost-budget/cost-budget-settings-helpers.ts";
import { renderCostBudgetKeyValueTable } from "../../../cost-budget/cost-budget-table.ts";
import { renderEnterpriseKpiGrid } from "../../../enterprise-kpi-card.ts";

export function renderAnalyticsSettingsSection(
  analytics: AnalyticsResponse | null,
): TemplateResult {
  if (!analytics) {
    return html`
      <div class="enterprise-empty" data-testid="cost-budget-v2-analytics-empty">
        ${t("costBudget.analyticsPanel.empty")}
      </div>
    `;
  }
  const aorRows = AOR_METERING_KEYS.map((key) => ({
    key,
    quantity: analytics.byKey[key] ?? 0,
  }));
  const aorTotal = aorRows.reduce((sum, row) => sum + row.quantity, 0);
  const governanceRows = GOVERNANCE_METERING_KEYS.map((key) => ({
    key,
    quantity: analytics.byKey[key] ?? 0,
  }));
  const governanceMeterTotal = governanceRows.reduce((sum, row) => sum + row.quantity, 0);
  const savingsQty = analytics.byKey.aor_optimization_savings ?? 0;
  const shareQty = analytics.byKey.aor_optimization_revenue_share ?? 0;
  const fmtUsdProxy = (qty: number) => `¥${(qty / 100).toFixed(2)}`;
  return html`
    <section class="cost-budget-v2-analytics-section" data-testid="cost-budget-v2-analytics-section">
      ${renderEnterpriseKpiGrid([
        { label: t("costBudget.analyticsPanel.recordCount"), value: String(analytics.recordCount) },
        {
          label: t("costBudget.analyticsPanel.totalQuantity"),
          value: String(analytics.totalQuantity),
        },
        { label: t("costBudget.analyticsPanel.aorTotal"), value: String(aorTotal) },
      ])}
      <h3 class="enterprise-section-title">${t("costBudget.analyticsPanel.aorKeysTitle")}</h3>
      ${renderCostBudgetKeyValueTable(
        aorRows.map((row) => ({ label: row.key, value: String(row.quantity) })),
        { testId: "aor-usage-keys" },
      )}
      ${
        governanceMeterTotal > 0
          ? html`
              <h3 class="enterprise-section-title">
                ${t("costBudget.analyticsPanel.governanceKeysTitle")}
              </h3>
              ${renderCostBudgetKeyValueTable(
                governanceRows.map((row) => ({ label: row.key, value: String(row.quantity) })),
                { testId: "governance-usage-keys" },
              )}
            `
          : nothing
      }
      <h3 class="enterprise-section-title">${t("costBudget.analyticsPanel.optimizationTitle")}</h3>
      <div data-testid="aor-optimization-summary">
        ${renderEnterpriseKpiGrid([
          { label: t("costBudget.analyticsPanel.savingsProxy"), value: fmtUsdProxy(savingsQty) },
          { label: t("costBudget.analyticsPanel.shareProxy"), value: fmtUsdProxy(shareQty) },
          {
            label: t("costBudget.analyticsPanel.savingsShareQty"),
            value: `${savingsQty} / ${shareQty}`,
          },
        ])}
      </div>
      ${
        aorTotal === 0
          ? html`
              <div class="enterprise-hint cost-budget-callout--spaced-top" data-testid="aor-analytics-empty-hint">
                ${t("costBudget.analyticsPanel.aorDisabledEmpty")}
              </div>
            `
          : nothing
      }
    </section>
  `;
}
