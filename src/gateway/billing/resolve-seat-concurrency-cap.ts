/**
 * 席位商业档位并发上限：min(租户 includedRuns, SeatEntitlementProfile.maxConcurrentRuns)。
 */

import { getSeatEntitlementAssignment } from "./seat-entitlement-assignments-store.js";
import {
  defaultSeatEntitlementProfileForRole,
  getSeatEntitlementProfile,
} from "./seat-entitlement-profiles.js";
import type { Seat } from "./types.js";

export type SeatConcurrencyCap = {
  billingSeatId: string;
  profileId: string;
  /** 席位 profile 并发上限；0 = 不单独限制。 */
  seatMaxConcurrentRuns: number;
  /** 与租户 includedRuns 取 min 后的有效上限。 */
  effectiveMaxConcurrentRuns: number;
};

function combineConcurrencyCaps(tenantCap: number, seatCap: number): number {
  if (tenantCap <= 0 && seatCap <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (tenantCap <= 0) {
    return seatCap;
  }
  if (seatCap <= 0) {
    return tenantCap;
  }
  return Math.min(tenantCap, seatCap);
}

export async function resolveSeatConcurrencyCap(input: {
  enterpriseId: string;
  seat: Seat;
  tenantMaxConcurrentRuns: number;
  seatEntitlementAssignmentsPath?: string;
}): Promise<SeatConcurrencyCap> {
  const assignment = await getSeatEntitlementAssignment(
    input.enterpriseId,
    input.seat.id,
    input.seatEntitlementAssignmentsPath,
  );
  const profileId =
    assignment?.profileId ?? defaultSeatEntitlementProfileForRole(input.seat.currentRole);
  const profile = getSeatEntitlementProfile(profileId);
  const seatMax = profile?.maxConcurrentRuns ?? input.tenantMaxConcurrentRuns;
  return {
    billingSeatId: input.seat.id,
    profileId,
    seatMaxConcurrentRuns: seatMax,
    effectiveMaxConcurrentRuns: combineConcurrencyCaps(input.tenantMaxConcurrentRuns, seatMax),
  };
}
