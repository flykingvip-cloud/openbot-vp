// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-commerce-isolation-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { __resetCommercialOrdersForTest } = await import("./commercial-orders-store.js");
const { __resetPaymentsForTest, createPayment, getPaymentForEnterprise } =
  await import("./payments-store.js");

describe("commerce tenant isolation", () => {
  beforeEach(async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    await __resetCommercialOrdersForTest();
    await __resetPaymentsForTest();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("getPaymentForEnterprise rejects cross-tenant access (Property 5)", async () => {
    const payment = await createPayment({
      orderId: "ord-a",
      enterpriseId: "ent-a",
      provider: "manual",
      amountCents: 100,
    });
    expect(await getPaymentForEnterprise("ent-a", payment.id)).toBeTruthy();
    expect(await getPaymentForEnterprise("ent-b", payment.id)).toBeNull();
  });
});
