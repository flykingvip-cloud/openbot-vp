/**
 * 试用租户开通编排：订阅 Trial 套餐 → provision → 按租户试用席位数授权。
 *
 * 调用方必须在 platform-auth store 落盘之后再调，否则读不到新租户。
 */

import { createSubscribeCommercialOrder } from "../commerce/create-order-service.js";
import { isTrialPlan } from "../commerce/plan-commercial-policy.js";
import { ensureDefaultSeatModelGrant } from "../model-entitlement/ensure-default-seat-model-grant.js";
import { loadSeatAssetsStoreForTenantId } from "../platform-auth/seat-store-loader.js";
import { getCurrentPlanVersion, listPlans } from "./plans-store.js";
import { upsertSeatEntitlementAssignment } from "./seat-entitlement-assignments-store.js";
import { listSeats } from "./seats-store.js";
import { provisionEnterpriseSubscription } from "./subscription-provisioning.js";
import { getActiveSubscription } from "./subscriptions-store.js";
import { resolveTrialSeatCapacity } from "./trial-seat-capacity.js";

const TRIAL_SEAT_PROFILE = "basic_ai" as const;

export type EnsureTrialCommercialAccessResult = {
  skipped?: boolean;
  reason?: string;
  subscriptionId?: string;
  seatCapacity?: number;
  orgGrantsApplied?: number;
};

async function findActiveTrialPlanId(): Promise<string | null> {
  const plans = await listPlans();
  for (const plan of plans) {
    if (plan.status !== "active") {
      continue;
    }
    const version = await getCurrentPlanVersion(plan.id);
    if (version && isTrialPlan(plan, version)) {
      return plan.id;
    }
  }
  return null;
}

async function alignTrialSeatGrants(enterpriseId: string): Promise<number> {
  const billingSeats = await listSeats(enterpriseId, undefined, { status: "active" });
  for (const seat of billingSeats) {
    await upsertSeatEntitlementAssignment({
      enterpriseId,
      seatId: seat.id,
      profileId: TRIAL_SEAT_PROFILE,
    });
  }

  const orgStore = await loadSeatAssetsStoreForTenantId(enterpriseId);
  let applied = 0;
  for (const seat of Object.values(orgStore.seats)) {
    if (!seat.currentEmployeeId?.trim()) {
      continue;
    }
    const result = await ensureDefaultSeatModelGrant({
      tenantId: enterpriseId,
      seatId: seat.seatId,
    });
    if (result.applied || result.grant) {
      applied += 1;
    }
  }
  return applied;
}

/**
 * 保证试用租户具备生效订阅、模型权益，并按 seatQuota 授权已占岗员工。
 */
export async function ensureTrialCommercialAccess(
  enterpriseId: string,
): Promise<EnsureTrialCommercialAccessResult> {
  const trimmed = enterpriseId.trim();
  if (!trimmed) {
    return { skipped: true, reason: "missing-enterprise" };
  }
  const seatCapacity = await resolveTrialSeatCapacity(trimmed);
  if (seatCapacity == null) {
    return { skipped: true, reason: "not-trial" };
  }

  let subscription = await getActiveSubscription(trimmed);
  if (!subscription) {
    const planId = await findActiveTrialPlanId();
    if (!planId) {
      return { skipped: true, reason: "no-active-trial-plan", seatCapacity };
    }
    try {
      const commerce = await createSubscribeCommercialOrder({
        enterpriseId: trimmed,
        planId,
        actorUserId: "system:trial-provision",
      });
      subscription = commerce.fulfillment?.subscription ?? (await getActiveSubscription(trimmed));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("已存在生效订阅")) {
        throw err;
      }
      subscription = await getActiveSubscription(trimmed);
    }
  }

  if (!subscription) {
    return { skipped: true, reason: "subscribe-failed", seatCapacity };
  }

  await provisionEnterpriseSubscription({
    enterpriseId: trimmed,
    planVersionId: subscription.planVersionId,
    subscription,
    actorUserId: "system:trial-provision",
    syncSeatGrants: true,
  });
  const orgGrantsApplied = await alignTrialSeatGrants(trimmed);
  return {
    subscriptionId: subscription.id,
    seatCapacity,
    orgGrantsApplied,
  };
}

export function scheduleTrialCommercialAccess(enterpriseId: string): void {
  void ensureTrialCommercialAccess(enterpriseId).catch((err) => {
    console.warn(
      `[trial-commercial-access] failed for ${enterpriseId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
}
