/**
 * 支付宝 adapter（sandbox 默认；live 预留 appId + 密钥配置）。
 */

import { resolveCommercePaymentConfig } from "../commerce-config.js";
import { signCommercePayload, verifyCommerceSignature } from "./signing.js";
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

export const alipayPaymentAdapter: PaymentProviderAdapter = {
  provider: "alipay",

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const config = resolveCommercePaymentConfig();
    const providerRef = `sandbox_alipay_${input.paymentId}`;
    const qrContent = `https://openapi.alipay.com/gateway.do?mock=1&out_trade_no=${encodeURIComponent(input.paymentId)}&total_amount=${(input.amountCents / 100).toFixed(2)}`;
    const checkoutUrl =
      config.mode === "live" && config.alipayAppId
        ? `${config.gatewayPublicBaseUrl}/commerce/checkout/alipay?paymentId=${encodeURIComponent(input.paymentId)}`
        : `${config.gatewayPublicBaseUrl}/commerce/checkout/alipay?paymentId=${encodeURIComponent(input.paymentId)}`;
    return { providerRef, checkoutUrl, qrContent };
  },

  async parseWebhook(input: WebhookParseInput): Promise<WebhookParseResult> {
    const config = resolveCommercePaymentConfig();
    const sandboxSig =
      headerValue(input.headers, "x-openbot-commerce-signature") ??
      headerValue(input.headers, "X-OpenBot-Commerce-Signature");

    if (config.mode === "live" && config.alipayWebhookSecret) {
      if (!verifyCommerceSignature(config.alipayWebhookSecret, input.rawBody, sandboxSig)) {
        throw new Error("支付宝 notify 签名校验失败");
      }
    } else if (!verifyCommerceSignature(config.sandboxWebhookSecret, input.rawBody, sandboxSig)) {
      throw new Error("Commerce sandbox webhook 签名校验失败");
    }

    let payload: Record<string, string | undefined>;
    const contentType = headerValue(input.headers, "content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      payload = Object.fromEntries(new URLSearchParams(input.rawBody));
    } else {
      payload = JSON.parse(input.rawBody) as Record<string, string | undefined>;
    }

    const paymentId = payload.paymentId ?? payload.out_trade_no;
    const tradeStatus = payload.trade_status ?? payload.event;
    if (tradeStatus === "TRADE_SUCCESS" || tradeStatus === "paid") {
      return {
        kind: "paid",
        providerRef:
          payload.trade_no ?? payload.providerRef ?? `sandbox_alipay_${paymentId ?? "unknown"}`,
        paymentId,
      };
    }
    if (tradeStatus === "TRADE_CLOSED" || tradeStatus === "failed") {
      return {
        kind: "failed",
        providerRef: payload.trade_no ?? `sandbox_alipay_${paymentId ?? "unknown"}`,
        paymentId,
        reason: payload.reason,
      };
    }
    return { kind: "ignored" };
  },
};

export function buildSandboxAlipayWebhookPayload(
  paymentId: string,
  secret: string,
): {
  body: string;
  signature: string;
} {
  const body = JSON.stringify({
    event: "paid",
    paymentId,
    providerRef: `sandbox_alipay_${paymentId}`,
  });
  return { body, signature: signCommercePayload(secret, body) };
}
