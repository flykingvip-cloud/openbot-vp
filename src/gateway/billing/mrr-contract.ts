/**
 * Phase 5：合同标准化 MRR（Monthly Recurring Revenue）。
 *
 * 规则：
 * - 单价真源 = 订阅锁定的 PlanVersion.snapshot.basePriceCents（禁止 Plan 头 live basePrice）
 * - 周期真源 = commercialContract.billingCycle（缺省回退 plan.billingCycle → monthly）
 * - MRR = 合同周期报价的 effectiveMonthlyCents（年付/季付按折扣总价摊月）
 */

import {
  computeCyclePrice,
  normalizeBillingCycle,
  type CyclePriceQuote,
} from "./billing-cycle-pricing.js";
import type { BillingCycle, Plan, PlanVersion, Subscription } from "./types.js";

export type MrrResolution = {
  mrrCents: number;
  monthlyBaseCents: number;
  billingCycle: BillingCycle;
  planVersionId: string;
  quote: CyclePriceQuote;
  /** true = 使用了锁定版本快照；false = 无版本时降级（应尽量避免） */
  versionLocked: boolean;
};

/**
 * 解析订阅的合同标准化 MRR（分）。
 * planVersion 优先；缺失时不得用 plan.basePrice 冒充锁定价（返回 0 并 versionLocked=false）。
 */
export function resolveContractNormalizedMrr(input: {
  subscription: Pick<Subscription, "planVersionId" | "commercialContract" | "planId">;
  planVersion?: Pick<PlanVersion, "id" | "planId" | "snapshot"> | null;
  /** 仅用于 cycle 回退与审计，不用作价格真源 */
  plan?: Pick<Plan, "id" | "billingCycle" | "basePriceCents"> | null;
}): MrrResolution {
  const planVersion = input.planVersion;
  const plan = input.plan;

  const cycle =
    normalizeBillingCycle(input.subscription.commercialContract?.billingCycle) ??
    normalizeBillingCycle(plan?.billingCycle) ??
    "monthly";

  // 价格：必须锁定版本快照
  if (
    planVersion &&
    planVersion.id === input.subscription.planVersionId &&
    Number.isFinite(planVersion.snapshot.basePriceCents)
  ) {
    const monthlyBaseCents = Math.max(0, Math.round(planVersion.snapshot.basePriceCents));
    const quote = computeCyclePrice(monthlyBaseCents, cycle);
    return {
      mrrCents: quote.effectiveMonthlyCents,
      monthlyBaseCents,
      billingCycle: cycle,
      planVersionId: planVersion.id,
      quote,
      versionLocked: true,
    };
  }

  // 无锁定版本：不回退 live plan.basePrice（防版本漂移污染 MRR）
  const quote = computeCyclePrice(0, cycle);
  return {
    mrrCents: 0,
    monthlyBaseCents: 0,
    billingCycle: cycle,
    planVersionId: input.subscription.planVersionId,
    quote,
    versionLocked: false,
  };
}

/** 批量：subscriptionId → mrrCents（仅 versionLocked 计入）。 */
export function sumContractNormalizedMrrCents(
  items: readonly {
    subscription: Pick<Subscription, "planVersionId" | "commercialContract" | "planId">;
    planVersion?: Pick<PlanVersion, "id" | "planId" | "snapshot"> | null;
    plan?: Pick<Plan, "id" | "billingCycle" | "basePriceCents"> | null;
  }[],
): number {
  let total = 0;
  for (const item of items) {
    const resolved = resolveContractNormalizedMrr(item);
    if (resolved.versionLocked) {
      total += resolved.mrrCents;
    }
  }
  return total;
}
