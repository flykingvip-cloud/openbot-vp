import { describe, expect, it } from "vitest";
import type { Plan } from "../../../capability/cost-budget-billing/index.ts";
import { buildPlanRecommendationHealthRows } from "./plan-recommendation-health.ts";

const plan: Plan = {
  id: "plan-pro",
  name: "Professional",
  billingCycle: "monthly",
  basePriceCents: 49_900,
  currentVersionId: "pv-1",
  seatQuota: { viewer: 18, creator: 10 },
  botQuota: 120,
  status: "active",
  targetMarginRate: 0.75,
  guardMarginRate: 0.6,
  matchingProfile: { targetPersonas: ["team-6-20"] },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("buildPlanRecommendationHealthRows", () => {
  it("aggregates at-risk tenants by plan", () => {
    const rows = buildPlanRecommendationHealthRows({
      plans: [plan],
      economics: {
        startTime: "2026-06-01T00:00:00.000Z",
        endTime: "2026-06-30T00:00:00.000Z",
        activeCostVersionId: null,
        summary: {
          taskCount: 0,
          creditsCharged: 0,
          providerCostCents: 0,
          tenantRevenueCents: 0,
          marginCents: 0,
        },
        byPlan: {},
        byEnterprise: {},
        enterprisePlans: {},
      },
      forecastOverview: {
        cycleStart: "2026-06-01T00:00:00.000Z",
        cycleEnd: "2026-06-30T00:00:00.000Z",
        computedAt: "2026-06-15T00:00:00.000Z",
        enterpriseCount: 2,
        summary: {
          concurrencyHigh: 1,
          creditsCritical: 1,
          marginHigh: 0,
          botQuotaHigh: 0,
          anyAlert: 1,
        },
        atRiskEnterprises: [
          {
            enterpriseId: "acme",
            planId: "plan-pro",
            alerts: ["credits", "concurrency"],
            maxRisk: "high",
            concurrencyRisk: "high",
            creditsEtaDays: 5,
            marginWarning: "none",
            forecastCostCents: 1000,
          },
        ],
      },
      commercialSummary: null,
      versionMetaById: {},
      catalogPolicies: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.atRiskEnterpriseCount).toBe(1);
    expect(rows[0]?.upgradeAlertCount).toBe(1);
    expect(rows[0]?.targetPersonas).toEqual(["team-6-20"]);
  });
});
