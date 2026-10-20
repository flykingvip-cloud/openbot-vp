import { resolveStateDir } from "../../config/paths.js";
import {
  approvalScopeFingerprint,
  readGovernanceApprovalGrant,
  verifyGovernanceApprovalGrant,
} from "./cognitive-approval-grant-store.js";
import {
  isGovernanceAuthenticatedCall,
  type GovernanceAuthenticatedCall,
} from "./cognitive-recommendation-auth.js";
import { actorMayRepresentOwner } from "./cognitive-recommendation-registry.js";
import {
  ownershipProofFromLocalUser,
  ownershipProofFromPrincipal,
  ownershipProofFromTenantUser,
} from "./ownership-proof.js";
import type {
  ActorRef,
  GovernanceApprovalAudit,
  GovernanceApprovalGrant,
  GovernanceApprovalGrantKind,
  GovernanceApprovalGrantScope,
  OwnershipPrincipal,
} from "./types.js";
import type { GovernanceOwnershipProof } from "./write-gate.js";

const APPROVAL_AUTH_BRAND = Symbol("openbot.governanceApprovalAuth");

/**
 * Unforgeable approval context, minted only by {@link resolveGovernanceApprovalAuth}.
 * A raw `ActorRef`, a hand-built `{ kind: "operator" }`, or a structured session DTO is
 * never accepted in its place (§0.1).
 */
export type GovernanceApprovalAuth = {
  readonly [APPROVAL_AUTH_BRAND]: true;
  readonly callerTenantId: string | null;
  readonly actor: ActorRef;
  readonly ownershipProof: GovernanceOwnershipProof;
  readonly approvalGrant: GovernanceApprovalGrant;
};

export type GovernanceApprovalAuthDenied = {
  ok: false;
  error: "governance_approval_auth_required";
  reason:
    | "not_authenticated"
    | "actor_not_user"
    | "ownership_proof_unavailable"
    | "owner_not_represented"
    | "grant_not_found"
    | "grant_kind_mismatch"
    | "grant_scope_mismatch"
    | "grant_tenant_mismatch"
    | "grant_approver_mismatch"
    | "grant_revoked"
    | "grant_expired";
};

export function isGovernanceApprovalAuth(value: unknown): value is GovernanceApprovalAuth {
  return Boolean(
    value && typeof value === "object" && (value as GovernanceApprovalAuth)[APPROVAL_AUTH_BRAND],
  );
}

function mint(params: {
  callerTenantId: string | null;
  actor: ActorRef;
  ownershipProof: GovernanceOwnershipProof;
  approvalGrant: GovernanceApprovalGrant;
}): GovernanceApprovalAuth {
  return Object.freeze({
    [APPROVAL_AUTH_BRAND]: true as const,
    callerTenantId: params.callerTenantId,
    actor: params.actor,
    ownershipProof: params.ownershipProof,
    approvalGrant: Object.freeze({ ...params.approvalGrant }),
  });
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
    return ownershipProofFromPrincipal({ owner, scope: { kind: "group", groupId: owner.groupId } });
  }
  return null;
}

/** Audit copy for receipts. Never round-trips back in as authorization (§0.3). */
export function approvalAuditFrom(
  auth: GovernanceApprovalAuth,
  now: Date,
): GovernanceApprovalAudit {
  return {
    grantId: auth.approvalGrant.grantId,
    approverUserId: auth.approvalGrant.approverUserId,
    callerTenantId: auth.callerTenantId,
    approvedAt: now.toISOString(),
  };
}

/**
 * Mint branded approval auth for one command invocation.
 *
 * Identity comes only from a `GovernanceAuthenticatedCall` (TenantContext / authoritative
 * membership). The grant is loaded from the read-only registry and must match the command's
 * kind and scope exactly, so a grant issued for one pair can never approve another.
 */
export async function resolveGovernanceApprovalAuth(params: {
  call: GovernanceAuthenticatedCall;
  owner: OwnershipPrincipal;
  grantId: string;
  requiredKind: GovernanceApprovalGrantKind;
  requiredScope: GovernanceApprovalGrantScope;
  now?: Date;
  stateDir?: string;
}): Promise<{ ok: true; auth: GovernanceApprovalAuth } | GovernanceApprovalAuthDenied> {
  const allowedKeys = new Set([
    "call",
    "owner",
    "grantId",
    "requiredKind",
    "requiredScope",
    "now",
    "stateDir",
  ]);
  if (
    !isGovernanceAuthenticatedCall(params.call) ||
    Object.keys(params).some((key) => !allowedKeys.has(key))
  ) {
    return { ok: false, error: "governance_approval_auth_required", reason: "not_authenticated" };
  }
  const { actor, callerTenantId } = params.call;
  if (actor.kind !== "user" || !actor.userId) {
    return { ok: false, error: "governance_approval_auth_required", reason: "actor_not_user" };
  }
  const proof = ownershipProofFor(callerTenantId, params.owner);
  if (!proof) {
    return {
      ok: false,
      error: "governance_approval_auth_required",
      reason: "ownership_proof_unavailable",
    };
  }
  const represents = await actorMayRepresentOwner({
    callerTenantId,
    actor,
    owner: params.owner,
    stateDir: params.stateDir,
  });
  if (!represents) {
    return {
      ok: false,
      error: "governance_approval_auth_required",
      reason: "owner_not_represented",
    };
  }
  const stateDir = params.stateDir ?? resolveStateDir();
  const record = readGovernanceApprovalGrant({
    grantId: params.grantId,
    tenantId: callerTenantId,
    stateDir,
  });
  const verified = verifyGovernanceApprovalGrant({
    grant: record,
    requiredKind: params.requiredKind,
    requiredScopeFingerprint: approvalScopeFingerprint(params.requiredScope),
    callerTenantId,
    approverUserId: actor.userId,
    now: params.now ?? new Date(),
  });
  if (!verified.ok) {
    return { ok: false, error: "governance_approval_auth_required", reason: verified.reason };
  }
  const grant = record!;
  return {
    ok: true,
    auth: mint({
      callerTenantId,
      actor,
      ownershipProof: proof,
      approvalGrant: {
        grantId: grant.grantId,
        grantKind: grant.grantKind,
        tenantId: grant.tenantId,
        scope: grant.scope,
        approverUserId: grant.approverUserId,
        issuedAt: grant.issuedAt,
        expiresAt: grant.expiresAt,
        ...(grant.revokedAt ? { revokedAt: grant.revokedAt } : {}),
      },
    }),
  };
}
