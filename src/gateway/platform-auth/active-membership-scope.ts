// Feature: shared-agent-identity-access-control-plane

import { resolvePlatformRole } from "./auth-helpers.js";
import {
  findMembershipByIdForUser,
  findUniqueMembershipByUserId,
  findUserByEmail,
  listMembershipsByUserId,
} from "./memberships.js";
import type { PlatformAuthMembership, PlatformAuthStore, PlatformAuthUser } from "./store-types.js";

/**
 * Why a request-time enterprise scope is or is not authoritative.
 *
 * `no-platform-identity` is deliberately distinct from `deny`: the caller has no
 * platform-auth identity at all (local operator, loopback, header-only proxy user
 * that is not a platform user), so a caller-side local fallback stays legitimate.
 * `deny` means an identity *was* recognized but could not be bound to exactly one
 * enterprise, which must never degrade into a local-operator grant.
 */
export type AuthoritativeEnterpriseScopeDenyReason =
  | "user-inactive"
  | "membership-unknown"
  | "membership-enterprise-mismatch"
  | "membership-ambiguous"
  | "enterprise-unavailable"
  | "requested-tenant-mismatch";

/**
 * A recognized platform account that simply has no enterprise membership (for
 * example a platform-only operator account). Kept separate from `deny` so this
 * pre-existing case keeps whatever fallback the caller already allowed; making it
 * fail closed would lock platform operators out rather than fix a tenant leak.
 */
export type AuthoritativeEnterpriseScopeNoMembership = {
  kind: "no-enterprise-membership";
  user: PlatformAuthUser;
  /**
   * True only for a verified platform operator (platform admin / super-admin).
   * A caller must not grant enterprise-admin-equivalent scope to a plain account
   * just because it has no membership.
   */
  isPlatformOperator: boolean;
};

export type AuthoritativeEnterpriseScope =
  | {
      kind: "authoritative";
      user: PlatformAuthUser;
      membership: PlatformAuthMembership;
      enterpriseId: string;
    }
  | { kind: "deny"; reason: AuthoritativeEnterpriseScopeDenyReason }
  | AuthoritativeEnterpriseScopeNoMembership
  /**
   * No platform-auth identity resolved. `claimedIdentity` distinguishes a caller
   * that presented an unrecognized identity (must fail closed) from one that
   * presented none at all (may still use a caller-side local-mode fallback).
   */
  | { kind: "no-platform-identity"; claimedIdentity: boolean };

/**
 * Minimal shape of a connected client. Declared structurally so this module stays
 * independent of the gateway request types while still accepting a GatewayClient.
 */
export type AuthoritativeScopeClient = {
  user?: string;
  sessionMembershipId?: string;
  sessionEnterpriseId?: string;
};

export type ResolveAuthoritativeEnterpriseScopeParams = {
  store: PlatformAuthStore;
  /** Normalized login email carried by the connection, when present. */
  email: string | null;
  /** Membership pinned by the validated session (paired with `sessionEnterpriseId`). */
  sessionMembershipId?: string;
  /** Enterprise pinned by the validated session (paired with `sessionMembershipId`). */
  sessionEnterpriseId?: string;
  /** Canonicalized tenant claimed by the request; only ever an equality constraint. */
  requestedTenantId?: string | null;
  /** Canonicalization used for enterprise ids so comparisons share one form. */
  canonicalize: (value: string | null | undefined) => string | null;
};

function trimmedOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Resolves the authoritative enterprise for a request without ever selecting a
 * membership by object order.
 *
 * Selection precedence:
 *  1. the exact `membershipId + enterpriseId` pair pinned by the validated
 *     session, revalidated against the store on every read;
 *  2. otherwise the user's single membership (unambiguous legacy compatibility).
 *
 * A requested tenant never selects an enterprise; it only has to equal the one
 * already resolved. Multiple memberships without a session pair are ambiguous and
 * fail closed rather than falling back to a first match.
 */
