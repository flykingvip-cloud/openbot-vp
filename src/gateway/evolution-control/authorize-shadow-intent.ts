/**
 * P1-E production entry: reachable human authorize for DISCOVERED assist-shadow
 * proposals that already have adapters.
 *
 * Auto/shadow registration stays observe-only (DISCOVERED; never Apply).
 * This entry is the missing human gate: DISCOVERED → APPROVED_FOR_EXPERIMENT
 * after confirm + grant authority. It does not start an experiment or Apply;
 * callers use evolution.experiments.create / applications.apply / rollback.
 *
 * Eligible: capability.skill-installation (reversible install adapter).
 * Observe-only via this entry: system.runtime-binding-governance (critical).
 * Does not invent auto-Apply of system code or runtime bindings.
 */
import type { EvolutionProposal } from "@openbot/evolution-core";
import {
  createDelegationEvolutionInspector,
  type EvolutionAuthorizationInspector,
  type EvolutionAuthorizationView,
} from "../../diagnosis/evolution-proposal.js";
import { checkEvolutionAuthority } from "./authority-gate.js";
import type { EvolutionControlPlane } from "./control-plane.js";
import { getSharedDiagnosisDelegationMachine } from "./delegation-service.js";

let inspectorOverride: EvolutionAuthorizationInspector | undefined;

/** Test-only: inject the plane's inspector so RPC authorize sees the same grants. */
export function setAuthorizeShadowIntentInspectorForTests(
  inspector?: EvolutionAuthorizationInspector,
): void {
  inspectorOverride = inspector;
}

export function resolveAuthorizeShadowIntentInspector(): EvolutionAuthorizationInspector {
  if (inspectorOverride) {
    return inspectorOverride;
  }
  return createDelegationEvolutionInspector(getSharedDiagnosisDelegationMachine());
}

/** Surfaces that may leave DISCOVERED via this human authorize entry. */
export const SHADOW_INTENT_AUTHORIZE_SURFACES = new Set<string>(["capability.skill-installation"]);

/** Assist-shadow surfaces that stay observe-only until a dedicated governance path. */
export const SHADOW_INTENT_OBSERVE_ONLY_SURFACES = new Set<string>([
  "system.runtime-binding-governance",
]);

const SHADOW_SOURCE_PREFIX = "assist-shadow:";

export type AuthorizeShadowIntentInput = {
  commandId: string;
  proposalId: string;
  grantId: string;
  principalRef: string;
  trustedTenantId: string | null;
  confirmedByUser: boolean;
  now?: string;
};

export type AuthorizeShadowIntentDenial =
  | "confirm_required"
  | "proposal_missing"
  | "not_discovered"
  | "not_shadow_intent"
  | "observe_only_surface"
  | "unsupported_surface"
  | "grant_missing"
  | "grant_inactive"
  | "cross_tenant"
  | "proposal_expired"
  | "authority_denied"
  | "command_rebind";

export type AuthorizeShadowIntentResult =
  | {
      ok: true;
      proposal: EvolutionProposal;
      alreadyAuthorized: boolean;
      eventId: string;
    }
  | {
      ok: false;
      code: AuthorizeShadowIntentDenial;
      proposal?: EvolutionProposal;
    };

export type ShadowIntentOperatorProjection = {
  observeOnly: boolean;
  nextAction: "authorize" | "request_experiment" | "reject" | "observe" | null;
  nextActionHint: string | null;
};

export function isAssistShadowProposal(proposal: EvolutionProposal): boolean {
  return proposal.sourceMechanismRef.startsWith(SHADOW_SOURCE_PREFIX);
}

export function projectShadowIntentOperatorHints(
  proposal: EvolutionProposal,
): ShadowIntentOperatorProjection {
  if (!isAssistShadowProposal(proposal)) {
    return { observeOnly: false, nextAction: null, nextActionHint: null };
  }
  if (SHADOW_INTENT_OBSERVE_ONLY_SURFACES.has(proposal.surfaceId)) {
    return {
      observeOnly: true,
      nextAction: "observe",
      nextActionHint:
        "observe-only: runtime-binding shadow never auto-Applies; use dedicated governance",
    };
  }
  if (
    proposal.status === "DISCOVERED" &&
    SHADOW_INTENT_AUTHORIZE_SURFACES.has(proposal.surfaceId)
  ) {
    return {
      observeOnly: true,
      nextAction: "authorize",
      nextActionHint: "human authorize via evolution.proposals.authorize (no auto-Apply)",
    };
  }
  if (proposal.status === "APPROVED_FOR_EXPERIMENT" && !proposal.experimentId) {
    return {
      observeOnly: false,
      nextAction: "request_experiment",
      nextActionHint: "request experiment via evolution.experiments.create",
    };
  }
  if (proposal.status === "DISCOVERED") {
    return {
      observeOnly: true,
      nextAction: "observe",
      nextActionHint: "observe-only assist-shadow; surface not eligible for this authorize entry",
    };
  }
  return { observeOnly: false, nextAction: null, nextActionHint: null };
}

