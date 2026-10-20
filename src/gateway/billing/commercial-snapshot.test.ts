import { describe, expect, it } from "vitest";
import { buildCommercialMetricsSnapshot, fractionalTrendDelta } from "./commercial-snapshot.js";
import type { Plan, PlanVersion, Subscription, SubscriptionEvent } from "./types.js";

const PLAN: Plan = {
  id: "plan-a",
  name: "Starter",
  billingCycle: "monthly",
  basePriceCents: 99_00, // live 漂移价
  currentVersionId: "pv-1",
  seatQuota: {},
  botQuota: 5,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const VERSION: PlanVersion = {
  id: "pv-1",
  planId: "plan-a",
  version: 1,
  status: "active",
  snapshot: {
    basePriceCents: 49_00,
    seatQuota: {},
    botQuota: 5,
    pricing: [],
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  createdByUserId: "admin",
};

describe("commercial-snapshot", () => {
  it("reconstructs active subscriptions at a point in time with locked MRR", () => {
    const subscription: Subscription = {
      id: "sub-1",
      enterpriseId: "ent-a",
      planId: "plan-a",
      planVersionId: "pv-1",
      startTime: "2026-05-01T00:00:00.000Z",
      endTime: null,
      status: "active",
      createdAt: "2026-05-01T00:00:00.000Z",
      commercialContract: {
        billingCycle: "monthly",
        contractStart: "2026-05-01T00:00:00.000Z",
        contractEnd: "2026-06-01T00:00:00.000Z",
      },
    };
    const events: SubscriptionEvent[] = [
      {
        id: "ev-1",
        enterpriseId: "ent-a",
        subscriptionId: "sub-1",
        fromStatus: null,
        toStatus: "active",
        planVersionId: "pv-1",
        occurredAt: "2026-05-01T00:00:00.000Z",
      },
    ];
    const before = buildCommercialMetricsSnapshot({
      plans: [PLAN],
      planVersions: [VERSION],
      subscriptions: [subscription],
      events,
      asOf: "2026-05-15T00:00:00.000Z",
    });
    expect(before.activeSubscriptions).toBe(1);
    expect(before.mrrCents).toBe(49_00);
    expect(before.mrrCents).not.toBe(PLAN.basePriceCents);

    const afterCancel = buildCommercialMetricsSnapshot({
      plans: [PLAN],
      planVersions: [VERSION],
      subscriptions: [subscription],
      events: [
        ...events,
        {
          id: "ev-2",
          enterpriseId: "ent-a",
          subscriptionId: "sub-1",
          fromStatus: "active",
          toStatus: "canceled",
          planVersionId: "pv-1",
          occurredAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      asOf: "2026-06-15T00:00:00.000Z",
    });
    expect(afterCancel.activeSubscriptions).toBe(0);
    expect(afterCancel.mrrCents).toBe(0);
  });

  it("MRR is 0 without planVersions map (no live price fallback)", () => {
    const subscription: Subscription = {
      id: "sub-1",
      enterpriseId: "ent-a",
      planId: "plan-a",
      planVersionId: "pv-1",
      startTime: "2026-05-01T00:00:00.000Z",
      endTime: null,
      status: "active",
      createdAt: "2026-05-01T00:00:00.000Z",
    };
    const snap = buildCommercialMetricsSnapshot({
      plans: [PLAN],
      subscriptions: [subscription],
      events: [],
      asOf: "2026-05-15T00:00:00.000Z",
    });
    expect(snap.activeSubscriptions).toBe(1);
    expect(snap.mrrCents).toBe(0);
  });

  it("computes fractional trend delta", () => {
    expect(fractionalTrendDelta(110, 100)).toBeCloseTo(0.1);
    expect(fractionalTrendDelta(100, 0)).toBeNull();
  });
});
