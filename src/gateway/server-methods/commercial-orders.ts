/**
 * 商业订单 RPC（企业端 + 平台只读列表）。
 */

import { BANK_TRANSFER_INSTRUCTIONS } from "../commerce/commerce-config.js";
import {
  getCommercialOrder,
  listAllCommercialOrders,
  listCommercialOrders,
  transitionCommercialOrderStatus,
} from "../commerce/commercial-orders-store.js";
import { createOrderFromSalesLead } from "../commerce/create-order-from-lead.js";
import {
  createChangePlanCommercialOrder,
  createRechargeCreditsCommercialOrder,
  createRenewCommercialOrder,
  createSubscribeCommercialOrder,
} from "../commerce/create-order-service.js";
import { listPaymentsForOrder } from "../commerce/payments-store.js";
import { syncTenantBillingProjection } from "../commerce/tenant-billing-projection.js";
import type { CommercialOrderKind } from "../commerce/types.js";
import {
  numberValue,
  requireEnterpriseScope,
  respondInvalid,
  respondUnavailable,
  stringValue,
} from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

function parseKind(value: string | undefined): CommercialOrderKind | null {
  if (
    value === "subscribe" ||
    value === "change_plan" ||
    value === "renew" ||
    value === "recharge_credits"
  ) {
    return value;
  }
  return null;
}

export const commercialOrdersHandlers: GatewayRequestHandlers = {
  "commercial-orders.create": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const kind = parseKind(stringValue(params.kind) ?? "subscribe");
      if (!kind) {
        respondInvalid(respond, "kind 无效");
        return;
      }
      const billingCycle = stringValue(params.billingCycle);
      const actorUserId = client?.user;

      if (kind === "subscribe") {
        const result = await createSubscribeCommercialOrder({
          enterpriseId: scope.enterpriseId,
          ...(stringValue(params.planVersionId)
            ? { planVersionId: stringValue(params.planVersionId) as string }
            : {}),
          ...(stringValue(params.planId) ? { planId: stringValue(params.planId) as string } : {}),
          ...(billingCycle === "monthly" ||
          billingCycle === "quarterly" ||
          billingCycle === "annual"
            ? { billingCycle }
            : {}),
          ...(actorUserId ? { actorUserId } : {}),
        });
        respond(true, result);
        return;
      }

      if (kind === "change_plan") {
        const targetPlanId = stringValue(params.targetPlanId);
        if (!targetPlanId) {
          respondInvalid(respond, "targetPlanId 是必填项");
          return;
        }
        const result = await createChangePlanCommercialOrder({
          enterpriseId: scope.enterpriseId,
          targetPlanId,
          ...(billingCycle === "monthly" ||
          billingCycle === "quarterly" ||
          billingCycle === "annual"
            ? { billingCycle }
            : {}),
          ...(actorUserId ? { actorUserId } : {}),
        });
        respond(true, result);
        return;
      }

      if (kind === "renew") {
        const result = await createRenewCommercialOrder({
          enterpriseId: scope.enterpriseId,
          ...(actorUserId ? { actorUserId } : {}),
        });
        respond(true, result);
        return;
      }

      if (kind === "recharge_credits") {
        const creditPackId = stringValue(params.creditPackId);
        if (!creditPackId) {
          respondInvalid(respond, "creditPackId 是必填项");
          return;
        }
        const result = await createRechargeCreditsCommercialOrder({
          enterpriseId: scope.enterpriseId,
          creditPackId,
          ...(actorUserId ? { actorUserId } : {}),
        });
        respond(true, result);
        return;
      }

      respondInvalid(respond, "该订单类型尚未开放");
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "commercial-orders.get": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const orderId = stringValue(params.orderId);
      if (!orderId) {
        respondInvalid(respond, "orderId 是必填项");
        return;
      }
      const order = await getCommercialOrder(scope.enterpriseId, orderId);
      if (!order) {
        respondInvalid(respond, "订单不存在");
        return;
      }
      const payments = await listPaymentsForOrder(scope.enterpriseId, orderId);
      respond(true, { order, payments });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "commercial-orders.list": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const status = stringValue(params.status);
      const limitRaw = params.limit;
      const limit = typeof limitRaw === "number" ? limitRaw : Number(limitRaw);
      const orders = await listCommercialOrders(scope.enterpriseId, {
        ...(status === "pending_payment" ||
        status === "paid" ||
        status === "failed" ||
        status === "canceled"
          ? { status }
          : {}),
        ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
      });
      respond(true, { orders });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "commercial-orders.cancel": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const orderId = stringValue(params.orderId);
      if (!orderId) {
        respondInvalid(respond, "orderId 是必填项");
        return;
      }
      const existing = await getCommercialOrder(scope.enterpriseId, orderId);
      if (!existing) {
        respondInvalid(respond, "订单不存在");
        return;
      }
      if (existing.status !== "pending_payment") {
        respondInvalid(respond, "仅待支付订单可取消");
        return;
      }
      const order = await transitionCommercialOrderStatus(scope.enterpriseId, orderId, "canceled");
      await syncTenantBillingProjection(scope.enterpriseId);
      respond(true, { order });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-commerce.orders": async ({ params, respond }) => {
    try {
      const status = stringValue(params.status);
      const limitRaw = params.limit;
      const limit = typeof limitRaw === "number" ? limitRaw : Number(limitRaw);
      const orders = await listAllCommercialOrders({
        ...(status === "pending_payment" ||
        status === "paid" ||
        status === "failed" ||
        status === "canceled"
          ? { status }
          : {}),
        ...(Number.isFinite(limit) && limit > 0 ? { limit } : { limit: 100 }),
      });
      respond(true, { orders });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-commerce.from-lead": async ({ client, params, respond }) => {
    try {
      const leadId = stringValue(params.leadId);
      const enterpriseId = stringValue(params.enterpriseId);
      if (!leadId) {
        respondInvalid(respond, "leadId 是必填项");
        return;
      }
      if (!enterpriseId) {
        respondInvalid(respond, "enterpriseId 是必填项");
        return;
      }
      const billingCycle = stringValue(params.billingCycle);
      const amountRaw = numberValue(params.amountCents);
      const result = await createOrderFromSalesLead({
        leadId,
        enterpriseId,
        ...(stringValue(params.planId) ? { planId: stringValue(params.planId) as string } : {}),
        ...(stringValue(params.planVersionId)
          ? { planVersionId: stringValue(params.planVersionId) as string }
          : {}),
        ...(billingCycle === "monthly" || billingCycle === "quarterly" || billingCycle === "annual"
          ? { billingCycle }
          : {}),
        ...(amountRaw !== null && amountRaw >= 0 ? { amountCents: Math.round(amountRaw) } : {}),
        ...(client?.user ? { actorUserId: client.user } : {}),
      });
      respond(true, result);
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "commercial-orders.checkout-info": async ({ respond }) => {
    respond(true, { bankTransfer: BANK_TRANSFER_INSTRUCTIONS });
  },
};
