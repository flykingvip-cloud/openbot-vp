/**
 * 商业支付 RPC（手工核销 + 后续在线支付扩展）。
 */

import { getCommercialOrderForEnterprise } from "../commerce/commercial-orders-store.js";
import { confirmManualPayment } from "../commerce/create-order-service.js";
import {
  listPlatformCommerceQueue,
  retryOrderFulfillment,
} from "../commerce/fulfillment-reconcile.js";
import { createOnlinePaymentCheckout } from "../commerce/payment-checkout-service.js";
import {
  createPayment,
  getPaymentForEnterprise,
  listPaymentsForOrder,
} from "../commerce/payments-store.js";
import type { PaymentProvider } from "../commerce/types.js";
import {
  requireEnterpriseScope,
  respondInvalid,
  respondUnavailable,
  stringValue,
} from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

function parseOnlineProvider(value: string | undefined): PaymentProvider | null {
  if (value === "manual" || value === "stripe" || value === "alipay" || value === "wechat") {
    return value;
  }
  return null;
}

export const commercialPaymentsHandlers: GatewayRequestHandlers = {
  "payments.create": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const orderId = stringValue(params.orderId);
      const provider = parseOnlineProvider(stringValue(params.provider) ?? undefined) ?? "manual";
      if (!orderId) {
        respondInvalid(respond, "orderId 是必填项");
        return;
      }
      if (provider === "wechat") {
        respondInvalid(respond, "微信支付尚未开放");
        return;
      }
      if (provider === "stripe" || provider === "alipay") {
        const result = await createOnlinePaymentCheckout({
          enterpriseId: scope.enterpriseId,
          orderId,
          provider,
          ...(stringValue(params.requestId)
            ? { requestId: stringValue(params.requestId) as string }
            : {}),
        });
        respond(true, result);
        return;
      }
      const order = await getCommercialOrderForEnterprise(scope.enterpriseId, orderId);
      if (!order) {
        respondInvalid(respond, "订单不存在");
        return;
      }
      if (order.status !== "pending_payment") {
        respondInvalid(respond, "订单不在待支付状态");
        return;
      }
      const existing = await listPaymentsForOrder(scope.enterpriseId, orderId);
      const pending = existing.find((payment) => payment.status === "pending");
      if (pending) {
        respond(true, { payment: pending });
        return;
      }
      const payment = await createPayment({
        orderId: order.id,
        enterpriseId: order.enterpriseId,
        provider: "manual",
        amountCents: order.amountCents,
        ...(stringValue(params.requestId)
          ? { requestId: stringValue(params.requestId) as string }
          : {}),
      });
      respond(true, { payment });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "payments.confirm-manual": async ({ client, params, respond }) => {
    try {
      const paymentId = stringValue(params.paymentId);
      if (!paymentId) {
        respondInvalid(respond, "paymentId 是必填项");
        return;
      }
      const result = await confirmManualPayment({
        paymentId,
        ...(stringValue(params.requestId)
          ? { requestId: stringValue(params.requestId) as string }
          : {}),
        ...(client?.user ? { confirmedByUserId: client.user } : {}),
      });
      respond(true, result);
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "payments.get": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const paymentId = stringValue(params.paymentId);
      if (!paymentId) {
        respondInvalid(respond, "paymentId 是必填项");
        return;
      }
      const payment = await getPaymentForEnterprise(scope.enterpriseId, paymentId);
      if (!payment) {
        respondInvalid(respond, "支付记录不存在");
        return;
      }
      respond(true, { payment });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-commerce.reconcile-queue": async ({ respond }) => {
    try {
      const queue = await listPlatformCommerceQueue();
      respond(true, {
        ...queue,
        /** 兼容旧客户端：仅 paid-unfulfilled */
        orders: queue.paidUnfulfilled,
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-commerce.fulfillment-retry": async ({ client, params, respond }) => {
    try {
      const orderId = stringValue(params.orderId);
      if (!orderId) {
        respondInvalid(respond, "orderId 是必填项");
        return;
      }
      const result = await retryOrderFulfillment(orderId, client?.user);
      respond(true, result);
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
