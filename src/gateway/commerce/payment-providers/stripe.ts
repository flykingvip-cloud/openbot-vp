/**
 * Stripe checkout + webhook adapter（sandbox 默认；live 需 OPENBOT_COMMERCE_STRIPE_SECRET_KEY）。
 */

import { resolveCommercePaymentConfig } from "../commerce-config.js";
import {
  signCommercePayload,
  verifyCommerceSignature,
  verifyStripeWebhookSignature,
} from "./signing.js";
import type {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProviderAdapter,
  WebhookParseInput,
  WebhookParseResult,
} from "./types.js";

function headerValue(headers: WebhookParseInput["headers"], name: string): string | undefined {
  const raw = headers[name.toLowerCase()] ?? headers[name];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return raw;
}

async function createLiveStripeCheckout(
  input: CreateCheckoutInput,
  secretKey: string,
  baseUrl: string,
): Promise<CreateCheckoutResult> {
  const providerRef = `stripe_cs_${input.paymentId}`;
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("client_reference_id", input.paymentId);
  params.set(
    "success_url",
    `${baseUrl}/commerce/checkout/complete?paymentId=${encodeURIComponent(input.paymentId)}`,
  );
  params.set(
    "cancel_url",
    `${baseUrl}/commerce/checkout/canceled?paymentId=${encodeURIComponent(input.paymentId)}`,
  );
  params.set("metadata[paymentId]", input.paymentId);
  params.set("metadata[orderId]", input.orderId);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", input.currency.toLowerCase());
  params.set("line_items[0][price_data][unit_amount]", String(input.amountCents));
  params.set("line_items[0][price_data][product_data][name]", `OpenBot Order ${input.orderId}`);

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Stripe checkout 创建失败：${text.slice(0, 200)}`);
  }
  const body = (await response.json()) as { id?: string; url?: string };
  return {
    providerRef: body.id ?? providerRef,
    checkoutUrl: body.url,
  };
}

function createSandboxStripeCheckout(
  input: CreateCheckoutInput,
  baseUrl: string,
): CreateCheckoutResult {
  const providerRef = `sandbox_stripe_${input.paymentId}`;
  const checkoutUrl = `${baseUrl}/commerce/checkout/stripe?paymentId=${encodeURIComponent(input.paymentId)}`;
  return { providerRef, checkoutUrl };
}

export const stripePaymentAdapter: PaymentProviderAdapter = {
  provider: "stripe",

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const config = resolveCommercePaymentConfig();
    const baseUrl = config.gatewayPublicBaseUrl;
    if (config.mode === "live" && config.stripeSecretKey) {
      return createLiveStripeCheckout(input, config.stripeSecretKey, baseUrl);
    }
    return createSandboxStripeCheckout(input, baseUrl);
  },

  async parseWebhook(input: WebhookParseInput): Promise<WebhookParseResult> {
    const config = resolveCommercePaymentConfig();
    const stripeSig = headerValue(input.headers, "stripe-signature");
    const sandboxSig =
      headerValue(input.headers, "x-openbot-commerce-signature") ??
      headerValue(input.headers, "X-OpenBot-Commerce-Signature");

    if (config.mode === "live" && config.stripeWebhookSecret) {
      if (!verifyStripeWebhookSignature(config.stripeWebhookSecret, input.rawBody, stripeSig)) {
        throw new Error("Stripe webhook 签名校验失败");
      }
      const event = JSON.parse(input.rawBody) as {
        type?: string;
        data?: {
          object?: { client_reference_id?: string; id?: string; metadata?: { paymentId?: string } };
        };
      };
      if (event.type === "checkout.session.completed") {
        const obj = event.data?.object;
        return {
          kind: "paid",
          providerRef: obj?.id ?? "stripe",
          paymentId: obj?.client_reference_id ?? obj?.metadata?.paymentId,
        };
      }
      return { kind: "ignored" };
    }

    const secret = config.sandboxWebhookSecret;
    if (!verifyCommerceSignature(secret, input.rawBody, sandboxSig)) {
      throw new Error("Commerce sandbox webhook 签名校验失败");
    }
    const payload = JSON.parse(input.rawBody) as {
      event?: string;
      paymentId?: string;
      providerRef?: string;
    };
    if (payload.event === "paid" && payload.paymentId) {
      return {
        kind: "paid",
        providerRef: payload.providerRef ?? `sandbox_stripe_${payload.paymentId}`,
        paymentId: payload.paymentId,
      };
    }
    if (payload.event === "failed" && payload.paymentId) {
      return {
        kind: "failed",
        providerRef: payload.providerRef ?? `sandbox_stripe_${payload.paymentId}`,
        paymentId: payload.paymentId,
      };
    }
    return { kind: "ignored" };
  },
};

/** 生成 sandbox webhook 测试载荷（仅测试/文档）。 */
export function buildSandboxStripeWebhookPayload(
  paymentId: string,
  secret: string,
): {
  body: string;
  signature: string;
} {
  const body = JSON.stringify({
    event: "paid",
    paymentId,
    providerRef: `sandbox_stripe_${paymentId}`,
  });
  return { body, signature: signCommercePayload(secret, body) };
}
