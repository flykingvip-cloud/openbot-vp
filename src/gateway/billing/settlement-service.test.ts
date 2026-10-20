// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.ts";
import {
  ContractEndedError,
  NoCompletedCycleError,
  NoPendingSettlementError,
} from "./billing-period.ts";
import {
  __resetLedgerForTest,
  findFinalSettlementByKey,
  listBills,
  listSnapshots,
} from "./ledger-store.ts";
import { createPlan, __resetPlansForTest } from "./plans-store.ts";
import type { BillingStorePaths } from "./runtime.ts";
import { resolveSettlementBillingCycle, settleEnterpriseCycle } from "./settlement-service.ts";
import {
  createSubscription,
  setSubscriptionCommercialContract,
  __resetSubscriptionsForTest,
} from "./subscriptions-store.ts";
import { recordUsage } from "./usage-records-store.ts";

let tmpDir: string;
let paths: BillingStorePaths & { ledger: string; entitlementSnapshot: string };

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ob-settle-"));
  paths = {
    plans: path.join(tmpDir, "plans.json"),
    subscriptions: path.join(tmpDir, "subs.json"),
    seats: path.join(tmpDir, "seats.json"),
    usage: path.join(tmpDir, "usage.json"),
    resources: path.join(tmpDir, "res.json"),
    ledger: path.join(tmpDir, "ledger.json"),
    entitlementSnapshot: path.join(tmpDir, "entitlement.json"),
  };
  await __resetPlansForTest(paths.plans);
  await __resetSubscriptionsForTest(paths.subscriptions);
  await __resetLedgerForTest(paths.ledger);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function seedEnterprise(
  enterpriseId: string,
  opts?: { contractStart?: string; cycle?: "monthly" | "annual" },
) {
  const plan = await createPlan(
    {
      name: "Pro",
      billingCycle: opts?.cycle ?? "monthly",
      basePriceCents: 99_00,
      seatQuota: { viewer: 5, creator: 2, admin: 1 },
      botQuota: 10,
      pricing: [
        { type: "seat", key: "viewer", priceCents: 1000 },
        { type: "seat", key: "creator", priceCents: 3000 },
        { type: "seat", key: "admin", priceCents: 5000 },
        { type: "extra", key: "ai_credits", priceCents: 2 },
      ],
      createdByUserId: "admin",
    },
    paths.plans,
  );
  const versionId = plan.currentVersionId;
  const contractStart = opts?.contractStart ?? "2026-01-01T00:00:00.000Z";
  // 权益必须在订阅绑定前写入（版本被引用后冻结）。
  await upsertPlanEntitlementSnapshot(
    {
      planVersionId: versionId,
      monthlyPriceCents: 99_00,
      monthlyCredits: 10_000,
      maxBots: 10,
      maxSeats: { viewer: 5 },
    },
    paths.entitlementSnapshot,
    { plans: paths.plans, subscriptions: paths.subscriptions },
  );
  const sub = await createSubscription(
    {
      enterpriseId,
      planId: plan.id,
      planVersionId: versionId,
      startTime: contractStart,
    },
    paths.subscriptions,
  );
  const months = opts?.cycle === "annual" ? 12 : 1;
  const end = new Date(contractStart);
  end.setUTCMonth(end.getUTCMonth() + months);
  await setSubscriptionCommercialContract(
    enterpriseId,
    sub.id,
    {
      billingCycle: opts?.cycle ?? "monthly",
      contractStart,
      contractEnd: end.toISOString(),
    },
    paths.subscriptions,
  );
  return { plan, versionId, sub, contractStart };
}

