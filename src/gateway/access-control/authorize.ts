// Feature: shared-agent-identity-access-control-plane

import type { AgentRef, AgentRegistryStore } from "../agent-registry/types.js";
import { loadEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { recordAccessControlShadow } from "../governance/adapters/access-control-adapter.js";
import { resolveControlPlaneStorePathForTenantId } from "../tenant-context.js";
import { TENANT_SEAT_ASSETS_FILE } from "../tenant-store-paths.js";
import {
  type AccessControlMode,
  emitAccessDecisionAudit,
  emitAccessGovernanceAudit,
} from "./audit-sink.js";
import { assertSingleAuthoritativePolicySet } from "./policy-v1-adapter.js";
import { evaluateAgentAssetAccess, toResourceRef } from "./policy-v2-evaluator.js";
import type {
  AccessDecision,
  AccessResourceRef,
  AccessSubject,
  EnterpriseAccessPolicyV2,
} from "./policy-v2-types.js";

/**
 * Resolves the enforcement mode.
 *
 * Default is `shadow` on purpose: the Registry starts empty and v1 policies have
 * not been migrated, so enforcing immediately would deny every request. Shadow
 * mode records what enforcement *would* do, which is the evidence needed before
 * flipping a tenant over. Set `OPENBOT_ACCESS_CONTROL_MODE=enforce` (legacy
 * `OPENCLAW_` prefix also honored) once a tenant's assets and policies are in place.
 */
export function resolveAccessControlMode(env: NodeJS.ProcessEnv = process.env): AccessControlMode {
  const raw = (env.OPENBOT_ACCESS_CONTROL_MODE ?? env.OPENCLAW_ACCESS_CONTROL_MODE ?? "")
    .trim()
    .toLowerCase();
  return raw === "enforce" ? "enforce" : "shadow";
}

export type AuthorizeAgentAssetParams = {
  policies: EnterpriseAccessPolicyV2[];
  registry: AgentRegistryStore;
  subject: AccessSubject;
  /**
   * An `AgentRef` keeps the agent-asset call sites unchanged; a full
   * `AccessResourceRef` is used for the non-canonical resource types.
   */
  resource: AgentRef | AccessResourceRef;
  permission: string;
  requestId?: string;
  mode?: AccessControlMode;
  resolveMembershipSubject?: (membershipId: string) => AccessSubject | null;
};

export type AuthorizeAgentAssetResult = {
  /** What the caller must honour: always true in shadow mode. */
  allowed: boolean;
  /** The evaluator's verdict, regardless of enforcement. */
  decision: AccessDecision;
  mode: AccessControlMode;
};

/**
 * Evaluates one permission, writes a decision audit line, and returns whether the
 * caller may proceed.
 *
 * In `shadow` mode the caller is always allowed and the audit line records the
 * would-be denial, so a rollout can be observed without breaking traffic. In
 * `enforce` mode the evaluator's verdict is returned verbatim.
 */
export async function authorizeAgentAssetAccess(
  params: AuthorizeAgentAssetParams,
): Promise<AuthorizeAgentAssetResult> {
  const mode = params.mode ?? resolveAccessControlMode();
  const decision = evaluateAgentAssetAccess({
    policies: params.policies,
    registry: params.registry,
    subject: params.subject,
    resource: params.resource,
    permission: params.permission,
    ...(params.resolveMembershipSubject
      ? { resolveMembershipSubject: params.resolveMembershipSubject }
      : {}),
  });
  const allowed = mode === "enforce" ? decision.allowed : true;
  // Normalized so the audit line names the resource actually decided, not just agents.
  const resource = toResourceRef(params.resource);

  await emitAccessDecisionAudit({
    ts: new Date().toISOString(),
    ...(params.requestId ? { requestId: params.requestId } : {}),
    mode,
    enterpriseId: resource.enterpriseId,
    subjectType: params.subject.subjectType,
    subjectId: params.subject.subjectId,
    ...(params.subject.onBehalfOfMembershipId
      ? { onBehalfOfMembershipId: params.subject.onBehalfOfMembershipId }
      : {}),
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    permission: params.permission,
    evaluated: decision.allowed ? "allow" : "deny",
    ...(decision.allowed ? {} : { reason: decision.reason }),
    ...(decision.matchedPolicyId ? { matchedPolicyId: decision.matchedPolicyId } : {}),
    effect: allowed ? "allowed" : "denied",
  });

  // PR-P2-3: map the already-decided access result into a governance envelope.
  // Best-effort shadow only; the access result is unchanged. Flag defaults off.
  void recordAccessControlShadow({
    decision: {
      allowed: decision.allowed,
      ...(!decision.allowed ? { reason: decision.reason } : {}),
      mode,
      callerAllowed: allowed,
      resourceType: resource.resourceType,
      resourceId: resource.resourceId,
      permission: params.permission,
      enterpriseId: resource.enterpriseId,
      subjectType: params.subject.subjectType,
      subjectId: params.subject.subjectId,
      ...(params.requestId ? { requestId: params.requestId } : {}),
      ...(decision.matchedPolicyId ? { matchedPolicyId: decision.matchedPolicyId } : {}),
    },
  });

  return { allowed, decision, mode };
}

/**
 * Honor an access denial on the agent identity write.
 * Shadow mode still reports `allowed: true` for other callers, but §7.1 aborts
 * this write when the decision itself is deny.
 */
export function rejectAgentAssetWriteWhenDenied(result: AuthorizeAgentAssetResult): void {
  if (result.decision.allowed) {
    return;
  }
  const reason = result.decision.reason || "denied";
  throw new Error(`agent asset access denied: ${reason}`);
}

/** Records an ownership transfer in the long-retention governance stream. */
export async function auditOwnershipTransfer(params: {
  resource: AgentRef;
  actor: { subjectType: AccessSubject["subjectType"] | "platform-operator"; subjectId: string };
  ownerType: "membership" | "seat";
  ownerId: string;
  requestId?: string;
  previousOwnerId?: string;
}): Promise<void> {
  await emitAccessGovernanceAudit({
    ts: new Date().toISOString(),
    ...(params.requestId ? { requestId: params.requestId } : {}),
    enterpriseId: params.resource.enterpriseId,
    action: "ownership.transfer",
    actor: params.actor,
    target: {
      agentAssetId: params.resource.agentAssetId,
      ownerType: params.ownerType,
      ownerId: params.ownerId,
    },
    ...(params.previousOwnerId ? { detail: { previousOwnerId: params.previousOwnerId } } : {}),
  });
}

/** Records creation of a canonical asset so the Registry has an auditable origin. */
export async function auditAssetCreated(params: {
  resource: AgentRef;
  actor: { subjectType: AccessSubject["subjectType"] | "platform-operator"; subjectId: string };
  agentSlug: string;
  requestId?: string;
  legacyAgentId?: string;
}): Promise<void> {
  await emitAccessGovernanceAudit({
    ts: new Date().toISOString(),
    ...(params.requestId ? { requestId: params.requestId } : {}),
    enterpriseId: params.resource.enterpriseId,
    action: "asset.create",
    actor: params.actor,
    target: { agentAssetId: params.resource.agentAssetId },
    detail: {
      agentSlug: params.agentSlug,
      legacyAgentId: params.legacyAgentId ?? null,
    },
  });
}

export type TenantEnforcementDecision = {
  mode: AccessControlMode;
  /** Why enforcement is not active, when it is not. */
  reason?: "mode-not-enforce" | "v1-still-authoritative";
  /** Active v1 rows counted, present only when the check actually ran. */
  activeV1Count?: number;
};

/**
 * Resolves the enforcement mode for one tenant, refusing to enforce while two policy sets
 * are live.
 *
 * `assertSingleAuthoritativePolicySet` existed but nothing called it at runtime, so setting
 * `OPENBOT_ACCESS_CONTROL_MODE=enforce` would have enforced V2 while the v1 rows were still
 * the live fallback. Enforcement now downgrades to `shadow` with a recorded reason instead,
 * which fails safe in the availability direction: V2 is a copy of v1, so enforcing a subset
 * of the truth would remove access rather than add it.
 *
 * The v1 count is only read when someone actually asked for enforcement, so the default
 * shadow path costs no extra I/O.
 */
export async function resolveTenantEnforcementMode(params: {
  enterpriseId: string;
  env?: NodeJS.ProcessEnv;
  /** Injectable so this is testable without touching the seat-assets store. */
  countActiveV1Policies?: (enterpriseId: string) => Promise<number> | number;
}): Promise<TenantEnforcementDecision> {
  if (resolveAccessControlMode(params.env ?? process.env) !== "enforce") {
    return { mode: "shadow", reason: "mode-not-enforce" };
  }
  const count = await (params.countActiveV1Policies ?? countActiveV1AccessPolicies)(
    params.enterpriseId,
  );
  try {
    assertSingleAuthoritativePolicySet({
      enterpriseId: params.enterpriseId,
      activeV1Count: count,
      v2Enabled: true,
    });
  } catch {
    return { mode: "shadow", reason: "v1-still-authoritative", activeV1Count: count };
  }
  return { mode: "enforce", activeV1Count: count };
}

/** Counts the v1 rows that still grant access for a tenant. */
export async function countActiveV1AccessPolicies(enterpriseId: string): Promise<number> {
  const store = await loadEnterpriseSeatAssetsStore(
    resolveControlPlaneStorePathForTenantId(enterpriseId, TENANT_SEAT_ASSETS_FILE),
  );
  return Object.values(store.accessPolicies ?? {}).filter(
    (row) => row.tenantId === enterpriseId && !row.revokedAt,
  ).length;
}
