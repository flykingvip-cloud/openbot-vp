// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { Plan } from "../../../capability/cost-budget-billing/index.ts";
import {
  buildExecutiveKpis,
  buildPlanOperatingRows,
  sortOperatingRows,
} from "./pricing-operating-dashboard.ts";

const PLAN: Plan = {
  id: "plan-growth",
  name: "Growth",
  billingCycle: "monthly",
  basePriceCents: 4900,
  currentVersionId: "pv-1",
  seatQuota: {},
  botQuota: 10,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("pricing-operating-dashboard", () => {
  it("builds executive KPIs from commercial and economics summaries", () => {
    const kpis = buildExecutiveKpis({
      plans: [PLAN],
      commercialSummary: {
        totals: { activeSubscriptions: 2, mrrCents: 9800 },
        plans: {},
      },
      economicsOverview: {
        startTime: "2026-06-01T00:00:00.000Z",
        endTime: "2026-06-30T00:00:00.000Z",
        activeCostVersionId: "cv-1",
        summary: {
          taskCount: 10,
          creditsCharged: 100,
          providerCostCents: 2500,
          tenantRevenueCents: 5000,
          marginCents: 2500,
        },
        byEnterprise: {},
        byPlan: {},
        marginTrendDelta: 0.05,
      },
    });
    expect(kpis.mrrCents).toBe(9800);
    expect(kpis.activePlanCount).toBe(1);
    expect(kpis.activeSubscriptions).toBe(2);
    expect(kpis.grossMarginRate).toBeCloseTo(0.5);
    expect(kpis.marginTrendDelta).toBeCloseTo(0.05);
  });

  it("builds operating rows with ARR and popular badge", () => {
    const rows = buildPlanOperatingRows({
      plans: [PLAN],
      commercialSummary: {
        totals: { activeSubscriptions: 2, mrrCents: 9800 },
        plans: {
          "plan-growth": {
            planId: "plan-growth",
            activeSubscriptions: 2,
            mrrCents: 9800,
            versions: {},
          },
        },
      },
      economicsOverview: null,
      versionMetaById: {},
      versionsByPlan: {
        "plan-growth": [
          {
            id: "pv-1",
            planId: "plan-growth",
            version: 2,
            status: "active",
            snapshot: {
              basePriceCents: 4900,
              seatQuota: {},
              botQuota: 10,
              pricing: [],
            },
            createdAt: "2026-01-01T00:00:00.000Z",
            createdByUserId: "u1",
          },
        ],
      },
      catalogPolicies: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.arrCents).toBe(9800 * 12);
    expect(rows[0]?.versionNumber).toBe(2);
    expect(rows[0]?.isPopular).toBe(true);
  });

  it("includes plan health fields from version meta", () => {
    const rows = buildPlanOperatingRows({
      plans: [PLAN],
      commercialSummary: {
        totals: { activeSubscriptions: 1, mrrCents: 4900 },
        plans: {
          "plan-growth": {
            planId: "plan-growth",
            activeSubscriptions: 1,
            mrrCents: 4900,
            versions: {},
          },
        },
      },
      economicsOverview: null,
      versionMetaById: {
        "pv-1": {
          versionId: "pv-1",
          version: 1,
          status: "active",
          bindingState: "valid",
          activationReady: true,
          activationBlockers: [],
          snapshot: { basePriceCents: 4900, seatQuota: {}, botQuota: 10, pricing: [] },
          binding: {
            planVersionId: "pv-1",
            allowedModelIds: ["ollama/llama3.2"],
            allowedTiers: ["tier_a"],
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      },
      versionsByPlan: {
        "plan-growth": [
          {
            id: "pv-1",
            planId: "plan-growth",
            version: 1,
            status: "active",
            snapshot: {
              basePriceCents: 4900,
              seatQuota: {},
              botQuota: 10,
              pricing: [],
            },
            createdAt: "2026-01-01T00:00:00.000Z",
            createdByUserId: "u1",
          },
        ],
      },
      catalogPolicies: [],
    });
    expect(rows[0]?.modelsBound).toBe(true);
    expect(rows[0]?.modelCount).toBe(1);
    expect(rows[0]?.tierCount).toBe(1);
    expect(rows[0]?.needsModels).toBe(false);
  });

  it("includes marketing tags from plan metadata", () => {
    const rows = buildPlanOperatingRows({
      plans: [{ ...PLAN, marketingTags: ["default", "recommended"] }],
      commercialSummary: {
        totals: { activeSubscriptions: 1, mrrCents: 4900 },
        plans: {
          "plan-growth": {
            planId: "plan-growth",
            activeSubscriptions: 1,
            mrrCents: 4900,
            versions: {},
          },
        },
      },
      economicsOverview: null,
      versionMetaById: {},
      versionsByPlan: {},
      catalogPolicies: [],
    });
    expect(rows[0]?.marketingTags).toEqual(["default", "recommended"]);
  });

  it("sorts operating rows by margin descending", () => {
    const rows = sortOperatingRows(
      [
        {
          planId: "a",
          planName: "A",
          activeSubscriptions: 1,
          sharePercent: 50,
          mrrCents: 1000,
          arrCents: 12000,
          versionNumber: 1,
          versionStatus: "active",
          providerCostCents: null,
          marginCents: null,
          marginRate: 0.5,
          marginSource: "projected",
          marginTrendDelta: null,
          subsTrendDelta: null,
          mrrTrendDelta: null,
          marketingTags: [],
          isPopular: false,
          isDeprecated: false,
          tierCount: 0,
          modelsBound: false,
          modelCount: 0,
          needsModels: false,
        },
        {
          planId: "b",
          planName: "B",
          activeSubscriptions: 1,
          sharePercent: 50,
          mrrCents: 2000,
          arrCents: 24000,
          versionNumber: 1,
          versionStatus: "active",
          providerCostCents: null,
          marginCents: null,
          marginRate: 0.8,
          marginSource: "projected",
          marginTrendDelta: null,
          subsTrendDelta: null,
          mrrTrendDelta: null,
          marketingTags: ["recommended"],
          isPopular: false,
          isDeprecated: false,
          tierCount: 0,
          modelsBound: false,
          modelCount: 0,
          needsModels: false,
        },
      ],
      "margin",
      true,
    );
    expect(rows[0]?.planId).toBe("b");
  });
});