describe("settleEnterpriseCycle — completed cycle final", () => {
  it("rejects final when no completed cycle yet", async () => {
    await seedEnterprise("ent-a");
    await expect(
      settleEnterpriseCycle({
        enterpriseId: "ent-a",
        mode: "final",
        now: new Date("2026-01-15T00:00:00.000Z"),
        storePaths: paths,
      }),
    ).rejects.toBeInstanceOf(NoCompletedCycleError);
  });

  it("allows estimated preview mid-cycle on containing window", async () => {
    await seedEnterprise("ent-a");
    const result = await settleEnterpriseCycle({
      enterpriseId: "ent-a",
      mode: "estimated",
      now: new Date("2026-01-15T00:00:00.000Z"),
      storePaths: paths,
    });
    expect(result!.mode).toBe("estimated");
    expect(result!.cycle.periodIndex).toBe(0);
    expect(await listBills("ent-a", paths.ledger)).toHaveLength(0);
  });

  it("final settles latest completed cycle (not open containing)", async () => {
    await seedEnterprise("ent-a");
    // mid Feb → final period 0 [Jan1, Feb1)
    const result = await settleEnterpriseCycle({
      enterpriseId: "ent-a",
      mode: "final",
      now: new Date("2026-02-15T00:00:00.000Z"),
      storePaths: paths,
    });
    expect(result!.deduped).toBe(false);
    expect(result!.cycle.periodIndex).toBe(0);
    expect(result!.bill.cycleStart).toBe("2026-01-01T00:00:00.000Z");
    expect(result!.bill.cycleEnd).toBe("2026-02-01T00:00:00.000Z");
    expect(result!.snapshot.settlementKey).toBe(result!.settlementKey);
    expect(result!.snapshot.billId).toBe(result!.bill.id);
  });

  it("after sole completed cycle settled, default final returns no pending; explicit cycleStart re-reads", async () => {
    await seedEnterprise("ent-a");
    const now = new Date("2026-02-01T00:00:00.000Z");
    const first = await settleEnterpriseCycle({
      enterpriseId: "ent-a",
      mode: "final",
      now,
      storePaths: paths,
    });
    // 所有已完成周期均已结算 → 默认再次调用明确无待结，不重复生成账单
    await expect(
      settleEnterpriseCycle({
        enterpriseId: "ent-a",
        mode: "final",
        now,
        storePaths: paths,
      }),
    ).rejects.toBeInstanceOf(NoPendingSettlementError);

    // 显式历史周期：幂等返回已落账的 bill+snapshot
    const second = await settleEnterpriseCycle({
      enterpriseId: "ent-a",
      mode: "final",
      now,
      cycleStart: first!.cycle.cycleStart,
      storePaths: paths,
    });
    expect(second!.deduped).toBe(true);
    expect(second!.bill.id).toBe(first!.bill.id);
    expect(second!.snapshot.id).toBe(first!.snapshot.id);
    expect(second!.snapshot.totalCostCents).toBe(first!.snapshot.totalCostCents);

    const stored = await findFinalSettlementByKey("ent-a", first!.settlementKey, paths.ledger);
    expect(stored!.bill.id).toBe(first!.bill.id);
    expect(stored!.snapshot.id).toBe(first!.snapshot.id);
    expect(await listBills("ent-a", paths.ledger)).toHaveLength(1);
    expect(await listSnapshots("ent-a", { snapshotType: "final" }, paths.ledger)).toHaveLength(1);
  });

  it("concurrent finals: single bill, single snapshot, same amounts", async () => {
    await seedEnterprise("ent-b");
    const now = new Date("2026-02-01T00:00:00.000Z");
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        settleEnterpriseCycle({
          enterpriseId: "ent-b",
          mode: "final",
          now,
          storePaths: paths,
        }),
      ),
    );
    const billIds = new Set(results.map((r) => r!.bill.id));
    const snapIds = new Set(results.map((r) => r!.snapshot.id));
    const totals = new Set(results.map((r) => r!.bill.totalCostCents));
    expect(billIds.size).toBe(1);
    expect(snapIds.size).toBe(1);
    expect(totals.size).toBe(1);
    expect(await listBills("ent-b", paths.ledger)).toHaveLength(1);
    expect(await listSnapshots("ent-b", { snapshotType: "final" }, paths.ledger)).toHaveLength(1);
  });

  it("concurrent amount stability after usage recorded in completed cycle", async () => {
    const { sub } = await seedEnterprise("ent-c");
    await recordUsage(
      {
        enterpriseId: "ent-c",
        userId: "u1",
        eventId: "ev-1",
        key: "ai_credits",
        quantity: 50,
        occurredAt: "2026-01-10T00:00:00.000Z",
      },
      paths.usage,
    );
    void sub;
    const now = new Date("2026-02-05T00:00:00.000Z");
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        settleEnterpriseCycle({
          enterpriseId: "ent-c",
          mode: "final",
          now,
          storePaths: paths,
        }),
      ),
    );
    const amounts = results.map((r) => r!.bill.totalCostCents);
    expect(new Set(amounts).size).toBe(1);
  });

  it("isolates tenants", async () => {
    await seedEnterprise("ent-a");
    await seedEnterprise("ent-b");
    const now = new Date("2026-02-01T00:00:00.000Z");
    await settleEnterpriseCycle({
      enterpriseId: "ent-a",
      mode: "final",
      now,
      storePaths: paths,
    });
    await settleEnterpriseCycle({
      enterpriseId: "ent-b",
      mode: "final",
      now,
      storePaths: paths,
    });
    expect((await listBills("ent-a", paths.ledger))[0].enterpriseId).toBe("ent-a");
    expect(await listBills("ent-a", paths.ledger)).toHaveLength(1);
    expect(await listBills("ent-b", paths.ledger)).toHaveLength(1);
  });

  it("end-of-month anchor recovery across multi-month continuous subscription", async () => {
    await seedEnterprise("ent-eom", { contractStart: "2026-01-31T00:00:00.000Z" });
    // Settle March 15 → completed period covering Feb window from Jan31 anchor
    const r = await settleEnterpriseCycle({
      enterpriseId: "ent-eom",
      mode: "final",
      now: new Date("2026-03-15T00:00:00.000Z"),
      storePaths: paths,
    });
    // containing mid-Mar is period 1 [Feb28, Mar31); completed is period 0 or 1?
    // Mar 15 containing: periodIndex for Jan31 monthly:
    // p0 [Jan31, Feb28), p1 [Feb28, Mar31), p2 [Mar31, Apr30)
    // Mar 15 → period 1, completed = period 0
    expect(r!.cycle.periodIndex).toBe(0);
    expect(r!.bill.cycleStart).toBe("2026-01-31T00:00:00.000Z");
    expect(r!.bill.cycleEnd).toBe("2026-02-28T00:00:00.000Z");
  });

  it("fault injection: retry with explicit cycleStart still dedupes after first commit", async () => {
    await seedEnterprise("ent-fault");
    const now = new Date("2026-02-01T00:00:00.000Z");
    const first = await settleEnterpriseCycle({
      enterpriseId: "ent-fault",
      mode: "final",
      now,
      storePaths: paths,
    });
    // 崩溃重试：用 settlementKey 对应 cycleStart 再请求 → 幂等复用
    const retry = await settleEnterpriseCycle({
      enterpriseId: "ent-fault",
      mode: "final",
      now: new Date("2026-02-01T01:00:00.000Z"),
      cycleStart: first!.cycle.cycleStart,
      storePaths: paths,
    });
    expect(retry!.deduped).toBe(true);
    expect(retry!.bill.totalCostCents).toBe(first!.bill.totalCostCents);
    expect(retry!.snapshot.id).toBe(first!.snapshot.id);
  });
});

