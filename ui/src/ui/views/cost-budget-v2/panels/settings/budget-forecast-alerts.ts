import { html, type TemplateResult } from "lit";
import { t } from "../../../../../i18n/index.ts";
import type {
  BudgetGetResponse,
  ConsumptionForecast,
} from "../../../../capability/cost-budget-billing/index.ts";

function fmtMoney(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

export function renderBudgetForecastAlerts(params: {
  budget: BudgetGetResponse | null;
  forecast: ConsumptionForecast | null;
}): TemplateResult {
  const f = params.forecast;
  const budget = params.budget?.budget;
  if (!f || !budget) {
    return html``;
  }
  const lines: string[] = [];
  if (
    f.forecastCostCents != null &&
    budget.monthlyLimitCents > 0 &&
    f.forecastCostCents >= budget.monthlyLimitCents * 0.9
  ) {
    lines.push(
      t("costBudget.forecastPanel.budgetOverrun", {
        cost: fmtMoney(f.forecastCostCents),
        budget: fmtMoney(budget.monthlyLimitCents),
        ratio: String(Math.round((f.forecastCostCents / budget.monthlyLimitCents) * 100)),
      }),
    );
  }
  if (f.creditsEtaDays != null && f.creditsEtaDays <= 7 && f.monthlyCredits > 0) {
    lines.push(t("costBudget.forecastPanel.creditsCritical", { days: String(f.creditsEtaDays) }));
  }
  if (
    f.concurrencyRiskMessage &&
    (f.concurrencyRisk === "high" || f.concurrencyRisk === "medium")
  ) {
    lines.push(f.concurrencyRiskMessage);
  }
  if (lines.length === 0) {
    return html``;
  }
  return html`
    <div class="callout warning cost-budget-callout--spaced" data-testid="forecast-budget-alerts">
      <strong>${t("costBudget.forecastPanel.budgetAlertsTitle")}</strong>
      <ul class="cost-budget-alert-list">
        ${lines.map((line) => html`<li>${line}</li>`)}
      </ul>
    </div>
  `;
}
