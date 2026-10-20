/**
 * Enterprise member offboard write point.
 * Membership, sessions, and employee provisions are updated here.
 * Seat disposition (freeze into handover vs delete the seat) stays with the caller.
 */

import { isPlatformUser } from "./auth-helpers.js";
import { listMembershipsByUserId } from "./memberships.js";
import { resolveStoredPlatformAuthSessionContext } from "./session-context.js";
import type { PlatformAuthMembership, PlatformAuthStore, PlatformAuthUser } from "./store-types.js";
import { invalidateUserSessions } from "./token-operations.js";

function invalidateRemovedMembershipSessions(params: {
  store: PlatformAuthStore;
  userId: string;
  membershipId: string;
  enterpriseId: string;
  preservePlatformSessions: boolean;
}): void {
  for (const [sessionId, session] of Object.entries(params.store.sessions)) {
    if (session.userId !== params.userId) {
      continue;
    }
    const isRemovedMembershipSession =
      session.membershipId === params.membershipId && session.enterpriseId === params.enterpriseId;
    const persistedMembership =
      session.membershipId && session.enterpriseId
        ? params.store.memberships[session.membershipId]
        : undefined;
    const isValidOtherMembershipSession =
      !isRemovedMembershipSession &&
      persistedMembership?.userId === params.userId &&
      persistedMembership.enterpriseId === session.enterpriseId;
    const isValidPlatformSession =
      params.preservePlatformSessions &&
      !session.membershipId &&
      !session.enterpriseId &&
      resolveStoredPlatformAuthSessionContext({
        store: params.store,
        session,
      })?.membership === null;

    // A legacy or partial binding cannot prove which enterprise it represented.
    // Invalidate it rather than letting a surviving membership become its fallback.
    if (!isValidOtherMembershipSession && !isValidPlatformSession) {
      delete params.store.sessions[sessionId];
    }
  }
}

export function applyEnterpriseMemberOffboard(params: {
  store: PlatformAuthStore;
  user: PlatformAuthUser;
  membership: PlatformAuthMembership;
  nowIso: string;
}): void {
  const targetIsPlatformUser = isPlatformUser(params.user);
  const enterprise = params.store.enterprises[params.membership.enterpriseId];
  if (enterprise) {
    enterprise.seatUsed = Math.max(0, enterprise.seatUsed - 1);
    enterprise.updatedAt = params.nowIso;
  }
  // Drop membership so offboarded users disappear from the org member list
  // (including activated users whose seat shell was already deleted).
  delete params.store.memberships[params.membership.id];
  const hasRemainingMemberships = listMembershipsByUserId(params.store, params.user.id).length > 0;
  if (!hasRemainingMemberships && !targetIsPlatformUser) {
    params.user.status = "suspended";
    params.user.updatedAt = params.nowIso;
    invalidateUserSessions(params.store, params.user.id);
  } else {
    invalidateRemovedMembershipSessions({
      store: params.store,
      userId: params.user.id,
      membershipId: params.membership.id,
      enterpriseId: params.membership.enterpriseId,
      preservePlatformSessions: targetIsPlatformUser,
    });
  }
  for (const provision of Object.values(params.store.employeeProvisions)) {
    if (
      provision.enterpriseId !== params.membership.enterpriseId ||
      (provision.activatedUserId !== params.user.id &&
        provision.normalizedEmployeeEmail !== params.user.normalizedEmail)
    ) {
      continue;
    }
    if (provision.status === "pending_activation" || provision.status === "activated") {
      provision.status = "revoked";
      provision.revokedReason = "member_offboarded";
      provision.updatedAt = params.nowIso;
    }
  }
}
