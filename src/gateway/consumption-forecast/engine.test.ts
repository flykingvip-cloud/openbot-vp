// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { AgentRunRecord } from "../billing/agent-run-registry.js";
import {
  assessConcurrencyRisk,
  assessMarginWarning,
  buildConsumptionForecast,
  computeCreditsEtaDays,
  peakConcurrentRuns,
} from "./engine.js";

describe("consumption-forecast engine", () => {
  it("peakConcurrentRuns finds overlap peak", () => {
    const runs: AgentRunRecord[] = [
      {
        runId: "a",
        enterpriseId: "ent-1",
        startedAt: "2026-06-01T10:00:00.000Z",
        finishedAt: "2026-06-01T10:30:00.000Z",
      },
      {
        runId: "b",
        enterpriseId: "ent-1",
        startedAt: "2026-06-01T10:10:00.000Z",
        finishedAt: "2026-06-01T10:20:00.000Z",
      },
      {
        runId: "c",
        enterpriseId: "ent-1",
        startedAt: "2026-06-01T10:15:00.000Z",
        finishedAt: "2026-06-01T10:25:00.000Z",
      },
    ];
    expect(peakConcurrentRuns(runs, Date.parse("2026-06-01T11:00:00.000Z"))).toBe(3);
  });

  it("computeCreditsEtaDays extrapolates burn rate", () => {
    expect(
      computeCreditsEtaDays({ creditsRemaining: 100, creditsConsumed: 50, elapsedDays: 10 }),
    ).toEqual({
      etaDays: 20,
      insufficientData: false,
    });
    expect(
      computeCreditsEtaDays({ creditsRemaining: 10, creditsConsumed: 0, elapsedDays: 5 }),
    ).toEqual({
      etaDays: null,
      insufficientData: true,
    });
  });

  it("assessConcurrencyRisk escalates near limit", () => {
    expect(
      assessConcurrencyRisk({ concurrencyUsed: 4, concurrencyLimit: 5, concurrencyPeakInCycle: 4 })
        .level,
    ).toBe("low");
    expect(
      assessConcurrencyRisk({ concurrencyUsed: 5, concurrencyLimit: 5, concurrencyPeakInCycle: 5 })
        .level,
    ).toBe("high");
    expect(
      assessConcurrencyRisk({ concurrencyUsed: 1, concurrencyLimit: 0, concurrencyPeakInCycle: 3 })
        .level,
    ).toBe("none");
  });

  it("assessMarginWarning flags negative margin", () => {
    const warn = assessMarginWarning({ marginCents: -100, tenantRevenueCents: 500 });
    expect(warn.level).toBe("high");
    expect(warn.ratio).toBeLessThan(0);
  });

  it("buildConsumptionForecast assembles four outputs", () => {
    const forecast = buildConsumptionForecast({
      enterpriseId: "ent-x",
      cycleStart: "2026-06-01T00:00:00.000Z",
      cycleEnd: "2026-07-01T00:00:00.000Z",
      now: new Date("2026-06-11T00:00:00.000Z"),
      billingMode: "credits",
      accruedCostCents: 1000,
      creditsRemaining: 400,
      monthlyCredits: 1000,
      creditsConsumed: 600,
      concurrencyUsed: 3,
      concurrencyLimit: 4,
      runsInCycle: [],
      providerCostCents: 800,
      tenantRevenueCents: 1200,
      marginCents: 400,
    });
    expect(forecast.forecastCostCents).toBeGreaterThan(1000);
    expect(forecast.creditsEtaDays).toBe(7);
    expect(forecast.concurrencyRisk).toBe("low");
    expect(forecast.marginWarning).toBe("none");
    expect(forecast.activeBots).toBe(0);
    expect(forecast.botQuotaRisk).toBe("none");
  });
});
