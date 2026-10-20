// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { UsageLedgerEntry } from "../package-entitlement/types.js";
import {
  assessCostOverBudgetRisk,
  assessCreditsRisk,
  collectForecastAlertKinds,
} from "./alerts.js";
import { buildDailyProviderCostSeries } from "./daily-series.js";
import { buildConsumptionForecast } from "./engine.js";
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
    activeBots: 0,
    maxBots: 0,
    botsCreatedInCycle: 0,
    botGrowthRatePerDay: null,
    projectedBotsAtCycleEnd: null,
    botGrowthInsufficientData: true,
    botQuotaRisk: "none",
    ...overrides,
  };
}

describe("consumption-forecast daily-series", () => {
  it("builds zero-filled daily provider cost buckets", () => {
    const entries: UsageLedgerEntry[] = [
      {
        id: "e1",
        enterpriseId: "ent-1",
        taskId: "t1",
        modelId: "m1",
        tier: "t",
        policyId: "p",
        creditsCharged: 1,
        providerCostCents: 300,
        tenantRevenueCents: 500,
        occurredAt: "2026-06-02T12:00:00.000Z",
      },
    ];
    const series = buildDailyProviderCostSeries({
      entries,
      cycleStart: "2026-06-01T00:00:00.000Z",
      cycleEnd: "2026-07-01T00:00:00.000Z",
      now: new Date("2026-06-03T00:00:00.000Z"),
    });
    expect(series).toEqual([0, 300, 0]);
  });
});

describe("consumption-forecast alerts", () => {
  it("flags credits critical within 7 days", () => {
    expect(assessCreditsRisk(forecast({ creditsEtaDays: 5 }))).toBe("medium");
    expect(assessCreditsRisk(forecast({ creditsEtaDays: 2 }))).toBe("high");
  });

  it("assesses cost over budget risk", () => {
    expect(assessCostOverBudgetRisk(forecast({ forecastCostCents: 9500 }), 10000)).toBe("medium");
    expect(assessCostOverBudgetRisk(forecast({ forecastCostCents: 11000 }), 10000)).toBe("high");
  });

  it("collects alert kinds", () => {
    const kinds = collectForecastAlertKinds(
      forecast({ concurrencyRisk: "high", creditsEtaDays: 2 }),
      10000,
    );
    expect(kinds).toContain("concurrency");
    expect(kinds).toContain("credits");
  });
});

describe("consumption-forecast wma mode", () => {
  it("uses wma when daily series has 3+ days", () => {
    const built = buildConsumptionForecast({
      enterpriseId: "ent-wma",
      cycleStart: "2026-06-01T00:00:00.000Z",
      cycleEnd: "2026-07-01T00:00:00.000Z",
      now: new Date("2026-06-05T00:00:00.000Z"),
      billingMode: "enterprise_budget",
      accruedCostCents: 600,
      creditsRemaining: 0,
      monthlyCredits: 0,
      creditsConsumed: 0,
      concurrencyUsed: 0,
      concurrencyLimit: 0,
      runsInCycle: [],
      providerCostCents: 600,
      tenantRevenueCents: 800,
      marginCents: 200,
      dailyCostSeries: [100, 100, 200, 200],
    });
    expect(built.forecastCostMode).toBe("wma");
    expect(built.forecastCostCents).toBeGreaterThan(600);
  });
});
