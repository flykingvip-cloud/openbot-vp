/**
 * 在线支付 checkout 创建 + webhook 入账（Property 2 幂等）。
 */

import { getCommercialOrderForEnterprise } from "./commercial-orders-store.js";
import { confirmManualPayment } from "./create-order-service.js";
import { getOnlinePaymentAdapter, isOnlinePaymentProvider } from "./payment-providers/registry.js";
import {
  createPayment,
  findPaymentByProviderRef,
  getPayment,
  listPaymentsForOrder,
  patchPayment,
  transitionPaymentStatus,
} from "./payments-store.js";
import type { PaymentProvider } from "./types.js";

export type CreateOnlinePaymentInput = {
  enterpriseId: string;
  orderId: string;
  provider: PaymentProvider;
  requestId?: string;
};

export async function createOnlinePaymentCheckout(input: CreateOnlinePaymentInput) {
  if (!isOnlinePaymentProvider(input.provider)) {
    throw new Error(`不支持的在线支付渠道：${input.provider}`);
  }
  const adapter = getOnlinePaymentAdapter(input.provider);
  if (!adapter) {
    throw new Error(`支付 adapter 未注册：${input.provider}`);
  }

  const order = await getCommercialOrderForEnterprise(input.enterpriseId, input.orderId);
  if (!order) {
    throw new Error("订单不存在");
  }
  if (order.status !== "pending_payment") {
    throw new Error("订单不在待支付状态");
  }

  const existing = await listPaymentsForOrder(input.enterpriseId, input.orderId);
  const pendingSameProvider = existing.find(
    (payment) => payment.status === "pending" && payment.provider === input.provider,
  );
  if (pendingSameProvider?.checkoutUrl) {
    return {
      payment: pendingSameProvider,
      checkoutUrl: pendingSameProvider.checkoutUrl,
      qrContent: undefined,
    };
  }

  const payment =
    pendingSameProvider ??
    (await createPayment({
      orderId: order.id,
      enterpriseId: order.enterpriseId,
      provider: input.provider,
      amountCents: order.amountCents,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    }));

  const checkout = await adapter.createCheckout({
    paymentId: payment.id,
    orderId: order.id,
    enterpriseId: order.enterpriseId,
    amountCents: order.amountCents,
    currency: order.currency,
  });

  const updated =
    (await patchPayment(payment.id, {
      providerRef: checkout.providerRef,
      ...(checkout.checkoutUrl ? { checkoutUrl: checkout.checkoutUrl } : {}),
    })) ?? payment;

  return {
    payment: { ...updated, checkoutUrl: checkout.checkoutUrl ?? updated.checkoutUrl },
    checkoutUrl: checkout.checkoutUrl,
    qrContent: checkout.qrContent,
  };
}

export async function processPaymentProviderWebhook(
  provider: Extract<PaymentProvider, "stripe" | "alipay">,
  input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: string;
  },
) {
  const adapter = getOnlinePaymentAdapter(provider);
  if (!adapter) {
    throw new Error(`未知 provider：${provider}`);
  }
  const event = await adapter.parseWebhook(input);
  if (event.kind === "ignored") {
    return { handled: true, status: 204 as const, deduped: false, result: null };
  }

  let payment =
    (event.paymentId ? await getPayment(event.paymentId) : null) ??
    (await findPaymentByProviderRef(event.providerRef));
  if (!payment) {
    throw new Error("未找到关联支付记录");
  }

  if (event.kind === "failed") {
    await transitionPaymentStatus(payment.id, "failed", {
      providerRef: event.providerRef,
    });
    return { handled: true, status: 204 as const, deduped: false, result: null };
  }

  const result = await confirmManualPayment({
    paymentId: payment.id,
    requestId: `webhook:${provider}:${event.providerRef}`,
  });
  return {
    handled: true,
    status: 204 as const,
    deduped: result.deduped,
    result,
  };
}
