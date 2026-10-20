// @vitest-environment node
/**
 * 裸总额无 allocations 历史脏数据迁移。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-inv-migrate-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { allocateFromPool, isBareTotalInvoiceRequest, planBareTotalAllocationMigration } =
  await import("./invoice-allocation-migrate.js");
const { migrateBareTotalInvoiceAllocationsForEnterprise } =
  await import("./invoice-allocation-migrate-io.js");
const { loadCommercialStatement } = await import("./commercial-statement.js");
const { createInvoiceRequest } = await import("./invoice-request-service.js");
const {
  __putInvoiceRequestForTest,
  __resetInvoiceRequestsForTest,
  getInvoiceRequest,
  listActiveInvoiceOccupanciesForEnterprise,
} = await import("./invoice-requests-store.js");
const { __resetCommercialOrdersForTest, createCommercialOrder, transitionCommercialOrderStatus } =
  await import("./commercial-orders-store.js");
const { __resetLedgerForTest, appendFinalSettlementIdempotent } =
  await import("../billing/ledger-store.js");
const { __resetBillingProfilesForTest, upsertBillingProfile } =
  await import("./billing-profile-store.js");

describe("planBareTotalAllocationMigration (pure)", () => {
  it("detects bare total only", () => {
    expect(
      isBareTotalInvoiceRequest({
        id: "1",
        enterpriseId: "e",
        amountCents: 100,
        status: "pending",
        createdAt: "t",
      }),
    ).toBe(true);
    expect(
      isBareTotalInvoiceRequest({
        id: "2",
        enterpriseId: "e",
        amountCents: 100,
        status: "pending",
        createdAt: "t",
        orderId: "o1",
      }),
    ).toBe(false);
    expect(
      isBareTotalInvoiceRequest({
        id: "3",
        enterpriseId: "e",
        amountCents: 100,
        status: "pending",
        createdAt: "t",
        allocations: [{ orderId: "o1", amountCents: 100 }],
      }),
    ).toBe(false);
  });

  it("greedily covers bare total from paid orders then bills", () => {
    const patches = planBareTotalAllocationMigration({
      enterpriseId: "e",
      orders: [
        {
          id: "o1",
          enterpriseId: "e",
          kind: "subscribe",
          status: "paid",
          amountCents: 1000,
          currency: "CNY",
          lineItems: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          paidAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "o2",
          enterpriseId: "e",
          kind: "subscribe",
          status: "paid",
          amountCents: 500,
          currency: "CNY",
          lineItems: [],
          createdAt: "2026-01-02T00:00:00.000Z",
          paidAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      bills: [
        {
          id: "b1",
          enterpriseId: "e",
          cycleStart: "2026-01-01T00:00:00.000Z",
          cycleEnd: "2026-02-01T00:00:00.000Z",
          planVersionId: "pv",
          items: [],
          seatCostCents: 0,
          usageCostCents: 0,
          extraCostCents: 200,
          totalCostCents: 200,
          generatedAt: "2026-02-01T00:00:00.000Z",
          status: "finalized",
        },
      ],
      requests: [
        {
          id: "inv-bare",
          enterpriseId: "e",
          amountCents: 1700,
          status: "pending",
          createdAt: "2026-02-02T00:00:00.000Z",
          // 裸总额：无 orderId/billId/allocations
        },
      ],
    });
    expect(patches).toHaveLength(1);
    expect(patches[0].requestId).toBe("inv-bare");
    expect(patches[0].allocations).toEqual([
      { orderId: "o1", amountCents: 1000 },
      { orderId: "o2", amountCents: 500 },
      { billId: "b1", amountCents: 200 },
    ]);
  });

  it("respects prior directed occupancy when planning bare total", () => {
    const patches = planBareTotalAllocationMigration({
      enterpriseId: "e",
      orders: [
        {
          id: "o1",
          enterpriseId: "e",
          kind: "subscribe",
          status: "paid",
          amountCents: 1000,
          currency: "CNY",
          lineItems: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          paidAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      bills: [],
      requests: [
        {
          id: "inv-dir",
          enterpriseId: "e",
          amountCents: 600,
          status: "issued",
          createdAt: "2026-01-02T00:00:00.000Z",
          orderId: "o1",
          allocations: [{ orderId: "o1", amountCents: 600 }],
        },
        {
          id: "inv-bare",
          enterpriseId: "e",
          amountCents: 400,
          status: "pending",
          createdAt: "2026-01-03T00:00:00.000Z",
        },
      ],
    });
    expect(patches[0].allocations).toEqual([{ orderId: "o1", amountCents: 400 }]);
  });

  it("allocateFromPool is stable and caps at remaining", () => {
    const pool = [
      { kind: "order" as const, id: "o1", remaining: 30, sortKey: "a" },
      { kind: "bill" as const, id: "b1", remaining: 20, sortKey: "b" },
    ];
    expect(allocateFromPool(pool, 100)).toEqual([
      { orderId: "o1", amountCents: 30 },
      { billId: "b1", amountCents: 20 },
    ]);
    expect(pool[0].remaining).toBe(0);
    expect(pool[1].remaining).toBe(0);
  });
});

describe("migrate bare total IO + statement", () => {
  beforeEach(async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    await __resetBillingProfilesForTest();
    await __resetCommercialOrdersForTest();
    await __resetInvoiceRequestsForTest();
    await __resetLedgerForTest();
    await upsertBillingProfile({
      enterpriseId: "ent-mig",
      legalName: "Mig Co",
      taxId: "91110000MAMIGRATE",
      invoiceType: "electronic",
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadCommercialStatement migrates bare total so invoiceable drops", async () => {
    const order = await createCommercialOrder({
      enterpriseId: "ent-mig",
      kind: "subscribe",
      amountCents: 5000,
      lineItems: [{ label: "P", amountCents: 5000 }],
    });
    await transitionCommercialOrderStatus("ent-mig", order.id, "paid");

    // 注入历史脏数据：总额申请但无 allocations
    await __putInvoiceRequestForTest({
      id: "inv-dirty-bare",
      enterpriseId: "ent-mig",
      amountCents: 5000,
      status: "pending",
      createdAt: "2026-01-10T00:00:00.000Z",
    });

    // 迁移前若直接用 list（不 migrate）会漏占用 — 经 load 会 migrate
    const statement = await loadCommercialStatement("ent-mig");
    expect(statement.invoiceableCents).toBe(0);

    const stored = await getInvoiceRequest("inv-dirty-bare");
    expect(stored?.allocations).toEqual([{ orderId: order.id, amountCents: 5000 }]);

    // 可重入
    const again = await migrateBareTotalInvoiceAllocationsForEnterprise("ent-mig");
    expect(again.migrated).toBe(0);
    expect(again.planned).toBe(0);
  });

  it("after migrate, second total invoice request is rejected", async () => {
    const order = await createCommercialOrder({
      enterpriseId: "ent-mig",
      kind: "subscribe",
      amountCents: 3000,
      lineItems: [{ label: "P", amountCents: 3000 }],
    });
    await transitionCommercialOrderStatus("ent-mig", order.id, "paid");
    await __putInvoiceRequestForTest({
      id: "inv-dirty",
      enterpriseId: "ent-mig",
      amountCents: 3000,
      status: "pending",
      createdAt: "2026-01-10T00:00:00.000Z",
    });

    await expect(createInvoiceRequest({ enterpriseId: "ent-mig" })).rejects.toThrow(/无可开票余额/);

    const active = await listActiveInvoiceOccupanciesForEnterprise("ent-mig");
    expect(active).toHaveLength(1);
    expect(active[0].allocations?.[0]?.orderId).toBe(order.id);
  });

  it("migrate + bill allocation for mixed bare total", async () => {
    const order = await createCommercialOrder({
      enterpriseId: "ent-mig",
      kind: "subscribe",
      amountCents: 1000,
      lineItems: [{ label: "P", amountCents: 1000 }],
    });
    await transitionCommercialOrderStatus("ent-mig", order.id, "paid");
    await appendFinalSettlementIdempotent(
      {
        id: "bill-mig-1",
        enterpriseId: "ent-mig",
        cycleStart: "2026-01-01T00:00:00.000Z",
        cycleEnd: "2026-02-01T00:00:00.000Z",
        planVersionId: "pv-1",
        items: [],
        seatCostCents: 0,
        usageCostCents: 0,
        extraCostCents: 500,
        totalCostCents: 500,
        generatedAt: "2026-02-01T00:00:00.000Z",
        status: "finalized",
        settlementKey: "ent-mig|s|pv|c0",
      },
      {
        id: "snap-mig-1",
        enterpriseId: "ent-mig",
        date: "2026-02-01",
        snapshotType: "final",
        seatCostCents: 0,
        usageCostCents: 0,
        totalCostCents: 500,
        missingPriceKeys: [],
        createdAt: "2026-02-01T00:00:00.000Z",
        billId: "bill-mig-1",
        settlementKey: "ent-mig|s|pv|c0",
      },
    );

    await __putInvoiceRequestForTest({
      id: "inv-mixed-bare",
      enterpriseId: "ent-mig",
      amountCents: 1500,
      status: "issued",
      createdAt: "2026-02-02T00:00:00.000Z",
    });

    const result = await migrateBareTotalInvoiceAllocationsForEnterprise("ent-mig");
    expect(result.migrated).toBe(1);
    const stored = await getInvoiceRequest("inv-mixed-bare");
    expect(stored?.allocations).toEqual([
      { orderId: order.id, amountCents: 1000 },
      { billId: "bill-mig-1", amountCents: 500 },
    ]);
    expect((await loadCommercialStatement("ent-mig")).invoiceableCents).toBe(0);
  });
});
