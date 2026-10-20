// Feature: shared-agent-identity-access-control-plane

import type { PlatformAuthTrustedProxySession } from "./store-types.js";

/**
 * Authoritative enterprise context carried on a connected gateway client.
 *
 * Only ever populated from an already server-validated session. Both fields are
 * present together or not at all, so a consumer can treat their presence as
 * proof that the pair was revalidated server-side.
 */
export type AuthoritativeClientMembershipContext = {
  sessionMembershipId?: string;
  sessionEnterpriseId?: string;
};

/** Session identity fields a gateway client exposes to RPC consumers. */
export type ClientSessionIdentity = AuthoritativeClientMembershipContext & {
  user?: string;
  sessionDomain?: "platform" | "enterprise" | "employee";
  sessionKind?: "platform-super-admin" | "platform-admin" | "enterprise-admin" | "member";
  /** Compatibility tenant hint; never an authority source on its own. */
  sessionTenantId?: string;
};

function trimmedOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Projects the authoritative `membershipId + enterpriseId` pair from a validated
 * platform session.
 *
 * Fail-closed by design: a partial pair (only one side present, or a blank
 * value) yields no authoritative context rather than a half-bound identity that
 * a consumer might complete by guessing the other side. Platform sessions are
 * intentionally unbound and therefore also yield nothing.
 */
export function resolveAuthoritativeClientMembershipContext(
  session: PlatformAuthTrustedProxySession | null | undefined,
): AuthoritativeClientMembershipContext {
  const membershipId = trimmedOrNull(session?.membershipId);
  const enterpriseId = trimmedOrNull(session?.enterpriseId);
  if (!membershipId || !enterpriseId) {
    return {};
  }
  return { sessionMembershipId: membershipId, sessionEnterpriseId: enterpriseId };
}

/**
 * Builds the full session-identity block for a connected client from a validated
 * session. Kept as one unit so the authoritative pair cannot be partially
 * assigned, and so the tenant hint can never overwrite it.
 */
export function resolveClientSessionIdentity(
  session: PlatformAuthTrustedProxySession | null | undefined,
): ClientSessionIdentity {
  if (!session) {
    return {};
  }
  return {
    ...(session.user === undefined ? {} : { user: session.user }),
    ...(session.domain === undefined ? {} : { sessionDomain: session.domain }),
    ...(session.sessionKind === undefined ? {} : { sessionKind: session.sessionKind }),
    ...resolveAuthoritativeClientMembershipContext(session),
    ...(session.tenantId === undefined ? {} : { sessionTenantId: session.tenantId }),
  };
}
