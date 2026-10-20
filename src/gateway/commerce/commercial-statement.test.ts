// @vitest-environment node
/**
 * Phase 4：Statement + allocations 占用 + 原子开票回归。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-statement-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { __resetBillingProfilesForTest, upsertBillingProfile } =
  await import("./billing-profile-store.js");
const { __resetCommercialOrdersForTest, createCommercialOrder, transitionCommercialOrderStatus } =
  await import("./commercial-orders-store.js");
const {
  __resetInvoiceRequestsForTest,
  listActiveInvoiceOccupanciesForEnterprise,
  rejectInvoiceRequest,
} = await import("./invoice-requests-store.js");
const { createInvoiceRequest } = await import("./invoice-request-service.js");
const {
  buildCommercialStatement,
  buildTotalBalanceAllocations,
  collectInvoiceOccupancy,
  loadCommercialStatement,
  resolveInvoiceAllocations,
} = await import("./commercial-statement.js");
const { __resetLedgerForTest, appendFinalSettlementIdempotent } =
  await import("../billing/ledger-store.js");

async function seedProfile(enterpriseId = "ent-a") {
  await upsertBillingProfile({
    enterpriseId,
    legalName: "Acme Ltd",
    taxId: "91110000MA01234567",
    invoiceType: "vat_special",
  });
}

async function seedPaidOrder(enterpriseId: string, amountCents: number, idHint?: string) {
  const order = await createCommercialOrder({
    enterpriseId,
    kind: "subscribe",
    amountCents,
    lineItems: [{ label: idHint ?? "Plan", amountCents }],
  });
  await transitionCommercialOrderStatus(enterpriseId, order.id, "paid");
  return order;
}

async function seedFinalBill(
  enterpriseId: string,
  totalCostCents: number,
  billId: string,
): Promise<void> {
  const bill = {
    id: billId,
    enterpriseId,
    cycleStart: "2026-01-01T00:00:00.000Z",
    cycleEnd: "2026-02-01T00:00:00.000Z",
    planVersionId: "pv-1",
    items: [],
    seatCostCents: 0,
    usageCostCents: 0,
    extraCostCents: totalCostCents,
    totalCostCents,
    generatedAt: "2026-02-01T00:00:00.000Z",
    status: "finalized" as const,
    settlementKey: `${enterpriseId}|sub|pv-1|${billId}`,
  };
  await appendFinalSettlementIdempotent(bill, {
    id: `snap-${billId}`,
    enterpriseId,
    date: "2026-02-01",
    snapshotType: "final",
    seatCostCents: 0,
    usageCostCents: 0,
    totalCostCents,
    missingPriceKeys: [],
    createdAt: "2026-02-01T00:00:00.000Z",
    billId: bill.id,
    settlementKey: bill.settlementKey,
  });
}

describe("buildCommercialStatement + allocations", () => {
  it("aggregates paid order and final bill; occupancy via allocations", () => {
    const statement = buildCommercialStatement({
      enterpriseId: "ent-1",
      orders: [
        {
          id: "ord-1",
          enterpriseId: "ent-1",
          kind: "subscribe",
          status: "paid",
          amountCents: 10_000,
          currency: "CNY",
          lineItems: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          paidAt: "2026-01-01T01:00:00.000Z",
        },
      ],
      bills: [
        {
          id: "bill-1",
          enterpriseId: "ent-1",
          cycleStart: "2026-01-01T00:00:00.000Z",
          cycleEnd: "2026-02-01T00:00:00.000Z",
          planVersionId: "pv-1",
          items: [],
          seatCostCents: 500,
          usageCostCents: 200,
          extraCostCents: 300,
          totalCostCents: 1000,
          generatedAt: "2026-02-01T00:00:00.000Z",
          status: "finalized",
        },
      ],
      invoiceRequests: [
        {
          id: "inv-total",
          enterpriseId: "ent-1",
          amountCents: 11_000,
          status: "pending",
          createdAt: "2026-02-02T00:00:00.000Z",
          allocations: [
            { orderId: "ord-1", amountCents: 10_000 },
            { billId: "bill-1", amountCents: 1000 },
          ],
        },
      ],
    });
    expect(statement.balanceDueCents).toBe(1000);
    expect(statement.invoiceableCents).toBe(0);
    expect(statement.invoicedCents).toBe(11_000);
  });

  it("total-balance request without top-level orderId still occupies via allocations", () => {
    const open = buildCommercialStatement({
      enterpriseId: "ent-1",
      orders: [
        {
          id: "ord-1",
          enterpriseId: "ent-1",
          kind: "subscribe",
          status: "paid",
          amountCents: 5000,
          currency: "CNY",
          lineItems: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          paidAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      bills: [],
      invoiceRequests: [],
    });
    const allocs = buildTotalBalanceAllocations(open);
    expect(allocs).toEqual([{ orderId: "ord-1", amountCents: 5000 }]);

    const after = buildCommercialStatement({
      enterpriseId: "ent-1",
      orders: open.lines.length
        ? [
            {
              id: "ord-1",
              enterpriseId: "ent-1",
              kind: "subscribe",
              status: "paid",
              amountCents: 5000,
              currency: "CNY",
              lineItems: [],
              createdAt: "2026-01-01T00:00:00.000Z",
              paidAt: "2026-01-01T00:00:00.000Z",
            },
          ]
        : [],
      bills: [],
      invoiceRequests: [
        {
          id: "inv-1",
          enterpriseId: "ent-1",
          amountCents: 5000,
          status: "pending",
          createdAt: "2026-01-02T00:00:00.000Z",
          allocations: allocs,
          // 故意无 orderId 顶层字段
        },
      ],
    });
    expect(after.invoiceableCents).toBe(0);
    expect(after.invoiceableByOrderId["ord-1"]).toBeUndefined();
  });

  it("rejected releases allocation occupancy", () => {
    const baseOrders = [
      {
        id: "ord-1",
        enterpriseId: "ent-1",
        kind: "subscribe" as const,
        status: "paid" as const,
        amountCents: 1000,
        currency: "CNY" as const,
        lineItems: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        paidAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const pending = buildCommercialStatement({
      enterpriseId: "ent-1",
      orders: baseOrders,
      bills: [],
      invoiceRequests: [
        {
          id: "inv-1",
          enterpriseId: "ent-1",
          amountCents: 1000,
          status: "pending",
          createdAt: "2026-01-02T00:00:00.000Z",
          allocations: [{ orderId: "ord-1", amountCents: 1000 }],
        },
      ],
    });
    expect(pending.invoiceableCents).toBe(0);

    const rejected = buildCommercialStatement({
      enterpriseId: "ent-1",
      orders: baseOrders,
      bills: [],
      invoiceRequests: [
        {
          id: "inv-1",
          enterpriseId: "ent-1",
          amountCents: 1000,
          status: "rejected",
          createdAt: "2026-01-02T00:00:00.000Z",
          allocations: [{ orderId: "ord-1", amountCents: 1000 }],
        },
      ],
    });
    expect(rejected.invoiceableCents).toBe(1000);
  });

  it("collectInvoiceOccupancy sums partial allocations", () => {
    const occ = collectInvoiceOccupancy(
      [
        {
          id: "a",
          enterpriseId: "e",
          amountCents: 300,
          status: "pending",
          createdAt: "t",
          allocations: [
            { orderId: "o1", amountCents: 100 },
            { billId: "b1", amountCents: 200 },
          ],
        },
        {
          id: "b",
          enterpriseId: "e",
          amountCents: 50,
          status: "issued",
          createdAt: "t",
          allocations: [{ orderId: "o1", amountCents: 50 }],
        },
      ],
      "e",
    );
    expect(occ.byOrderId.o1).toBe(150);
    expect(occ.byBillId.b1).toBe(200);
    expect(occ.totalOccupiedCents).toBe(350);
  });
});

describe("createInvoiceRequest atomic + allocations", () => {
  beforeEach(async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    await __resetBillingProfilesForTest();
    await __resetCommercialOrdersForTest();
    await __resetInvoiceRequestsForTest();
    await __resetLedgerForTest();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("two consecutive total-balance requests: second fails", async () => {
    await seedProfile();
    await seedPaidOrder("ent-a", 10_000);
    await seedFinalBill("ent-a", 2000, "bill-a1");

    const first = await createInvoiceRequest({ enterpriseId: "ent-a" });
    expect(first.amountCents).toBe(12_000);
    expect(first.allocations?.length).toBeGreaterThanOrEqual(2);
    expect(first.orderId).toBeUndefined();

    const statement = await loadCommercialStatement("ent-a");
    expect(statement.invoiceableCents).toBe(0);

    await expect(createInvoiceRequest({ enterpriseId: "ent-a" })).rejects.toThrow(/无可开票余额/);
  });

  it("total then targeted order request fails (cross-dup)", async () => {
    await seedProfile();
    const order = await seedPaidOrder("ent-a", 5000);
    const total = await createInvoiceRequest({ enterpriseId: "ent-a" });
    expect(total.allocations?.some((a) => a.orderId === order.id)).toBe(true);
    await expect(
      createInvoiceRequest({ enterpriseId: "ent-a", orderId: order.id }),
    ).rejects.toThrow(/无可开票余额/);
  });

  it("concurrent total vs targeted: only one succeeds", async () => {
    await seedProfile();
    const order = await seedPaidOrder("ent-a", 8000);
    const results = await Promise.allSettled([
      createInvoiceRequest({ enterpriseId: "ent-a" }),
      createInvoiceRequest({ enterpriseId: "ent-a", orderId: order.id }),
      createInvoiceRequest({ enterpriseId: "ent-a" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const fail = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(fail.length).toBeGreaterThanOrEqual(2);
    const statement = await loadCommercialStatement("ent-a");
    expect(statement.invoiceableCents).toBe(0);
  });

  it(">100 active requests still occupy (no list limit 100)", async () => {
    await seedProfile();
    // 101 个小订单，每个单独定向开票
    const orderIds: string[] = [];
    for (let i = 0; i < 101; i++) {
      const o = await seedPaidOrder("ent-a", 100, `o-${i}`);
      orderIds.push(o.id);
      await createInvoiceRequest({ enterpriseId: "ent-a", orderId: o.id });
    }
    const active = await listActiveInvoiceOccupanciesForEnterprise("ent-a");
    expect(active.length).toBe(101);

    const statement = await loadCommercialStatement("ent-a");
    expect(statement.invoiceableCents).toBe(0);
    for (const id of orderIds) {
      expect(statement.invoiceableByOrderId[id]).toBeUndefined();
    }

    // 新增可开票应成功
    await seedPaidOrder("ent-a", 999);
    const extra = await createInvoiceRequest({ enterpriseId: "ent-a" });
    expect(extra.amountCents).toBe(999);
  });

  it("reject releases allocation for re-invoice", async () => {
    await seedProfile();
    const order = await seedPaidOrder("ent-a", 3000);
    const req = await createInvoiceRequest({ enterpriseId: "ent-a", orderId: order.id });
    expect((await loadCommercialStatement("ent-a")).invoiceableCents).toBe(0);

    await rejectInvoiceRequest(req.id, "资料不符");
    expect((await loadCommercialStatement("ent-a")).invoiceableByOrderId[order.id]).toBe(3000);

    const again = await createInvoiceRequest({ enterpriseId: "ent-a", orderId: order.id });
    expect(again.amountCents).toBe(3000);
    expect(again.allocations).toEqual([{ orderId: order.id, amountCents: 3000 }]);
  });

  it("resolveInvoiceAllocations for total covers all open refs", () => {
    const statement = buildCommercialStatement({
      enterpriseId: "e",
      orders: [
        {
          id: "o1",
          enterpriseId: "e",
          kind: "subscribe",
          status: "paid",
          amountCents: 10,
          currency: "CNY",
          lineItems: [],
          createdAt: "t",
          paidAt: "t",
        },
      ],
      bills: [
        {
          id: "b1",
          enterpriseId: "e",
          cycleStart: "a",
          cycleEnd: "b",
          planVersionId: "p",
          items: [],
          seatCostCents: 0,
          usageCostCents: 0,
          extraCostCents: 5,
          totalCostCents: 5,
          generatedAt: "t",
          status: "finalized",
        },
      ],
      invoiceRequests: [],
    });
    const { amountCents, allocations } = resolveInvoiceAllocations(statement, {});
    expect(amountCents).toBe(15);
    expect(allocations).toHaveLength(2);
  });
});