export function resolveAuthoritativeEnterpriseScope(
  params: ResolveAuthoritativeEnterpriseScopeParams,
): AuthoritativeEnterpriseScope {
  const { store, canonicalize } = params;
  if (!params.email) {
    return { kind: "no-platform-identity", claimedIdentity: false };
  }
  const user = findUserByEmail(store, params.email);
  if (!user) {
    // An unrecognized but *claimed* identity must never be treated as a local
    // operator; only a caller with no identity at all may fall back.
    return { kind: "no-platform-identity", claimedIdentity: true };
  }
  // Suspension must take effect on the next request, not only at next login:
  // long-lived connections keep replaying an already-validated session pair.
  if (user.status !== "active") {
    return { kind: "deny", reason: "user-inactive" };
  }

  const membershipId = trimmedOrNull(params.sessionMembershipId);
  const sessionEnterpriseId = trimmedOrNull(params.sessionEnterpriseId);
  let membership: PlatformAuthMembership | undefined;
  if (membershipId && sessionEnterpriseId) {
    const exact = findMembershipByIdForUser(store, membershipId, user.id);
    if (!exact) {
      return { kind: "deny", reason: "membership-unknown" };
    }
    // The pair must still agree after any membership/enterprise change.
    if (canonicalize(exact.enterpriseId) !== canonicalize(sessionEnterpriseId)) {
      return { kind: "deny", reason: "membership-enterprise-mismatch" };
    }
    membership = exact;
  } else if (membershipId || sessionEnterpriseId) {
    // Half-bound context: never complete it by guessing the missing side.
    return { kind: "deny", reason: "membership-unknown" };
  } else {
    membership = findUniqueMembershipByUserId(store, user.id);
    if (!membership) {
      const all = listMembershipsByUserId(store, user.id);
      if (all.length === 0) {
        // Nothing to bind: a recognized account with no enterprise membership.
        return {
          kind: "no-enterprise-membership",
          user,
          isPlatformOperator: resolvePlatformRole(user) !== null,
        };
      }
      // Several memberships without a pinned session pair. The ambiguity guard
      // exists to stop a TENANT being chosen by object order (the first-match
      // cross-tenant leak this migration closes). When every membership resolves
      // to the SAME enterprise there is no tenant to leak between, so the
      // enterprise is unambiguous — resolve it instead of failing closed. Pick the
      // least-privileged ("member") membership as the representative so an
      // un-pinned connection never inherits enterprise-admin scope; an explicit
      // admin login still pins its enterprise-admin membership via the exact-pair
      // branch above.
      const distinctEnterpriseIds = new Set(
        all.map((entry) => canonicalize(entry.enterpriseId) ?? entry.enterpriseId),
      );
      if (distinctEnterpriseIds.size !== 1) {
        return { kind: "deny", reason: "membership-ambiguous" };
      }
      membership =
        all.find((entry) => entry.membershipRole === "member") ??
        [...all].toSorted((left, right) =>
          (left.createdAt ?? "").localeCompare(right.createdAt ?? ""),
        )[0];
    }
  }

  // Enterprise lifecycle is revalidated on every request for the same reason as
  // user status: a frozen tenant must lose access immediately, not at reconnect.
  const enterprise = store.enterprises?.[membership.enterpriseId];
  if (!enterprise || enterprise.status === "suspended" || enterprise.status === "expired") {
    return { kind: "deny", reason: "enterprise-unavailable" };
  }

  const enterpriseId = canonicalize(membership.enterpriseId) ?? membership.enterpriseId;
  const requestedTenantId = trimmedOrNull(params.requestedTenantId ?? undefined);
  if (requestedTenantId) {
    const requested = canonicalize(requestedTenantId) ?? requestedTenantId;
    if (requested !== enterpriseId) {
      return { kind: "deny", reason: "requested-tenant-mismatch" };
    }
  }
  return { kind: "authoritative", user, membership, enterpriseId };
}

/**
 * Request-time convenience wrapper: derives the normalized login email and the
 * validated session pair from a connected client, so every consumer resolves the
 * enterprise the same way instead of re-deriving it from `client.user` alone.
 */
export function resolveAuthoritativeEnterpriseScopeForClient(params: {
  store: PlatformAuthStore;
  client: AuthoritativeScopeClient | null | undefined;
  requestedTenantId?: string | null;
  canonicalize: (value: string | null | undefined) => string | null;
}): AuthoritativeEnterpriseScope {
  const email = params.client?.user?.trim().toLowerCase() || null;
  return resolveAuthoritativeEnterpriseScope({
    store: params.store,
    email,
    ...(params.client?.sessionMembershipId
      ? { sessionMembershipId: params.client.sessionMembershipId }
      : {}),
    ...(params.client?.sessionEnterpriseId
      ? { sessionEnterpriseId: params.client.sessionEnterpriseId }
      : {}),
    requestedTenantId: params.requestedTenantId ?? null,
    canonicalize: params.canonicalize,
  });
}
