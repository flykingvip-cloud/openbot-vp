/**
 * System grant for capability-gap evolution proposals.
 *
 * Narrow scope: allowedActions = suggest + expire only.
 * "expire" is dedicated for the capability-gap stale-DISCOVERED sweep.
 * "reject" is intentionally absent so rejectProposal / RPC transition reject
 * cannot use this system grant. No apply / promote / authorize.
 *
 * Idempotent ensure via delegation request+approve; evidence ids are expanded
 * onto the grant through restoreGrant (auditable putGrant) as gaps are ingested.
 */
import type {
  AuthorizationGrant,
  DelegationActor,
  DiagnosisDelegationMachine,
} from "../../diagnosis/delegation.js";
import type { TrustedTenantContext } from "../../diagnosis/types.js";
import { approveEvolutionGrant, evolutionGrantActorFromPrincipal } from "./evolution-grant.js";

export const CAPABILITY_GAP_GRANT_PURPOSE_PREFIX = "evolution-grant:capability-gap:";

/** Authority actions for DISCOVERED→SUGGESTED and TTL expire only (not reject/won't-fix). */
export const CAPABILITY_GAP_ALLOWED_ACTIONS = ["suggest", "expire"] as const;

export type CapabilityGapGrantMetadata = {
  schemaVersion: 1;
  grantVersion: 1;
  source: "capability-gap";
  tenantId: string | null;
};

export function encodeCapabilityGapGrantPurpose(metadata: CapabilityGapGrantMetadata): string {
  return `${CAPABILITY_GAP_GRANT_PURPOSE_PREFIX}${JSON.stringify(metadata)}`;
}

