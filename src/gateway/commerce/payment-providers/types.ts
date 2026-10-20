/**
 * 在线支付 provider adapter 缝（R9.1）。
 */

import type { PaymentProvider } from "../types.js";

export type CreateCheckoutInput = {
  paymentId: string;
  orderId: string;
  enterpriseId: string;
  amountCents: number;
  currency: "CNY" | "USD";
};

export type CreateCheckoutResult = {
  providerRef: string;
  checkoutUrl?: string;
  /** 支付宝等扫码支付：供 UI 渲染二维码内容。 */
  qrContent?: string;
};

export type WebhookParseInput = {
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
};

export type WebhookParseResult =
  | { kind: "paid"; providerRef: string; paymentId?: string }
  | { kind: "failed"; providerRef: string; paymentId?: string; reason?: string }
  | { kind: "ignored" };

export type PaymentProviderAdapter = {
  provider: Extract<PaymentProvider, "stripe" | "alipay">;
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  parseWebhook(input: WebhookParseInput): Promise<WebhookParseResult>;
};
