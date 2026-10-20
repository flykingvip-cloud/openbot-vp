/**
 * Forecast 告警聚合（企业 + 平台汇总共用）。
 */

import type { ConsumptionForecast, ForecastAlertKind, ForecastRiskLevel } from "./types.js";

const RISK_RANK: Record<ForecastRiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export function maxRiskLevel(...levels: ForecastRiskLevel[]): ForecastRiskLevel {
  let best: ForecastRiskLevel = "none";
  for (const level of levels) {
    if (RISK_RANK[level] > RISK_RANK[best]) {
      best = level;
    }
  }
  return best;
}

export function assessCreditsRisk(forecast: ConsumptionForecast): ForecastRiskLevel {
  if (forecast.monthlyCredits <= 0) {
    return "none";
  }
  if (forecast.creditsRemaining <= 0) {
    return "high";
  }
  if (forecast.creditsEtaInsufficientData || forecast.creditsEtaDays == null) {
    return "none";
  }
  if (forecast.creditsEtaDays <= 3) {
    return "high";
  }
  if (forecast.creditsEtaDays <= 7) {
    return "medium";
  }
  if (forecast.creditsEtaDays <= 14) {
    return "low";
  }
  return "none";
}

export function assessCostOverBudgetRisk(
  forecast: ConsumptionForecast,
  monthlyBudgetCents: number,
): ForecastRiskLevel {
  if (monthlyBudgetCents <= 0 || forecast.forecastCostCents == null) {
    return "none";
  }
  const ratio = forecast.forecastCostCents / monthlyBudgetCents;
  if (ratio >= 1) {
    return "high";
  }
  if (ratio >= 0.9) {
    return "medium";
  }
  if (ratio >= 0.75) {
    return "low";
  }
  return "none";
}

export function collectForecastAlertKinds(
  forecast: ConsumptionForecast,
  monthlyBudgetCents = 0,
): ForecastAlertKind[] {
  const kinds: ForecastAlertKind[] = [];
  if (forecast.concurrencyRisk !== "none") {
    kinds.push("concurrency");
  }
  const creditsRisk = assessCreditsRisk(forecast);
  if (creditsRisk !== "none") {
    kinds.push("credits");
  }
  if (forecast.marginWarning !== "none") {
    kinds.push("margin");
  }
  if (forecast.botQuotaRisk !== "none") {
    kinds.push("bots");
  }
  if (assessCostOverBudgetRisk(forecast, monthlyBudgetCents) !== "none") {
    kinds.push("cost");
  }
  return kinds;
}

export function overallForecastRisk(
  forecast: ConsumptionForecast,
  monthlyBudgetCents = 0,
): ForecastRiskLevel {
  return maxRiskLevel(
    forecast.concurrencyRisk,
    assessCreditsRisk(forecast),
    forecast.marginWarning,
    forecast.botQuotaRisk,
    assessCostOverBudgetRisk(forecast, monthlyBudgetCents),
  );
}
