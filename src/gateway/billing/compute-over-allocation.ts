/**
 * 根据 SubscriptionRuntimeSnapshot 与当前用量计算超配状态（P1）。
 */

import { countActiveBots } from "./bot-resources-store.js";
import { upsertOverAllocationState } from "./over-allocation-store.js";
import { listSeatEntitlementAssignments } from "./seat-entitlement-assignments-store.js";
import { getSeatEntitlementProfile } from "./seat-entitlement-profiles.js";
import { listSeats, resolveSeatStatus } from "./seats-store.js";
import type { SubscriptionRuntimeSnapshot } from "./subscription-runtime-snapshots-store.js";
import { resolveTrialSeatCapacity } from "./trial-seat-capacity.js";
import type { OverAllocationBlockedAction, OverAllocationState } from "./types.js";

export type ComputeOverAllocationInput = {
  enterpriseId: string;
  snapshot: SubscriptionRuntimeSnapshot;
  storePaths?: {
    seats?: string;
    bots?: string;
    seatEntitlementAssignments?: string;
    overAllocation?: string;
  };
};

function countEliteProfiles(
  assignments: Awaited<ReturnType<typeof listSeatEntitlementAssignments>>,
  allowedProfiles: Set<string>,
): number {
  let over = 0;
  for (const assignment of assignments) {
    if (!allowedProfiles.has(assignment.profileId)) {
      over += 1;
    }
  }
  return over;
}

/**
 * 刷新企业超配状态并落盘。降级后不删资产，进入 over_allocated + blockedActions。
 */
export async function refreshOverAllocationState(
  input: ComputeOverAllocationInput,
): Promise<OverAllocationState> {
  const entitlement = input.snapshot.entitlementSnapshot;
  const seats = await listSeats(input.enterpriseId, input.storePaths?.seats);
  const activeSeatCount = seats.filter((seat) => resolveSeatStatus(seat) === "active").length;
  const trialCap = await resolveTrialSeatCapacity(input.enterpriseId);
  const activeBots = await countActiveBots(input.enterpriseId, input.storePaths?.bots);
  const assignments = await listSeatEntitlementAssignments(
    input.enterpriseId,
    input.storePaths?.seatEntitlementAssignments,
  );

  const maxSeats =
    trialCap ??
    Object.values(entitlement.maxSeats).reduce(
      (sum, n) => sum + (typeof n === "number" ? n : 0),
      0,
    );
  const seatsOver = Math.max(0, (trialCap != null ? activeSeatCount : seats.length) - maxSeats);
  const botsOver = Math.max(0, activeBots - entitlement.maxBots);

  const allowedProfileIds = new Set(
    assignments
      .map((a) => getSeatEntitlementProfile(a.profileId))
      .filter(Boolean)
      .filter((profile) =>
        profile!.allowedTiers.every((tier) => entitlement.allowedTiers.includes(tier)),
      )
      .map((profile) => profile!.id),
  );
  const seatProfilesOver =
    trialCap != null ? 0 : countEliteProfiles(assignments, allowedProfileIds);

  const privateModelsOver =
    trialCap != null
      ? 0
      : entitlement.allowPrivateModels === false
        ? assignments.filter((a) => getSeatEntitlementProfile(a.profileId)?.allowPrivateModels)
            .length
        : 0;

  const workflowsOver = 0;

  const over =
    seatsOver > 0 ||
    botsOver > 0 ||
    seatProfilesOver > 0 ||
    privateModelsOver > 0 ||
    workflowsOver > 0;

  const blockedActions: OverAllocationBlockedAction[] = over
    ? [
        ...(seatsOver > 0 ? (["assign_seat"] as const) : []),
        ...(botsOver > 0 ? (["create_bot", "duplicate_bot"] as const) : []),
        ...(seatProfilesOver > 0 || privateModelsOver > 0
          ? (["upgrade_seat_profile", "run_high_tier"] as const)
          : []),
      ]
    : [];

  const now = new Date().toISOString();
  const state: OverAllocationState = {
    enterpriseId: input.enterpriseId,
    subscriptionSnapshotId: input.snapshot.id,
    status: over ? "over_allocated" : "normal",
    seatsOver,
    botsOver,
    seatProfilesOver,
    privateModelsOver,
    workflowsOver,
    blockedActions,
    detectedAt: now,
    updatedAt: now,
  };

  return upsertOverAllocationState(state, input.storePaths?.overAllocation);
}
