import { describe, expect, it } from "vitest";
import type { Plan } from "../../../capability/cost-budget-billing/index.ts";
import type { RoutingPolicy } from "../../../capability/policy-engine/index.ts";
import type { ResourceTier } from "../../../capability/resource-catalog/index.ts";
import { groupModelsByTier } from "./resource-catalog-display.ts";
import {
  buildGovernanceOverviewKpis,
  buildGovernanceSystemSignals,
  buildPlanAuthorizationRows,
  countEnterprisesServingTier,
  modelCostLevelLabel,
} from "./resource-catalog-governance.ts";

const TIERS: ResourceTier[] = [
  {
    id: "tier_a",
    code: "A",
    name: "Tier A",
    description: "",
    sortOrder: 0,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "tier_b",
    code: "B",
    name: "Tier B",
    description: "",
    sortOrder: 1,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

const PLAN: Plan = {
  id: "plan_pro",
  name: "专业版",
  status: "active",
  billingCycle: "monthly",
  basePriceCents: 9900,
  seatQuota: {},
  botQuota: 50,
  currentVersionId: "pv-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const POLICIES: RoutingPolicy[] = [
  {
    id: "balanced",
    name: "Balanced",
    description: "",
    selectorStrategy: "balanced",
    status: "active",
    builtin: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("resource-catalog-governance console helpers", () => {
  it("builds overview KPIs from catalog and commercial summary", () => {
    const kpis = buildGovernanceOverviewKpis(
      [
        {
          modelId: "openai/gpt-4o",
          provider: "openai",
          displayName: "GPT-4o",
          tier: "tier_b",
          enabled: true,
          inputCostPer1MCents: 0,
          outputCostPer1MCents: 0,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          modelId: "openai/gpt-4o-mini",
          provider: "openai",
          displayName: "GPT-4o mini",
          tier: "tier_a",
          enabled: false,
          inputCostPer1MCents: 0,
          outputCostPer1MCents: 0,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      TIERS,
      {
        commercialSummary: {
          totals: { activeSubscriptions: 182, mrrCents: 1_242_000 },
          plans: {},
        },
        economicsSummary: {
          taskCount: 10,
          creditsCharged: 100,
          providerCostCents: 1_242_000,
          tenantRevenueCents: 2_000_000,
          marginCents: 758_000,
        },
      },
    );
    expect(kpis.activeModels).toBe(1);
    expect(kpis.tierCount).toBe(2);
    expect(kpis.enterpriseCount).toBe(182);
    expect(kpis.periodCostCents).toBe(1_242_000);
  });

  it("emits pressure and failure signals from tier usage stats", () => {
    const groups = groupModelsByTier({
      tiers: TIERS,
      models: [],
      creditWeights: [
        { tier: "tier_a", creditCost: 1, updatedAt: "2026-01-01T00:00:00.000Z" },
        { tier: "tier_b", creditCost: 5, updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
    });
    const signals = buildGovernanceSystemSignals(
      groups,
      [
        { tierId: "tier_b", taskCount: 1000, avgLatencyMs: 5200, failureRate: 2.4 },
        { tierId: "tier_a", taskCount: 500, avgLatencyMs: 800, failureRate: 0.5 },
      ],
      [],
    );
    expect(signals.some((signal) => signal.messageKey === "governanceStatusTierPressure")).toBe(
      true,
    );
    expect(signals.some((signal) => signal.messageKey === "governanceStatusHighFailure")).toBe(
      true,
    );
  });

  it("builds plan authorization rows and enterprise counts per tier", () => {
    const options = {
      plans: [PLAN],
      versionMetaById: {
        "pv-1": {
          binding: { allowedTiers: ["tier_b"], policyId: "balanced" },
          entitlementSnapshot: {
            maxBots: 50,
            maxConcurrentRuns: 20,
            allowedTiers: ["tier_b"],
          },
        },
      },
      commercialSummary: {
        totals: { activeSubscriptions: 82, mrrCents: 0 },
        plans: {
          plan_pro: {
            planId: "plan_pro",
            activeSubscriptions: 82,
            mrrCents: 0,
            versions: {},
          },
        },
      },
    };
    const rows = buildPlanAuthorizationRows(TIERS, options, POLICIES);
    expect(rows[0]?.planName).toBe("专业版");
    expect(rows[0]?.tierLabels).toBe("Tier B");
    expect(rows[0]?.policyLabel).toBe("Balanced");
    expect(rows[0]?.maxConcurrentLabel).toBe("20");
    expect(countEnterprisesServingTier("tier_b", options)).toBe(82);
  });

  it("maps credit cost to model cost level bands", () => {
    expect(modelCostLevelLabel(1)).toBe("low");
    expect(modelCostLevelLabel(5)).toBe("mid");
    expect(modelCostLevelLabel(12)).toBe("high");
  });
});
