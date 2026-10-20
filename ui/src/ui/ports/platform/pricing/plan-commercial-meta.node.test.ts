import { describe, expect, it } from "vitest";
import {
  planCommercialMetrics,
  planDisplayMeta,
  versionCommercialMeta,
  versionLockedSubscriptions,
} from "./plan-commercial-meta.ts";

describe("plan-commercial-meta", () => {
  const versionMetaById = {
    "pv-1": {
      versionId: "pv-1",
      version: 1,
      status: "active",
      snapshot: {
        basePriceCents: 0,
        seatQuota: {},
        botQuota: 12,
        pricing: [],
      },
      binding: {
        planVersionId: "pv-1",
        allowedModelIds: ["m1"],
        allowedTiers: ["tier_a", "tier_b"],
        allowedPolicies: ["balanced"],
        policyId: "balanced",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      entitlementSnapshot: {
        planVersionId: "pv-1",
        monthlyPriceCents: 0,
        monthlyCredits: 1200,
        maxSeats: {},
        maxBots: 12,
        maxConcurrentRuns: 4,
        allowedPolicies: ["balanced"],
        allowedTiers: ["tier_a", "tier_b"],
        overagePolicy: { type: "block" as const, allowBurstConcurrency: false },
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      bindingState: "valid",
      activationReady: true,
      activationBlockers: [],
    },
  };

  const versionsByPlan = {
    "plan-1": [
      {
        id: "pv-1",
        planId: "plan-1",
        version: 1,
        status: "active",
        snapshot: {
          basePriceCents: 0,
          seatQuota: {},
          botQuota: 12,
          pricing: [],
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        createdByUserId: "admin",
      },
    ],
  };

  const commercialSummary = {
    totals: {
      activeSubscriptions: 2,
      mrrCents: 9800,
    },
    plans: {
      "plan-1": {
        planId: "plan-1",
        activeSubscriptions: 2,
        mrrCents: 9800,
        versions: {
          "pv-1": { lockedSubscriptions: 2 },
        },
      },
    },
  };

  it("projects plan display meta from current version", () => {
    expect(planDisplayMeta({ currentVersionId: "pv-1" }, versionMetaById as never)).toEqual({
      tiers: ["tier_a", "tier_b"],
      monthlyCredits: 1200,
      policyId: "balanced",
    });
  });

  it("projects version commercial meta and bot quota", () => {
    expect(
      versionCommercialMeta("pv-1", versionMetaById as never, versionsByPlan as never),
    ).toEqual({
      tiers: ["tier_a", "tier_b"],
      monthlyCredits: 1200,
      policyId: "balanced",
      botQuota: 12,
    });
  });

  it("resolves commercial metrics and locked subscription counts", () => {
    expect(planCommercialMetrics("plan-1", commercialSummary as never)?.mrrCents).toBe(9800);
    expect(versionLockedSubscriptions("plan-1", "pv-1", commercialSummary as never)).toBe(2);
    expect(versionLockedSubscriptions("plan-1", "missing", commercialSummary as never)).toBe(0);
  });
});
