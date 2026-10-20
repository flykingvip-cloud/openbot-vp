/**
 * 套餐 Capacity 展示投影层（Phase 0）。
 * 将 Plan + 可选 Entitlement 转为用户侧 L1/L2/L3 展示结构。
 */

import type { Plan, SeatRole } from "../../capability/cost-budget-billing/index.ts";
import {
  resolvePlanSlot,
  type CanonicalPlanKey,
} from "../../ports/platform/pricing/plan-display.ts";
import {
  defaultMaxConcurrentRuns,
  FROZEN_CAPACITY_BY_SLOT,
  type FrozenCapacityContract,
} from "./plan-capacity-contract.ts";

export type PlanCapacityEntitlement = {
  monthlyCredits?: number;
  maxConcurrentRuns?: number;
  maxWorkflows?: number;
  maxKnowledgeBases?: number;
  allowedTiers?: string[];
  allowedPolicies?: string[];
  features?: {
    auditLog?: boolean;
    mfa?: boolean;
    sso?: boolean;
    vpcIsolation?: boolean;
  };
};

export type PlanCapacitySummary = {
  slotKey: CanonicalPlanKey | null;
  planId: string;
  planName: string;
  teamMembers: number;
  aiEmployees: number;
  concurrentRuns: number;
  monthlyCredits: number | null;
  monthlyPriceCents: number;
  allowedTiers: string[];
  allowedPolicies: string[];
  contactSales: boolean;
  /** 数值主要来自 plan 字段还是 entitlement / 冻结表 */
  capacitySource: "plan" | "entitlement" | "frozen";
};

function totalSeats(seatQuota: Partial<Record<SeatRole, number>> | undefined): number {
  if (!seatQuota) {
    return 0;
  }
  return (seatQuota.viewer ?? 0) + (seatQuota.creator ?? 0) + (seatQuota.admin ?? 0);
}

function frozenForSlot(slotKey: CanonicalPlanKey | null): FrozenCapacityContract | null {
  if (!slotKey) {
    return null;
  }
  return FROZEN_CAPACITY_BY_SLOT[slotKey];
}

export function buildPlanCapacitySummary(params: {
  plan: Plan;
  entitlement?: PlanCapacityEntitlement | null;
}): PlanCapacitySummary {
  const { plan, entitlement } = params;
  const slotKey = resolvePlanSlot(plan.name);
  const frozen = frozenForSlot(slotKey);
  const seatsFromPlan = totalSeats(plan.seatQuota);
  const botsFromPlan = Math.max(0, plan.botQuota);

  const teamMembers = seatsFromPlan > 0 ? seatsFromPlan : (frozen?.teamMembers ?? 0);
  const aiEmployees = botsFromPlan > 0 ? botsFromPlan : (frozen?.aiEmployees ?? 0);

  let concurrentRuns: number;
  let monthlyCredits: number | null;
  let capacitySource: PlanCapacitySummary["capacitySource"] = "plan";

  if (entitlement?.maxConcurrentRuns !== undefined && entitlement.maxConcurrentRuns >= 0) {
    concurrentRuns = entitlement.maxConcurrentRuns;
    capacitySource = "entitlement";
  } else if (frozen && frozen.concurrentRuns > 0) {
    concurrentRuns = frozen.concurrentRuns;
    capacitySource = "frozen";
  } else {
    concurrentRuns = defaultMaxConcurrentRuns(aiEmployees);
    capacitySource = aiEmployees === botsFromPlan ? "plan" : "frozen";
  }

  if (entitlement?.monthlyCredits !== undefined) {
    monthlyCredits = entitlement.monthlyCredits;
    capacitySource = "entitlement";
  } else if (frozen && !frozen.contactSales) {
    monthlyCredits = frozen.monthlyCredits;
    if (capacitySource === "plan") {
      capacitySource = "frozen";
    }
  } else {
    monthlyCredits = null;
  }

  const allowedTiers = entitlement?.allowedTiers?.length
    ? entitlement.allowedTiers
    : frozen
      ? [...frozen.allowedTiers]
      : [];
  const allowedPolicies = entitlement?.allowedPolicies?.length
    ? entitlement.allowedPolicies
    : frozen
      ? [...frozen.allowedPolicies]
      : [];

  const contactSales = slotKey === "enterprise" || frozen?.contactSales === true;

  return {
    slotKey,
    planId: plan.id,
    planName: plan.name,
    teamMembers,
    aiEmployees,
    concurrentRuns,
    monthlyCredits,
    monthlyPriceCents: plan.basePriceCents,
    allowedTiers,
    allowedPolicies,
    contactSales,
    capacitySource,
  };
}