describe("settleEnterpriseCycle — backlog earliest unfinalized", () => {
  async function seedMultiMonth(
    enterpriseId: string,
    opts?: { contractStart?: string; contractMonths?: number },
  ) {
    const contractStart = opts?.contractStart ?? "2026-01-01T00:00:00.000Z";
    const months = opts?.contractMonths ?? 12;
    const plan = await createPlan(
      {
        name: "Pro",
        billingCycle: "monthly",
        basePriceCents: 99_00,
        seatQuota: { viewer: 5 },
        botQuota: 10,
        pricing: [
          { type: "seat", key: "viewer", priceCents: 1000 },
          { type: "extra", key: "ai_credits", priceCents: 2 },
        ],
        createdByUserId: "admin",
      },
      paths.plans,
    );
    const versionId = plan.currentVersionId;
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: versionId,
        monthlyPriceCents: 99_00,
        monthlyCredits: 10_000,
        maxBots: 10,
        maxSeats: { viewer: 5 },
      },
      paths.entitlementSnapshot,
      { plans: paths.plans, subscriptions: paths.subscriptions },
    );
    const sub = await createSubscription(
      {
        enterpriseId,
        planId: plan.id,
        planVersionId: versionId,
        startTime: contractStart,
      },
      paths.subscriptions,
    );
    const end = new Date(contractStart);
    end.setUTCMonth(end.getUTCMonth() + months);
    await setSubscriptionCommercialContract(
      enterpriseId,
      sub.id,
      {
        billingCycle: "monthly",
        contractStart,
        contractEnd: end.toISOString(),
      },
      paths.subscriptions,
    );
    return { plan, versionId, sub, contractStart };
  }

  it("missed 3 cycles: settle thrice covers period 0,1,2 then no pending", async () => {
    await seedMultiMonth("ent-backlog");
    // Apr 15 → completed periods 0,1,2
    const now = new Date("2026-04-15T00:00:00.000Z");
    const r0 = await settleEnterpriseCycle({
      enterpriseId: "ent-backlog",
      mode: "final",
      now,
      storePaths: paths,
    });
    expect(r0!.cycle.periodIndex).toBe(0);
    expect(r0!.bill.cycleStart).toBe("2026-01-01T00:00:00.000Z");

    const r1 = await settleEnterpriseCycle({
      enterpriseId: "ent-backlog",
      mode: "final",
      now,
      storePaths: paths,
    });
    expect(r1!.cycle.periodIndex).toBe(1);
    expect(r1!.bill.cycleStart).toBe("2026-02-01T00:00:00.000Z");

    const r2 = await settleEnterpriseCycle({
      enterpriseId: "ent-backlog",
      mode: "final",
      now,
      storePaths: paths,
    });
    expect(r2!.cycle.periodIndex).toBe(2);
    expect(r2!.bill.cycleStart).toBe("2026-03-01T00:00:00.000Z");

    await expect(
      settleEnterpriseCycle({
        enterpriseId: "ent-backlog",
        mode: "final",
        now,
        storePaths: paths,
      }),
    ).rejects.toBeInstanceOf(NoPendingSettlementError);

    // must not skip earliest — three bills, three period indices
    const bills = await listBills("ent-backlog", paths.ledger);
    expect(bills).toHaveLength(3);
    expect(bills.map((b) => b.cycleStart).toSorted()).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
    ]);
  });

  it("when period 0 settled and 1/2 open, resumes from period 1", async () => {
    await seedMultiMonth("ent-resume");
    const now = new Date("2026-04-15T00:00:00.000Z");
    await settleEnterpriseCycle({
      enterpriseId: "ent-resume",
      mode: "final",
      now,
      storePaths: paths,
    });
    const next = await settleEnterpriseCycle({
      enterpriseId: "ent-resume",
      mode: "final",
      now,
      storePaths: paths,
    });
    expect(next!.cycle.periodIndex).toBe(1);
    // must NOT jump to latest (period 2)
    expect(next!.bill.cycleStart).toBe("2026-02-01T00:00:00.000Z");
  });

  it("must not skip earlier unfinalized when a later period could be targeted", async () => {
    await seedMultiMonth("ent-no-skip");
    // Three completed; first call settles earliest even though "latest" would be period 2
    const now = new Date("2026-04-15T00:00:00.000Z");
    const first = await settleEnterpriseCycle({
      enterpriseId: "ent-no-skip",
      mode: "final",
      now,
      storePaths: paths,
    });
    expect(first!.cycle.periodIndex).toBe(0);
    expect(first!.cycle.periodIndex).not.toBe(2);
  });

  it("two concurrent requests finalize the same earliest cycle only once", async () => {
    await seedMultiMonth("ent-conc");
    const now = new Date("2026-04-15T00:00:00.000Z");
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        settleEnterpriseCycle({
          enterpriseId: "ent-conc",
          mode: "final",
          now,
          storePaths: paths,
        }),
      ),
    );
    // all settle period 0 (or dedupe of same)
    for (const r of results) {
      expect(r!.cycle.periodIndex).toBe(0);
    }
    const billIds = new Set(results.map((r) => r!.bill.id));
    expect(billIds.size).toBe(1);
    expect(await listBills("ent-conc", paths.ledger)).toHaveLength(1);
  });
});

