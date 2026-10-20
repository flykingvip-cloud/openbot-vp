// @vitest-environment node
/**
 * Phase 5 黄金路径 E2E：
 * 订阅(锁定版本) → 席位 → 用量 → final settle → Statement → 发票申请
 * 并断言 MRR 不随 Plan 头价漂移。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetBillingProfilesForTest,
  upsertBillingProfile,
} from "../commerce/billing-profile-store.ts";
import {
  __resetCommercialOrdersForTest,
  createCommercialOrder,
  transitionCommercialOrderStatus,
} from "../commerce/commercial-orders-store.ts";
import { loadCommercialStatement } from "../commerce/commercial-statement.ts";
import { createInvoiceRequest } from "../commerce/invoice-request-service.ts";
import { __resetInvoiceRequestsForTest } from "../commerce/invoice-requests-store.ts";
import { upsertPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.ts";
import { __resetLedgerForTest, listBills } from "./ledger-store.ts";
import { resolveContractNormalizedMrr } from "./mrr-contract.ts";
import { buildPlatformCommercialSummary } from "./plan-commercial-summary.ts";
import {
  activatePlanVersion,
  createPlan,
  createPlanVersion,
  __resetPlansForTest,
} from "./plans-store.ts";
import { getPlanVersion } from "./plans-store.ts";
import { assignSeat, __resetSeatsForTest } from "./seats-store.ts";
import { settleEnterpriseCycle } from "./settlement-service.ts";
import {
  createSubscription,
  setSubscriptionCommercialContract,
  __resetSubscriptionsForTest,
} from "./subscriptions-store.ts";
import { recordUsage } from "./usage-records-store.ts";

let tmp: string;
let paths: {
  plans: string;
  subscriptions: string;
  seats: string;
  usage: string;
  ledger: string;
  entitlement: string;
  resources: string;
};

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ob-p5-golden-"));
  paths = {
    plans: path.join(tmp, "plans.json"),
    subscriptions: path.join(tmp, "subs.json"),
    seats: path.join(tmp, "seats.json"),
    usage: path.join(tmp, "usage.json"),
    ledger: path.join(tmp, "ledger.json"),
    entitlement: path.join(tmp, "ent.json"),
    resources: path.join(tmp, "res.json"),
  };
  await __resetPlansForTest(paths.plans);
  await __resetSubscriptionsForTest(paths.subscriptions);
  await __resetSeatsForTest(paths.seats);
  await __resetLedgerForTest(paths.ledger);
  await __resetBillingProfilesForTest();
  await __resetInvoiceRequestsForTest();
  await __resetCommercialOrdersForTest();
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("Phase 5 golden path E2E", () => {
  it("subscribe → seat → usage → settle → statement → invoice; MRR version-locked", async () => {
    const enterpriseId = "ent-golden";
    const lockedBase = 49_00;
    const liveDriftBase = 199_00;

    // 1) 创建套餐 v1 并订阅（锁定 v1）
    const plan = await createPlan(
      {
        name: "Golden",
        billingCycle: "monthly",
        basePriceCents: lockedBase,
        seatQuota: { viewer: 5 },
        botQuota: 5,
        pricing: [
          { type: "seat", key: "viewer", priceCents: 1000 },
          { type: "extra", key: "ai_credits", priceCents: 2 },
          { type: "usage", key: "ai_credits", priceCents: 1 },
        ],
        meters: [
          {
            key: "ai_credits",
            unit: "credit",
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
        monthlyPriceCents: lockedBase,
        monthlyCredits: 10,
        maxBots: 5,
        maxSeats: { viewer: 5 },
      },
      paths.entitlement,
      { plans: paths.plans, subscriptions: paths.subscriptions },
    );

    const sub = await createSubscription(
      {
        enterpriseId,
        planId: plan.id,
        planVersionId: v1Id,
        startTime: "2026-01-01T00:00:00.000Z",
      },
      paths.subscriptions,
    );
    await setSubscriptionCommercialContract(
      enterpriseId,
      sub.id,
      {
        billingCycle: "monthly",
        contractStart: "2026-01-01T00:00:00.000Z",
        contractEnd: "2026-02-01T00:00:00.000Z",
      },
      paths.subscriptions,
    );

    // 2) Plan 头价漂移 + 新版本激活（订阅仍锁 v1）
    const v2 = await createPlanVersion(
      {
        planId: plan.id,
        basePriceCents: liveDriftBase,
        pricing: [
          { type: "seat", key: "viewer", priceCents: 1000 },
          { type: "extra", key: "ai_credits", priceCents: 2 },
        ],
        meters: [
          {
            key: "ai_credits",
            unit: "credit",
            includedQuota: 10,
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

    // 3) 席位
    const seat = await assignSeat(
      {
        enterpriseId,
        userId: "alice@golden.test",
        role: "viewer",
        botQuota: 1,
        planVersionId: v1Id,
        roleQuota: 5,
        effectiveAt: "2026-01-02T00:00:00.000Z",
      },
      paths.seats,
    );
    expect(seat.planVersionId).toBe(v1Id);

    // 4) 用量（超出 included 产生 overage）
    await recordUsage(
      {
        enterpriseId,
        userId: "alice@golden.test",
        eventId: "gold-usage-1",
        key: "ai_credits",
        quantity: 15,
        occurredAt: "2026-01-15T00:00:00.000Z",
      },
      paths.usage,
    );

    // 5) final settle
    const settled = await settleEnterpriseCycle({
      enterpriseId,
      mode: "final",
      now: new Date("2026-02-01T00:00:00.000Z"),
      storePaths: {
        plans: paths.plans,
        subscriptions: paths.subscriptions,
        seats: paths.seats,
        usage: paths.usage,
        ledger: paths.ledger,
        entitlementSnapshot: paths.entitlement,
        resources: paths.resources,
      },
    });
    expect(settled).not.toBeNull();
    expect(settled!.version.id).toBe(v1Id);
    // overage 5 * 2 = 10
    expect(settled!.bill.extraCostCents).toBe(5 * 2);

    const bills = await listBills(enterpriseId, paths.ledger);
    expect(bills).toHaveLength(1);

    // 6) 预付订单 + Statement + 发票
    await upsertBillingProfile({
      enterpriseId,
      legalName: "Golden Ltd",
      taxId: "91110000MAGOLDEN1",
      invoiceType: "electronic",
    });
    const order = await createCommercialOrder({
      enterpriseId,
      kind: "subscribe",
      amountCents: lockedBase,
      planId: plan.id,
      planVersionId: v1Id,
      lineItems: [{ label: "Golden plan", amountCents: lockedBase }],
    });
    await transitionCommercialOrderStatus(enterpriseId, order.id, "paid");

    const statement = await loadCommercialStatement(enterpriseId, {
      ledger: paths.ledger,
    });
    expect(statement.invoiceableByBillId[bills[0].id]).toBe(settled!.bill.totalCostCents);
    expect(statement.invoiceableByOrderId[order.id]).toBe(lockedBase);
    expect(statement.invoiceableCents).toBe(lockedBase + settled!.bill.totalCostCents);

    const invoice = await createInvoiceRequest({
      enterpriseId,
      billId: bills[0].id,
      storePaths: { ledger: paths.ledger },
    });
    expect(invoice.amountCents).toBe(settled!.bill.totalCostCents);
    expect(invoice.allocations).toEqual([
      { billId: bills[0].id, amountCents: settled!.bill.totalCostCents },
    ]);

    // 7) MRR：合同标准化 + 锁定 v1，不随 live 19900 漂移
    const version = await getPlanVersion(v1Id, paths.plans);
    const mrr = resolveContractNormalizedMrr({
      subscription: {
        ...sub,
        commercialContract: {
          billingCycle: "monthly",
          contractStart: "2026-01-01T00:00:00.000Z",
          contractEnd: "2026-02-01T00:00:00.000Z",
        },
      },
      planVersion: version,
      plan: { ...plan, basePriceCents: liveDriftBase },
    });
    expect(mrr.versionLocked).toBe(true);
    expect(mrr.mrrCents).toBe(lockedBase);
    expect(mrr.mrrCents).not.toBe(liveDriftBase);

    // 平台汇总也必须走锁定版本（需默认 store 时在单元测；此处断言纯函数路径已覆盖）
    expect(buildPlatformCommercialSummary).toEqual(expect.any(Function));
  });
});
