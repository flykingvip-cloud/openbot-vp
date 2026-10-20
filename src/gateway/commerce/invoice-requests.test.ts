// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-invoice-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { __resetBillingProfilesForTest, upsertBillingProfile } =
  await import("./billing-profile-store.js");
const { __resetCommercialOrdersForTest, createCommercialOrder, transitionCommercialOrderStatus } =
  await import("./commercial-orders-store.js");
const { __resetInvoiceRequestsForTest } = await import("./invoice-requests-store.js");
const { createInvoiceRequest } = await import("./invoice-request-service.js");
const { getInvoiceRequestForEnterprise } = await import("./invoice-requests-store.js");

describe("invoice requests", () => {
  beforeEach(async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    await __resetBillingProfilesForTest();
    await __resetCommercialOrdersForTest();
    await __resetInvoiceRequestsForTest();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("snapshots order amount on request (Property 4)", async () => {
    await upsertBillingProfile({
      enterpriseId: "ent-a",
      legalName: "Acme Ltd",
      taxId: "91110000MA01234567",
      invoiceType: "vat_special",
    });
    const order = await createCommercialOrder({
      enterpriseId: "ent-a",
      kind: "subscribe",
      amountCents: 49900,
      lineItems: [{ label: "Professional", amountCents: 49900 }],
    });
    await transitionCommercialOrderStatus("ent-a", order.id, "paid");

    const request = await createInvoiceRequest({ enterpriseId: "ent-a", orderId: order.id });
    expect(request.amountCents).toBe(49900);
    expect(request.status).toBe("pending");
  });

  it("rejects duplicate non-rejected requests (R5.2)", async () => {
    await upsertBillingProfile({
      enterpriseId: "ent-a",
      legalName: "Acme Ltd",
      taxId: "91110000MA01234567",
      invoiceType: "vat_normal",
    });
    const order = await createCommercialOrder({
      enterpriseId: "ent-a",
      kind: "subscribe",
      amountCents: 9900,
      lineItems: [{ label: "Starter", amountCents: 9900 }],
    });
    await transitionCommercialOrderStatus("ent-a", order.id, "paid");

    await createInvoiceRequest({ enterpriseId: "ent-a", orderId: order.id });
    // Phase 4：可开票余额已为 0（或 store 层重复拦截）
    await expect(
      createInvoiceRequest({ enterpriseId: "ent-a", orderId: order.id }),
    ).rejects.toThrow(/可开票余额|已有进行中的发票申请/);
  });

  it("rejects when billing profile incomplete (R5.3)", async () => {
    const order = await createCommercialOrder({
      enterpriseId: "ent-a",
      kind: "subscribe",
      amountCents: 9900,
      lineItems: [{ label: "Starter", amountCents: 9900 }],
    });
    await transitionCommercialOrderStatus("ent-a", order.id, "paid");

    await expect(
      createInvoiceRequest({ enterpriseId: "ent-a", orderId: order.id }),
    ).rejects.toThrow(/开票资料/);
  });

  it("getInvoiceRequestForEnterprise rejects cross-tenant access (Property 5)", async () => {
    await upsertBillingProfile({
      enterpriseId: "ent-a",
      legalName: "Acme Ltd",
      taxId: "91110000MA01234567",
      invoiceType: "electronic",
    });
    const order = await createCommercialOrder({
      enterpriseId: "ent-a",
      kind: "subscribe",
      amountCents: 100,
      lineItems: [{ label: "Test", amountCents: 100 }],
    });
    await transitionCommercialOrderStatus("ent-a", order.id, "paid");
    const request = await createInvoiceRequest({ enterpriseId: "ent-a", orderId: order.id });

    expect(await getInvoiceRequestForEnterprise("ent-a", request.id)).toBeTruthy();
    expect(await getInvoiceRequestForEnterprise("ent-b", request.id)).toBeNull();
  });
});
