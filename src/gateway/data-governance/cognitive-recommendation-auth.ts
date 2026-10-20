import type { GatewayClient } from "../server-methods/types.js";
import { resolveAuthoritativeMembership, resolveTenantContext } from "../tenant-context.js";
import { actorMayRepresentOwner } from "./cognitive-recommendation-registry.js";
import {
  ownershipProofFromLocalUser,
  ownershipProofFromPrincipal,
  ownershipProofFromTenantUser,
} from "./ownership-proof.js";
import type { ActorRef, OwnershipPrincipal } from "./types.js";
import type { GovernanceOwnershipProof } from "./write-gate.js";

const AUTH_BRAND = Symbol("openbot.cognitiveRecommendationAuth");
const CALL_BRAND = Symbol("openbot.governanceAuthenticatedCall");

export type CognitiveRecommendationAuth = {
  readonly [AUTH_BRAND]: true;
  readonly callerTenantId: string | null;
  readonly actor: ActorRef;
  readonly ownershipProof: GovernanceOwnershipProof;
  readonly requestedBy: ActorRef;
};

/**
 * Unforgeable call context minted only by {@link authenticateGovernanceCall}.
 * Structured session DTOs and test minters are not accepted.
 */
export type GovernanceAuthenticatedCall = {
  readonly [CALL_BRAND]: true;
  readonly callerTenantId: string | null;
  readonly actor: ActorRef;
};

function mintCall(params: {
  callerTenantId: string | null;
  actor: ActorRef;
}): GovernanceAuthenticatedCall {
  return Object.freeze({
    [CALL_BRAND]: true as const,
    callerTenantId: params.callerTenantId,
    actor: params.actor,
  });
}

function mintAuth(params: {
  callerTenantId: string | null;
  actor: ActorRef;
  ownershipProof: GovernanceOwnershipProof;
  requestedBy: ActorRef;
}): CognitiveRecommendationAuth {
  return Object.freeze({
    [AUTH_BRAND]: true as const,
    callerTenantId: params.callerTenantId,
    actor: params.actor,
    ownershipProof: params.ownershipProof,
    requestedBy: params.requestedBy,
  });
}

export function isGovernanceAuthenticatedCall(
  value: unknown,
): value is GovernanceAuthenticatedCall {
  return Boolean(
    value && typeof value === "object" && (value as GovernanceAuthenticatedCall)[CALL_BRAND],
  );
}

export function isCognitiveRecommendationAuth(
  value: unknown,
): value is CognitiveRecommendationAuth {
  return Boolean(
    value && typeof value === "object" && (value as CognitiveRecommendationAuth)[AUTH_BRAND],
  );
}

/**
 * Gateway authentication entry. P3-b is user-only: identity comes from TenantContext
 * / platform-auth membership. Worker/operator/system execution is out of this slice.
 */
export async function authenticateGovernanceCall(
  client: GatewayClient | null,
): Promise<
  { ok: true; call: GovernanceAuthenticatedCall } | { ok: false; error: "actor_not_authorized" }
> {
  try {
    const ctx = await resolveTenantContext(client);
    if (ctx?.tenantId && ctx.userId) {
      return {
        ok: true,
        call: mintCall({
          callerTenantId: ctx.tenantId,
          actor: { kind: "user", userId: ctx.userId },
        }),
      };
    }
    const membership = await resolveAuthoritativeMembership(client);
    if (membership.userId && !membership.tenantId) {
      return {
        ok: true,
        call: mintCall({
          callerTenantId: null,
          actor: { kind: "user", userId: membership.userId },
        }),
      };
    }
  } catch {
    return { ok: false, error: "actor_not_authorized" };
  }
  return { ok: false, error: "actor_not_authorized" };
}

function ownershipProofFor(
  callerTenantId: string | null,
  owner: OwnershipPrincipal,
): GovernanceOwnershipProof | null {
  if (owner.kind === "user" && callerTenantId) {
    return ownershipProofFromTenantUser({ tenantId: callerTenantId, userId: owner.userId });
  }
  if (owner.kind === "user" && !callerTenantId) {
    return ownershipProofFromLocalUser({ userId: owner.userId });
  }
  if (owner.kind === "position" && callerTenantId) {
    return ownershipProofFromPrincipal({
      owner,
      scope: { kind: "tenant", tenantId: callerTenantId },
    });
  }
  if (owner.kind === "group") {
    return ownershipProofFromPrincipal({
      owner,
      scope: { kind: "group", groupId: owner.groupId },
    });
  }
  return null;
}

function ownerKey(owner: OwnershipPrincipal): string {
  switch (owner.kind) {
    case "user":
      return `user:${owner.userId}`;
    case "position":
      return `position:${owner.seatId}`;
    case "group":
      return `group:${owner.groupId}`;
    case "system":
      return `system:${owner.systemId}`;
  }
}

/**
 * Resolve branded recommendation auth from a Gateway-authenticated user call.
 * Worker delegation is not part of P3-b.
 */
export async function resolveCognitiveRecommendationAuth(params: {
  call: GovernanceAuthenticatedCall;
  owner: OwnershipPrincipal;
  stateDir?: string;
}): Promise<
  { ok: true; auth: CognitiveRecommendationAuth } | { ok: false; error: "actor_not_authorized" }
> {
  const allowedKeys = new Set(["call", "owner", "stateDir"]);
  if (
    !isGovernanceAuthenticatedCall(params.call) ||
    Object.keys(params).some((key) => !allowedKeys.has(key))
  ) {
    return { ok: false, error: "actor_not_authorized" };
  }
  const { actor, callerTenantId } = params.call;
  if (actor.kind !== "user" || !actor.userId) {
    return { ok: false, error: "actor_not_authorized" };
  }
  const proof = ownershipProofFor(callerTenantId, params.owner);
  if (!proof || ownerKey(proof.owner) !== ownerKey(params.owner)) {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (callerTenantId && proof.scope.kind === "user") {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (!callerTenantId && (proof.owner.kind !== "user" || proof.scope.kind !== "user")) {
    return { ok: false, error: "actor_not_authorized" };
  }
  const selfAuthorized = await actorMayRepresentOwner({
    callerTenantId,
    actor,
    owner: params.owner,
    stateDir: params.stateDir,
  });
  if (!selfAuthorized) {
    return { ok: false, error: "actor_not_authorized" };
  }
  return {
    ok: true,
    auth: mintAuth({
      callerTenantId,
      actor,
      ownershipProof: proof,
      requestedBy: actor,
    }),
  };
}
