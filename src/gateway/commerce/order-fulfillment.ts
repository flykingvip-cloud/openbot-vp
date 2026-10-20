/**
 * 订单支付成功后的履约：激活订阅 / 换套餐 / provision。
 */

import { normalizeBillingCycle } from "../billing/billing-cycle-pricing.js";
import { appendCreditBucket } from "../billing/credit-buckets-store.js";
import { billingEventBus } from "../billing/event-bus.js";
import { getCurrentPlanVersion, getPlan } from "../billing/plans-store.js";
import { resolveCycleWindow } from "../billing/runtime.js";
import { provisionEnterpriseSubscription } from "../billing/subscription-provisioning.js";
import {
  createSubscription,
  getActiveSubscription,
  getSubscription,
  setSubscriptionCommercialContract,
  transitionSubscriptionStatus,
} from "../billing/subscriptions-store.js";
import { appendRechargeCredits } from "../billing/tenant-credits-store.js";
import type { BillingCycle, Subscription } from "../billing/types.js";
import { buildCommercialContract, nextRenewContractStart } from "./commercial-contract.js";
import {
  getCommercialOrderById,
  hasOrderFulfillmentEvent,
  markOrderFulfilled,
  transitionCommercialOrderStatus,
} from "./commercial-orders-store.js";
import { getCreditPack } from "./credit-packs-store.js";
import { syncTenantBillingProjection } from "./tenant-billing-projection.js";
import type { CommercialOrder } from "./types.js";

export type FulfillmentResult = {
  order: CommercialOrder;
  subscription: Subscription | null;
  provisioning: Awaited<ReturnType<typeof provisionEnterpriseSubscription>> | null;
  deduped: boolean;
};

async function publishSubscriptionChanged(
  enterpriseId: string,
  subscription: Subscription,
): Promise<void> {
  await billingEventBus.publish({
    type: "subscription.changed",
    enterpriseId,
    subscriptionId: subscription.id,
    toStatus: subscription.status,
    planVersionId: subscription.planVersionId,
    occurredAt: new Date().toISOString(),
  });
}

async function bindCommercialContract(
  enterpriseId: string,
  subscription: Subscription,
  billingCycle: BillingCycle,
  contractStart: Date = new Date(),
): Promise<Subscription> {
  const commercialContract = buildCommercialContract(contractStart, billingCycle);
  const updated =
    (await setSubscriptionCommercialContract(enterpriseId, subscription.id, commercialContract)) ??
    subscription;
  return updated;
}

async function provisionAfterContract(
  enterpriseId: string,
  subscription: Subscription,
  actorUserId?: string,
  syncSeatGrants = true,
): Promise<Awaited<ReturnType<typeof provisionEnterpriseSubscription>>> {
  return provisionEnterpriseSubscription({
    enterpriseId,
    planVersionId: subscription.planVersionId,
    subscription,
    ...(actorUserId ? { actorUserId } : {}),
    ...(!syncSeatGrants ? { syncSeatGrants: false } : {}),
  });
}

async function fulfillSubscribe(
  order: CommercialOrder,
  actorUserId?: string,
): Promise<{
  subscription: Subscription;
  provisioning: Awaited<ReturnType<typeof provisionEnterpriseSubscription>>;
}> {
  const billingCycle = order.billingCycle ?? "monthly";
  const contractStart = order.paidAt ? new Date(order.paidAt) : new Date();

  if (order.pendingSubscriptionId) {
    const activated = await transitionSubscriptionStatus(
      order.enterpriseId,
      order.pendingSubscriptionId,
      "active",
    );
    if (!activated) {
      throw new Error(`订阅不存在或无法激活：${order.pendingSubscriptionId}`);
    }
    const withContract = await bindCommercialContract(
      order.enterpriseId,
      activated,
      billingCycle,
      contractStart,
    );
    const provisioning = await provisionAfterContract(
      order.enterpriseId,
      withContract,
      actorUserId,
    );
    await publishSubscriptionChanged(order.enterpriseId, withContract);
    return { subscription: withContract, provisioning };
  }

  if (!order.planId || !order.planVersionId) {
    throw new Error("订阅订单缺少 planId/planVersionId");
  }

  const subscription = await createSubscription({
    enterpriseId: order.enterpriseId,
    planId: order.planId,
    planVersionId: order.planVersionId,
    initialStatus: "active",
  });
  const withContract = await bindCommercialContract(
    order.enterpriseId,
    subscription,
    billingCycle,
    contractStart,
  );
  const provisioning = await provisionAfterContract(order.enterpriseId, withContract, actorUserId);
  await publishSubscriptionChanged(order.enterpriseId, withContract);
  return { subscription: withContract, provisioning };
}

