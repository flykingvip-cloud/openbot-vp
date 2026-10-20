/**
 * 按 billing seat 解析 SeatEntitlementProfile（P2 Wave 2 共享真源）。
 *
 * authorizeCommercialRun 与 employee-model-gate 均通过此模块解析档位，避免漂移。
 */

import { getSeatEntitlementAssignment } from "./seat-entitlement-assignments-store.js";
import {
  defaultSeatEntitlementProfileForRole,
  getSeatEntitlementProfile,
} from "./seat-entitlement-profiles.js";
import { listSeats } from "./seats-store.js";
import type { SeatEntitlementProfileId } from "./types.js";

export type ResolveSeatEntitlementProfileInput = {
  tenantId: string;
  seatId: string;
  seatEntitlementAssignmentsPath?: string;
  seatsStorePath?: string;
};

export type ResolvedSeatEntitlementProfile = {
  profileId: SeatEntitlementProfileId;
  allowPrivateModels: boolean;
};

export async function resolveSeatEntitlementProfileForSeat(
  input: ResolveSeatEntitlementProfileInput,
): Promise<ResolvedSeatEntitlementProfile | null> {
  const seatId = input.seatId.trim();
  if (!seatId) {
    return null;
  }

  const assignment = await getSeatEntitlementAssignment(
    input.tenantId,
    seatId,
    input.seatEntitlementAssignmentsPath,
  );
  if (assignment?.profileId) {
    const profile = getSeatEntitlementProfile(assignment.profileId);
    if (profile) {
      return { profileId: profile.id, allowPrivateModels: profile.allowPrivateModels };
    }
  }

  const seats = await listSeats(input.tenantId, input.seatsStorePath);
  const seat = seats.find((row) => row.id === seatId);
  if (!seat) {
    return null;
  }

  const profileId = defaultSeatEntitlementProfileForRole(seat.currentRole);
  const profile = getSeatEntitlementProfile(profileId);
  if (!profile) {
    return null;
  }
  return { profileId: profile.id, allowPrivateModels: profile.allowPrivateModels };
}

/** 闸口层双层 profile 校验：authorize 与 gate 解析结果必须一致。 */
export function assertCommercialSeatProfileAligned(
  authorizeProfileId: string | undefined,
  gateProfileId: string | undefined,
): boolean {
  if (!authorizeProfileId || !gateProfileId) {
    return true;
  }
  return authorizeProfileId === gateProfileId;
}
