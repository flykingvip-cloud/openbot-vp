// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildCapacityRecommendations } from "./capacity-recommendations.js";
import type { ConsumptionForecast } from "./types.js";

function forecast(overrides: Partial<ConsumptionForecast> = {}): ConsumptionForecast {
  return {
    enterpriseId: "ent-1",
    cycleStart: "2026-06-01T00:00:00.000Z",
    cycleEnd: "2026-07-01T00:00:00.000Z",
    computedAt: "2026-06-10T00:00:00.000Z",
    forecastCostCents: 5000,
    forecastCostInsufficientData: false,
    creditsRemaining: 100,
    monthlyCredits: 1000,
    creditsEtaDays: 5,
    creditsEtaInsufficientData: false,
    concurrencyUsed: 1,
    concurrencyLimit: 4,
    concurrencyPeakInCycle: 2,
    concurrencyRisk: "none",
    marginCents: 1000,
    tenantRevenueCents: 5000,
    providerCostCents: 4000,
    marginRatio: 0.2,
    marginWarning: "none",
    forecastCostMode: "linear",
    activeBots: 5,
    maxBots: 10,
    botsCreatedInCycle: 2,
    botGrowthRatePerDay: 0.2,
    projectedBotsAtCycleEnd: 8,
    botGrowthInsufficientData: false,
    botQuotaRisk: "none",
    ...overrides,
  };
}

describe("capacity-recommendations", () => {
  const candidates = [
    {
      planId: "plan-starter",
      planName: "Starter",
      maxBots: 5,
      maxConcurrentRuns: 2,
      monthlyCredits: 500,
      monthlyPriceCents: 9900,
    },
    {
      planId: "plan-pro",
      planName: "Pro",
      maxBots: 20,
      maxConcurrentRuns: 8,
      monthlyCredits: 2000,
      monthlyPriceCents: 29900,
    },
  ];

  it("suggests plan upgrade when bot quota is high", () => {
    const recs = buildCapacityRecommendations({
      forecast: forecast({
        botQuotaRisk: "high",
        activeBots: 9,
        maxBots: 10,
        projectedBotsAtCycleEnd: 11,
        botQuotaRiskMessage: "即将触顶",
      }),
      currentPlanId: "plan-starter",
      currentPlanName: "Starter",
      upgradeCandidates: candidates,
    });
    expect(recs.some((r) => r.trigger === "bot_quota")).toBe(true);
    const botRec = recs.find((r) => r.trigger === "bot_quota");
    expect(botRec?.decisionOptions?.some((o) => o.planId === "plan-pro")).toBe(true);
  });

  it("suggests credits top-up when credits critical and no upgrade fits", () => {
    const recs = buildCapacityRecommendations({
      forecast: forecast({ creditsEtaDays: 2, creditsRemaining: 10 }),
      currentPlanId: "plan-pro",
      currentPlanName: "Pro",
      upgradeCandidates: candidates,
    });
    const creditsRec = recs.find((r) => r.trigger === "credits");
    expect(creditsRec?.kind).toBe("top_up_credits");
  });
});