describe("settleEnterpriseCycle — contractEnd boundary + version lock", () => {
  it("estimated after contractEnd throws ContractEnded; final still settles backlog", async () => {
    // 3-month contract Jan–Apr; at Apr 15 contract has ended with 3 completed months
    const plan = await createPlan(
      {
        name: "Pro",
        billingCycle: "monthly",
        basePriceCents: 99_00,
        seatQuota: { viewer: 5 },
        botQuota: 10,
        pricing: [
          { type: "seat", key: "viewer", priceCents: 1000 },
          { type: "extra", key: "ai_credits", priceCents: 2 },
        ],
        createdByUserId: "admin",
      },
      paths.plans,
    );
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: plan.currentVersionId,
        monthlyPriceCents: 99_00,
        monthlyCredits: 10_000,
        maxBots: 10,
        maxSeats: { viewer: 5 },
      },
      paths.entitlementSnapshot,
      { plans: paths.plans, subscriptions: paths.subscriptions },
    );
    const sub = await createSubscription(
      {
        enterpriseId: "ent-ended",
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        startTime: "2026-01-01T00:00:00.000Z",
      },
      paths.subscriptions,
    );
    await setSubscriptionCommercialContract(
      "ent-ended",
      sub.id,
      {
        billingCycle: "monthly",
        contractStart: "2026-01-01T00:00:00.000Z",
        contractEnd: "2026-04-01T00:00:00.000Z",
      },
      paths.subscriptions,
    );

    const afterEnd = new Date("2026-04-15T00:00:00.000Z");
    await expect(
      settleEnterpriseCycle({
        enterpriseId: "ent-ended",
        mode: "estimated",
        now: afterEnd,
        storePaths: paths,
      }),
    ).rejects.toBeInstanceOf(ContractEndedError);

    const final0 = await settleEnterpriseCycle({
      enterpriseId: "ent-ended",
      mode: "final",
      now: afterEnd,
      storePaths: paths,
    });
    expect(final0!.cycle.periodIndex).toBe(0);
    expect(final0!.bill.cycleStart).toBe("2026-01-01T00:00:00.000Z");
  });

  it("subscription locked to v1 settles with v1 meters after v2 meter change", async () => {
    const plan = await createPlan(
      {
        name: "LockMeters",
        billingCycle: "monthly",
        basePriceCents: 1000,
        seatQuota: {},
        botQuota: 1,
        pricing: [
          { type: "usage", key: "workflow_run", priceCents: 100 },
          { type: "extra", key: "workflow_run", priceCents: 200 },
        ],
        meters: [
          {
            key: "workflow_run",
            unit: "count",
            includedQuota: 10,
            chargeIncludedAtUsagePrice: false,
            allowOverage: true,
          },
        ],
        createdByUserId: "admin",
      },
      paths.plans,
    );
    const v1Id = plan.currentVersionId;
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: v1Id,
        monthlyPriceCents: 1000,
        monthlyCredits: 0,
        maxBots: 1,
        maxSeats: {},
      },
      paths.entitlementSnapshot,
      { plans: paths.plans, subscriptions: paths.subscriptions },
    );
    const sub = await createSubscription(
      {
        enterpriseId: "ent-lock-m",
        planId: plan.id,
        planVersionId: v1Id,
        startTime: "2026-01-01T00:00:00.000Z",
      },
      paths.subscriptions,
    );
    await setSubscriptionCommercialContract(
      "ent-lock-m",
      sub.id,
      {
        billingCycle: "monthly",
        contractStart: "2026-01-01T00:00:00.000Z",
        contractEnd: "2027-01-01T00:00:00.000Z",
      },
      paths.subscriptions,
    );

    // New version with much larger free quota — must NOT affect locked sub
    const { createPlanVersion, activatePlanVersion } = await import("./plans-store.ts");
    const v2 = await createPlanVersion(
      {
        planId: plan.id,
        pricing: [
          { type: "usage", key: "workflow_run", priceCents: 100 },
          { type: "extra", key: "workflow_run", priceCents: 200 },
        ],
        meters: [
          {
            key: "workflow_run",
            unit: "count",
            includedQuota: 10_000,
            chargeIncludedAtUsagePrice: false,
            allowOverage: true,
          },
        ],
        createdByUserId: "admin",
      },
      paths.plans,
    );
    await activatePlanVersion(
      {
        planId: plan.id,
        versionId: v2!.id,
        requestId: `act-${v2!.id}`,
        changedByUserId: "admin",
      },
      paths.plans,
    );

    // 15 units in Jan → with v1 quota 10: 5 overage * 200 = 1000 extra
    await recordUsage(
      {
        enterpriseId: "ent-lock-m",
        userId: "u1",
        eventId: "ev-lock-1",
        key: "workflow_run",
        quantity: 15,
        occurredAt: "2026-01-10T00:00:00.000Z",
      },
      paths.usage,
    );

    const result = await settleEnterpriseCycle({
      enterpriseId: "ent-lock-m",
      mode: "final",
      now: new Date("2026-02-05T00:00:00.000Z"),
      storePaths: paths,
    });
    expect(result!.version.id).toBe(v1Id);
    // Bill total = seat+usage+extra（不含套餐 base 单独项）。
    // v1 includedQuota=10 → overage 5 × extra 200¢ = 1000；
    // 若误用 v2 quota=10000 则 overage=0、总额为 0。
    expect(result!.bill.extraCostCents).toBe(5 * 200);
    expect(result!.bill.totalCostCents).toBe(5 * 200);
  });
});

