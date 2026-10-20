import {
  evaluateAuthorityGate,
  type AuthorityGateDecision,
  type AuthorityGrantView,
} from "@openbot/evolution-core";
import type {
  EvolutionAuthorizationInspector,
  EvolutionAuthorizationView,
} from "../../diagnosis/evolution-proposal.js";
import {
  evaluateCapabilityGapSystemGrantAction,
  isCapabilityGapSystemGrantId,
  type CapabilityGapExpireProposalView,
} from "./capability-gap-grant.js";
import { resolveEvolutionSurface } from "./surface-registry.js";

export type EvolutionAuthorityRequest = {
  surfaceId: string;
  grantId: string;
  tenantScope: string | null;
  trustedTenantId: string | null;
  requestedAction: string;
  evidenceRefs: readonly string[];
  confidentialityScope: "personal" | "enterprise" | "platform";
  expandScope?: boolean;
  /** Required for capability-gap system-grant expire; ignored otherwise. */
  proposal?: CapabilityGapExpireProposalView | null;
  nowMs?: number;
};

function toGrantView(
  viewed: EvolutionAuthorizationView | { status: "missing" },
): AuthorityGrantView | { status: "missing" } {
  if (viewed.status === "missing" || !("grantId" in viewed)) {
    return { status: "missing" };
  }
  return {
    grantId: viewed.grantId,
    status: viewed.status,
    tenantScope: viewed.tenantScope,
    allowedEvidence: viewed.allowedEvidence,
    allowedActions: viewed.allowedActions,
    confidentialityCeiling: viewed.confidentialityCeiling,
    ...(viewed.targetPrincipal ? { targetPrincipal: viewed.targetPrincipal } : {}),
    expired: viewed.status === "EXPIRED",
    revoked: viewed.status === "REVOKED",
  };
}

/**
 * Authority gate with capability-gap system-grant constraints:
 * suggest ok; expire only for stale DISCOVERED capability-gap proposals;
 * reject/hold/promote always refused for that grant.
 */
export function checkEvolutionAuthority(
  inspector: EvolutionAuthorizationInspector,
  request: EvolutionAuthorityRequest,
): AuthorityGateDecision {
  if (isCapabilityGapSystemGrantId(request.grantId)) {
    const restricted = evaluateCapabilityGapSystemGrantAction({
      grantId: request.grantId,
      requestedAction: request.requestedAction,
      proposal: request.proposal,
      nowMs: request.nowMs,
    });
    if (!restricted.ok) {
      return { ok: false, code: restricted.code, reason: restricted.reason };
    }
  }
  return evaluateAuthorityGate({
    surface: resolveEvolutionSurface(request.surfaceId),
    grant: toGrantView(inspector.inspect(request.grantId)),
    tenantScope: request.tenantScope,
    trustedTenantId: request.trustedTenantId,
    requestedAction: request.requestedAction,
    evidenceRefs: request.evidenceRefs,
    confidentialityScope: request.confidentialityScope,
    expandScope: Boolean(request.expandScope),
  });
}
