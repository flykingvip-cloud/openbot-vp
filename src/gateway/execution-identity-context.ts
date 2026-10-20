/**
 * Canonical trusted execution identity for one agent turn.
 *
 * Task: conversation-identity-context-convergence
 *
 * Authentication identity is *request* state. It is frozen once, at the authenticated
 * Gateway boundary, and then carried forward unchanged. No downstream layer may
 * reconstruct a stronger identity than its upstream layer supplied, and nothing here may
 * be sourced from model text, tool arguments, URLs, display names, or process environment
 * variables.
 *
 * This is the single canonical structure. Seat-bound enterprise tools consume it instead
 * of independently re-deriving identity from a different subset of scalars.
 */
import { buildKnowledgeReplyGatewayClient } from "./knowledge/reply-gateway-client.js";
import type { GatewayClient } from "./server-methods/types.js";

/**
 * Collaboration owner entitlement: kept explicit and separate from the speaking employee.
 * P2 live revalidation reads authoritative seat/binding (+ optional stillGroupOwner).
 */
export type CollaborationOwnerEntitlement = {
  tenantId: string;
  seatId: string;
  employeeId?: string;
  userEmail?: string;
  /** Collaboration group id — used for delegation lookup and live "still group owner". */
  collaborationGroupId?: string;
  /**
   * Authoritative affirmation that this employee is still the group owner.
   * When `false`, high-risk collaboration-owner paths fail closed.
   * When omitted, seat/binding revalidation still applies; group-owner check is skipped.
   */
  stillGroupOwner?: boolean;
};

export type ExecutionIdentityContext = {
  /** Authenticated platform login email. */
  readonly user?: string;
  /** Authenticated platform user id (employee id in the tenant control plane). */
  readonly platformUserId?: string;
  readonly sessionDomain?: "platform" | "enterprise" | "employee";
  /** Tenant pinned by the validated session; never a client-supplied hint. */
  readonly enterpriseId?: string;
  /** Membership pinned by the validated session; paired with `enterpriseId`. */
  readonly membershipId?: string;
  /** Seat resolved server-side. Absent on ingress; only set by authoritative resolution. */
  readonly seatId?: string;
  readonly agentId?: string;
  readonly sessionKey?: string;
  readonly collaborationGroupId?: string;
  /**
   * Group owner entitlement for a collaboration round. Deliberately a separate field:
   * a speaking member's seat must never be substituted for the owner's entitlement.
   */
  readonly collaborationOwnerEntitlement?: CollaborationOwnerEntitlement;
};

/** Field-wise input shape; every field is optional and absence is preserved as absence. */
export type ExecutionIdentityContextInput = {
  user?: string | null;
  platformUserId?: string | null;
  sessionDomain?: "platform" | "enterprise" | "employee" | null;
  enterpriseId?: string | null;
  membershipId?: string | null;
  seatId?: string | null;
  agentId?: string | null;
  sessionKey?: string | null;
  collaborationGroupId?: string | null;
  collaborationOwnerEntitlement?: CollaborationOwnerEntitlement | null;
};

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Freeze a turn identity. Only present values are kept, so an absent field stays absent
 * rather than becoming an empty string that later reads as "set".
 */
export function createExecutionIdentityContext(
  input: ExecutionIdentityContextInput,
): ExecutionIdentityContext {
  const entitlement = input.collaborationOwnerEntitlement;
  return Object.freeze({
    ...(clean(input.user) ? { user: clean(input.user) } : {}),
    ...(clean(input.platformUserId) ? { platformUserId: clean(input.platformUserId) } : {}),
    ...(input.sessionDomain ? { sessionDomain: input.sessionDomain } : {}),
    ...(clean(input.enterpriseId) ? { enterpriseId: clean(input.enterpriseId) } : {}),
    ...(clean(input.membershipId) ? { membershipId: clean(input.membershipId) } : {}),
    ...(clean(input.seatId) ? { seatId: clean(input.seatId) } : {}),
    ...(clean(input.agentId) ? { agentId: clean(input.agentId) } : {}),
    ...(clean(input.sessionKey) ? { sessionKey: clean(input.sessionKey) } : {}),
    ...(clean(input.collaborationGroupId)
      ? { collaborationGroupId: clean(input.collaborationGroupId) }
      : {}),
    ...(entitlement?.tenantId?.trim() && entitlement.seatId?.trim()
      ? { collaborationOwnerEntitlement: Object.freeze({ ...entitlement }) }
      : {}),
  });
}

