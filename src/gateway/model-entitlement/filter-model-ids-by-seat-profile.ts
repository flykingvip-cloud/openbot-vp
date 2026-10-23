/**
 * 按席位商业档位（SeatEntitlementProfile）过滤模型 allowlist（P1）。
 *
 * EffectiveModelSet ∩ seatProfile.allowedTiers（经 catalog tier 映射）。
 *
 * Enterprise BYOK (`ent/*`) is not in the platform resource catalog and has no
 * subscription tier — it is already gated by grant ∩ ceiling ∩ healthy assets.
 * Dropping no-tier ids would silently strip private models from hard-deny
 * allowlists and force runs onto platform proxies.
 */

import {
  getOverAllocationState,
  isActionBlockedByOverAllocation,
} from "../billing/over-allocation-store.js";
import { resolveSeatEntitlementProfileForSeat } from "../billing/resolve-seat-entitlement-profile-for-seat.js";
import {
  getSeatEntitlementProfile,
  intersectAllowedTiers,
} from "../billing/seat-entitlement-profiles.js";
import type { SeatEntitlementProfileId } from "../billing/types.js";
import { isEnterpriseRuntimeModelId } from "../enterprise-model/ids.js";
import { getResourceModelCatalogEntry } from "../resource-catalog/models-catalog-store.js";

export type FilterModelIdsBySeatProfileInput = {
  tenantId: string;
  seatId: string;
  modelIds: string[];
  tenantAllowedTiers: readonly string[];
  seatEntitlementAssignmentsPath?: string;
  seatsStorePath?: string;
  modelCatalogPath?: string;
  overAllocationPath?: string;
};

async function resolveSeatProfileId(
  input: FilterModelIdsBySeatProfileInput,
): Promise<SeatEntitlementProfileId | null> {
  const resolved = await resolveSeatEntitlementProfileForSeat({
    tenantId: input.tenantId,
    seatId: input.seatId,
    seatEntitlementAssignmentsPath: input.seatEntitlementAssignmentsPath,
    seatsStorePath: input.seatsStorePath,
  });
  return resolved?.profileId ?? null;
}

export async function filterModelIdsBySeatEntitlementProfile(
  input: FilterModelIdsBySeatProfileInput,
): Promise<string[]> {
  if (input.modelIds.length === 0) {
    return [];
  }

  const profileId = await resolveSeatProfileId(input);
  if (!profileId) {
    return input.modelIds;
  }
  const profile = getSeatEntitlementProfile(profileId);
  if (!profile) {
    return input.modelIds;
  }

  // Legacy plans store model ids and leave allowedTiers empty. Intersecting
  // that with a seat profile yields [] and hard-denies every platform model
  // the effective set already authorized — including ones chat was using.
  if (input.tenantAllowedTiers.length === 0) {
    return input.modelIds;
  }

  let allowedTiers = intersectAllowedTiers(input.tenantAllowedTiers, profile.allowedTiers);
  const overAllocation = await getOverAllocationState(input.tenantId, input.overAllocationPath);
  if (isActionBlockedByOverAllocation(overAllocation, "run_high_tier")) {
    allowedTiers = profile.allowedTiers.length > 0 ? [profile.allowedTiers[0]] : allowedTiers;
  }

  if (allowedTiers.length === 0) {
    // Seat tier and tenant tier do not overlap. Platform models are out of
    // profile; enterprise BYOK is not a subscription tier and stays.
    return input.modelIds.filter((modelId) => isEnterpriseRuntimeModelId(modelId));
  }

  const allowedTierSet = new Set(allowedTiers);
  const filtered: string[] = [];
  for (const modelId of input.modelIds) {
    if (isEnterpriseRuntimeModelId(modelId)) {
      filtered.push(modelId);
      continue;
    }
    const entry = await getResourceModelCatalogEntry(modelId, input.modelCatalogPath);
    const tier = entry?.tier?.trim();
    if (!tier) {
      continue;
    }
    if (allowedTierSet.has(tier)) {
      filtered.push(modelId);
    }
  }
  return filtered;
}
