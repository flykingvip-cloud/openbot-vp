import { recycleSuspendedOrphanUserByEmail } from "./auth-helpers.js";
import { findUserByEmail, listMembershipsByUserId } from "./memberships.js";
import type { PlatformAuthMembership, PlatformAuthStore, PlatformAuthUser } from "./store-types.js";

export function findUserMembershipInEnterprise(params: {
  store: PlatformAuthStore;
  userId: string;
  enterpriseId: string;
}): PlatformAuthMembership | undefined {
  return listMembershipsByUserId(params.store, params.userId).find(
    (membership) => membership.enterpriseId === params.enterpriseId,
  );
}

/** Employee-category seat only. Enterprise-admin of the same tenant is not this class. */
export function findUserEmployeeMembershipInEnterprise(params: {
  store: PlatformAuthStore;
  userId: string;
  enterpriseId: string;
}): PlatformAuthMembership | undefined {
  return listMembershipsByUserId(params.store, params.userId).find(
    (membership) =>
      membership.enterpriseId === params.enterpriseId && membership.membershipRole === "member",
  );
}

/**
 * Invite / provision may reuse an email that already has an account elsewhere.
 * Only block when the person already holds an employee (`member`) seat in this
 * enterprise. Enterprise-admin of the same tenant stays invitable onto a
 * concrete position. Suspended orphans with no memberships are recycled first
 * so a deleted position can be recreated with the same address.
 */
export function resolveEmployeeInviteEmailAvailability(params: {
  store: PlatformAuthStore;
  email: string;
  enterpriseId: string;
}):
  | { status: "available"; existingUser?: PlatformAuthUser }
  | { status: "already-member"; user: PlatformAuthUser } {
  recycleSuspendedOrphanUserByEmail(params.store, params.email);
  const existingUser = findUserByEmail(params.store, params.email);
  if (!existingUser) {
    return { status: "available" };
  }
  if (
    findUserEmployeeMembershipInEnterprise({
      store: params.store,
      userId: existingUser.id,
      enterpriseId: params.enterpriseId,
    })
  ) {
    return { status: "already-member", user: existingUser };
  }
  return { status: "available", existingUser };
}