/** True when the turn presented an authenticated platform identity of any kind. */
export function hasAuthenticatedIdentity(context: ExecutionIdentityContext | null): boolean {
  return Boolean(context?.user || context?.platformUserId);
}

/**
 * Duck-typed view of either `ExecutionIdentityContext` or a restricted `GatewayClient`.
 * Cron/knowledge owner lookups stamp email + `sessionDomain: "employee"` without a
 * pinned membership/enterprise pair; that must not count as an authenticated employee session.
 */
export type PinnedEmployeeSessionLike =
  | {
      user?: string | null;
      platformUserId?: string | null;
      sessionDomain?: string | null;
      enterpriseId?: string | null;
      membershipId?: string | null;
      sessionEnterpriseId?: string | null;
      sessionMembershipId?: string | null;
    }
  | null
  | undefined;

/**
 * True when this turn is an authenticated employee/enterprise session with a
 * server-pinned tenant or membership. Owner email alone is not enough.
 */
export function hasPinnedEmployeeSessionContext(identity: PinnedEmployeeSessionLike): boolean {
  const hasActor = Boolean(identity?.user?.trim() || identity?.platformUserId?.trim());
  if (!hasActor) {
    return false;
  }
  const tenant = identity?.enterpriseId?.trim() || identity?.sessionEnterpriseId?.trim();
  const membership = identity?.membershipId?.trim() || identity?.sessionMembershipId?.trim();
  return Boolean(tenant || membership);
}

/**
 * Narrow the canonical context to the restricted `GatewayClient` view that server-side
 * membership/seat resolution consumes. Returns `null` when no authenticated identity was
 * presented, so callers keep failing closed instead of receiving an empty client.
 *
 * Delegates to the existing `buildKnowledgeReplyGatewayClient` rather than introducing a
 * second client builder: there must remain exactly one place that shapes a restricted
 * client from trusted turn identity.
 */
export function toRestrictedGatewayClient(
  context: ExecutionIdentityContext | null | undefined,
): GatewayClient | null {
  if (!hasAuthenticatedIdentity(context ?? null)) {
    return null;
  }
  return buildKnowledgeReplyGatewayClient({
    gatewayClientUser: context?.user,
    gatewayClientPlatformUserId: context?.platformUserId,
    gatewayClientSessionDomain: context?.sessionDomain,
    gatewayClientSessionEnterpriseId: context?.enterpriseId,
    gatewayClientSessionMembershipId: context?.membershipId,
  });
}

/**
 * Transitional adapter: freeze a canonical context from the run's trusted options.
 * Scalars remain accepted only so callers that have not yet been migrated can still
 * forward identity; they are never read from tool arguments or model text.
 */
export type ExecutionIdentityRunFields = {
  executionIdentity?: ExecutionIdentityContext;
  gatewayClientUser?: string | null;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"] | null;
  gatewayClientPlatformUserId?: string | null;
  gatewayClientSessionEnterpriseId?: string | null;
  gatewayClientSessionMembershipId?: string | null;
  agentId?: string | null;
  sessionKey?: string | null;
  collaborationGroupId?: string | null;
};

export function resolveExecutionIdentityFromRunFields(
  fields?: ExecutionIdentityRunFields,
): ExecutionIdentityContext {
  const base = fields?.executionIdentity;
  return createExecutionIdentityContext({
    user: base?.user ?? fields?.gatewayClientUser,
    platformUserId: base?.platformUserId ?? fields?.gatewayClientPlatformUserId,
    sessionDomain: base?.sessionDomain ?? fields?.gatewayClientSessionDomain,
    enterpriseId: base?.enterpriseId ?? fields?.gatewayClientSessionEnterpriseId,
    membershipId: base?.membershipId ?? fields?.gatewayClientSessionMembershipId,
    seatId: base?.seatId,
    agentId: fields?.agentId ?? base?.agentId,
    sessionKey: base?.sessionKey ?? fields?.sessionKey,
    collaborationGroupId: base?.collaborationGroupId ?? fields?.collaborationGroupId,
    collaborationOwnerEntitlement: base?.collaborationOwnerEntitlement,
  });
}

