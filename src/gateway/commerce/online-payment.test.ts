// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-online-pay-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { __resetCommercialOrdersForTest, createCommercialOrder } =
  await import("./commercial-orders-store.js");
const { __resetPaymentsForTest } = await import("./payments-store.js");
const { __resetSubscriptionsForTest } = await import("../billing/subscriptions-store.js");
const { createPlan } = await import("../billing/plans-store.js");
const { createSubscription } = await import("../billing/subscriptions-store.js");
const { createOnlinePaymentCheckout, processPaymentProviderWebhook } =
  await import("./payment-checkout-service.js");
const { buildSandboxStripeWebhookPayload } = await import("./payment-providers/stripe.js");
const { resolveCommercePaymentConfig } = await import("./commerce-config.js");

describe("online payment adapters", () => {
  beforeEach(async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    vi.unstubAllEnvs();
    process.env.OPENBOT_COMMERCE_PAYMENT_MODE = "sandbox";
    process.env.OPENBOT_COMMERCE_GATEWAY_PUBLIC_URL = "http://127.0.0.1:18789";
    await __resetCommercialOrdersForTest();
    await __resetPaymentsForTest();
    await __resetSubscriptionsForTest();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  async function seedPendingOrder(enterpriseId: string) {
    const plan = await createPlan({
      name: "Pro",
      billingCycle: "monthly",
      basePriceCents: 9900,
      seatQuota: { viewer: 5 },
      botQuota: 2,
      createdByUserId: "test",
      pricing: [],
    });
    await createSubscription({
      enterpriseId,
      planId: plan.id,
      planVersionId: plan.currentVersionId,
      initialStatus: "pending_payment",
    });
    return createCommercialOrder({
      enterpriseId,
      kind: "subscribe",
      amountCents: 9900,
      lineItems: [{ label: "Pro", amountCents: 9900 }],
      planId: plan.id,
      planVersionId: plan.currentVersionId,
      initialStatus: "pending_payment",
    });
  }

  it("createOnlinePaymentCheckout returns checkoutUrl for stripe", async () => {
    const order = await seedPendingOrder("ent-pay");
    const result = await createOnlinePaymentCheckout({
      enterpriseId: "ent-pay",
      orderId: order.id,
      provider: "stripe",
    });
    expect(result.checkoutUrl).toContain("/commerce/checkout/stripe");
    expect(result.payment.provider).toBe("stripe");
    expect(result.payment.providerRef).toContain("sandbox_stripe_");
  });

  it("stripe webhook confirms payment idempotently (Property 2)", async () => {
    const order = await seedPendingOrder("ent-wh");
    const checkout = await createOnlinePaymentCheckout({
      enterpriseId: "ent-wh",
      orderId: order.id,
      provider: "stripe",
    });
    const config = resolveCommercePaymentConfig();
    const payload = buildSandboxStripeWebhookPayload(
      checkout.payment.id,
      config.sandboxWebhookSecret,
    );

    const first = await processPaymentProviderWebhook("stripe", {
      headers: { "x-openbot-commerce-signature": payload.signature },
      rawBody: payload.body,
    });
    expect(first.result?.deduped).toBe(false);

    const second = await processPaymentProviderWebhook("stripe", {
      headers: { "x-openbot-commerce-signature": payload.signature },
      rawBody: payload.body,
    });
    expect(second.result?.deduped).toBe(true);
  });

  it("rejects webhook with invalid signature", async () => {
    const order = await seedPendingOrder("ent-bad");
    const checkout = await createOnlinePaymentCheckout({
      enterpriseId: "ent-bad",
      orderId: order.id,
      provider: "alipay",
    });
    await expect(
      processPaymentProviderWebhook("alipay", {
        headers: { "x-openbot-commerce-signature": "bad-signature" },
        rawBody: JSON.stringify({ event: "paid", paymentId: checkout.payment.id }),
      }),
    ).rejects.toThrow(/签名校验失败/);
  });
});
