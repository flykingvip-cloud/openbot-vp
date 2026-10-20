/**
 * 五档套餐 Capacity 冻结表（Phase 0 fallback）。
 * 设计真源：docs/design/openbot-plan-capacity-contract-frozen-2026-06-22.md
 */

import { SHARED_PACKAGE_MATRIX } from "../../../../../src/shared/package-matrix.js";
import type { CanonicalPlanKey } from "../../ports/platform/pricing/plan-display.ts";

export type FrozenCapacityContract = {
  teamMembers: number;
  aiEmployees: number;
  concurrentRuns: number;
  monthlyCredits: number;
  allowedTiers: readonly string[];
  allowedPolicies: readonly string[];
  contactSales: boolean;
};

/** 与后端 normalize-entitlement 一致的默认并发推导（无 snapshot 时）。 */
export function defaultMaxConcurrentRuns(maxBots: number): number {
  if (maxBots <= 0) {
    return 8;
  }
  return Math.max(2, Math.min(32, Math.ceil(maxBots * 0.4) + 2));
}

export const FROZEN_CAPACITY_BY_SLOT: Readonly<Record<CanonicalPlanKey, FrozenCapacityContract>> = {
  trial: {
    teamMembers: 3,
    aiEmployees: SHARED_PACKAGE_MATRIX.trial.snapshot.maxBots,
    concurrentRuns: SHARED_PACKAGE_MATRIX.trial.snapshot.maxConcurrentRuns,
    monthlyCredits: SHARED_PACKAGE_MATRIX.trial.snapshot.monthlyCredits,
    allowedTiers: SHARED_PACKAGE_MATRIX.trial.snapshot.allowedTiers,
    allowedPolicies: SHARED_PACKAGE_MATRIX.trial.snapshot.allowedPolicies,
    contactSales: false,
  },
  starter: {
    teamMembers: 10,
    aiEmployees: SHARED_PACKAGE_MATRIX.starter.snapshot.maxBots,
    concurrentRuns: SHARED_PACKAGE_MATRIX.starter.snapshot.maxConcurrentRuns,
    monthlyCredits: SHARED_PACKAGE_MATRIX.starter.snapshot.monthlyCredits,
    allowedTiers: SHARED_PACKAGE_MATRIX.starter.snapshot.allowedTiers,
    allowedPolicies: SHARED_PACKAGE_MATRIX.starter.snapshot.allowedPolicies,
    contactSales: false,
  },
  professional: {
    teamMembers: 30,
    aiEmployees: SHARED_PACKAGE_MATRIX.professional.snapshot.maxBots,
    concurrentRuns: SHARED_PACKAGE_MATRIX.professional.snapshot.maxConcurrentRuns,
    monthlyCredits: SHARED_PACKAGE_MATRIX.professional.snapshot.monthlyCredits,
    allowedTiers: SHARED_PACKAGE_MATRIX.professional.snapshot.allowedTiers,
    allowedPolicies: SHARED_PACKAGE_MATRIX.professional.snapshot.allowedPolicies,
    contactSales: false,
  },
  business: {
    teamMembers: 100,
    aiEmployees: SHARED_PACKAGE_MATRIX.business.snapshot.maxBots,
    concurrentRuns: SHARED_PACKAGE_MATRIX.business.snapshot.maxConcurrentRuns,
    monthlyCredits: SHARED_PACKAGE_MATRIX.business.snapshot.monthlyCredits,
    allowedTiers: SHARED_PACKAGE_MATRIX.business.snapshot.allowedTiers,
    allowedPolicies: SHARED_PACKAGE_MATRIX.business.snapshot.allowedPolicies,
    contactSales: false,
  },
  enterprise: {
    teamMembers: 0,
    aiEmployees: 0,
    concurrentRuns: 0,
    monthlyCredits: 0,
    allowedTiers: SHARED_PACKAGE_MATRIX.enterprise.snapshot.allowedTiers,
    allowedPolicies: SHARED_PACKAGE_MATRIX.enterprise.snapshot.allowedPolicies,
    contactSales: true,
  },
};
