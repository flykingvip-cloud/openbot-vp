/**
 * 套餐商业策略解析：优先 PlanVersion.snapshot.commercial，Plan.commercial 次之，最后 name 别名推断（兼容旧数据）。
 *
 * 标准五档中仅「卓越版 / enterprise」为 contact_sales；旗舰版(business)等自助标价，不得回落 custom。
 */

import type {
  Plan,
  PlanCommercialPolicy,
  PlanPurchaseMode,
  PlanVersion,
} from "../billing/types.js";
import { resolveCanonicalPlanKey } from "../platform/pricing/plan-slot-display.js";
import { resolvePlanSlotKey } from "./plan-slots.js";

function policyFromCanonicalName(name: string): PlanCommercialPolicy | null {
  const key = resolveCanonicalPlanKey(name) ?? resolvePlanSlotKey(name);
  if (key === "enterprise") {
    return { slot: "enterprise", purchaseMode: "contact_sales" };
  }
  if (key === "trial") {
    return { slot: "trial", purchaseMode: "trial_auto" };
  }
  if (key === "starter" || key === "professional" || key === "business") {
    return { slot: key, purchaseMode: "self_serve" };
  }
  return null;
}

export function resolvePlanCommercialPolicy(
  plan: Plan,
  version?: PlanVersion | null,
): PlanCommercialPolicy {
  const frozen = version?.snapshot.commercial;
  if (frozen?.purchaseMode) {
    // 纠偏：若 frozen 误标 custom 但名称是标准档，用名称推断补全 slot
    if (frozen.slot === "custom" || !frozen.slot) {
      const inferred = policyFromCanonicalName(plan.name);
      if (inferred && inferred.purchaseMode === frozen.purchaseMode) {
        return { ...frozen, slot: inferred.slot };
      }
      if (inferred && frozen.purchaseMode === "self_serve" && inferred.slot !== "enterprise") {
        return { purchaseMode: "self_serve", slot: inferred.slot };
      }
    }
    return frozen;
  }
  if (plan.commercial?.purchaseMode) {
    if (plan.commercial.slot === "custom" || !plan.commercial.slot) {
      const inferred = policyFromCanonicalName(plan.name);
      if (
        inferred &&
        plan.commercial.purchaseMode === "self_serve" &&
        inferred.slot !== "enterprise"
      ) {
        return { purchaseMode: "self_serve", slot: inferred.slot };
      }
    }
    return plan.commercial;
  }
  const inferred = policyFromCanonicalName(plan.name);
  if (inferred) {
    return inferred;
  }
  // 未识别名称：自助，不落 contact_sales；slot 仍可能 custom 供内部区分
  return { purchaseMode: "self_serve", slot: "custom" };
}

export function isContactSalesPolicy(policy: PlanCommercialPolicy): boolean {
  return policy.purchaseMode === "contact_sales";
}

export function isTrialAutoPolicy(policy: PlanCommercialPolicy): boolean {
  return policy.purchaseMode === "trial_auto";
}

export function isSelfServePolicy(policy: PlanPurchaseMode): boolean {
  return policy === "self_serve";
}

export function isContactSalesPlan(plan: Plan, version?: PlanVersion | null): boolean {
  return isContactSalesPolicy(resolvePlanCommercialPolicy(plan, version));
}

export function isTrialPlan(plan: Plan, version?: PlanVersion | null): boolean {
  return isTrialAutoPolicy(resolvePlanCommercialPolicy(plan, version));
}
