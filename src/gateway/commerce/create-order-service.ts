/**
 * 商业订单创建编排（PlanVersion 锁价 + 合同周期 + 履约状态）。
 */

import { normalizeBillingCycle } from "../billing/billing-cycle-pricing.js";
import { getCurrentPlanVersion, getPlan, getPlanVersion } from "../billing/plans-store.js";
import {
  createSubscription,
  getActiveSubscription,
  getPendingPaymentSubscription,
} from "../billing/subscriptions-store.js";
import type { BillingCycle, Plan, PlanVersion } from "../billing/types.js";
import { BANK_TRANSFER_INSTRUCTIONS } from "./commerce-config.js";
import { buildCommercialContract } from "./commercial-contract.js";
import {
  createCommercialOrder,
  getCommercialOrderById,
  listCommercialOrders,
  transitionCommercialOrderStatus,
} from "./commercial-orders-store.js";
import { getCreditPack } from "./credit-packs-store.js";
import { fulfillCommercialOrder } from "./order-fulfillment.js";
import { quoteChangePlanOrder, quoteRenewOrder, quoteSubscribeOrder } from "./order-pricing.js";
import {
  createPayment,
  getPayment,
  getPaymentForEnterprise,
  listPaymentsForOrder,
  transitionPaymentStatus,
} from "./payments-store.js";
import { isContactSalesPlan, isTrialPlan } from "./plan-commercial-policy.js";
import { versionPricingSource } from "./pricing-version-source.js";
import { syncTenantBillingProjection } from "./tenant-billing-projection.js";
import type { CommercialOrderKind } from "./types.js";
import type { CommercialPaymentMethod } from "./types.js";

export type CreateSubscribeOrderInput = {
  enterpriseId: string;
  planId?: string;
  planVersionId?: string;
  billingCycle?: BillingCycle;
  actorUserId?: string;
  salesLeadId?: string;
  /** 平台议价覆盖（from-lead）；仍锁定 planVersionId。 */
  amountCentsOverride?: number;
  paymentMethod?: CommercialPaymentMethod;
  /** 平台 from-lead 路径：允许 contact_sales 套餐生成订单。 */
  platformFromLead?: boolean;
};

export type CreateChangePlanOrderInput = {
  enterpriseId: string;
  targetPlanId: string;
  billingCycle?: BillingCycle;
  actorUserId?: string;
};

export type CreateRenewOrderInput = {
  enterpriseId: string;
  actorUserId?: string;
};

export type CreateRechargeCreditsOrderInput = {
  enterpriseId: string;
  creditPackId: string;
  actorUserId?: string;
};

async function assertNoPendingPaymentOrders(enterpriseId: string): Promise<void> {
  const pending = await listCommercialOrders(enterpriseId, {
    status: "pending_payment",
    limit: 1,
  });
  if (pending.length > 0) {
    throw new Error("已有待支付订单，请先完成支付或取消。");
  }
}

async function assertActiveSubscription(enterpriseId: string) {
  const current = await getActiveSubscription(enterpriseId);
  if (!current) {
    throw new Error("当前没有生效订阅，无法续费或购买容量包。");
  }
  return current;
}

async function resolveSubscribePlan(input: CreateSubscribeOrderInput): Promise<{
  plan: Plan;
  version: PlanVersion;
  planVersionId: string;
  resolvedFromPlanId: boolean;
}> {
  if (input.planVersionId) {
    const version = await getPlanVersion(input.planVersionId);
    if (!version || version.status !== "active") {
      throw new Error(`套餐版本不可订阅：${input.planVersionId}`);
    }
    const plan = await getPlan(version.planId);
    if (!plan || plan.status !== "active") {
      throw new Error(`套餐不可用：${version.planId}`);
    }
    return { plan, version, planVersionId: version.id, resolvedFromPlanId: false };
  }
  if (!input.planId) {
    throw new Error("planId 或 planVersionId 必填");
  }
  const plan = await getPlan(input.planId);
  if (!plan || plan.status !== "active") {
    throw new Error(`套餐不存在或不可用：${input.planId}`);
  }
  const version = await getCurrentPlanVersion(input.planId);
  if (!version || version.status !== "active") {
    throw new Error("该套餐当前没有可订阅的生效版本");
  }
  return { plan, version, planVersionId: version.id, resolvedFromPlanId: true };
}

