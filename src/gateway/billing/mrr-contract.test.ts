// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveContractNormalizedMrr } from "./mrr-contract.js";
import type { Plan, PlanVersion, Subscription } from "./types.js";

const plan: Plan = {
  id: "plan-a",
  name: "Pro",
  billingCycle: "monthly",
  basePriceCents: 99_00, // live 头价（应被忽略）
  currentVersionId: "pv-1",
  seatQuota: {},
  botQuota: 5,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const lockedVersion: PlanVersion = {
  id: "pv-1",
  planId: "plan-a",
  version: 1,
  status: "active",
  snapshot: {
    basePriceCents: 49_00, // 锁定价
    seatQuota: {},
    botQuota: 5,
    pricing: [],
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  createdByUserId: "admin",
};

describe("resolveContractNormalizedMrr", () => {
  it("uses locked planVersion price not live plan basePrice", () => {
    const sub: Subscription = {
      id: "sub-1",
      enterpriseId: "ent-a",
      planId: "plan-a",
      planVersionId: "pv-1",
      startTime: "2026-01-01T00:00:00.000Z",
      endTime: null,
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      commercialContract: {
        billingCycle: "monthly",
        contractStart: "2026-01-01T00:00:00.000Z",
        contractEnd: "2026-02-01T00:00:00.000Z",
      },
    };
    const r = resolveContractNormalizedMrr({
      subscription: sub,
      planVersion: lockedVersion,
      plan,
    });
    expect(r.versionLocked).toBe(true);
    expect(r.mrrCents).toBe(49_00);
    expect(r.mrrCents).not.toBe(plan.basePriceCents);
  });

  it("normalizes annual contract to effective monthly MRR", () => {
    const sub: Subscription = {
      id: "sub-2",
      enterpriseId: "ent-a",
      planId: "plan-a",
      planVersionId: "pv-1",
      startTime: "2026-01-01T00:00:00.000Z",
      endTime: null,
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      commercialContract: {
        billingCycle: "annual",
        contractStart: "2026-01-01T00:00:00.000Z",
        contractEnd: "2027-01-01T00:00:00.000Z",
      },
    };
    const r = resolveContractNormalizedMrr({
      subscription: sub,
      planVersion: lockedVersion,
      plan,
    });
    // 4900 * 12 * 0.85 / 12 = round(4900 * 0.85) effective monthly
    expect(r.billingCycle).toBe("annual");
    expect(r.mrrCents).toBe(r.quote.effectiveMonthlyCents);
    expect(r.mrrCents).toBeLessThan(49_00); // annual discount
    expect(r.quote.totalCents).toBe(Math.round(49_00 * 12 * 0.85));
  });

  it("refuses live plan price when version missing (no drift)", () => {
    const sub: Subscription = {
      id: "sub-3",
      enterpriseId: "ent-a",
      planId: "plan-a",
      planVersionId: "pv-missing",
      startTime: "2026-01-01T00:00:00.000Z",
      endTime: null,
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const r = resolveContractNormalizedMrr({
      subscription: sub,
      planVersion: null,
      plan,
    });
    expect(r.versionLocked).toBe(false);
    expect(r.mrrCents).toBe(0);
  });
});
