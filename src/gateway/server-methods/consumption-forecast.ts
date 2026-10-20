/**
 * 企业 Consumption Forecast RPC（P1）。
 */

import { getBudget } from "../billing/budgets-store.js";
import { overallForecastRisk, assessCostOverBudgetRisk } from "../consumption-forecast/alerts.js";
import { computeEnterpriseCapacityRecommendations } from "../consumption-forecast/compute-capacity-recommendations.js";
import { computeEnterpriseConsumptionForecast } from "../consumption-forecast/compute-enterprise-forecast.js";
import { computePlatformConsumptionForecastOverview } from "../consumption-forecast/compute-platform-overview.js";
import { requireEnterpriseScope, respondUnavailable } from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

export const consumptionForecastHandlers: GatewayRequestHandlers = {
  "consumption-forecast.get": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const forecast = await computeEnterpriseConsumptionForecast(scope.enterpriseId);
      if (!forecast) {
        respond(true, { subscribed: false, forecast: null, recommendations: [] });
        return;
      }
      const recommendations = await computeEnterpriseCapacityRecommendations(
        scope.enterpriseId,
        forecast,
      );
      respond(true, { subscribed: true, forecast, recommendations });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "consumption-forecast.platform-overview": async ({ respond }) => {
    try {
      const overview = await computePlatformConsumptionForecastOverview();
      respond(true, overview);
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "consumption-forecast.budget-signals": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const forecast = await computeEnterpriseConsumptionForecast(scope.enterpriseId);
      if (!forecast) {
        respond(true, { subscribed: false, forecast: null, budgetRisk: "none" as const });
        return;
      }
      const budget = await getBudget(scope.enterpriseId);
      const monthlyBudgetCents = budget?.monthlyLimitCents ?? 0;
      const budgetRisk = assessCostOverBudgetRisk(forecast, monthlyBudgetCents);
      respond(true, {
        subscribed: true,
        forecast,
        budgetRisk,
        overallRisk: overallForecastRisk(forecast, monthlyBudgetCents),
        monthlyBudgetCents,
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