describe("truncated cycle credits scale (actual months, not nominal)", () => {
  it("truncated annual 6 months: includedQuota = monthlyCredits × 6", async () => {
    const monthlyCredits = 10;
    const plan = await createPlan(
      {
        name: "Annual6",
        billingCycle: "annual",
        basePriceCents: 0,
        seatQuota: {},
        botQuota: 1,
        pricing: [
          { type: "usage", key: "ai_credits", priceCents: 1 },
          { type: "extra", key: "ai_credits", priceCents: 100 },
        ],
        meters: [
          {
            key: "ai_credits",
            unit: "credit",
            includedQuota: monthlyCredits,
            chargeIncludedAtUsagePrice: false,
            allowOverage: true,
          },
        ],
        createdByUserId: "admin",
      },
      paths.plans,
    );
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: plan.currentVersionId,
        monthlyPriceCents: 0,
        monthlyCredits,
        maxBots: 1,
      },
      paths.entitlementSnapshot,
      { plans: paths.plans, subscriptions: paths.subscriptions },
    );
    const sub = await createSubscription(
      {
        enterpriseId: "ent-ann-6",
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        startTime: "2026-01-01T00:00:00.000Z",
      },
      paths.subscriptions,
    );
    // 名义年付但合同只 6 个月
    await setSubscriptionCommercialContract(
      "ent-ann-6",
      sub.id,
      {
        billingCycle: "annual",
        contractStart: "2026-01-01T00:00:00.000Z",
        contractEnd: "2026-07-01T00:00:00.000Z",
      },
      paths.subscriptions,
    );
    // 恰好 6×monthlyCredits：若误乘 12 也会 0 overage；再测 +1 月超额
    await recordUsage(
      {
        enterpriseId: "ent-ann-6",
        userId: "u1",
        eventId: "ann6-exact",
        key: "ai_credits",
        quantity: monthlyCredits * 6,
        occurredAt: "2026-03-15T00:00:00.000Z",
      },
      paths.usage,
    );
    const exact = await settleEnterpriseCycle({
      enterpriseId: "ent-ann-6",
      mode: "final",
      now: new Date("2026-07-01T00:00:00.000Z"),
      storePaths: paths,
    });
    expect(exact!.cycle.cycleStart).toBe("2026-01-01T00:00:00.000Z");
    expect(exact!.cycle.cycleEnd).toBe("2026-07-01T00:00:00.000Z");
    expect(exact!.bill.extraCostCents).toBe(0);

    // 新企业：用量 = 6× + 1 月 → 必须按 ×6 算 overage（若误 ×12 则 overage=0）
    const plan2 = await createPlan(
      {
        name: "Annual6b",
        billingCycle: "annual",
        basePriceCents: 0,
        seatQuota: {},
        botQuota: 1,
        pricing: [
          { type: "usage", key: "ai_credits", priceCents: 1 },
          { type: "extra", key: "ai_credits", priceCents: 100 },
        ],
        meters: [
          {
            key: "ai_credits",
            unit: "credit",
            includedQuota: monthlyCredits,
            chargeIncludedAtUsagePrice: false,
            allowOverage: true,
          },
        ],
        createdByUserId: "admin",
      },
      paths.plans,
    );
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: plan2.currentVersionId,
        monthlyPriceCents: 0,
        monthlyCredits,
        maxBots: 1,
      },
      paths.entitlementSnapshot,
      { plans: paths.plans, subscriptions: paths.subscriptions },
    );
    const sub2 = await createSubscription(
      {
        enterpriseId: "ent-ann-6-ov",
        planId: plan2.id,
        planVersionId: plan2.currentVersionId,
        startTime: "2026-01-01T00:00:00.000Z",
      },
      paths.subscriptions,
    );
    await setSubscriptionCommercialContract(
      "ent-ann-6-ov",
      sub2.id,
      {
        billingCycle: "annual",
        contractStart: "2026-01-01T00:00:00.000Z",
        contractEnd: "2026-07-01T00:00:00.000Z",
      },
      paths.subscriptions,
    );
    await recordUsage(
      {
        enterpriseId: "ent-ann-6-ov",
        userId: "u1",
        eventId: "ann6-ov",
        key: "ai_credits",
        quantity: monthlyCredits * 6 + monthlyCredits,
        occurredAt: "2026-03-15T00:00:00.000Z",
      },
      paths.usage,
    );
    const over = await settleEnterpriseCycle({
      enterpriseId: "ent-ann-6-ov",
      mode: "final",
      now: new Date("2026-07-01T00:00:00.000Z"),
      storePaths: paths,
    });
    // overage 10 × 100¢；若误用 ×12 included=120 则 extra=0
    expect(over!.bill.extraCostCents).toBe(monthlyCredits * 100);
  });

  it("truncated quarterly 1 month: includedQuota = monthlyCredits × 1", async () => {
    const monthlyCredits = 10;
    const plan = await createPlan(
      {
        name: "Q1mo",
        billingCycle: "quarterly",
        basePriceCents: 0,
        seatQuota: {},
        botQuota: 1,
        pricing: [
          { type: "usage", key: "ai_credits", priceCents: 1 },
          { type: "extra", key: "ai_credits", priceCents: 50 },
        ],
        meters: [
          {
            key: "ai_credits",
            unit: "credit",
            includedQuota: monthlyCredits,
            chargeIncludedAtUsagePrice: false,
            allowOverage: true,
          },
        ],
        createdByUserId: "admin",
      },
      paths.plans,
    );
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: plan.currentVersionId,
        monthlyPriceCents: 0,
        monthlyCredits,
        maxBots: 1,
      },
      paths.entitlementSnapshot,
      { plans: paths.plans, subscriptions: paths.subscriptions },
    );
    const sub = await createSubscription(
      {
        enterpriseId: "ent-q-1",
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        startTime: "2026-01-01T00:00:00.000Z",
      },
      paths.subscriptions,
    );
    // 名义季付但合同截成 1 个月
    await setSubscriptionCommercialContract(
      "ent-q-1",
      sub.id,
      {
        billingCycle: "quarterly",
        contractStart: "2026-01-01T00:00:00.000Z",
        contractEnd: "2026-02-01T00:00:00.000Z",
      },
      paths.subscriptions,
    );
    await recordUsage(
      {
        enterpriseId: "ent-q-1",
        userId: "u1",
        eventId: "q1-ov",
        key: "ai_credits",
        quantity: monthlyCredits * 2,
        occurredAt: "2026-01-15T00:00:00.000Z",
      },
      paths.usage,
    );
    const settled = await settleEnterpriseCycle({
      enterpriseId: "ent-q-1",
      mode: "final",
      now: new Date("2026-02-01T00:00:00.000Z"),
      storePaths: paths,
    });
    expect(settled!.cycle.cycleEnd).toBe("2026-02-01T00:00:00.000Z");
    // ×1 → overage 10 × 50；若误 ×3 included=30 则 extra=0
    expect(settled!.bill.extraCostCents).toBe(monthlyCredits * 50);
  });
});