async function assertNoBlockingSubscription(enterpriseId: string): Promise<void> {
  const active = await getActiveSubscription(enterpriseId);
  if (active) {
    throw new Error("已存在生效订阅，请先变更或取消现有订阅。");
  }
  const pending = await getPendingPaymentSubscription(enterpriseId);
  if (pending) {
    throw new Error("已有待支付订阅订单，请先完成支付或取消。");
  }
}

async function autoFulfillZeroOrder(
  orderId: string,
  actorUserId?: string,
): Promise<Awaited<ReturnType<typeof fulfillCommercialOrder>>> {
  const order = await getCommercialOrderById(orderId);
  if (!order) {
    throw new Error(`订单不存在：${orderId}`);
  }
  await transitionCommercialOrderStatus(order.enterpriseId, order.id, "paid", {
    paidAt: new Date().toISOString(),
    fulfillmentStatus: "pending",
  });
  const payment = await createPayment({
    orderId: order.id,
    enterpriseId: order.enterpriseId,
    provider: "manual",
    amountCents: 0,
    requestId: `auto-zero:${order.id}`,
  });
  await transitionPaymentStatus(payment.id, "paid", { paidAt: new Date().toISOString() });
  return fulfillCommercialOrder(order.id, { actorUserId });
}

export async function createSubscribeCommercialOrder(input: CreateSubscribeOrderInput) {
  await assertNoBlockingSubscription(input.enterpriseId);
  const resolved = await resolveSubscribePlan(input);
  if (!input.platformFromLead && isContactSalesPlan(resolved.plan, resolved.version)) {
    throw new Error("企业版请通过「联系销售」开通，不支持自助下单。");
  }

  const billingCycle = input.billingCycle ?? resolved.plan.billingCycle ?? "monthly";
  const source = versionPricingSource(resolved.plan, resolved.version, billingCycle);
  const quote = quoteSubscribeOrder({ source });
  const amountCents = input.amountCentsOverride ?? quote.amountCents;
  const lineItems =
    input.amountCentsOverride !== undefined
      ? [
          {
            label: `${resolved.plan.name} · 议价 · v:${resolved.planVersionId}`,
            amountCents,
          },
        ]
      : quote.lineItems;
  const trial = isTrialPlan(resolved.plan, resolved.version);

  const pendingSubscription = await createSubscription({
    enterpriseId: input.enterpriseId,
    planId: resolved.plan.id,
    planVersionId: resolved.planVersionId,
    resolvedFromPlanId: resolved.resolvedFromPlanId,
    initialStatus: trial ? "active" : "pending_payment",
  });

  const contract = buildCommercialContract(new Date(), billingCycle);
  const order = await createCommercialOrder({
    enterpriseId: input.enterpriseId,
    kind: "subscribe",
    amountCents,
    lineItems,
    billingCycle,
    planId: resolved.plan.id,
    planVersionId: resolved.planVersionId,
    pendingSubscriptionId: pendingSubscription.id,
    paymentMethod: input.paymentMethod ?? (amountCents > 0 ? "bank_transfer" : "manual"),
    initialStatus: amountCents > 0 ? "pending_payment" : "paid",
    quotedPlanVersionIds: quote.planVersionIds,
    ...(input.salesLeadId ? { salesLeadId: input.salesLeadId } : {}),
  });

  if (amountCents <= 0 || trial) {
    const fulfillment = await autoFulfillZeroOrder(order.id, input.actorUserId);
    return {
      order: fulfillment.order,
      payment: null,
      bankTransfer: null,
      fulfillment,
      autoPaid: true,
    };
  }

  const payment = await createPayment({
    orderId: order.id,
    enterpriseId: input.enterpriseId,
    provider: "manual",
    amountCents: order.amountCents,
  });

  await syncTenantBillingProjection(input.enterpriseId);

  return {
    order,
    payment,
    bankTransfer: BANK_TRANSFER_INSTRUCTIONS,
    fulfillment: null,
    autoPaid: false,
    contractPreview: contract,
  };
}

