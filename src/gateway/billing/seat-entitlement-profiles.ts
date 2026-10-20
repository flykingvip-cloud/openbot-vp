/**
 * SeatEntitlementProfile — 商业席位能力档位（P1）。
 *
 * SeatRole 管组织治理；Profile 管 AI 商业能力（tier / 并发 / 私有模型等）。
 */

import type { SeatEntitlementProfileId, SeatRole } from "./types.js";

export type SeatEntitlementProfile = {
  id: SeatEntitlementProfileId;
  displayName: string;
  allowedTiers: string[];
  /** 席位级并发上限（与租户 includedRuns 取 min）。 */
  maxConcurrentRuns: number;
  allowPrivateModels: boolean;
};

export const SEAT_ENTITLEMENT_PROFILES: Record<SeatEntitlementProfileId, SeatEntitlementProfile> = {
  basic_ai: {
    id: "basic_ai",
    displayName: "基础 AI",
    allowedTiers: ["tier_a"],
    maxConcurrentRuns: 1,
    allowPrivateModels: false,
  },
  pro_ai: {
    id: "pro_ai",
    displayName: "专业 AI",
    allowedTiers: ["tier_a", "tier_b"],
    maxConcurrentRuns: 2,
    allowPrivateModels: false,
  },
  elite_ai: {
    id: "elite_ai",
    displayName: "高级 AI",
    allowedTiers: ["tier_a", "tier_b", "tier_c"],
    maxConcurrentRuns: 4,
    allowPrivateModels: true,
  },
  premier_ai: {
    id: "premier_ai",
    displayName: "旗舰 AI",
    allowedTiers: ["tier_a", "tier_b", "tier_c"],
    maxConcurrentRuns: 8,
    allowPrivateModels: true,
  },
};

const PROFILE_IDS = new Set<string>(Object.keys(SEAT_ENTITLEMENT_PROFILES));

export function isSeatEntitlementProfileId(value: string): value is SeatEntitlementProfileId {
  return PROFILE_IDS.has(value);
}

export function getSeatEntitlementProfile(profileId: string): SeatEntitlementProfile | null {
  if (!isSeatEntitlementProfileId(profileId)) {
    return null;
  }
  return SEAT_ENTITLEMENT_PROFILES[profileId];
}

/** 未显式分配时的默认档位映射。 */
export function defaultSeatEntitlementProfileForRole(role: SeatRole): SeatEntitlementProfileId {
  switch (role) {
    case "admin":
      return "elite_ai";
    case "creator":
      return "pro_ai";
    default:
      return "basic_ai";
  }
}

/** 租户 allowedTiers ∩ 席位 profile allowedTiers。 */
export function intersectAllowedTiers(
  tenantTiers: readonly string[],
  profileTiers: readonly string[],
): string[] {
  const tenant = new Set(tenantTiers);
  return profileTiers.filter((tier) => tenant.has(tier));
}