/**
 * Deny without leaking proposal body (cross-tenant / rebound / inactive grant).
 * Same-tenant eligibility denials may still attach proposal for operator UX.
 */
function denyAuthorize(
  code: AuthorizeShadowIntentDenial,
  proposal?: EvolutionProposal,
): AuthorizeShadowIntentResult {
  if (
    code === "cross_tenant" ||
    code === "command_rebind" ||
    code === "grant_missing" ||
    code === "grant_inactive"
  ) {
    return { ok: false, code };
  }
  return proposal ? { ok: false, code, proposal } : { ok: false, code };
}

/**
 * commandId ledger binding: tenantScope + principalRef + proposalId + grantId.
 * Rebound any of these → refuse (idempotent success only for the original subject).
 */
function replayBindingDenial(
  existingEvent: {
    proposalId: string;
    tenantScope: string | null;
    principalRef: string;
    grantId: string;
  },
  input: {
    proposalId: string;
    grantId: string;
    principalRef: string;
    trustedTenantId: string | null;
  },
): AuthorizeShadowIntentDenial | null {
  if (existingEvent.proposalId !== input.proposalId) {
    return "command_rebind";
  }
  if (existingEvent.principalRef !== input.principalRef) {
    return "command_rebind";
  }
  if (existingEvent.grantId !== input.grantId) {
    return "command_rebind";
  }
  if (
    input.trustedTenantId != null &&
    existingEvent.tenantScope != null &&
    existingEvent.tenantScope !== input.trustedTenantId
  ) {
    return "cross_tenant";
  }
  return null;
}

type GrantViewWithLifecycle = EvolutionAuthorizationView & {
  expired?: boolean;
  revoked?: boolean;
};

/**
 * Current grant must still be readable/active for idempotent success.
 * Policy: revoked or expired grant → grant_inactive (no replay receipt).
 */
function inspectGrantForAuthorize(
  inspector: EvolutionAuthorizationInspector,
  grantId: string,
  trustedTenantId: string | null,
): AuthorizeShadowIntentDenial | { ok: true; viewed: GrantViewWithLifecycle } {
  const viewed = inspector.inspect(grantId) as GrantViewWithLifecycle | { status: "missing" };
  if (viewed.status === "missing" || !("grantId" in viewed)) {
    return "grant_missing";
  }
  if (viewed.status !== "APPROVED" || viewed.expired || viewed.revoked) {
    return "grant_inactive";
  }
  if (
    trustedTenantId != null &&
    viewed.tenantScope != null &&
    viewed.tenantScope !== trustedTenantId
  ) {
    return "cross_tenant";
  }
  return { ok: true, viewed };
}

/**
 * Authorize a DISCOVERED assist-shadow proposal for experiment (not Apply).
 * Idempotent on commandId **only when** the current trusted tenant/principal/grant
 * still match the original authorization binding and the grant remains active.
 * Reject/fault leaves the proposal unchanged. Denials never leak other-tenant bodies.
 */
