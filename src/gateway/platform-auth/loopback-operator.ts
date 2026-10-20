/**
 * Sanctioned loopback operator identity (Fix A).
 *
 * A DIRECT LOOPBACK (127.0.0.1) connection to the gateway that presents no
 * reverse-proxy identity header and no platform-auth session cookie normally
 * authorizes as an identity-less `user:"local"` principal. That principal has
 * no `sessionDomain` and no enterprise membership, so `resolveTenantContext`
 * and `resolveEmployeeWorkbenchActor` fail closed — which is why the local
 * Control UI webchat sees "enterprise tenant context is required" /
 * "trusted tenant context required" and its messages never persist or get a
 * reply.
 *
 * When (and only when) an operator explicitly opts in via
 * `gateway.auth.trustedProxy.localOperator`, this module maps the configured
 * email to a real platform-auth user + enterprise membership and synthesizes a
 * scoped trusted-proxy session for it. The session pins `sessionKind`/`domain`
 * from the membership role so the resulting client resolves an AUTHORITATIVE
 * tenant (the enterprise is read from the store, never invented from config).
 *
 * Fail-closed by design: returns `null` (→ caller keeps the anonymous local
 * principal) unless the configured email resolves to an ACTIVE user that has an
 * enterprise membership. The membership is selected with the same
 * `findMembershipByUserId` the tenant authority (`resolveMembershipAuthority`)
 * uses, so the synthesized enterprise can never disagree with the authoritative
 * tenant (no `hint_mismatch`). Intended for single-enterprise operators;
 * multi-enterprise ambiguity stays bounded by the downstream authoritative
 * resolvers.
 *
 * SECURITY TRADEOFF: enabling this treats anyone with direct loopback access to
 * the gateway as the configured operator. Only enable on a host where loopback
 * access already implies operator trust. It is strictly gated by
 * `isLocalDirectRequest` at the call site and never applies to proxied or
 * remote connections.
 */
import { findMembershipByUserId, findUserByEmail } from "./memberships.js";
import { deriveSessionDomain } from "./session-domain.js";
import type {
  PlatformAuthMembership,
  PlatformAuthStore,
  PlatformAuthTrustedProxySession,
  PlatformAuthUser,
} from "./store-types.js";

/**
 * Build a scoped trusted-proxy session from a resolved operator user +
 * membership. Mirrors the cookie-session shape produced by
 * `toTrustedProxySession` (session-context.ts) but additionally pins
 * `sessionKind`/`domain` from the membership role so the connected client
 * carries a usable `sessionDomain`.
 */
function buildOperatorSession(
  user: PlatformAuthUser,
  membership: PlatformAuthMembership,
): PlatformAuthTrustedProxySession {
  const sessionKind = membership.membershipRole;
  return {
    provider: "trusted-proxy",
    user: user.email,
    displayName: user.displayName,
    membershipId: membership.id,
    enterpriseId: membership.enterpriseId,
    tenantId: membership.enterpriseId,
    role: user.role,
    scopes: [...user.scopes],
    sessionKind,
    domain: deriveSessionDomain({ sessionKind }),
  };
}

/**
 * Resolve the configured loopback operator to a trusted-proxy session against an
 * already-loaded platform-auth store. Pure (no I/O) so it is unit-testable, and
 * fail-closed: returns `null` unless the email maps to an active user with an
 * enterprise membership.
 */
export function resolveOperatorSessionFromStore(
  store: PlatformAuthStore,
  email: string | undefined,
): PlatformAuthTrustedProxySession | null {
  // findUserByEmail matches on `normalizedEmail`; normalize the configured value
  // the same way resolveMembershipAuthority does so both resolve the same user.
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) {
    return null;
  }
  const user = findUserByEmail(store, normalizedEmail);
  if (!user || user.status !== "active") {
    return null;
  }
  const membership = findMembershipByUserId(store, user.id);
  if (!membership?.enterpriseId) {
    // No enterprise membership → no tenant to grant; keep the anonymous principal.
    return null;
  }
  return buildOperatorSession(user, membership);
}