describe("resolveSettlementBillingCycle", () => {
  it("prefers commercialContract.billingCycle over plan header", () => {
    const sub = {
      id: "s",
      enterpriseId: "e",
      planId: "p",
      planVersionId: "v",
      startTime: "2026-01-01T00:00:00.000Z",
      endTime: null,
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      commercialContract: {
        billingCycle: "annual" as const,
        contractStart: "2026-01-01T00:00:00.000Z",
        contractEnd: "2027-01-01T00:00:00.000Z",
      },
    };
    const plan = {
      id: "p",
      name: "P",
      billingCycle: "monthly" as const,
      basePriceCents: 1,
      seatQuota: {},
      botQuota: 0,
      status: "active" as const,
      currentVersionId: "v",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(resolveSettlementBillingCycle(sub, plan)).toBe("annual");
  });
});

describe("settleEnterpriseCycle — expired / upgrade multi-subscription backlog", () => {
  async function seedSub(
    enterpriseId: string,
    opts: {
      contractStart: string;
      contractMonths: number;
      status?: "active" | "expired" | "canceled";
      name?: string;
    },
  ) {
    const plan = await createPlan(
      {
        name: opts.name ?? "Pro",
        billingCycle: "monthly",
        basePriceCents: 99_00,
        seatQuota: { viewer: 5 },
        botQuota: 10,
        pricing: [
          { type: "seat", key: "viewer", priceCents: 1000 },
          { type: "extra", key: "ai_credits", priceCents: 2 },
        ],
        createdByUserId: "admin",
      },
      paths.plans,
    );
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: plan.currentVersionId,
        monthlyPriceCents: 99_00,
        monthlyCredits: 10_000,
        maxBots: 10,
        maxSeats: { viewer: 5 },
      },
      paths.entitlementSnapshot,
      { plans: paths.plans, subscriptions: paths.subscriptions },
    );
    const sub = await createSubscription(
      {
        enterpriseId,
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        startTime: opts.contractStart,
      },
      paths.subscriptions,
    );
    const end = new Date(opts.contractStart);
    end.setUTCMonth(end.getUTCMonth() + opts.contractMonths);
    await setSubscriptionCommercialContract(
      enterpriseId,
      sub.id,
      {
        billingCycle: "monthly",
        contractStart: opts.contractStart,
        contractEnd: end.toISOString(),
      },
      paths.subscriptions,
    );
    if (opts.status && opts.status !== "active") {
      const { transitionSubscriptionStatus } = await import("./subscriptions-store.ts");
      await transitionSubscriptionStatus(enterpriseId, sub.id, opts.status, paths.subscriptions);
    }
    const { getSubscription } = await import("./subscriptions-store.ts");
    const reloaded = await getSubscription(enterpriseId, sub.id, paths.subscriptions);
    return { plan, sub: reloaded!, versionId: plan.currentVersionId };
  }

  it("expired subscription can still settle unfinalized completed cycles", async () => {
    const { sub } = await seedSub("ent-expired", {
      contractStart: "2026-01-01T00:00:00.000Z",
      contractMonths: 3,
      status: "expired",
    });
    expect(sub.status).toBe("expired");

    const now = new Date("2026-04-15T00:00:00.000Z");
    // no active subscription — still settles
    const r0 = await settleEnterpriseCycle({
      enterpriseId: "ent-expired",
      mode: "final",
      now,
      storePaths: paths,
    });
    expect(r0).not.toBeNull();
    expect(r0!.subscription.id).toBe(sub.id);
    expect(r0!.subscription.status).toBe("expired");
    expect(r0!.cycle.periodIndex).toBe(0);
    expect(r0!.bill.cycleStart).toBe("2026-01-01T00:00:00.000Z");

    const r1 = await settleEnterpriseCycle({
      enterpriseId: "ent-expired",
      mode: "final",
      now,
      storePaths: paths,
    });
    expect(r1!.cycle.periodIndex).toBe(1);
  });

  it("after upgrade: settles old subscription backlog before new active cycles", async () => {
    // 旧订阅 Jan–Apr（3 个月），升级后 canceled
    const old = await seedSub("ent-upgrade", {
      contractStart: "2026-01-01T00:00:00.000Z",
      contractMonths: 3,
      name: "OldPlan",
      status: "canceled",
    });
    // 新 active：从 Apr 1 起
    const neu = await seedSub("ent-upgrade", {
      contractStart: "2026-04-01T00:00:00.000Z",
      contractMonths: 6,
      name: "NewPlan",
      status: "active",
    });

    // May 15：旧完成 period 0/1/2；新完成 period 0 [Apr1,May1)
    const now = new Date("2026-05-15T00:00:00.000Z");

    const first = await settleEnterpriseCycle({
      enterpriseId: "ent-upgrade",
      mode: "final",
      now,
      storePaths: paths,
    });
    expect(first!.subscription.id).toBe(old.sub.id);
    expect(first!.cycle.cycleStart).toBe("2026-01-01T00:00:00.000Z");
    expect(first!.cycle.periodIndex).toBe(0);

    const second = await settleEnterpriseCycle({
      enterpriseId: "ent-upgrade",
      mode: "final",
      now,
      storePaths: paths,
    });
    expect(second!.subscription.id).toBe(old.sub.id);
    expect(second!.cycle.periodIndex).toBe(1);

    const third = await settleEnterpriseCycle({
      enterpriseId: "ent-upgrade",
      mode: "final",
      now,
      storePaths: paths,
    });
    expect(third!.subscription.id).toBe(old.sub.id);
    expect(third!.cycle.periodIndex).toBe(2);

    // 旧积压结清后，才结算新 active 的 period 0
    const fourth = await settleEnterpriseCycle({
      enterpriseId: "ent-upgrade",
      mode: "final",
      now,
      storePaths: paths,
    });
    expect(fourth!.subscription.id).toBe(neu.sub.id);
    expect(fourth!.cycle.cycleStart).toBe("2026-04-01T00:00:00.000Z");
    expect(fourth!.cycle.periodIndex).toBe(0);
  });
});