async function fulfillChangePlan(
  order: CommercialOrder,
  actorUserId?: string,
): Promise<{
  subscription: Subscription;
  provisioning: Awaited<ReturnType<typeof provisionEnterpriseSubscription>>;
}> {
  const targetPlanId = order.targetPlanId ?? order.planId;
  if (!targetPlanId) {
    throw new Error("换套餐订单缺少 targetPlanId");
  }
  const targetPlan = await getPlan(targetPlanId);
  if (!targetPlan) {
    throw new Error(`目标套餐不存在：${targetPlanId}`);
  }
  const targetVersionId =
    order.targetPlanVersionId ??
    order.planVersionId ??
    (await getCurrentPlanVersion(targetPlanId))?.id;
  if (!targetVersionId) {
    throw new Error("目标套餐没有可订阅版本");
  }
  const billingCycle = order.billingCycle ?? "monthly";
  const contractStart = order.paidAt ? new Date(order.paidAt) : new Date();

  if (order.pendingSubscriptionId) {
    const pending = await getSubscription(order.enterpriseId, order.pendingSubscriptionId);
    if (pending?.status === "pending_payment") {
      const activated = await transitionSubscriptionStatus(
        order.enterpriseId,
        pending.id,
        "active",
      );
      if (!activated) {
        throw new Error("待支付订阅激活失败");
      }
      const withContract = await bindCommercialContract(
        order.enterpriseId,
        activated,
        billingCycle,
        contractStart,
      );
      const provisioning = await provisionAfterContract(
        order.enterpriseId,
        withContract,
        actorUserId,
      );
      await publishSubscriptionChanged(order.enterpriseId, withContract);
      return { subscription: withContract, provisioning };
    }
  }

  const current = order.subscriptionId
    ? await getSubscription(order.enterpriseId, order.subscriptionId)
    : null;
  if (current && current.status === "active") {
    await transitionSubscriptionStatus(order.enterpriseId, current.id, "canceled");
  }
  const subscription = await createSubscription({
    enterpriseId: order.enterpriseId,
    planId: targetPlanId,
    planVersionId: targetVersionId,
    initialStatus: "active",
  });
  const withContract = await bindCommercialContract(
    order.enterpriseId,
    subscription,
    billingCycle,
    contractStart,
  );
  const provisioning = await provisionAfterContract(order.enterpriseId, withContract, actorUserId);
  await publishSubscriptionChanged(order.enterpriseId, withContract);
  return { subscription: withContract, provisioning };
}

async function fulfillRenew(
  order: CommercialOrder,
  actorUserId?: string,
): Promise<{
  subscription: Subscription;
  provisioning: Awaited<ReturnType<typeof provisionEnterpriseSubscription>>;
}> {
  if (!order.subscriptionId) {
    throw new Error("续费订单缺少 subscriptionId");
  }
  const subscription = await getSubscription(order.enterpriseId, order.subscriptionId);
  if (!subscription) {
    throw new Error("续费目标订阅不存在");
  }
  const billingCycle =
    normalizeBillingCycle(order.billingCycle ?? subscription.commercialContract?.billingCycle) ??
    "monthly";
  const contractStart = nextRenewContractStart(
    subscription,
    order.paidAt ? new Date(order.paidAt) : new Date(),
  );
  const commercialContract = buildCommercialContract(contractStart, billingCycle);
  let active = subscription;
  if (subscription.status === "expired" || subscription.status === "suspended") {
    const reactivated = await transitionSubscriptionStatus(
      order.enterpriseId,
      subscription.id,
      "active",
    );
    if (!reactivated) {
      throw new Error("续费后订阅激活失败");
    }
    active = reactivated;
  }
  const withContract =
    (await setSubscriptionCommercialContract(order.enterpriseId, active.id, commercialContract)) ??
    active;
  const provisioning = await provisionAfterContract(
    order.enterpriseId,
    withContract,
    actorUserId,
    false,
  );
  await publishSubscriptionChanged(order.enterpriseId, withContract);
  return { subscription: withContract, provisioning };
}

