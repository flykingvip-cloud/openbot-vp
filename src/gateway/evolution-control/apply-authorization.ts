import { evolutionTargetKey, type EvolutionProposal } from "@openbot/evolution-core";

export type EvolutionSessionKind =
  | "platform-super-admin"
  | "platform-admin"
  | "enterprise-admin"
  | "member";

export type EvolutionApplyActor = {
  sessionKind: EvolutionSessionKind;
  /** Null for a platform session. Enterprise sessions must match sessionKind. */
  membershipRole: "enterprise-admin" | "member" | null;
  tenantId: string | null;
  userId: string;
};

export type EvolutionApplyObject = {
  tenantId: string;
  targetId: string;
  objectKind: "member" | "enterprise";
  ownerUserId: string | null;
};

export type EvolutionApplyGrant = {
  tenantId: string;
  targetId: string;
  actions: readonly string[];
  expiresAt: string;
  status: "APPROVED";
  granteeUserId: string;
};

export type EvolutionApplyAuthPorts = {
  resolveActor(client: {
    sessionKind?: EvolutionSessionKind;
    sessionMembershipId?: string;
    sessionEnterpriseId?: string;
    platformUserId?: string;
    user?: string;
  }): Promise<EvolutionApplyActor | null>;
  resolveObject(proposal: EvolutionProposal): Promise<EvolutionApplyObject | null>;
  resolveGrant(input: {
    actor: EvolutionApplyActor;
    object: EvolutionApplyObject;
    action: "apply" | "verify";
    scope: "shadow" | "canary" | "active";
    now: string;
  }): Promise<EvolutionApplyGrant | null>;
};

let testPorts: EvolutionApplyAuthPorts | undefined;

export function setEvolutionApplyAuthPortsForTests(ports?: EvolutionApplyAuthPorts): void {
  testPorts = ports;
}

export function evolutionApplyAuthPortsForTests(): EvolutionApplyAuthPorts | undefined {
  return testPorts;
}

export function applyTargetId(proposal: EvolutionProposal): string {
  return evolutionTargetKey(proposal.target);
}

function grantCovers(input: {
  grant: EvolutionApplyGrant | null;
  actor: EvolutionApplyActor;
  object: EvolutionApplyObject;
  action: "apply" | "verify";
  scope: "shadow" | "canary" | "active";
  now: string;
}): boolean {
  const grant = input.grant;
  if (!grant || grant.status !== "APPROVED") {
    return false;
  }
  if (grant.granteeUserId !== input.actor.userId) {
    return false;
  }
  if (grant.tenantId !== input.object.tenantId) {
    return false;
  }
  const target = grant.targetId;
  const objectTarget = input.object.targetId;
  const agentId = objectTarget.startsWith("agent:") ? objectTarget.slice("agent:".length) : "";
  if (target !== objectTarget && target !== agentId) {
    return false;
  }
  const expiresAt = Date.parse(grant.expiresAt);
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(nowMs) || expiresAt <= nowMs) {
    return false;
  }
  if (input.action === "verify") {
    return grant.actions.includes("verify");
  }
  return (
    grant.actions.includes(input.scope) ||
    grant.actions.includes("apply") ||
    (input.scope === "shadow" && grant.actions.includes("canary"))
  );
}

/**
 * Apply/Verify actor gate. Platform identity, a membership role, and a client
 * field are not tenant write authority by themselves.
 */
export function decideEvolutionApplyAuthorization(input: {
  action: "apply" | "verify";
  scope: "shadow" | "canary" | "active";
  actor: EvolutionApplyActor;
  object: EvolutionApplyObject;
  grant: EvolutionApplyGrant | null;
  now: string;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.actor.userId.trim()) {
    return { ok: false, reason: "operator identity is required" };
  }
  const covered = grantCovers(input);
  if (
    input.actor.sessionKind === "platform-admin" ||
    input.actor.sessionKind === "platform-super-admin"
  ) {
    if (!covered) {
      return { ok: false, reason: "platform identity requires a delegation grant" };
    }
    return { ok: true };
  }
  if (input.actor.sessionKind === "enterprise-admin") {
    if (input.actor.membershipRole !== "enterprise-admin") {
      return { ok: false, reason: "enterprise-admin session does not match membership role" };
    }
    if (input.actor.tenantId !== input.object.tenantId) {
      return { ok: false, reason: "cross-tenant apply is not authorized" };
    }
    if (input.object.objectKind === "member" && !covered) {
      return { ok: false, reason: "employee object requires a delegation grant" };
    }
    return { ok: true };
  }
  if (input.actor.sessionKind === "member") {
    if (input.actor.membershipRole !== "member") {
      return { ok: false, reason: "member session does not match membership role" };
    }
    if (input.actor.tenantId !== input.object.tenantId) {
      return { ok: false, reason: "cross-tenant apply is not authorized" };
    }
    if (input.object.objectKind !== "member" || input.object.ownerUserId !== input.actor.userId) {
      return { ok: false, reason: "member can only operate an owned digital human" };
    }
    if (input.action === "apply" && input.scope === "active" && !covered) {
      return { ok: false, reason: "member active apply requires an explicit grant" };
    }
    return { ok: true };
  }
  return { ok: false, reason: "operator session is not authorized" };
}
