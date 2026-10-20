/**
 * 解析企业当前生效的 Entitlement 限制。
 *
 * P0：优先读取 SubscriptionRuntimeSnapshot（冻结运行时真相）；
 * 无 snapshot 时回退 entitlement snapshot store（迁移期兼容）。
 */

import {
  DEFAULT_OVERAGE_POLICY,
  defaultMaxConcurrentRuns,
  normalizeEntitlementSnapshot,
} from "../package-entitlement/normalize-entitlement.js";
import { getPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import type { EntitlementSnapshot } from "../package-entitlement/types.js";
import { getPlanVersion } from "./plans-store.js";
import { resolveTenantCreditsStatus } from "./record-credit-usage.js";
import { getActiveSubscriptionRuntimeSnapshot } from "./subscription-runtime-snapshots-store.js";
import { getActiveSubscription } from "./subscriptions-store.js";
import { overlayTrialMaxSeats, resolveTrialSeatCapacity } from "./trial-seat-capacity.js";

export type ResolvedEnterpriseEntitlement = EntitlementSnapshot & {
  enterpriseId: string;
  planId: string;
  creditsRemaining: number;
  subscriptionSnapshotId?: string;
};

export async function resolveEnterpriseEntitlement(
  enterpriseId: string,
): Promise<ResolvedEnterpriseEntitlement | null> {
  const subscription = await getActiveSubscription(enterpriseId);
  if (!subscription) {
    return null;
  }

  const runtimeSnapshot = await getActiveSubscriptionRuntimeSnapshot(enterpriseId);
  const creditsStatus = await resolveTenantCreditsStatus(enterpriseId);
  const trialCap = await resolveTrialSeatCapacity(enterpriseId);

  if (runtimeSnapshot) {
    const ent = overlayTrialMaxSeats(runtimeSnapshot.entitlementSnapshot, trialCap);
    return {
      planVersionId: runtimeSnapshot.planVersionId,
      monthlyPriceCents: runtimeSnapshot.pricingSnapshot.basePriceCents,
      monthlyCredits: ent.monthlyCredits,
      maxSeats: ent.maxSeats,
      maxBots: ent.maxBots,
      maxConcurrentRuns: ent.maxConcurrentRuns,
      allowedPolicies: ent.allowedPolicies,
      allowedTiers: ent.allowedTiers,
      ...(ent.allowCustomPolicy !== undefined ? { allowCustomPolicy: ent.allowCustomPolicy } : {}),
      ...(ent.allowPrivateModels !== undefined
        ? { allowPrivateModels: ent.allowPrivateModels }
        : {}),
      overagePolicy: ent.overagePolicy,
      ...(ent.maxWorkflows !== undefined ? { maxWorkflows: ent.maxWorkflows } : {}),
      ...(ent.maxKnowledgeBases !== undefined ? { maxKnowledgeBases: ent.maxKnowledgeBases } : {}),
      ...(ent.features !== undefined ? { features: ent.features } : {}),
      updatedAt: runtimeSnapshot.createdAt,
      enterpriseId,
      planId: subscription.planId,
      creditsRemaining: creditsStatus?.creditsRemaining ?? ent.monthlyCredits,
      subscriptionSnapshotId: runtimeSnapshot.id,
    };
  }

  const version = await getPlanVersion(subscription.planVersionId);
  const stored = await getPlanEntitlementSnapshot(subscription.planVersionId);

  const base = stored
    ? stored
    : normalizeEntitlementSnapshot({
        planVersionId: subscription.planVersionId,
        monthlyPriceCents: version?.snapshot.basePriceCents ?? 0,
        monthlyCredits: 0,
        maxSeats: version?.snapshot.seatQuota ?? {},
        maxBots: version?.snapshot.botQuota ?? 0,
        maxConcurrentRuns: defaultMaxConcurrentRuns(version?.snapshot.botQuota ?? 0),
        allowedPolicies: [],
        allowedTiers: [],
        overagePolicy: DEFAULT_OVERAGE_POLICY,
        updatedAt: new Date().toISOString(),
      });

  return {
    ...overlayTrialMaxSeats(base, trialCap),
    enterpriseId,
    planId: subscription.planId,
    creditsRemaining: creditsStatus?.creditsRemaining ?? base.monthlyCredits,
  };
}
