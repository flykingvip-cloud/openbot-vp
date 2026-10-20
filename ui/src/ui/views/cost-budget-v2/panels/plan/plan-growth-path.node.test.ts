import { describe, expect, it } from "vitest";
import type { SubscriptionGetResponse } from "../../../../capability/cost-budget-billing/index.ts";
import type { OperationsStoreState } from "../../stores/operations-store.ts";
import {
  buildPlanGrowthPathContext,
  expandSeriesToChartWindow,
  growthDeltaLabel,
  resolveGrowthChartWindow,
} from "./plan-growth-path.ts";

function subscription(): SubscriptionGetResponse {
  return {
    subscription: {
      id: "sub-1",
      planId: "starter",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    planView: {
      id: "scale",
      name: "Scale",
      botQuota: 100,
      seatQuota: { viewer: 80, creator: 20 },
      billingCycle: "monthly",
      basePriceCents: 199900,
      currentVersionId: "pv-scale",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
    pricingView: [],
    availablePlans: [
      {
        id: "starter",
        name: "Starter",
        botQuota: 30,
        seatQuota: { viewer: 10 },
        billingCycle: "monthly",
        basePriceCents: 49900,
        currentVersionId: "pv-starter",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "scale",
        name: "Scale",
        botQuota: 100,
        seatQuota: { viewer: 80, creator: 20 },
        billingCycle: "monthly",
        basePriceCents: 199900,
        currentVersionId: "pv-scale",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ],
    planEntitlements: {
      starter: { maxConcurrentRuns: 10, monthlyCredits: 5000, allowedTiers: ["tier_a"] },
      scale: {
        maxConcurrentRuns: 32,
        monthlyCredits: 30000,
        allowedTiers: ["tier_a", "tier_b", "tier_c"],
      },
    },
    entitlementSnapshot: {
      maxConcurrentRuns: 32,
      monthlyCredits: 30000,
      allowedTiers: ["tier_a", "tier_b", "tier_c"],
    },
  } as unknown as SubscriptionGetResponse;
}

function operations(): OperationsStoreState {
  return {
    status: "success",
    loading: false,
    loadAttempted: true,
    loadPartialFailure: false,
    error: null,
    dashboardError: null,
    allocationError: null,
    seatsError: null,
    budgetError: null,
    resourcesError: null,
    creditsError: null,
    forecastError: null,
    dashboard: null,
    allocation: {
      seats: [{ grantedModelCount: 1 }, { grantedModelCount: 1 }],
      ceiling: {
        allowedTiers: ["tier_a", "tier_b", "tier_c"],
        entitledModelCount: 3,
        monthlyCredits: 30000,
      },
    } as never,
    seats: null,
    budget: null,
    resources: {
      usedBots: 12,
      quota: 100,
      ratio: 0.12,
      perUser: {},
      concurrencyUsed: 5,
      concurrencyLimit: 32,
    },
    creditCycles: null,
    forecast: { concurrencyPeakInCycle: 18 } as never,
  };
}

describe("plan-growth-path", () => {
  it("builds summary and trend series from plan milestones", () => {
    const context = buildPlanGrowthPathContext({
      subscription: subscription(),
      operations: operations(),
      orders: [
        {
          id: "ord-1",
          kind: "change_plan",
          status: "paid",
          amountCents: 1000,
          planId: "starter",
          fromPlanId: "starter",
          targetPlanId: "scale",
          paidAt: "2026-06-01T00:00:00.000Z",
        },
      ],
    });
    expect(context).not.toBeNull();
    expect(context!.summaries).toHaveLength(5);
    expect(context!.summaries.find((item) => item.id === "bots")?.value).toBe("12 / 100");
    expect(context!.seriesByMetric.bots.points.length).toBeGreaterThanOrEqual(2);
    expect(context!.seriesByMetric.bots.points[0]?.value).toBe(30);
    expect(context!.seriesByMetric.bots.points.at(-1)?.value).toBe(100);
    expect(growthDeltaLabel(context!.seriesByMetric.bots.points)).toContain("70");
  });

  it("renders compact tier labels in summary", () => {
    const context = buildPlanGrowthPathContext({
      subscription: subscription(),
      operations: operations(),
      orders: [],
    });
    const tiers = context!.summaries.find((item) => item.id === "tiers");
    expect(tiers?.value).toBe("Tier A + Tier B + Tier C");
    expect(tiers?.value).not.toContain("tier_a");
    expect(tiers?.value).not.toContain("进阶模型");
  });

  it("builds credits series from billing-cycle consumption instead of plan milestones", () => {
    const context = buildPlanGrowthPathContext({
      subscription: {
        ...subscription(),
        creditsStatus: {
          cycleStart: "2026-06-01T00:00:00.000Z",
          monthlyCredits: 30000,
          creditsConsumed: 8200,
          creditsRemaining: 21800,
        },
      },
      operations: {
        ...operations(),
        creditCycles: [
          {
            cycleStart: "2026-05-01T00:00:00.000Z",
            monthlyCredits: 5000,
            creditsConsumed: 4100,
            creditsRemaining: 900,
            updatedAt: "2026-05-31T23:59:59.000Z",
          },
          {
            cycleStart: "2026-06-01T00:00:00.000Z",
            monthlyCredits: 30000,
            creditsConsumed: 8200,
            creditsRemaining: 21800,
            updatedAt: "2026-06-15T12:00:00.000Z",
          },
        ],
      },
      orders: [
        {
          id: "ord-1",
          kind: "change_plan",
          status: "paid",
          amountCents: 1000,
          planId: "starter",
          targetPlanId: "scale",
          paidAt: "2026-06-01T00:00:00.000Z",
        },
      ],
    });
    const credits = context!.seriesByMetric.credits;
    expect(credits.mode).toBe("billing_cycle_usage");
    expect(credits.points).toHaveLength(2);
    expect(credits.points[0]?.value).toBe(4100);
    expect(credits.points[1]?.value).toBe(8200);
    expect(credits.points[1]?.quota).toBe(30000);
    expect(growthDeltaLabel(credits.points, { mode: credits.mode })).toContain("4100");
  });

  it("caps subscription chart window to one year", () => {
    const now = Date.parse("2026-06-24T12:00:00.000Z");
    const window = resolveGrowthChartWindow("2024-01-01T00:00:00.000Z", "subscription", now);
    const spanDays =
      (Date.parse(window.endAt) - Date.parse(window.startAt)) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeLessThanOrEqual(365);
    expect(spanDays).toBeGreaterThan(364);
  });

  it("expands entitlement series to subscription window with start and end anchors", () => {
    const context = buildPlanGrowthPathContext({
      subscription: subscription(),
      operations: operations(),
      orders: [
        {
          id: "ord-1",
          kind: "change_plan",
          status: "paid",
          amountCents: 1000,
          planId: "starter",
          fromPlanId: "starter",
          targetPlanId: "scale",
          paidAt: "2026-06-01T00:00:00.000Z",
        },
      ],
    });
    const now = Date.parse("2026-06-24T12:00:00.000Z");
    const window = resolveGrowthChartWindow(context!.subscriptionCreatedAt, "subscription", now);
    const expanded = expandSeriesToChartWindow(context!.seriesByMetric.bots.points, window, {
      mode: "entitlement_milestones",
      metricId: "bots",
      milestones: context!.milestones,
      subscription: subscription(),
    });
    expect(expanded[0]?.at).toBe(window.startAt);
    expect(expanded.at(-1)?.at).toBe(window.endAt);
    expect(expanded.at(-1)?.value).toBe(100);
  });
});
