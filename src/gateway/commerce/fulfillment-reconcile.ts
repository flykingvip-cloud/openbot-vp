/**
 * paid 但未 fulfilled / 待支付 的订单对账（平台 ADMIN）。
 */

import {
  getCommercialOrderById,
  listAllCommercialOrders,
  listPaidUnfulfilledOrders,
} from "./commercial-orders-store.js";
import { fulfillCommercialOrder } from "./order-fulfillment.js";
import { listPaymentsForOrder } from "./payments-store.js";
import type { Payment } from "./types.js";

export type PlatformCommerceQueue = {
  pendingPayment: Awaited<ReturnType<typeof listAllCommercialOrders>>;
  paidUnfulfilled: Awaited<ReturnType<typeof listPaidUnfulfilledOrders>>;
  /** orderId → 首选 pending 支付（平台核销用）。 */
  paymentsByOrderId: Record<string, Payment>;
};

async function attachPendingPayments(
  orders: Awaited<ReturnType<typeof listAllCommercialOrders>>,
): Promise<Record<string, Payment>> {
  const paymentsByOrderId: Record<string, Payment> = {};
  for (const order of orders) {
    const payments = await listPaymentsForOrder(order.enterpriseId, order.id);
    const pending = payments.find((payment) => payment.status === "pending") ?? payments[0];
    if (pending) {
      paymentsByOrderId[order.id] = pending;
    }
  }
  return paymentsByOrderId;
}

export async function listPlatformCommerceQueue(): Promise<PlatformCommerceQueue> {
  const [pendingPayment, paidUnfulfilled] = await Promise.all([
    listAllCommercialOrders({ status: "pending_payment", limit: 200 }),
    listPaidUnfulfilledOrders(),
  ]);
  const paymentsByOrderId = await attachPendingPayments(pendingPayment);
  return { pendingPayment, paidUnfulfilled, paymentsByOrderId };
}

/** @deprecated 使用 listPlatformCommerceQueue */
export async function listReconcileQueue() {
  return listPaidUnfulfilledOrders();
}

export async function retryOrderFulfillment(orderId: string, actorUserId?: string) {
  const order = await getCommercialOrderById(orderId);
  if (!order) {
    throw new Error(`订单不存在：${orderId}`);
  }
  if (order.status !== "paid") {
    throw new Error("仅 paid 订单可重试履约");
  }
  return fulfillCommercialOrder(orderId, { actorUserId });
}
