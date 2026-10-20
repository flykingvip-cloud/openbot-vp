// @vitest-environment node
/**
 * Phase 4：真实 Gateway handlers — billing.statement / invoices.request
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "../server-methods/types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-p4-handlers-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

vi.mock("../billing/scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../billing/scope.js")>();
  return {
    ...actual,
    resolveBillingScope: vi.fn(async () => ({
      enterpriseId: "ent-p4",
      user: { id: "user-1" },
      membership: null,
      isEnterpriseAdmin: true,
      permissions: new Set([actual.USAGE_BUDGET_PERMISSION]),
    })),
  };
});

const { commercialInvoicesHandlers } = await import("../server-methods/commercial-invoices.js");
const { __resetBillingProfilesForTest, upsertBillingProfile } =
  await import("./billing-profile-store.js");
const { __resetCommercialOrdersForTest, createCommercialOrder, transitionCommercialOrderStatus } =
  await import("./commercial-orders-store.js");
const { __resetInvoiceRequestsForTest, rejectInvoiceRequest } =
  await import("./invoice-requests-store.js");
const { __resetLedgerForTest, appendFinalSettlementIdempotent } =
  await import("../billing/ledger-store.js");

type HandlerError = { code?: string; message?: string };

async function invoke<P = Record<string, unknown>>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ ok: boolean; payload: P; error: HandlerError }> {
  const handler = commercialInvoicesHandlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: { ok: boolean; payload: P; error: HandlerError } | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: { connect: {} as never, user: "admin@example.com" },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload: payload as P, error: (error ?? {}) as HandlerError };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

beforeEach(async () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  await __resetBillingProfilesForTest();
  await __resetCommercialOrdersForTest();
  await __resetInvoiceRequestsForTest();
  await __resetLedgerForTest();
  await upsertBillingProfile({
    enterpriseId: "ent-p4",
    legalName: "P4 Co",
    taxId: "91110000MA0P4TEST",
    invoiceType: "electronic",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Phase 4 handlers billing.statement + invoices.request", () => {
  it("statement reflects prepaid + bill; total request writes allocations", async () => {
    const order = await createCommercialOrder({
      enterpriseId: "ent-p4",
      kind: "subscribe",
      amountCents: 10_000,
      lineItems: [{ label: "Plan", amountCents: 10_000 }],
    });
    await transitionCommercialOrderStatus("ent-p4", order.id, "paid");
    await appendFinalSettlementIdempotent(
      {
        id: "bill-p4-1",
        enterpriseId: "ent-p4",
        cycleStart: "2026-01-01T00:00:00.000Z",
        cycleEnd: "2026-02-01T00:00:00.000Z",
        planVersionId: "pv-1",
        items: [],
        seatCostCents: 0,
        usageCostCents: 0,
        extraCostCents: 2500,
        totalCostCents: 2500,
        generatedAt: "2026-02-01T00:00:00.000Z",
        status: "finalized",
        settlementKey: "ent-p4|s|pv|c0",
      },
      {
        id: "snap-p4-1",
        enterpriseId: "ent-p4",
        date: "2026-02-01",
        snapshotType: "final",
        seatCostCents: 0,
        usageCostCents: 0,
        totalCostCents: 2500,
        missingPriceKeys: [],
        createdAt: "2026-02-01T00:00:00.000Z",
        billId: "bill-p4-1",
        settlementKey: "ent-p4|s|pv|c0",
      },
    );

    const st1 = await invoke<{
      statement: {
        invoiceableCents: number;
        balanceDueCents: number;
        lines: Array<{ type: string }>;
      };
    }>("billing.statement");
    expect(st1.ok).toBe(true);
    expect(st1.payload.statement.invoiceableCents).toBe(12_500);
    expect(st1.payload.statement.balanceDueCents).toBe(2500);
    expect(st1.payload.statement.lines.some((l) => l.type === "base_prepaid")).toBe(true);
    expect(st1.payload.statement.lines.some((l) => l.type === "usage_overage")).toBe(true);

    const req = await invoke<{
      request: {
        amountCents: number;
        allocations?: Array<{ orderId?: string; billId?: string; amountCents: number }>;
      };
    }>("invoices.request", {});
    expect(req.ok).toBe(true);
    expect(req.payload.request.amountCents).toBe(12_500);
    expect(req.payload.request.allocations?.length).toBe(2);

    const st2 = await invoke<{ statement: { invoiceableCents: number } }>("billing.statement");
    expect(st2.payload.statement.invoiceableCents).toBe(0);

    const dup = await invoke("invoices.request", {});
    expect(dup.ok).toBe(false);
    expect(dup.error.message ?? "").toMatch(/可开票/);
  });

  it("handler concurrent total requests: single winner", async () => {
    const order = await createCommercialOrder({
      enterpriseId: "ent-p4",
      kind: "subscribe",
      amountCents: 4000,
      lineItems: [{ label: "S", amountCents: 4000 }],
    });
    await transitionCommercialOrderStatus("ent-p4", order.id, "paid");

    const results = await Promise.all([
      invoke("invoices.request", {}),
      invoke("invoices.request", {}),
      invoke("invoices.request", { orderId: order.id }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(2);

    const st = await invoke<{ statement: { invoiceableCents: number } }>("billing.statement");
    expect(st.payload.statement.invoiceableCents).toBe(0);
  });

  it("reject via store then handler can re-request", async () => {
    const order = await createCommercialOrder({
      enterpriseId: "ent-p4",
      kind: "subscribe",
      amountCents: 1500,
      lineItems: [{ label: "S", amountCents: 1500 }],
    });
    await transitionCommercialOrderStatus("ent-p4", order.id, "paid");
    const first = await invoke<{ request: { id: string } }>("invoices.request", {
      orderId: order.id,
    });
    expect(first.ok).toBe(true);
    await rejectInvoiceRequest(first.payload.request.id, "retry ok");

    const st = await invoke<{ statement: { invoiceableCents: number } }>("billing.statement");
    expect(st.payload.statement.invoiceableCents).toBe(1500);

    const second = await invoke<{ request: { amountCents: number } }>("invoices.request", {
      orderId: order.id,
    });
    expect(second.ok).toBe(true);
    expect(second.payload.request.amountCents).toBe(1500);
  });
});