export async function createChangePlanCommercialOrder(input: CreateChangePlanOrderInput) {
  const current = await getActiveSubscription(input.enterpriseId);
  if (!current) {
    throw new Error("当前没有生效订阅，请先订阅。");
  }
  const currentPlan = await getPlan(current.planId);
  const currentVersion = await getPlanVersion(current.planVersionId);
  const targetPlan = await getPlan(input.targetPlanId);
  if (!currentPlan || !currentVersion || !targetPlan || targetPlan.status !== "active") {
    throw new Error(`目标套餐不存在或不可用：${input.targetPlanId}`);
  }
  const targetVersion = await getCurrentPlanVersion(input.targetPlanId);
  if (!targetVersion || targetVersion.status !== "active") {
    throw new Error("目标套餐当前没有可订阅的生效版本");
  }
  if (isContactSalesPlan(targetPlan, targetVersion)) {
    throw new Error("升级至企业版请通过「联系销售」。");
  }

  const billingCycle =
    normalizeBillingCycle(
      input.billingCycle ?? current.commercialContract?.billingCycle ?? currentPlan.billingCycle,
    ) ?? "monthly";
  const quote = quoteChangePlanOrder({
    current: versionPricingSource(currentPlan, currentVersion, billingCycle),
    target: versionPricingSource(targetPlan, targetVersion, billingCycle),
    subscription: current,
  });

  const order = await createCommercialOrder({
    enterpriseId: input.enterpriseId,
    kind: "change_plan",
    amountCents: quote.amountCents,
    lineItems: quote.lineItems,
    billingCycle,
    planId: current.planId,
    planVersionId: current.planVersionId,
    fromPlanId: current.planId,
    targetPlanId: targetPlan.id,
    targetPlanVersionId: targetVersion.id,
    subscriptionId: current.id,
    paymentMethod: quote.amountCents > 0 ? "bank_transfer" : "manual",
    initialStatus: quote.amountCents > 0 ? "pending_payment" : "paid",
    quotedPlanVersionIds: quote.planVersionIds,
  });

  if (quote.amountCents <= 0) {
    const fulfillment = await autoFulfillZeroOrder(order.id, input.actorUserId);
    return {
      order: fulfillment.order,
      payment: null,
      bankTransfer: null,
      fulfillment,
      autoPaid: true,
    };
  }

  const payment = await createPayment({
    orderId: order.id,
    enterpriseId: input.enterpriseId,
    provider: "manual",
    amountCents: order.amountCents,
  });
  await syncTenantBillingProjection(input.enterpriseId);
  return {
    order,
    payment,
    bankTransfer: BANK_TRANSFER_INSTRUCTIONS,
    fulfillment: null,
    autoPaid: false,
    prorationUsesCommercialContract: quote.prorationUsesCommercialContract,
  };
}

export async function createRenewCommercialOrder(input: CreateRenewOrderInput) {
  await assertNoPendingPaymentOrders(input.enterpriseId);
  const current = await assertActiveSubscription(input.enterpriseId);
  const currentPlan = await getPlan(current.planId);
  const currentVersion = await getPlanVersion(current.planVersionId);
  if (!currentPlan || !currentVersion) {
    throw new Error("当前订阅套餐信息不完整");
  }

  const billingCycle =
    normalizeBillingCycle(current.commercialContract?.billingCycle ?? currentPlan.billingCycle) ??
    "monthly";
  const source = versionPricingSource(currentPlan, currentVersion, billingCycle);
  const quote = quoteRenewOrder(source);

  const order = await createCommercialOrder({
    enterpriseId: input.enterpriseId,
    kind: "renew",
    amountCents: quote.amountCents,
    lineItems: quote.lineItems,
    billingCycle,
    planId: current.planId,
    planVersionId: current.planVersionId,
    subscriptionId: current.id,
    paymentMethod: quote.amountCents > 0 ? "bank_transfer" : "manual",
    initialStatus: quote.amountCents > 0 ? "pending_payment" : "paid",
    quotedPlanVersionIds: quote.planVersionIds,
  });

  if (quote.amountCents <= 0) {
    const fulfillment = await autoFulfillZeroOrder(order.id, input.actorUserId);
    return {
      order: fulfillment.order,
      payment: null,
      bankTransfer: null,
      fulfillment,
      autoPaid: true,
    };
  }

  const payment = await createPayment({
    orderId: order.id,
    enterpriseId: input.enterpriseId,
    provider: "manual",
    amountCents: order.amountCents,
  });
  await syncTenantBillingProjection(input.enterpriseId);
  return {
    order,
    payment,
    bankTransfer: BANK_TRANSFER_INSTRUCTIONS,
    fulfillment: null,
    autoPaid: false,
  };
}

