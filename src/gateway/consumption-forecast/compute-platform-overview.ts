/**
 * 平台级 Consumption Forecast 汇总（活跃订阅租户）。
 */

import { resolveCycleWindow } from "../billing/runtime.js";
import { listActiveSubscriptions } from "../billing/subscriptions-store.js";
import { assessCreditsRisk, collectForecastAlertKinds, overallForecastRisk } from "./alerts.js";
import { computeEnterpriseConsumptionForecast } from "./compute-enterprise-forecast.js";
import type { ForecastAtRiskEnterprise, PlatformConsumptionForecastOverview } from "./types.js";

const RISK_RANK = { none: 0, low: 1, medium: 2, high: 3 } as const;

export async function computePlatformConsumptionForecastOverview(
  now: Date = new Date(),
  options?: { maxEnterprises?: number },
): Promise<PlatformConsumptionForecastOverview> {
  const { cycleStart, cycleEnd } = resolveCycleWindow(now);
  const subscriptions = await listActiveSubscriptions();
  const max = options?.maxEnterprises ?? 200;
  const targets = subscriptions.slice(0, max);

  const forecasts = await Promise.all(
    targets.map(async (sub) => {
      const forecast = await computeEnterpriseConsumptionForecast(sub.enterpriseId, now);
      return forecast ? { sub, forecast } : null;
    }),
  );

  const atRisk: ForecastAtRiskEnterprise[] = [];
  let concurrencyHigh = 0;
  let creditsCritical = 0;
  let marginHigh = 0;
  let botQuotaHigh = 0;
  let anyAlert = 0;

  for (const row of forecasts) {
    if (!row) {
      continue;
    }
    const { sub, forecast } = row;
    const alerts = collectForecastAlertKinds(forecast);
    if (alerts.length === 0) {
      continue;
    }
    anyAlert += 1;
    if (forecast.concurrencyRisk === "high") {
      concurrencyHigh += 1;
    }
    const creditsRisk = assessCreditsRisk(forecast);
    if (creditsRisk === "high" || creditsRisk === "medium") {
      creditsCritical += 1;
    }
    if (forecast.marginWarning === "high") {
      marginHigh += 1;
    }
    if (forecast.botQuotaRisk === "high" || forecast.botQuotaRisk === "medium") {
      botQuotaHigh += 1;
    }
    atRisk.push({
      enterpriseId: forecast.enterpriseId,
      planId: sub.planId,
      alerts,
      maxRisk: overallForecastRisk(forecast),
      concurrencyRisk: forecast.concurrencyRisk,
      creditsEtaDays: forecast.creditsEtaDays,
      marginWarning: forecast.marginWarning,
      forecastCostCents: forecast.forecastCostCents,
    });
  }

  atRisk.sort((a, b) => RISK_RANK[b.maxRisk] - RISK_RANK[a.maxRisk]);

  return {
    cycleStart,
    cycleEnd,
    computedAt: now.toISOString(),
    enterpriseCount: targets.length,
    summary: {
      concurrencyHigh,
      creditsCritical,
      marginHigh,
      botQuotaHigh,
      anyAlert,
    },
    atRiskEnterprises: atRisk.slice(0, 25),
  };
}
