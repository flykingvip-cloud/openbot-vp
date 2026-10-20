/**
 * 企业订阅 handler（WRITE / READ）。企业端只读消费平台定价（R3 / R4 / R17）。
 *
 * 方法：
 * - subscriptions.subscribe / subscriptions.get / subscriptions.change-plan / subscriptions.history
 */

import { billingEventBus } from "../billing/event-bus.js";
import {
  getCurrentPlanVersion,
  getPlan,
  getPlanVersion,
  listPlans,
} from "../billing/plans-store.js";
import { resolveTenantCreditsStatus } from "../billing/record-credit-usage.js";
import { provisionEnterpriseSubscription } from "../billing/subscription-provisioning.js";
import {
  createSubscription,
  getActiveSubscription,
  listSubscriptionEvents,
  setPendingChange,
  transitionSubscriptionStatus,
} from "../billing/subscriptions-store.js";
import type { Plan } from "../billing/types.js";
import { getBillingProfile, isBillingProfileComplete } from "../commerce/billing-profile-store.js";
import { isCommerceLegacyBypassEnabled } from "../commerce/commerce-config.js";
import { listCommercialOrders } from "../commerce/commercial-orders-store.js";
import {
  createChangePlanCommercialOrder,
  createSubscribeCommercialOrder,
} from "../commerce/create-order-service.js";
import { previewPlanAllocation } from "../model-entitlement/plan-allocation-preview.js";
import { getPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { resolveEnterpriseBillingMode } from "../package-entitlement/resolve-billing-mode.js";
import {
  resolvePlanEntitlementsForPlans,
  resolvePlanVersionEntitlement,
} from "../package-entitlement/resolve-plan-version-entitlement.js";
import type { EntitlementSnapshot } from "../package-entitlement/types.js";
import { buildPricingCatalogViewModel } from "../platform/pricing/pricing-view-model.js";
import {
  requireEnterpriseScope,
  respondInvalid,
  respondUnavailable,
  stringValue,
} from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

function planMarketingRank(plan: Plan): number {
  if (plan.marketingTags?.includes("default")) {
    return 0;
  }
  if (plan.marketingTags?.includes("recommended")) {
    return 1;
  }
  return 2;
}

function sortAvailablePlans(plans: Plan[]): Plan[] {
  return plans
    .filter((plan) => plan.status === "active")
    .toSorted((left, right) => {
      const rank = planMarketingRank(left) - planMarketingRank(right);
      if (rank !== 0) {
        return rank;
      }
      if (left.basePriceCents !== right.basePriceCents) {
        return left.basePriceCents - right.basePriceCents;
      }
      return left.name.localeCompare(right.name, "zh-CN");
    });
}

export const subscriptionsHandlers: GatewayRequestHandlers = {
  "subscriptions.subscribe": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const planVersionId = stringValue(params.planVersionId);
      const planId = stringValue(params.planId);
      if (!planVersionId && !planId) {
        respondInvalid(respond, "planVersionId（标准路径）或 planId（UI 路径）必填其一");
        return;
      }

      if (!isCommerceLegacyBypassEnabled()) {
        const commerce = await createSubscribeCommercialOrder({
          enterpriseId: scope.enterpriseId,
          ...(planVersionId ? { planVersionId } : {}),
          ...(planId ? { planId } : {}),
          ...(client?.user ? { actorUserId: client.user } : {}),
        });
        respond(true, {
          commerce: true,
          order: commerce.order,
          payment: commerce.payment,
          bankTransfer: commerce.bankTransfer,
          autoPaid: commerce.autoPaid,
          subscription: commerce.fulfillment?.subscription ?? null,
          provisioning: commerce.fulfillment?.provisioning ?? null,
        });
        return;
      }

      const existing = await getActiveSubscription(scope.enterpriseId);
      if (existing) {
        respondInvalid(respond, "已存在生效订阅，请先变更或取消现有订阅。");
        return;
      }

      let lockedPlanId: string;
      let lockedVersionId: string;
      let resolvedFromPlanId = false;

      if (planVersionId) {
        // 标准路径：显式版本，校验 status=active（draft/deprecated 拒绝，R26.2）。
        const version = await getPlanVersion(planVersionId);
        if (!version) {
          respondInvalid(respond, `套餐版本不存在：${planVersionId}`);
          return;
        }
        if (version.status !== "active") {
          respondInvalid(respond, `套餐版本不可订阅（状态为 ${version.status}，需 active）`);
          return;
        }
        lockedPlanId = version.planId;
        lockedVersionId = version.id;
      } else {
        // UI 路径：仅给 planId，解析当前 active 版本并标记 resolvedFromPlanId（R26.3）。
        const plan = await getPlan(planId!);
        if (!plan || plan.status !== "active") {
          respondInvalid(respond, `套餐不存在或不可用：${planId}`);
          return;
        }
        const active = await getCurrentPlanVersion(planId!);
        if (!active || active.status !== "active") {
          respondInvalid(respond, "该套餐当前没有可订阅的生效版本。");
          return;
        }
        lockedPlanId = plan.id;
        lockedVersionId = active.id;
        resolvedFromPlanId = true;
      }

      const subscription = await createSubscription({
        enterpriseId: scope.enterpriseId,
        planId: lockedPlanId,
        planVersionId: lockedVersionId,
        resolvedFromPlanId,
      });
      const provisioning = await provisionEnterpriseSubscription({
        enterpriseId: scope.enterpriseId,
        planVersionId: lockedVersionId,
        ...(client?.user ? { actorUserId: client.user } : {}),
      });
      await billingEventBus.publish({
        type: "subscription.changed",
        enterpriseId: scope.enterpriseId,
        subscriptionId: subscription.id,
        toStatus: "active",
        planVersionId: subscription.planVersionId,
        occurredAt: subscription.createdAt,
      });
      respond(true, { subscription, provisioning });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "subscriptions.get": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const subscription = await getActiveSubscription(scope.enterpriseId);
      const plans = await listPlans();
      // 订阅锁定版本的只读视图（R26：展示绑定的 planVersion + pricingSnapshot）。
      let planView = null;
      let planVersion = null;
      let currentPlanVersion = null;
      let pricingSnapshot: unknown[] = [];
      let entitlementSnapshot = null;
      let creditsStatus = null;
      let billingMode = null;
      if (subscription) {
        planView = await getPlan(subscription.planId);
        planVersion = await getPlanVersion(subscription.planVersionId);
        currentPlanVersion = planView ? await getPlanVersion(planView.currentVersionId) : null;
        pricingSnapshot = planVersion?.snapshot.pricing ?? [];
        entitlementSnapshot = await getPlanEntitlementSnapshot(subscription.planVersionId);
        creditsStatus = await resolveTenantCreditsStatus(scope.enterpriseId);
        billingMode = await resolveEnterpriseBillingMode(scope.enterpriseId);
      }
      // 可选套餐列表（只读下发，R17.1）；默认/推荐标签优先排序。
      const availablePlans = sortAvailablePlans(plans);
      const planEntitlements = await resolvePlanEntitlementsForPlans(availablePlans);
      const activePlans = availablePlans.filter((plan) => plan.status === "active");
      const entitlementByPlanVersionId = new Map<string, EntitlementSnapshot | undefined>();
      for (const plan of activePlans) {
        entitlementByPlanVersionId.set(
          plan.currentVersionId,
          planEntitlements[plan.id] ?? undefined,
        );
      }
      // 套餐预览 catalog 失败不得拖垮整个 subscriptions.get（企业端会表现为「无法加载套餐」）
      let pricingCatalog: ReturnType<typeof buildPricingCatalogViewModel> | null = null;
      try {
        pricingCatalog = buildPricingCatalogViewModel({
          plans: activePlans,
          entitlementByPlanVersionId,
          currentPlanId: subscription?.planId,
        });
      } catch (catalogErr) {
        console.warn(
          "[subscriptions.get] pricing catalog build failed:",
          catalogErr instanceof Error ? catalogErr.message : catalogErr,
        );
        pricingCatalog = {
          plans: [],
          compareRows: [],
          faq: [],
          billingHint: "",
        };
      }
      const pendingOrders = await listCommercialOrders(scope.enterpriseId, {
        status: "pending_payment",
        limit: 5,
      });
      const billingProfile = await getBillingProfile(scope.enterpriseId);
      respond(true, {
        subscription,
        planView,
        planVersion,
        currentPlanVersion,
        pricingSnapshot,
        // 兼容旧字段名
        pricingView: pricingSnapshot,
        entitlementSnapshot,
        planEntitlements,
        creditsStatus,
        billingMode,
        availablePlans,
        pricingCatalog,
        pendingOrders,
        billingProfile,
        billingProfileComplete: isBillingProfileComplete(billingProfile),
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "subscriptions.preview-plan-allocation": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      let planVersionId = stringValue(params.planVersionId);
      const planId = stringValue(params.planId);
      if (!planVersionId && planId) {
        const plan = await getPlan(planId);
        if (!plan || plan.status !== "active") {
          respondInvalid(respond, `套餐不存在或不可用：${planId}`);
          return;
        }
        planVersionId = plan.currentVersionId;
      }
      if (!planVersionId) {
        respondInvalid(respond, "planVersionId 或 planId 必填其一");
        return;
      }
      const preview = await previewPlanAllocation(planVersionId);
      if (!preview) {
        respondInvalid(respond, `无法预览套餐版本：${planVersionId}`);
        return;
      }
      const entitlement = await resolvePlanVersionEntitlement(planVersionId);
      respond(true, { preview, entitlement });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "subscriptions.change-plan": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const targetPlanId = stringValue(params.targetPlanId);
      const effective = stringValue(params.effective) ?? "now";
      if (!targetPlanId) {
        respondInvalid(respond, "targetPlanId 是必填项");
        return;
      }
      if (effective !== "now" && effective !== "next") {
        respondInvalid(respond, "effective 必须是 'now' 或 'next'");
        return;
      }
      const targetPlan = await getPlan(targetPlanId);
      if (!targetPlan || targetPlan.status !== "active") {
        respondInvalid(respond, `目标套餐不存在或不可用：${targetPlanId}`);
        return;
      }
      const current = await getActiveSubscription(scope.enterpriseId);
      if (!current) {
        respondInvalid(respond, "当前没有生效订阅，请先订阅。");
        return;
      }
      if (effective === "next") {
        // 记录待生效变更，下一周期应用（R17.4）。
        const updated = await setPendingChange(scope.enterpriseId, current.id, {
          targetPlanId,
          targetPlanVersionId: targetPlan.currentVersionId,
          effectiveAt: "next-cycle",
        });
        respond(true, { subscription: updated, mode: "next" });
        return;
      }
      if (!isCommerceLegacyBypassEnabled()) {
        const commerce = await createChangePlanCommercialOrder({
          enterpriseId: scope.enterpriseId,
          targetPlanId,
          ...(client?.user ? { actorUserId: client.user } : {}),
        });
        respond(true, {
          commerce: true,
          mode: "now",
          order: commerce.order,
          payment: commerce.payment,
          bankTransfer: commerce.bankTransfer,
          autoPaid: commerce.autoPaid,
          subscription: commerce.fulfillment?.subscription ?? null,
          provisioning: commerce.fulfillment?.provisioning ?? null,
        });
        return;
      }
      // 立即生效：结束当前订阅区间，创建新订阅区间（追加，R17.3）。
      await transitionSubscriptionStatus(scope.enterpriseId, current.id, "canceled");
      const next = await createSubscription({
        enterpriseId: scope.enterpriseId,
        planId: targetPlanId,
        planVersionId: targetPlan.currentVersionId,
      });
      const provisioning = await provisionEnterpriseSubscription({
        enterpriseId: scope.enterpriseId,
        planVersionId: targetPlan.currentVersionId,
        ...(client?.user ? { actorUserId: client.user } : {}),
      });
      await billingEventBus.publish({
        type: "subscription.changed",
        enterpriseId: scope.enterpriseId,
        subscriptionId: next.id,
        toStatus: "active",
        planVersionId: next.planVersionId,
        occurredAt: next.createdAt,
      });
      respond(true, { subscription: next, mode: "now", provisioning });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "subscriptions.history": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const events = await listSubscriptionEvents(scope.enterpriseId);
      respond(true, { events });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
