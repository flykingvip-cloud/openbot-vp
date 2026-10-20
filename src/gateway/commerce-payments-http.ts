/**
 * 商业支付 HTTP：webhook + sandbox checkout 页（不走 RPC scope）。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readRequestBodyWithLimit, DEFAULT_WEBHOOK_MAX_BODY_BYTES } from "../infra/http-body.js";
import { resolveCommercePaymentConfig } from "./commerce/commerce-config.js";
import { processPaymentProviderWebhook } from "./commerce/payment-checkout-service.js";
import { buildSandboxStripeWebhookPayload } from "./commerce/payment-providers/stripe.js";
import { getPayment } from "./commerce/payments-store.js";
import { sendMethodNotAllowed, sendText } from "./http-common.js";

const WEBHOOK_PATHS = {
  stripe: "/commerce/webhooks/stripe",
  alipay: "/commerce/webhooks/alipay",
} as const;

const CHECKOUT_PATHS = {
  stripe: "/commerce/checkout/stripe",
  complete: "/commerce/checkout/complete",
  canceled: "/commerce/checkout/canceled",
  alipay: "/commerce/checkout/alipay",
} as const;

async function readRawBody(req: IncomingMessage): Promise<string> {
  return readRequestBodyWithLimit(req, {
    maxBytes: DEFAULT_WEBHOOK_MAX_BODY_BYTES,
    encoding: "utf8",
  });
}

function renderSandboxStripeCheckoutPage(paymentId: string, amountCents: number): string {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/><title>OpenBot Sandbox Stripe</title></head>
<body style="font-family:system-ui;padding:24px;max-width:480px">
<h1>Sandbox Stripe Checkout</h1>
<p>Payment <code>${paymentId}</code> · ¥${(amountCents / 100).toFixed(2)}</p>
<p>此页仅用于开发/测试。生产环境请使用 Stripe Checkout 跳转。</p>
<form method="POST" action="${WEBHOOK_PATHS.stripe}?paymentId=${encodeURIComponent(paymentId)}">
<button type="submit">模拟支付成功</button>
</form>
<p class="muted">Webhook 将由服务端 sandbox 签名验证。</p>
</body></html>`;
}

function renderAlipayCheckoutPage(paymentId: string, qrContent?: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/><title>OpenBot 支付宝 Sandbox</title></head>
<body style="font-family:system-ui;padding:24px;max-width:480px">
<h1>支付宝 Sandbox</h1>
<p>Payment <code>${paymentId}</code></p>
${qrContent ? `<pre style="word-break:break-all;background:#f4f4f4;padding:12px">${qrContent}</pre>` : ""}
<p>请使用支付宝扫码（sandbox）或等待 notify。</p>
</body></html>`;
}

/** Gateway HTTP stage handler。返回 true 表示已处理。 */
export async function handleCommercePaymentsHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (path === WEBHOOK_PATHS.stripe || path === WEBHOOK_PATHS.alipay) {
    if (req.method !== "POST") {
      sendMethodNotAllowed(res, "POST");
      return true;
    }
    try {
      let rawBody = await readRawBody(req);
      const config = resolveCommercePaymentConfig();
      if (
        path === WEBHOOK_PATHS.stripe &&
        config.mode === "sandbox" &&
        req.headers["content-type"]?.includes("application/x-www-form-urlencoded")
      ) {
        const paymentId = url.searchParams.get("paymentId") ?? "";
        if (paymentId) {
          const payload = buildSandboxStripeWebhookPayload(paymentId, config.sandboxWebhookSecret);
          rawBody = payload.body;
          req.headers["x-openbot-commerce-signature"] = payload.signature;
          req.headers["content-type"] = "application/json";
        }
      }
      const provider = path === WEBHOOK_PATHS.stripe ? "stripe" : "alipay";
      await processPaymentProviderWebhook(provider, { headers: req.headers, rawBody });
      res.statusCode = 204;
      res.end();
      return true;
    } catch (err) {
      sendText(res, 400, err instanceof Error ? err.message : String(err));
      return true;
    }
  }

  if (path === CHECKOUT_PATHS.stripe && req.method === "GET") {
    const paymentId = url.searchParams.get("paymentId") ?? "";
    const payment = paymentId ? await getPayment(paymentId) : null;
    if (!payment) {
      sendText(res, 404, "Payment not found");
      return true;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(renderSandboxStripeCheckoutPage(payment.id, payment.amountCents));
    return true;
  }

  if (path === CHECKOUT_PATHS.alipay && req.method === "GET") {
    const paymentId = url.searchParams.get("paymentId") ?? "";
    const payment = paymentId ? await getPayment(paymentId) : null;
    if (!payment) {
      sendText(res, 404, "Payment not found");
      return true;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(renderAlipayCheckoutPage(payment.id, payment.checkoutUrl));
    return true;
  }

  if (
    (path === CHECKOUT_PATHS.complete || path === CHECKOUT_PATHS.canceled) &&
    req.method === "GET"
  ) {
    const paymentId = url.searchParams.get("paymentId") ?? "";
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      `<html><body style="font-family:system-ui;padding:24px"><h1>${
        path === CHECKOUT_PATHS.complete ? "支付处理中" : "支付已取消"
      }</h1><p>Payment ${paymentId || "—"}</p><p>请返回 OpenBot 订单页查看状态。</p></body></html>`,
    );
    return true;
  }

  return false;
}
