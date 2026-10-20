import { DevicePlatformError } from "./types.js";

/**
 * Fields a request must not use to choose an identity.
 * The actor comes from the trusted session, membership, and use grant.
 */
export const IDENTITY_OVERRIDE_FIELDS = [
  "userId",
  "tenantId",
  "agentId",
  "gatewayAgentId",
  "sessionKey",
  "userSubject",
  "ownerId",
  "membershipId",
] as const;

export type MembershipRole = "member" | "enterprise-admin";

export type TrustedActor = {
  userId: string;
  displayName: string;
  tenantId: string;
  membershipId: string;
  membershipRole: MembershipRole;
  /** True only for a platform-admin session, not an employee login of the same user. */
  platformAdmin: boolean;
  status: "active" | "suspended";
};

export type DigitalHumanRecord = {
  digitalHumanId: string;
  tenantId: string;
  gatewayAgentId: string;
  displayName: string;
  status: "active" | "disabled";
  /** Informational. Matching this field is not a use permission. */
  ownerId?: string;
};

export type IdentityDirectory = {
  resolveActor(sessionRef: string): TrustedActor | null;
  getDigitalHuman(digitalHumanId: string): DigitalHumanRecord | null;
  /**
   * Explicit use grant for this actor and human (seat, ownership manager, or catalog).
   * Implementations must not return true from ownerId equality alone.
   */
  hasDigitalHumanUse(actor: TrustedActor, human: DigitalHumanRecord): boolean;
};

export type PlatformSessionSlice = {
  userId: string;
  membershipId?: string;
  enterpriseId?: string;
  sessionKind?: string;
};

export type PlatformUserSlice = {
  id: string;
  displayName: string;
  status: "active" | "suspended";
  platformAdmin?: boolean;
};

export type PlatformMembershipSlice = {
  id: string;
  userId: string;
  enterpriseId: string;
  membershipRole: MembershipRole;
};

/**
 * Build an actor from trusted platform records.
 * Session, user, and membership must agree. Request payloads are not an input.
 */
export function actorFromPlatformRecords(input: {
  session: PlatformSessionSlice | null;
  user: PlatformUserSlice | null;
  membership: PlatformMembershipSlice | null;
}): TrustedActor | null {
  const { session, user, membership } = input;
  if (!session || !user || !membership) {
    return null;
  }
  if (!session.membershipId || !session.enterpriseId) {
    return null;
  }
  if (session.userId !== user.id || session.userId !== membership.userId) {
    return null;
  }
  if (session.membershipId !== membership.id || session.enterpriseId !== membership.enterpriseId) {
    return null;
  }
  const platformSession =
    session.sessionKind === "platform-super-admin" || session.sessionKind === "platform-admin";
  return {
    userId: user.id,
    displayName: user.displayName,
    tenantId: membership.enterpriseId,
    membershipId: membership.id,
    membershipRole: membership.membershipRole,
    platformAdmin: user.platformAdmin === true && platformSession,
    status: user.status,
  };
}

/**
 * Use permission is tenant membership plus an explicit agent grant.
 * ownerId is ignored on purpose: owning a record is not permission to bind a device.
 */
export function digitalHumanUseAllowed(input: {
  actor: TrustedActor;
  human: DigitalHumanRecord;
  permittedAgentIds: readonly string[];
}): boolean {
  if (input.actor.status !== "active" || input.human.status === "disabled") {
    return false;
  }
  if (input.actor.tenantId !== input.human.tenantId) {
    return false;
  }
  const allowed = new Set(input.permittedAgentIds);
  return allowed.has(input.human.digitalHumanId) || allowed.has(input.human.gatewayAgentId);
}

export function rejectIdentityOverrides(body: Record<string, unknown>): void {
  for (const field of IDENTITY_OVERRIDE_FIELDS) {
    if (body[field] !== undefined) {
      throw new DevicePlatformError(
        "IDENTITY_OVERRIDE",
        "Identity fields are taken from the trusted session",
      );
    }
  }
}

/** Formal management mode rejects the loopback stub's debug and force session switches. */
export function assertFormalRuntime(env: NodeJS.ProcessEnv): void {
  if (
    env.OPENBOT_DEVICE_DH_AGENT_DEBUG === "1" ||
    env.OPENBOT_DEVICE_DH_AGENT_SESSION_FORCE === "1"
  ) {
    throw new DevicePlatformError(
      "DEBUG_OVERRIDE",
      "Debug and force session overrides are rejected in formal device management",
    );
  }
}

export function requireActiveActor(actor: TrustedActor | null): TrustedActor {
  if (!actor) {
    throw new DevicePlatformError("UNAUTHENTICATED", "Login session is required");
  }
  if (actor.status !== "active") {
    throw new DevicePlatformError("FORBIDDEN", "User is not active");
  }
  if (!actor.tenantId || !actor.membershipId) {
    throw new DevicePlatformError("MEMBERSHIP_REQUIRED", "Tenant membership is required");
  }
  return actor;
}