export async function createRechargeCreditsCommercialOrder(input: CreateRechargeCreditsOrderInput) {
  await assertNoPendingPaymentOrders(input.enterpriseId);
  await assertActiveSubscription(input.enterpriseId);
  const pack = await getCreditPack(input.creditPackId);
  if (!pack || pack.status !== "active") {
    throw new Error(`容量包不存在或不可用：${input.creditPackId}`);
  }

  const order = await createCommercialOrder({
    enterpriseId: input.enterpriseId,
    kind: "recharge_credits",
    amountCents: pack.priceCents,
    lineItems: [{ label: `${pack.name} · 额外容量`, amountCents: pack.priceCents }],
    creditPackId: pack.id,
    paymentMethod: pack.priceCents > 0 ? "bank_transfer" : "manual",
    initialStatus: pack.priceCents > 0 ? "pending_payment" : "paid",
  });

  if (pack.priceCents <= 0) {
    const fulfillment = await autoFulfillZeroOrder(order.id, input.actorUserId);
    return {
      order: fulfillment.order,
      payment: null,
      bankTransfer: null,
      fulfillment,
      autoPaid: true,
    };
  }

  const payment = await createPayment({
    orderId: order.id,
    enterpriseId: input.enterpriseId,
    provider: "manual",
    amountCents: order.amountCents,
  });
  await syncTenantBillingProjection(input.enterpriseId);
  return {
    order,
    payment,
    bankTransfer: BANK_TRANSFER_INSTRUCTIONS,
    fulfillment: null,
    autoPaid: false,
    pack,
  };
}

export async function createCommercialOrderByKind(
  kind: CommercialOrderKind,
  input: CreateSubscribeOrderInput | CreateChangePlanOrderInput,
) {
  if (kind === "subscribe") {
    return createSubscribeCommercialOrder(input as CreateSubscribeOrderInput);
  }
  if (kind === "change_plan") {
    return createChangePlanCommercialOrder(input as CreateChangePlanOrderInput);
  }
  if (kind === "renew") {
    return createRenewCommercialOrder(input as CreateRenewOrderInput);
  }
  if (kind === "recharge_credits") {
    return createRechargeCreditsCommercialOrder(input as CreateRechargeCreditsOrderInput);
  }
  throw new Error("该订单类型尚未开放");
}

export async function confirmManualPayment(input: {
  paymentId: string;
  requestId?: string;
  confirmedByUserId?: string;
  /** 平台 ADMIN 核销时可省略；企业路径必须传且匹配。 */
  enterpriseId?: string;
}) {
  const payment = input.enterpriseId
    ? await getPaymentForEnterprise(input.enterpriseId, input.paymentId)
    : await getPayment(input.paymentId);
  if (!payment) {
    throw new Error(`支付记录不存在或无权访问：${input.paymentId}`);
  }
  if (input.requestId && payment.requestId === input.requestId && payment.status === "paid") {
    const order = await getCommercialOrderById(payment.orderId);
    return { payment, order, fulfillment: null, deduped: true };
  }
  if (payment.status === "paid") {
    const order = await getCommercialOrderById(payment.orderId);
    return { payment, order, fulfillment: null, deduped: true };
  }

  const updatedPayment = await transitionPaymentStatus(payment.id, "paid", {
    confirmedByUserId: input.confirmedByUserId,
    ...(input.requestId ? { requestId: input.requestId } : {}),
  });
  if (!updatedPayment) {
    throw new Error("支付状态更新失败");
  }

  const order = await getCommercialOrderById(updatedPayment.orderId);
  if (!order) {
    throw new Error("关联订单不存在");
  }
  await transitionCommercialOrderStatus(order.enterpriseId, order.id, "paid", {
    paidAt: new Date().toISOString(),
    fulfillmentStatus: "pending",
  });

  try {
    const fulfillment = await fulfillCommercialOrder(order.id, {
      actorUserId: input.confirmedByUserId,
    });
    const payments = await listPaymentsForOrder(order.enterpriseId, order.id);
    return {
      payment: updatedPayment,
      order: fulfillment.order,
      fulfillment,
      deduped: false,
      payments,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await transitionCommercialOrderStatus(order.enterpriseId, order.id, "paid", {
      fulfillmentStatus: "failed",
      fulfillmentError: message,
    });
    throw err;
  }
}
