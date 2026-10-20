// @vitest-environment node
// Feature: cost-budget-billing
// Property 16: 版本锁定计费不可变性

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  assertBillingInputs,
  BillingDataIntegrityError,
  settleCycle,
  type SettleInput,
} from "./engine.ts";
import type { PlanPricing, PlanVersion, PlanVersionStatus, UsageRecord } from "./types.ts";

const CYCLE_START = "2026-03-01T00:00:00.000Z";
const CYCLE_END = "2026-03-31T00:00:00.000Z";

function pricing(versionId: string, aiTokenPrice: number): PlanPricing[] {
  return [
    {
      id: `${versionId}-p`,
      planId: "plan-1",
      planVersionId: versionId,
      type: "usage",
      key: "ai_token",
      priceCents: aiTokenPrice,
    },
  ];
}

function makeVersion(id: string, status: PlanVersionStatus, aiTokenPrice: number): PlanVersion {
  return {
    id,
    planId: "plan-1",
    version: 1,
    status,
    snapshot: {
      basePriceCents: 0,
      seatQuota: {},
      botQuota: 1000,
      pricing: pricing(id, aiTokenPrice),
    },
    createdAt: CYCLE_START,
    createdByUserId: "admin",
  };
}

function usage(qty: number): UsageRecord[] {
  return [
    {
      id: "u1",
      enterpriseId: "ent-1",
      userId: "u",
      eventId: "e1",
      key: "ai_token",
      quantity: qty,
      occurredAt: "2026-03-10T00:00:00.000Z",
      ingestedAt: "2026-03-10T00:00:00.000Z",
    },
  ];
}

function settleWith(version: PlanVersion, qty: number): number {
  const input: SettleInput = {
    enterpriseId: "ent-1",
    version,
    planVersionId: version.id,
    cycleStart: CYCLE_START,
    cycleEnd: CYCLE_END,
    date: "2026-03-10",
    intervals: [],
    usage: usage(qty),
    usageQuota: { ai_token: 1_000_000 },
    snapshotType: "final",
    generatedAt: CYCLE_START,
    billId: "b1",
    snapshotId: "s1",
  };
  return settleCycle(input).bill.usageCostCents;
}

describe("Property 16: 版本锁定计费不可变性", () => {
  it("锁定 v1 计费与后续是否存在 v2（不同价）无关", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50000 }),
        fc.integer({ min: 1, max: 100 }),
        (qty, v1Price) => {
          const v1 = makeVersion("pv-1", "deprecated", v1Price); // 即使 v1 已被废弃
          // 用锁定的 v1 计费，结果只取决于 v1 的快照
          expect(settleWith(v1, qty)).toBe(qty * v1Price);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("同一锁定版本两次结算结果一致（与全局 active 切换无关）", () => {
    const v1 = makeVersion("pv-1", "deprecated", 3);
    expect(settleWith(v1, 1000)).toBe(settleWith(v1, 1000));
  });
});

describe("assertBillingInputs 守卫", () => {
  it("缺 planVersionId 抛 BillingDataIntegrityError", () => {
    expect(() =>
      assertBillingInputs({ planVersionId: null, version: makeVersion("pv-1", "active", 2) }),
    ).toThrow(BillingDataIntegrityError);
  });

  it("缺快照抛错", () => {
    expect(() => assertBillingInputs({ planVersionId: "pv-1", version: null })).toThrow(
      BillingDataIntegrityError,
    );
  });

  it("version.id 与锁定 planVersionId 不一致抛错（拒绝错绑）", () => {
    expect(() =>
      assertBillingInputs({ planVersionId: "pv-2", version: makeVersion("pv-1", "active", 2) }),
    ).toThrow(BillingDataIntegrityError);
  });

  it("锁定版本快照可用（即使 deprecated）放行", () => {
    expect(() =>
      assertBillingInputs({ planVersionId: "pv-1", version: makeVersion("pv-1", "deprecated", 2) }),
    ).not.toThrow();
  });
});