/** Scalar bag used only at the tool-construction boundary during the migration. */
export function toTrustedGatewayClientFields(context: ExecutionIdentityContext): {
  gatewayClientUser?: string;
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientSessionEnterpriseId?: string;
  gatewayClientSessionMembershipId?: string;
} {
  return {
    ...(context.user ? { gatewayClientUser: context.user } : {}),
    ...(context.platformUserId ? { gatewayClientPlatformUserId: context.platformUserId } : {}),
    ...(context.sessionDomain ? { gatewayClientSessionDomain: context.sessionDomain } : {}),
    ...(context.enterpriseId ? { gatewayClientSessionEnterpriseId: context.enterpriseId } : {}),
    ...(context.membershipId ? { gatewayClientSessionMembershipId: context.membershipId } : {}),
  };
}

/**
 * Keys that every execution-system hop must inherit. These are identity, not
 * routing: agentId/sessionKey stay with the run that owns the session.
 *
 * Reconstructing an attempt or tool list by hand-listing a subset of these
 * keys is how pins silently drop. Spread `inheritExecutionIdentityRunFields`
 * instead.
 */
export const EXECUTION_IDENTITY_INHERIT_KEYS = [
  "executionIdentity",
  "gatewayClientUser",
  "gatewayClientSessionDomain",
  "gatewayClientPlatformUserId",
  "gatewayClientSessionEnterpriseId",
  "gatewayClientSessionMembershipId",
] as const satisfies ReadonlyArray<keyof ExecutionIdentityRunFields>;

export type ExecutionIdentityInheritFields = {
  [K in (typeof EXECUTION_IDENTITY_INHERIT_KEYS)[number]]?: Exclude<
    ExecutionIdentityRunFields[K],
    null
  >;
};

/**
 * Copy the identity hop as present on the source. Does not invent scalars from
 * the canonical object — use `inheritExecutionIdentityRunFields` at reconstruct
 * sites so a hop that only kept the object still re-emits trusted scalars.
 */
export function pickExecutionIdentityRunFields(
  source?: ExecutionIdentityRunFields | null,
): ExecutionIdentityInheritFields {
  if (!source) {
    return {};
  }
  return {
    ...(source.executionIdentity ? { executionIdentity: source.executionIdentity } : {}),
    ...(source.gatewayClientUser?.trim() ? { gatewayClientUser: source.gatewayClientUser } : {}),
    ...(source.gatewayClientSessionDomain
      ? { gatewayClientSessionDomain: source.gatewayClientSessionDomain }
      : {}),
    ...(source.gatewayClientPlatformUserId?.trim()
      ? { gatewayClientPlatformUserId: source.gatewayClientPlatformUserId }
      : {}),
    ...(source.gatewayClientSessionEnterpriseId?.trim()
      ? { gatewayClientSessionEnterpriseId: source.gatewayClientSessionEnterpriseId }
      : {}),
    ...(source.gatewayClientSessionMembershipId?.trim()
      ? { gatewayClientSessionMembershipId: source.gatewayClientSessionMembershipId }
      : {}),
  };
}

/**
 * Single inherit operator for the digital-employee execution system.
 *
 * Any layer that reconstructs an agent attempt, compact session, HTTP invoke,
 * spawn child, queue/follow-up, or tool list must spread this result rather
 * than listing identity fields. The frozen canonical object is authoritative;
 * scalars are re-emitted from it so Seat-bound tools that still read the
 * transitional bag cannot see a weaker identity than the object already holds.
 */
