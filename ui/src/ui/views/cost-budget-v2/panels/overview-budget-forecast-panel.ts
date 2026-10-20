import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import type {
  BudgetGetResponse,
  ConsumptionForecast,
  DashboardResponse,
  ForecastRiskLevel,
} from "../../../capability/cost-budget-billing/index.ts";
import {
  renderCompactPlanCapacityUsagePanel,
  type CapacityUsageRow,
} from "../../cost-budget/plan-capacity-usage-panel.ts";

function fmtMoney(cents: number | null | undefined): string {
  if (cents == null) {
    return "—";
  }
  return `¥${(cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const RISK_RANK: Record<ForecastRiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function maxRiskLevel(levels: Array<ForecastRiskLevel | undefined>): ForecastRiskLevel {
  let best: ForecastRiskLevel = "none";
  for (const level of levels) {
    if (!level) {
      continue;
    }
    if (RISK_RANK[level] > RISK_RANK[best]) {
      best = level;
    }
  }
  return best;
}

function resolveMonthRiskLevel(
  dashboard: DashboardResponse,
  forecast: ConsumptionForecast | null,
): ForecastRiskLevel {
  const budgetLevel = dashboard.budgetStatus?.level ?? "ok";
  const budgetRisk: ForecastRiskLevel =
    budgetLevel === "exceeded" ? "high" : budgetLevel === "alert" ? "medium" : "none";

  let creditsRisk: ForecastRiskLevel = "none";
  if (forecast?.creditsEtaDays != null) {
    if (forecast.creditsEtaDays <= 7) {
      creditsRisk = "high";
    } else if (forecast.creditsEtaDays <= 14) {
      creditsRisk = "medium";
    } else if (forecast.creditsEtaDays <= 21) {
      creditsRisk = "low";
    }
  }

  return maxRiskLevel([
    budgetRisk,
    creditsRisk,
    forecast?.concurrencyRisk,
    forecast?.botQuotaRisk,
    forecast?.marginWarning,
  ]);
}

function monthRiskBadgeTone(risk: ForecastRiskLevel): string {
  if (risk === "high") {
    return "danger";
  }
  if (risk === "medium") {
    return "warning";
  }
  if (risk === "low") {
    return "success";
  }
  return "neutral";
}

function monthRiskLabel(risk: ForecastRiskLevel): string {
  switch (risk) {
    case "high":
      return t("costBudget.v2.overviewSnapshot.forecastCard.monthRiskHigh");
    case "medium":
      return t("costBudget.v2.overviewSnapshot.forecastCard.monthRiskMedium");
    case "low":
      return t("costBudget.v2.overviewSnapshot.forecastCard.monthRiskLow");
    default:
      return t("costBudget.v2.overviewSnapshot.forecastCard.monthRiskNone");
  }
}

function resolveCycleTrendPercent(
  forecastCost: number | null | undefined,
  accruedCents: number,
): number | null {
  if (forecastCost == null || accruedCents <= 0) {
    return null;
  }
  return ((forecastCost - accruedCents) / accruedCents) * 100;
}

function formatTrendPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

type AuxMetric = {
  label: string;
  primary: string;
  secondary?: string;
};

function buildAuxMetrics(
  dashboard: DashboardResponse,
  forecast: ConsumptionForecast | null,
): AuxMetric[] {
  const creditsRemaining = forecast?.creditsRemaining ?? dashboard.creditsStatus?.creditsRemaining;
  const monthlyCredits = forecast?.monthlyCredits ?? dashboard.creditsStatus?.monthlyCredits ?? 0;
  const metrics: AuxMetric[] = [];

  if (monthlyCredits > 0 && creditsRemaining != null) {
    const pct = Math.round((creditsRemaining / monthlyCredits) * 1000) / 10;
    metrics.push({
      label: t("costBudget.v2.overviewSnapshot.forecastCard.creditsRemainingShort"),
      primary: `${pct}%`,
      secondary: `${creditsRemaining.toLocaleString("zh-CN")} / ${monthlyCredits.toLocaleString("zh-CN")}`,
    });
  }

  if (forecast) {
    metrics.push({
      label: t("costBudget.v2.overviewSnapshot.forecastCard.concurrencyShort"),
      primary: `${forecast.concurrencyUsed} / ${forecast.concurrencyLimit}`,
    });
    if (forecast.maxBots != null && forecast.maxBots > 0) {
      metrics.push({
        label: t("costBudget.v2.overviewSnapshot.forecastCard.botQuotaShort"),
        primary: `${forecast.activeBots ?? 0} / ${forecast.maxBots}`,
      });
    }
  }

  return metrics;
}

export function renderOverviewBudgetForecastPanel(params: {
  dashboard: DashboardResponse;
  forecast: ConsumptionForecast | null;
  budget: BudgetGetResponse | null;
  usageRows?: readonly CapacityUsageRow[];
}): TemplateResult {
  const { dashboard, forecast, usageRows = [] } = params;
  if (!dashboard.subscribed) {
    return html``;
  }

  const forecastCost =
    forecast?.forecastCostCents ??
    dashboard.predictedCents ??
    dashboard.budgetStatus.predictedCents;
  const monthRisk = resolveMonthRiskLevel(dashboard, forecast);
  const trendPct = resolveCycleTrendPercent(forecastCost, dashboard.accruedCents);
  const auxMetrics = buildAuxMetrics(dashboard, forecast);
  const forecastModelLabel =
    forecast?.forecastCostInsufficientData || forecastCost == null
      ? t("costBudget.v2.overviewSnapshot.forecastCard.insufficientData")
      : forecast?.forecastCostMode === "wma"
        ? t("costBudget.v2.overviewSnapshot.forecastCard.modeWmaShort")
        : t("costBudget.v2.overviewSnapshot.forecastCard.modeLinear");

  return html`
    <section
      class="enterprise-card cost-budget-v2-overview-panel cost-budget-v2-forecast-card"
      data-testid="cost-budget-forecast-panel"
    >
      <header class="cost-budget-v2-forecast-card__header">
        <h3 class="cost-budget-v2-forecast-card__title">
          ${t("costBudget.v2.overviewSnapshot.forecastCard.title")}
        </h3>
        <span
          class="enterprise-status-badge enterprise-status-badge--${monthRiskBadgeTone(monthRisk)}"
          data-testid="cost-budget-forecast-month-risk"
        >
          ${t("costBudget.v2.overviewSnapshot.forecastCard.monthRiskLabel", {
            level: monthRiskLabel(monthRisk),
          })}
        </span>
      </header>

      <div class="cost-budget-v2-forecast-card__hero">
        <span class="cost-budget-v2-forecast-card__hero-label">
          ${t("costBudget.v2.overviewSnapshot.forecastCard.monthEndCost")}
        </span>
        <span class="cost-budget-v2-forecast-card__hero-value tabular-nums" data-testid="cost-budget-forecast-hero-value">
          ${fmtMoney(forecastCost)}
        </span>
        <div class="cost-budget-v2-forecast-card__hero-meta">
          ${
            trendPct != null
              ? html`
                  <span data-testid="cost-budget-forecast-trend">
                    ${t("costBudget.v2.overviewSnapshot.forecastCard.vsCurrentCycle", {
                      trend: formatTrendPercent(trendPct),
                    })}
                  </span>
                `
              : nothing
          }
          <span>${t("costBudget.v2.overviewSnapshot.forecastCard.forecastModel", { model: forecastModelLabel })}</span>
        </div>
      </div>

      ${
        auxMetrics.length > 0
          ? html`
              <div class="cost-budget-v2-forecast-card__aux" data-testid="cost-budget-forecast-aux">
                ${auxMetrics.map(
                  (metric) => html`
                    <div class="cost-budget-v2-forecast-card__aux-item">
                      <span class="cost-budget-v2-forecast-card__aux-label">${metric.label}</span>
                      <span class="cost-budget-v2-forecast-card__aux-primary tabular-nums">${metric.primary}</span>
                      ${
                        metric.secondary
                          ? html`<span class="cost-budget-v2-forecast-card__aux-secondary tabular-nums">${metric.secondary}</span>`
                          : nothing
                      }
                    </div>
                  `,
                )}
              </div>
            `
          : nothing
      }

      ${
        usageRows.length > 0
          ? html`
              <div class="cost-budget-v2-forecast-card__capacity" data-testid="cost-budget-v2-overview-usage">
                <h4 class="cost-budget-v2-forecast-card__capacity-title">
                  ${t("costBudget.v2.overviewSnapshot.usageTitle")}
                </h4>
                ${renderCompactPlanCapacityUsagePanel(usageRows)}
              </div>
            `
          : nothing
      }
    </section>
  `;
}