export function parseCapabilityGapGrantPurpose(purpose: string): CapabilityGapGrantMetadata | null {
  if (!purpose.startsWith(CAPABILITY_GAP_GRANT_PURPOSE_PREFIX)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      purpose.slice(CAPABILITY_GAP_GRANT_PURPOSE_PREFIX.length),
    ) as CapabilityGapGrantMetadata;
    if (parsed.schemaVersion !== 1 || parsed.grantVersion !== 1) {
      return null;
    }
    if (parsed.source !== "capability-gap") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Stable per-tenant (or platform) system grant id. */
export function capabilityGapSystemGrantId(tenantId: string | null | undefined): string {
  const key = tenantId?.trim() || "platform";
  return `grant:capability-gap:system:${key}`;
}

/** Synthetic enterprise tenant used when the gap itself is platform-scoped (tenantId null). */
export const CAPABILITY_GAP_PLATFORM_ENTERPRISE_TENANT = "system:capability-gap:platform";

function platformIssuer(): DelegationActor {
  return evolutionGrantActorFromPrincipal(
    {
      schemaVersion: 1,
      principalId: "system:capability-gap",
      kind: "system",
      tenantId: null,
    },
    "platform",
  );
}

function tenantApprover(tenantId: string): DelegationActor {
  return evolutionGrantActorFromPrincipal(
    {
      schemaVersion: 1,
      principalId: `system:capability-gap:tenant:${tenantId}`,
      kind: "system",
      tenantId,
    },
    "enterprise",
  );
}

/** platform_to_enterprise always needs an enterprise approver/grantee — even for null targetTenant. */
function platformScopedApprover(): DelegationActor {
  return tenantApprover(CAPABILITY_GAP_PLATFORM_ENTERPRISE_TENANT);
}

function farFutureExpiresAt(nowMs: number): string {
  return new Date(nowMs + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Idempotent: ensure an APPROVED system grant for capability-gap suggest+expire
 * exists for this tenant (or platform when tenantId is null/blank).
 */
export function ensureCapabilityGapSystemGrant(input: {
  machine: DiagnosisDelegationMachine;
  tenantId?: string | null;
  nowMs?: number;
  evidenceRefs?: readonly string[];
}): { grantId: string; created: boolean; grant: AuthorizationGrant } {
  const tenantId = input.tenantId?.trim() || null;
  const grantId = capabilityGapSystemGrantId(tenantId);
  const nowMs = input.nowMs ?? Date.now();
  const existing = input.machine.getGrant(grantId);
  if (existing?.status === "APPROVED") {
    return { grantId, created: false, grant: existing };
  }

  const issuer = platformIssuer();
  const approver = tenantId ? tenantApprover(tenantId) : platformScopedApprover();
  const grantee = approver;
  const metadata: CapabilityGapGrantMetadata = {
    schemaVersion: 1,
    grantVersion: 1,
    source: "capability-gap",
    tenantId,
  };
  const requestTrusted: TrustedTenantContext = { tenantId: null };
  // Approver is always enterprise; approve trusted must match approver.principal.tenantId.
  const approveTrusted: TrustedTenantContext = {
    tenantId: approver.principal.tenantId,
  };

  if (!existing) {
    const receipt = input.machine.dispatch({
      commandId: `cmd:capability-gap:system:request:${tenantId ?? "platform"}`,
      command: "request",
      trusted: requestTrusted,
      actor: issuer,
      scenario: "platform_to_enterprise",
      approver,
      grantee,
      grantId,
      targetTenant: tenantId,
      targetScope: { tenantId, targetType: "capability-gap", targetId: "system" },
      allowedEvidence: [...(input.evidenceRefs ?? [])],
      allowedActions: [...CAPABILITY_GAP_ALLOWED_ACTIONS],
      purpose: encodeCapabilityGapGrantPurpose(metadata),
      expiresAt: farFutureExpiresAt(nowMs),
      canSubdelegate: false,
      oneShot: false,
    });
    if (!receipt.grantId) {
      throw new Error(receipt.reason ?? "capability-gap system grant request failed");
    }
  }

  const requested = input.machine.getGrant(grantId);
  if (requested?.status === "REQUESTED") {
    approveEvolutionGrant({
      machine: input.machine,
      commandId: `cmd:capability-gap:system:approve:${tenantId ?? "platform"}`,
      trusted: approveTrusted,
      approver,
      grantId,
    });
  }

  const grant = input.machine.getGrant(grantId);
  if (!grant || grant.status !== "APPROVED") {
    throw new Error(`capability-gap system grant not approved: ${grant?.status ?? "missing"}`);
  }
  return { grantId, created: !existing, grant };
}

/**
 * Expand allowedEvidence on the system grant so suggest/expire authority checks pass
 * for newly persisted gap evidence ids. Uses restoreGrant (ledgered putGrant path).
 */
export function expandCapabilityGapGrantEvidence(input: {
  machine: DiagnosisDelegationMachine;
  grantId: string;
  evidenceIds: readonly string[];
  tenantId?: string | null;
}): AuthorizationGrant {
  const grant = input.machine.getGrant(input.grantId);
  if (!grant) {
    throw new Error(`capability-gap grant missing: ${input.grantId}`);
  }
  const missing = input.evidenceIds.filter((id) => id && !grant.allowedEvidence.includes(id));
  if (missing.length === 0) {
    return grant;
  }
  const trusted: TrustedTenantContext = {
    tenantId: grant.approver.principal.tenantId,
  };
  const next: AuthorizationGrant = {
    ...grant,
    allowedEvidence: [...grant.allowedEvidence, ...missing],
  };
  return input.machine.restoreGrant(next, trusted);
}

/** True when grantId is the capability-gap bootstrap system grant. */
export function isCapabilityGapSystemGrantId(grantId: string | null | undefined): boolean {
  return Boolean(grantId?.startsWith("grant:capability-gap:system:"));
}

export type CapabilityGapExpireProposalView = {
  status: string;
  sourceMechanismRef: string;
  expiresAt: string;
  grantId: string;
};

/**
 * Authority-layer constraint for expire on the capability-gap system grant.
 * Only capability-gap-sourced, stale DISCOVERED proposals may expire.
 */
export function evaluateCapabilityGapSystemGrantAction(input: {
  grantId: string;
  requestedAction: string;
  proposal?: CapabilityGapExpireProposalView | null;
  nowMs?: number;
}): { ok: true } | { ok: false; code: string; reason: string } {
  if (!isCapabilityGapSystemGrantId(input.grantId)) {
    return { ok: true };
  }
  if (input.requestedAction === "suggest" || input.requestedAction === "inspect") {
    return { ok: true };
  }
  if (
    input.requestedAction === "reject" ||
    input.requestedAction === "hold" ||
    input.requestedAction === "promote"
  ) {
    return {
      ok: false,
      code: "operation_forbidden",
      reason:
        "capability-gap system grant cannot reject/hold/promote; expire-only for stale DISCOVERED gaps",
    };
  }
  if (input.requestedAction !== "expire") {
    return {
      ok: false,
      code: "operation_forbidden",
      reason: `capability-gap system grant does not allow action: ${input.requestedAction}`,
    };
  }
  const proposal = input.proposal;
  if (!proposal) {
    return {
      ok: false,
      code: "authorization_required",
      reason: "capability-gap expire requires proposal context",
    };
  }
  if (!proposal.sourceMechanismRef.startsWith("capability-gap:")) {
    return {
      ok: false,
      code: "scope_widened",
      reason: "capability-gap system grant expire is limited to capability-gap proposals",
    };
  }
  if (proposal.status !== "DISCOVERED") {
    return {
      ok: false,
      code: "operation_forbidden",
      reason: "capability-gap system grant expire requires DISCOVERED status",
    };
  }
  if (!isCapabilityGapSystemGrantId(proposal.grantId)) {
    return {
      ok: false,
      code: "scope_widened",
      reason: "proposal grantId is not the capability-gap system grant",
    };
  }
  const expiresAt = Date.parse(proposal.expiresAt);
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(expiresAt) || expiresAt > nowMs) {
    return {
      ok: false,
      code: "operation_forbidden",
      reason: "capability-gap expire requires expiresAt in the past (TTL elapsed)",
    };
  }
  return { ok: true };
}
