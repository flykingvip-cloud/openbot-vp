// @vitest-environment node

import fs from "node:fs";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockHttpResponse } from "../test-http-response.js";

const tmpDir = path.join(os.tmpdir(), `openbot-commerce-e2e-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { createPlan } = await import("../billing/plans-store.js");
const { getActiveSubscription, __resetSubscriptionsForTest } =
  await import("../billing/subscriptions-store.js");
const { __resetCommercialOrdersForTest, getCommercialOrderById } =
  await import("./commercial-orders-store.js");
const { __resetPaymentsForTest } = await import("./payments-store.js");
const { createSubscribeCommercialOrder } = await import("./create-order-service.js");
const { createOnlinePaymentCheckout, processPaymentProviderWebhook } =
  await import("./payment-checkout-service.js");
const { buildSandboxStripeWebhookPayload } = await import("./payment-providers/stripe.js");
const { resolveCommercePaymentConfig } = await import("./commerce-config.js");
const { resolveTenantBillingProjectionStatus } = await import("./tenant-billing-projection.js");
const { handleCommercePaymentsHttpRequest } = await import("../commerce-payments-http.js");

function makeWebhookRequest(params: {
  url: string;
  body: string;
  headers?: Record<string, string>;
}): IncomingMessage {
  const req = Readable.from([params.body]) as IncomingMessage;
  Object.assign(req, {
    url: params.url,
    method: "POST",
    headers: {
      host: "127.0.0.1:18789",
      "content-type": "application/json",
      ...params.headers,
    },
  });
  return req;
}

describe("subscription-commerce integration", () => {
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

  it("subscribe → online checkout → webhook activates subscription (Property 2 + 3)", async () => {
    const enterpriseId = "ent-e2e";
    const plan = await createPlan({
      name: "Growth",
      billingCycle: "monthly",
      basePriceCents: 29_900,
      seatQuota: { viewer: 10 },
      botQuota: 5,
      createdByUserId: "test",
      pricing: [],
      commercial: { purchaseMode: "self_serve", slot: "business" },
    });

    const created = await createSubscribeCommercialOrder({
      enterpriseId,
      planId: plan.id,
    });
    expect(created.order.status).toBe("pending_payment");
    expect(await resolveTenantBillingProjectionStatus(enterpriseId)).toBe("past_due");

    const checkout = await createOnlinePaymentCheckout({
      enterpriseId,
      orderId: created.order.id,
      provider: "stripe",
    });
    expect(checkout.checkoutUrl).toContain("/commerce/checkout/stripe");

    const config = resolveCommercePaymentConfig();
    const payload = buildSandboxStripeWebhookPayload(
      checkout.payment.id,
      config.sandboxWebhookSecret,
    );

    const webhookResult = await processPaymentProviderWebhook("stripe", {
      headers: { "x-openbot-commerce-signature": payload.signature },
      rawBody: payload.body,
    });
    expect(webhookResult.result?.deduped).toBe(false);

    const order = await getCommercialOrderById(created.order.id);
    expect(order?.status).toBe("paid");

    const subscription = await getActiveSubscription(enterpriseId);
    expect(subscription?.status).toBe("active");

    expect(await resolveTenantBillingProjectionStatus(enterpriseId)).toBe("active");

    const duplicate = await processPaymentProviderWebhook("stripe", {
      headers: { "x-openbot-commerce-signature": payload.signature },
      rawBody: payload.body,
    });
    expect(duplicate.result?.deduped).toBe(true);
  });

  it("HTTP stripe webhook route confirms sandbox payment", async () => {
    const enterpriseId = "ent-http";
    const plan = await createPlan({
      name: "Team",
      billingCycle: "monthly",
      basePriceCents: 9900,
      seatQuota: { viewer: 5 },
      botQuota: 2,
      createdByUserId: "test",
      pricing: [],
    });
    const created = await createSubscribeCommercialOrder({
      enterpriseId,
      planId: plan.id,
    });
    const checkout = await createOnlinePaymentCheckout({
      enterpriseId,
      orderId: created.order.id,
      provider: "stripe",
    });

    const config = resolveCommercePaymentConfig();
    const payload = buildSandboxStripeWebhookPayload(
      checkout.payment.id,
      config.sandboxWebhookSecret,
    );
    const { res, end } = makeMockHttpResponse();
    const handled = await handleCommercePaymentsHttpRequest(
      makeWebhookRequest({
        url: "/commerce/webhooks/stripe",
        body: payload.body,
        headers: { "x-openbot-commerce-signature": payload.signature },
      }),
      res,
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(204);
    expect(end).toHaveBeenCalled();

    const order = await getCommercialOrderById(created.order.id);
    expect(order?.status).toBe("paid");
    const subscription = await getActiveSubscription(enterpriseId);
    expect(subscription?.status).toBe("active");
  });

  it("HTTP sandbox checkout page renders for pending payment", async () => {
    const enterpriseId = "ent-checkout-page";
    const plan = await createPlan({
      name: "Lite",
      billingCycle: "monthly",
      basePriceCents: 4900,
      seatQuota: { viewer: 3 },
      botQuota: 1,
      createdByUserId: "test",
      pricing: [],
    });
    const created = await createSubscribeCommercialOrder({
      enterpriseId,
      planId: plan.id,
    });
    const checkout = await createOnlinePaymentCheckout({
      enterpriseId,
      orderId: created.order.id,
      provider: "stripe",
    });

    const { res, end, setHeader } = makeMockHttpResponse();
    const handled = await handleCommercePaymentsHttpRequest(
      {
        url: `/commerce/checkout/stripe?paymentId=${encodeURIComponent(checkout.payment.id)}`,
        method: "GET",
        headers: { host: "127.0.0.1:18789" },
      } as IncomingMessage,
      res,
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(setHeader).toHaveBeenCalledWith("Content-Type", "text/html; charset=utf-8");
    const html = end.mock.calls[0]?.[0] as string;
    expect(html).toContain("Sandbox Stripe Checkout");
    expect(html).toContain(checkout.payment.id);
  });
});
