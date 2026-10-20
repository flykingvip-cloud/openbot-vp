/**
 * Subscription Transition Engine（P0 最小物化链路）。
 *
 * subscribe / change-plan / renew 等订阅事实切换时，物化 SubscriptionRuntimeSnapshot。
 */

import { getPlanVersionModelBinding } from "../model-entitlement/plan-version-model-binding-store.js";
import { resolveBillingModeFromMonthlyCredits } from "../package-entitlement/billing-mode.js";
import {
  DEFAULT_OVERAGE_POLICY,
  defaultMaxConcurrentRuns,
  normalizeEntitlementSnapshot,
} from "../package-entitlement/normalize-entitlement.js";
import { getPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { normalizeBillingCycle } from "./billing-cycle-pricing.js";
import { getPlan, getPlanVersion } from "./plans-store.js";
import {
  appendSubscriptionRuntimeSnapshot,
  type RuntimeEntitlementSnapshot,
  type RuntimeModelBindingSnapshot,
  type SubscriptionRuntimeSnapshot,
} from "./subscription-runtime-snapshots-store.js";
import { overlayTrialMaxSeats, resolveTrialSeatCapacity } from "./trial-seat-capacity.js";
import type { BillingCycle, Subscription } from "./types.js";

export type MaterializeRuntimeSnapshotInput = {
  enterpriseId: string;
  subscription: Pick<Subscription, "id" | "planId" | "planVersionId" | "commercialContract">;
  effectiveAt?: string;
  /** 显式覆盖；默认取 commercialContract.contractEnd */
  expiresAt?: string;
  /** 测试注入 store 路径 */
  storePaths?: {
    plans?: string;
    entitlementSnapshot?: string;
    modelBinding?: string;
    runtimeSnapshots?: string;
  };
};

function buildRuntimeEntitlement(
  stored: Awaited<ReturnType<typeof getPlanEntitlementSnapshot>>,
  planVersion: Awaited<ReturnType<typeof getPlanVersion>>,
): RuntimeEntitlementSnapshot {
  const base = stored
    ? stored
    : normalizeEntitlementSnapshot({
        planVersionId: planVersion?.id ?? "",
        monthlyPriceCents: planVersion?.snapshot.basePriceCents ?? 0,
        monthlyCredits: 0,
        maxSeats: planVersion?.snapshot.seatQuota ?? {},
        maxBots: planVersion?.snapshot.botQuota ?? 0,
        maxConcurrentRuns: defaultMaxConcurrentRuns(planVersion?.snapshot.botQuota ?? 0),
        allowedPolicies: [],
        allowedTiers: [],
        overagePolicy: DEFAULT_OVERAGE_POLICY,
        updatedAt: new Date().toISOString(),
      });

  const maxConcurrentRuns = base.maxConcurrentRuns;
  return {
    maxSeats: base.maxSeats,
    maxBots: base.maxBots,
    maxConcurrentRuns,
    concurrencyPolicy: {
      includedRuns: maxConcurrentRuns,
      maxBurstRuns: maxConcurrentRuns,
      mode: "block",
    },
    monthlyCredits: base.monthlyCredits,
    allowedTiers: base.allowedTiers,
    allowedPolicies: base.allowedPolicies,
    ...(base.allowCustomPolicy !== undefined ? { allowCustomPolicy: base.allowCustomPolicy } : {}),
    ...(base.allowPrivateModels !== undefined
      ? { allowPrivateModels: base.allowPrivateModels }
      : {}),
    overagePolicy: base.overagePolicy,
    ...(base.maxWorkflows !== undefined ? { maxWorkflows: base.maxWorkflows } : {}),
    ...(base.maxKnowledgeBases !== undefined ? { maxKnowledgeBases: base.maxKnowledgeBases } : {}),
    ...(base.features !== undefined ? { features: base.features } : {}),
  };
}

function buildModelBindingSnapshot(
  binding: Awaited<ReturnType<typeof getPlanVersionModelBinding>>,
  entitlement: RuntimeEntitlementSnapshot,
): RuntimeModelBindingSnapshot {
  return {
    allowedModelIds: binding?.allowedModelIds ?? [],
    allowedTiers: binding?.allowedTiers ?? entitlement.allowedTiers,
    allowedPolicies: binding?.allowedPolicies ?? entitlement.allowedPolicies,
    ...(binding?.policyId ? { policyId: binding.policyId } : {}),
  };
}

/** commercialContract 优先；否则回退到订阅锁定的 plan.billingCycle（legacy bypass 等无合同路径）。 */
async function resolveSnapshotBillingCycle(
  input: MaterializeRuntimeSnapshotInput,
): Promise<BillingCycle> {
  const fromContract = normalizeBillingCycle(input.subscription.commercialContract?.billingCycle);
  if (fromContract) {
    return fromContract;
  }
  const plan = await getPlan(input.subscription.planId, input.storePaths?.plans);
  return normalizeBillingCycle(plan?.billingCycle) ?? "monthly";
}

/**
 * 从订阅锁定的 planVersion 物化新的 SubscriptionRuntimeSnapshot。
 */
export async function materializeSubscriptionRuntimeSnapshot(
  input: MaterializeRuntimeSnapshotInput,
): Promise<SubscriptionRuntimeSnapshot> {
  const planVersionId = input.subscription.planVersionId;
  const planVersion = await getPlanVersion(planVersionId, input.storePaths?.plans);
  if (!planVersion) {
    throw new Error(`planVersion not found: ${planVersionId}`);
  }

  const storedEntitlement = await getPlanEntitlementSnapshot(
    planVersionId,
    input.storePaths?.entitlementSnapshot,
  );
  const entitlementSnapshot = overlayTrialMaxSeats(
    buildRuntimeEntitlement(storedEntitlement, planVersion),
    await resolveTrialSeatCapacity(input.enterpriseId),
  );

  const binding = await getPlanVersionModelBinding(planVersionId, input.storePaths?.modelBinding);
  const modelBindingSnapshot = buildModelBindingSnapshot(binding, entitlementSnapshot);

  const billingCycle = await resolveSnapshotBillingCycle(input);
  const contract = input.subscription.commercialContract;
  // expiresAt 必须对齐 commercialContract.contractEnd，禁止运行时快照无限延伸 Credits/账期
  const effectiveAt = input.effectiveAt ?? contract?.contractStart ?? new Date().toISOString();
  const expiresAt = input.expiresAt ?? contract?.contractEnd;

  return appendSubscriptionRuntimeSnapshot(
    {
      enterpriseId: input.enterpriseId,
      subscriptionId: input.subscription.id,
      planId: input.subscription.planId,
      planVersionId,
      pricingSnapshot: {
        billingCycle,
        basePriceCents: planVersion.snapshot.basePriceCents,
      },
      entitlementSnapshot,
      modelBindingSnapshot,
      billingMode: resolveBillingModeFromMonthlyCredits(entitlementSnapshot.monthlyCredits),
      effectiveAt,
      ...(expiresAt ? { expiresAt } : {}),
    },
    input.storePaths?.runtimeSnapshots,
  );
}