describe("settleEnterpriseCycle — explicit subscriptionId catch-up", () => {
  async function seedSub(
    enterpriseId: string,
    opts: {
      contractStart: string;
      contractMonths: number;
      status?: "active" | "expired" | "canceled";
      name?: string;
    },
  ) {
    const plan = await createPlan(
      {
        name: opts.name ?? "Pro",
        billingCycle: "monthly",
        basePriceCents: 99_00,
        seatQuota: { viewer: 5 },
        botQuota: 10,
        pricing: [
          { type: "seat", key: "viewer", priceCents: 1000 },
          { type: "extra", key: "ai_credits", priceCents: 2 },
        ],
        createdByUserId: "admin",
      },
      paths.plans,
    );
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: plan.currentVersionId,
        monthlyPriceCents: 99_00,
        monthlyCredits: 10_000,
        maxBots: 10,
        maxSeats: { viewer: 5 },
      },
      paths.entitlementSnapshot,
      { plans: paths.plans, subscriptions: paths.subscriptions },
    );
    const sub = await createSubscription(
      {
        enterpriseId,
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        startTime: opts.contractStart,
      },
      paths.subscriptions,
    );
    const end = new Date(opts.contractStart);
    end.setUTCMonth(end.getUTCMonth() + opts.contractMonths);
    await setSubscriptionCommercialContract(
      enterpriseId,
      sub.id,
      {
        billingCycle: "monthly",
        contractStart: opts.contractStart,
        contractEnd: end.toISOString(),
      },
      paths.subscriptions,
    );
    if (opts.status && opts.status !== "active") {
      const { transitionSubscriptionStatus } = await import("./subscriptions-store.ts");
      await transitionSubscriptionStatus(enterpriseId, sub.id, opts.status, paths.subscriptions);
    }
    const { getSubscription } = await import("./subscriptions-store.ts");
    return (await getSubscription(enterpriseId, sub.id, paths.subscriptions))!;
  }

  it("subscriptionId alone settles only that subscription even if another has earlier backlog", async () => {
    const old = await seedSub("ent-sid", {
      contractStart: "2026-01-01T00:00:00.000Z",
      contractMonths: 3,
      status: "canceled",
      name: "Old",
    });
    const neu = await seedSub("ent-sid", {
      contractStart: "2026-04-01T00:00:00.000Z",
      contractMonths: 6,
      status: "active",
      name: "New",
    });
    const now = new Date("2026-05-15T00:00:00.000Z");

    // 默认会先结旧订阅；锁定 new 时应先结 new 的 Apr 期
    const pinned = await settleEnterpriseCycle({
      enterpriseId: "ent-sid",
      mode: "final",
      now,
      subscriptionId: neu.id,
      storePaths: paths,
    });
    expect(pinned!.subscription.id).toBe(neu.id);
    expect(pinned!.cycle.cycleStart).toBe("2026-04-01T00:00:00.000Z");

    // 旧订阅积压仍在，企业默认仍从旧 period 0 开始
    const enterprise = await settleEnterpriseCycle({
      enterpriseId: "ent-sid",
      mode: "final",
      now,
      storePaths: paths,
    });
    expect(enterprise!.subscription.id).toBe(old.id);
    expect(enterprise!.cycle.periodIndex).toBe(0);
  });

  it("cycleStart + subscriptionId refuses when cycle belongs to another subscription", async () => {
    const old = await seedSub("ent-sid2", {
      contractStart: "2026-01-01T00:00:00.000Z",
      contractMonths: 3,
      status: "canceled",
      name: "Old2",
    });
    const neu = await seedSub("ent-sid2", {
      contractStart: "2026-04-01T00:00:00.000Z",
      contractMonths: 6,
      status: "active",
      name: "New2",
    });
    const now = new Date("2026-05-15T00:00:00.000Z");

    // 旧订阅的 Jan 起点不属于 new
    await expect(
      settleEnterpriseCycle({
        enterpriseId: "ent-sid2",
        mode: "final",
        now,
        subscriptionId: neu.id,
        cycleStart: "2026-01-01T00:00:00.000Z",
        storePaths: paths,
      }),
    ).rejects.toBeTruthy();

    // 精确补结旧订阅 Jan
    const ok = await settleEnterpriseCycle({
      enterpriseId: "ent-sid2",
      mode: "final",
      now,
      subscriptionId: old.id,
      cycleStart: "2026-01-01T00:00:00.000Z",
      storePaths: paths,
    });
    expect(ok!.subscription.id).toBe(old.id);
    expect(ok!.cycle.cycleStart).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects unknown or non-settleable subscriptionId", async () => {
    await seedSub("ent-sid3", {
      contractStart: "2026-01-01T00:00:00.000Z",
      contractMonths: 2,
      status: "active",
    });
    await expect(
      settleEnterpriseCycle({
        enterpriseId: "ent-sid3",
        mode: "final",
        now: new Date("2026-03-15T00:00:00.000Z"),
        subscriptionId: "sub-does-not-exist",
        storePaths: paths,
      }),
    ).rejects.toThrow(/不存在|不可结算/);
  });
});