async function fulfillRechargeCredits(
  order: CommercialOrder,
): Promise<{ subscription: Subscription | null; provisioning: null }> {
  if (!order.creditPackId) {
    throw new Error("充值订单缺少 creditPackId");
  }
  const pack = await getCreditPack(order.creditPackId);
  if (!pack) {
    throw new Error(`容量包不存在：${order.creditPackId}`);
  }
  const active = await getActiveSubscription(order.enterpriseId);
  if (!active) {
    throw new Error("无生效订阅，无法充值容量");
  }
  const { cycleStart } = resolveCycleWindow();
  await appendRechargeCredits({
    enterpriseId: order.enterpriseId,
    cycleStart,
    credits: pack.credits,
  });
  await appendCreditBucket({
    enterpriseId: order.enterpriseId,
    cycleStart,
    bucketType: "recharge",
    creditsGranted: pack.credits,
  });
  return { subscription: active, provisioning: null };
}

/**
 * 订单 paid 后履约（幂等：同一 orderId 仅执行一次）。
 */
export async function fulfillCommercialOrder(
  orderId: string,
  opts?: { actorUserId?: string },
): Promise<FulfillmentResult> {
  const order = await getCommercialOrderById(orderId);
  if (!order) {
    throw new Error(`订单不存在：${orderId}`);
  }
  if (order.status !== "paid") {
    throw new Error(`订单未支付，无法履约：${order.status}`);
  }
  if (await hasOrderFulfillmentEvent(orderId)) {
    const subscription = order.subscriptionId
      ? await getSubscription(order.enterpriseId, order.subscriptionId)
      : order.pendingSubscriptionId
        ? await getSubscription(order.enterpriseId, order.pendingSubscriptionId)
        : null;
    return { order, subscription, provisioning: null, deduped: true };
  }

  let subscription: Subscription | null = null;
  let provisioning: Awaited<ReturnType<typeof provisionEnterpriseSubscription>> | null = null;

  switch (order.kind) {
    case "subscribe": {
      const result = await fulfillSubscribe(order, opts?.actorUserId);
      subscription = result.subscription;
      provisioning = result.provisioning;
      break;
    }
    case "change_plan": {
      const result = await fulfillChangePlan(order, opts?.actorUserId);
      subscription = result.subscription;
      provisioning = result.provisioning;
      break;
    }
    case "renew": {
      const result = await fulfillRenew(order, opts?.actorUserId);
      subscription = result.subscription;
      provisioning = result.provisioning;
      break;
    }
    case "recharge_credits": {
      const result = await fulfillRechargeCredits(order);
      subscription = result.subscription;
      provisioning = result.provisioning;
      break;
    }
    default:
      throw new Error("未知订单类型尚未开放");
  }

  await transitionCommercialOrderStatus(order.enterpriseId, order.id, "paid", {
    subscriptionId: subscription?.id,
    fulfilledAt: new Date().toISOString(),
    fulfillmentStatus: "done",
    ...(subscription?.commercialContract
      ? {
          contractStart: subscription.commercialContract.contractStart,
          contractEnd: subscription.commercialContract.contractEnd,
        }
      : {}),
  });
  const fulfilled = await markOrderFulfilled(order.enterpriseId, order.id, subscription?.id);
  await syncTenantBillingProjection(order.enterpriseId);
  return {
    order: fulfilled ?? order,
    subscription,
    provisioning,
    deduped: false,
  };
}
