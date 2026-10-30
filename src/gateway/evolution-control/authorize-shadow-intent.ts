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
 * Authorize a DISCOVERED assist-shadow proposal for experiment (not Apply).
 * Idempotent on commandId. Reject/fault leaves the proposal unchanged.
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
    if (existingEvent.proposalId !== proposalId) {
      return { ok: false, code: "command_rebind" };
    }
    const existing = plane.getProposal(proposalId);
    if (!existing) {
      return { ok: false, code: "proposal_missing" };
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
    return { ok: false, code: "cross_tenant", proposal };
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
  if (proposal.status === "APPROVED_FOR_EXPERIMENT" && proposal.grantId === grantId) {
    return {
      ok: true,
      proposal,
      alreadyAuthorized: true,
      eventId:
        plane.ledger
          .list({ proposalId: proposal.proposalId })
          .find((row) => row.type === "proposal.authorized")?.eventId ?? eventId,
    };
  }
  if (proposal.status !== "DISCOVERED") {
    return { ok: false, code: "not_discovered", proposal };
  }

  const now = input.now ?? new Date().toISOString();
  if (Date.parse(proposal.expiresAt) <= Date.parse(now)) {
    return { ok: false, code: "proposal_expired", proposal };
  }

  const viewed = inspector.inspect(grantId);
  if (viewed.status === "missing" || !("grantId" in viewed)) {
    return { ok: false, code: "grant_missing", proposal };
  }
  if (viewed.status !== "APPROVED" || viewed.expired || viewed.revoked) {
    return { ok: false, code: "grant_inactive", proposal };
  }
  if (
    input.trustedTenantId != null &&
    viewed.tenantScope != null &&
    viewed.tenantScope !== input.trustedTenantId
  ) {
    return { ok: false, code: "cross_tenant", proposal };
  }

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