export function inheritExecutionIdentityRunFields(
  source?: ExecutionIdentityRunFields | null,
): ExecutionIdentityInheritFields {
  const resolved = resolveExecutionIdentityFromRunFields(source ?? undefined);
  if (!hasAuthenticatedIdentity(resolved) && !source?.executionIdentity) {
    return {};
  }
  return {
    executionIdentity: source?.executionIdentity ?? resolved,
    ...toTrustedGatewayClientFields(resolved),
  };
}

/** Freeze turn identity from an authenticated Gateway WS/HTTP client. */
export function createExecutionIdentityFromGatewayClient(
  client?: Pick<
    GatewayClient,
    "user" | "platformUserId" | "sessionDomain" | "sessionEnterpriseId" | "sessionMembershipId"
  > | null,
  extras?: { agentId?: string | null; sessionKey?: string | null },
): ExecutionIdentityContext {
  return createExecutionIdentityContext({
    user: client?.user,
    platformUserId: client?.platformUserId,
    sessionDomain: client?.sessionDomain,
    enterpriseId: client?.sessionEnterpriseId,
    membershipId: client?.sessionMembershipId,
    agentId: extras?.agentId,
    sessionKey: extras?.sessionKey,
  });
}

/** Freeze turn identity from HTTP gateway auth (cookie/trusted-proxy session). */
export function createExecutionIdentityFromGatewayAuth(
  auth?: {
    user?: string | null;
    trustedProxy?: {
      user?: string | null;
      domain?: "platform" | "enterprise" | "employee" | null;
      enterpriseId?: string | null;
      membershipId?: string | null;
    } | null;
  } | null,
): ExecutionIdentityContext {
  const proxy = auth?.trustedProxy;
  return createExecutionIdentityContext({
    user: auth?.user ?? proxy?.user,
    sessionDomain: proxy?.domain,
    enterpriseId: proxy?.enterpriseId,
    membershipId: proxy?.membershipId,
  });
}

/**
 * Merge a more specific context over a base one. Used only for forward-only refinement
 * (e.g. the group-owner identity resolved during a collaboration round). It can add
 * fields, never blank an existing one — an `undefined` override is ignored.
 */
export function refineExecutionIdentityContext(
  base: ExecutionIdentityContext | null | undefined,
  overrides: ExecutionIdentityContextInput,
): ExecutionIdentityContext {
  return createExecutionIdentityContext({
    user: overrides.user ?? base?.user,
    platformUserId: overrides.platformUserId ?? base?.platformUserId,
    sessionDomain: overrides.sessionDomain ?? base?.sessionDomain,
    enterpriseId: overrides.enterpriseId ?? base?.enterpriseId,
    membershipId: overrides.membershipId ?? base?.membershipId,
    seatId: overrides.seatId ?? base?.seatId,
    agentId: overrides.agentId ?? base?.agentId,
    sessionKey: overrides.sessionKey ?? base?.sessionKey,
    collaborationGroupId: overrides.collaborationGroupId ?? base?.collaborationGroupId,
    collaborationOwnerEntitlement:
      overrides.collaborationOwnerEntitlement ?? base?.collaborationOwnerEntitlement,
  });
}

/**
 * Redacted diagnostic view for the scope decision. Reports presence only — never
 * emails, ids, tokens, credentials, or message bodies.
 */
export function describeExecutionIdentityPresence(
  context: ExecutionIdentityContext | null | undefined,
): {
  user: boolean;
  platformUserId: boolean;
  sessionDomain?: string;
  tenant: boolean;
  membership: boolean;
  seat: boolean;
  agent: boolean;
  collaborationOwner: boolean;
} {
  return {
    user: Boolean(context?.user),
    platformUserId: Boolean(context?.platformUserId),
    ...(context?.sessionDomain ? { sessionDomain: context.sessionDomain } : {}),
    tenant: Boolean(context?.enterpriseId),
    membership: Boolean(context?.membershipId),
    seat: Boolean(context?.seatId),
    agent: Boolean(context?.agentId),
    collaborationOwner: Boolean(context?.collaborationOwnerEntitlement),
  };
}