export function authorizeShadowIntentProposal(
  plane: EvolutionControlPlane,
  inspector: EvolutionAuthorizationInspector,
  input: AuthorizeShadowIntentInput,
): AuthorizeShadowIntentResult {
  const commandId = input.commandId.trim();
  const proposalId = input.proposalId.trim();
  const grantId = input.grantId.trim();
  const principalRef = input.principalRef.trim();
  if (!input.confirmedByUser) {
    return { ok: false, code: "confirm_required" };
  }
  if (!commandId || !proposalId || !grantId || !principalRef) {
    return { ok: false, code: !grantId ? "grant_missing" : "proposal_missing" };
  }

  const eventId = `led:${commandId}:authorized`;
  const existingEvent = plane.ledger.list().find((row) => row.eventId === eventId);
  if (existingEvent) {
    // Verify current trusted subject can access BEFORE idempotent success.
    // Binding: commandId → tenant + principal + proposal + grant (+ request summary on ledger).
    const bindingDeny = replayBindingDenial(existingEvent, {
      proposalId,
      grantId,
      principalRef,
      trustedTenantId: input.trustedTenantId,
    });
    if (bindingDeny) {
      return denyAuthorize(bindingDeny);
    }

    const existing = plane.getProposal(proposalId);
    if (!existing) {
      return { ok: false, code: "proposal_missing" };
    }
    // Current read permission: caller tenant must still match proposal tenant.
    if (input.trustedTenantId != null && existing.tenantScope !== input.trustedTenantId) {
      return denyAuthorize("cross_tenant");
    }

    // Revoked/expired grant: refuse replay success (explicit fail-closed policy).
    const grantCheck = inspectGrantForAuthorize(inspector, grantId, input.trustedTenantId);
    if (typeof grantCheck === "string") {
      return denyAuthorize(grantCheck);
    }

    return {
      ok: true,
      proposal: existing,
      alreadyAuthorized: true,
      eventId,
    };
  }

  const proposal = plane.getProposal(proposalId);
  if (!proposal) {
    return { ok: false, code: "proposal_missing" };
  }
  if (input.trustedTenantId != null && proposal.tenantScope !== input.trustedTenantId) {
    // Do not attach other-tenant proposal body on cross_tenant denial.
    return denyAuthorize("cross_tenant");
  }
  if (!isAssistShadowProposal(proposal)) {
    return { ok: false, code: "not_shadow_intent", proposal };
  }
  if (SHADOW_INTENT_OBSERVE_ONLY_SURFACES.has(proposal.surfaceId)) {
    return { ok: false, code: "observe_only_surface", proposal };
  }
  if (!SHADOW_INTENT_AUTHORIZE_SURFACES.has(proposal.surfaceId)) {
    return { ok: false, code: "unsupported_surface", proposal };
  }

  // Same-grant already-approved early return: still require current tenant access
  // and an active grant (do not skip grant inspect / tenant check).
  if (proposal.status === "APPROVED_FOR_EXPERIMENT") {
    if (proposal.grantId !== grantId) {
      return denyAuthorize("command_rebind");
    }
    const grantCheck = inspectGrantForAuthorize(inspector, grantId, input.trustedTenantId);
    if (typeof grantCheck === "string") {
      return denyAuthorize(grantCheck);
    }
    const priorEventId =
      plane.ledger
        .list({ proposalId: proposal.proposalId })
        .find((row) => row.type === "proposal.authorized")?.eventId ?? eventId;
    // If a prior auth event exists, principal must match that binding for this commandId path.
    const priorAuth = plane.ledger
      .list({ proposalId: proposal.proposalId })
      .find((row) => row.type === "proposal.authorized");
    if (priorAuth && priorAuth.principalRef !== principalRef) {
      return denyAuthorize("command_rebind");
    }
    return {
      ok: true,
      proposal,
      alreadyAuthorized: true,
      eventId: priorEventId,
    };
  }
  if (proposal.status !== "DISCOVERED") {
    return { ok: false, code: "not_discovered", proposal };
  }

  const now = input.now ?? new Date().toISOString();
  if (Date.parse(proposal.expiresAt) <= Date.parse(now)) {
    return { ok: false, code: "proposal_expired", proposal };
  }

  const grantCheck = inspectGrantForAuthorize(inspector, grantId, input.trustedTenantId);
  if (typeof grantCheck === "string") {
    return denyAuthorize(grantCheck, proposal);
  }
  const viewed = grantCheck.viewed;

  // Shadow sourceEvidenceRefs are system observation markers (shadow:commandId).
  // Human authorize rebinds to the grant's allowedEvidence so experiment/Apply
  // authority checks can proceed without inventing auto-Apply.
  const authorizedEvidence =
    viewed.allowedEvidence.length > 0
      ? [...viewed.allowedEvidence]
      : [`authorized:${proposal.proposalId}`];
  const authority = checkEvolutionAuthority(inspector, {
    surfaceId: proposal.surfaceId,
    grantId,
    tenantScope: proposal.tenantScope,
    trustedTenantId: input.trustedTenantId,
    requestedAction: "experiment",
    evidenceRefs: authorizedEvidence,
    confidentialityScope: proposal.confidentialityScope,
  });
  if (!authority.ok) {
    return { ok: false, code: "authority_denied", proposal };
  }

  const next: EvolutionProposal = {
    ...proposal,
    grantId,
    status: "APPROVED_FOR_EXPERIMENT",
    sourceEvidenceRefs: authorizedEvidence,
  };
  plane.stageDiagnosisProposal(next);
  // Bind commandId → tenant/principal/proposal/grant (+ evidence as request summary).
  plane.ledger.append({
    eventId,
    type: "proposal.authorized",
    timestamp: now,
    proposalId: next.proposalId,
    target: next.target,
    surfaceId: next.surfaceId,
    tenantScope: next.tenantScope,
    principalRef,
    grantId,
    evidenceRefs: next.sourceEvidenceRefs,
  });
  return { ok: true, proposal: next, alreadyAuthorized: false, eventId };
}
