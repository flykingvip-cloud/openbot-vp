/**
 * publish-gate.ts — Tip D canPublishLaneAcceptSeal (canPublish* aligned).
 *
 * Kept separate from handoff-bridge / service to avoid circular imports.
 */

import type {
  HandoffKind,
  HandoffStatus,
  ResponsibilityRole,
} from "../collaboration-dispatch/handoff-contract.js";
import type { DeliveryLane, LaneSealKind } from "./types.js";

/** Collaboration RuntimePhase — do not invent alternate phase names. */
export type RuntimePhase = "draft" | "review" | "final";

export const HANDOFF_KINDS_FOR_LANE_SEAL: ReadonlySet<HandoffKind> = new Set([
  "review",
  "evidence",
]);

export const HANDOFF_STATUSES_FOR_LANE_SEAL: ReadonlySet<HandoffStatus> = new Set([
  "receiver_accepted",
  "approved",
  "applied",
]);

export type LanePublishGateResult =
  | { allowed: true; reason: string; sealKind: LaneSealKind; details?: Record<string, unknown> }
  | { allowed: false; reason: string; details?: Record<string, unknown> };

export type HandoffSealSnapshot = {
  handoffId: string;
  kind: HandoffKind;
  status: HandoffStatus;
  fromAgentId: string;
  toAgentId: string;
  toRole?: ResponsibilityRole;
  fromRole?: ResponsibilityRole;
  acceptanceCriteria?: readonly string[];
  completedArtifacts?: readonly string[];
};

export function mapHandoffKindToLaneSealKind(
  kind: HandoffKind,
  toRole?: ResponsibilityRole,
): LaneSealKind | null {
  if (kind === "evidence") {
    return "accept";
  }
  if (kind === "review") {
    if (toRole === "approver" || toRole === "reviewer" || toRole === undefined) {
      return "accept";
    }
    return "review";
  }
  return null;
}

export function runtimePhaseForSealKind(sealKind: LaneSealKind): RuntimePhase {
  if (sealKind === "implement") {
    return "draft";
  }
  if (sealKind === "review") {
    return "review";
  }
  return "final";
}

/**
 * Tip D gate: can an external issuer publish accept/review seal onto this lane?
 * Shape mirrors collaboration-runtime canPublishDeliverable / canPublishFinalDecision.
 */
function idsOverlap(a: string | undefined, b: string | undefined): boolean {
  const x = a?.trim();
  const y = b?.trim();
  return Boolean(x && y && x === y);
}

/** Tip A same-origin: agentId===owner OR botId===owner. */
export function isSameOriginIssuer(params: {
  laneOwnerAgentId?: string;
  issuerAgentId?: string;
  issuerBotId?: string;
}): boolean {
  const owner = params.laneOwnerAgentId?.trim();
  if (!owner) {
    return false;
  }
  return idsOverlap(params.issuerAgentId, owner) || idsOverlap(params.issuerBotId, owner);
}

/** Self-sign: accept issuer identities overlap implement issuer identities. */
export function isSelfSignAcceptVsImplement(params: {
  acceptAgentId?: string;
  acceptBotId?: string;
  implementAgentId?: string;
  implementBotId?: string;
}): boolean {
  const acceptIds = [params.acceptAgentId?.trim(), params.acceptBotId?.trim()].filter(Boolean);
  const implIds = [params.implementAgentId?.trim(), params.implementBotId?.trim()].filter(Boolean);
  for (const a of acceptIds) {
    for (const i of implIds) {
      if (a === i) {
        return true;
      }
    }
  }
  return false;
}

export function canPublishLaneAcceptSeal(params: {
  path1CrossBotEnabled: boolean;
  source: "direct" | "handoff";
  laneOwnerAgentId?: string;
  issuerAgentId: string;
  /** Tip A: botId===lane.agentId also counts as same-origin. */
  issuerBotId?: string;
  /** Tip E: personal_subagent cannot issue acceptSeal. */
  issuerKind?: string;
  /** When true (default for accept seals), refuse personal_subagent issuer. */
  refusePersonalSubagentAccept?: boolean;
  implementIssuerAgentId?: string;
  implementIssuerBotId?: string;
  handoff?: Pick<HandoffSealSnapshot, "kind" | "status" | "toRole" | "fromAgentId" | "toAgentId">;
}): LanePublishGateResult {
  const issuer = params.issuerAgentId.trim();
  if (!issuer) {
    return { allowed: false, reason: "missing_issuer", details: {} };
  }

  // Tip E: 分身不可自签验收 — personal_subagent cannot publish acceptSeal.
  if (
    params.refusePersonalSubagentAccept !== false &&
    params.issuerKind?.trim() === "personal_subagent"
  ) {
    return {
      allowed: false,
      reason: "personal_subagent_cannot_accept_seal",
      details: {
        issuer,
        issuerKind: "personal_subagent",
        hint: "helpers are not independent accept authorities",
      },
    };
  }

  let sealKind: LaneSealKind = "accept";

  if (params.source === "handoff") {
    if (!params.path1CrossBotEnabled) {
      return {
        allowed: false,
        reason: "path1_required_for_handoff_bridge",
        details: {
          hint: "enable gateway.deliveryLane.path1CrossBot / OPENBOT_DELIVERY_LANE_PATH1",
        },
      };
    }
    const handoff = params.handoff;
    if (!handoff) {
      return { allowed: false, reason: "missing_handoff_snapshot" };
    }
    if (!HANDOFF_KINDS_FOR_LANE_SEAL.has(handoff.kind)) {
      return {
        allowed: false,
        reason: "unsupported_handoff_kind",
        details: { kind: handoff.kind, allowed: [...HANDOFF_KINDS_FOR_LANE_SEAL] },
      };
    }
    if (!HANDOFF_STATUSES_FOR_LANE_SEAL.has(handoff.status)) {
      return {
        allowed: false,
        reason: "handoff_status_not_ready",
        details: { status: handoff.status, required: [...HANDOFF_STATUSES_FOR_LANE_SEAL] },
      };
    }
    const mapped = mapHandoffKindToLaneSealKind(handoff.kind, handoff.toRole);
    if (!mapped) {
      return { allowed: false, reason: "handoff_kind_not_mappable" };
    }
    sealKind = mapped;
  }

  if (params.path1CrossBotEnabled) {
    const owner = params.laneOwnerAgentId?.trim();
    if (!owner) {
      return {
        allowed: false,
        reason: "path1_lane_owner_required",
        details: { hint: "lane.agentId required to prove cross-bot" },
      };
    }
    if (
      isSameOriginIssuer({
        laneOwnerAgentId: owner,
        issuerAgentId: issuer,
        issuerBotId: params.issuerBotId,
      })
    ) {
      return {
        allowed: false,
        reason: "path1_same_origin_refused",
        details: {
          issuer,
          issuerBotId: params.issuerBotId?.trim() || undefined,
          owner,
        },
      };
    }
    if (
      isSelfSignAcceptVsImplement({
        acceptAgentId: issuer,
        acceptBotId: params.issuerBotId,
        implementAgentId: params.implementIssuerAgentId,
        implementBotId: params.implementIssuerBotId,
      })
    ) {
      return {
        allowed: false,
        reason: "path1_self_sign_refused",
        details: {
          issuer,
          issuerBotId: params.issuerBotId?.trim() || undefined,
          implementIssuer: params.implementIssuerAgentId?.trim() || undefined,
          implementIssuerBotId: params.implementIssuerBotId?.trim() || undefined,
        },
      };
    }
  }

  return {
    allowed: true,
    reason: params.source === "handoff" ? "handoff_bridge_authority_verified" : "direct_accept_ok",
    sealKind,
    details: {
      runtimePhase: runtimePhaseForSealKind(sealKind),
      path1: params.path1CrossBotEnabled,
    },
  };
}

/**
 * Order-independent path-1 re-check for dual seals (accept↔implement).
 * Call from requestMergeReady / requestMerge so accept→implement self-sign cannot merge.
 */
export function assertPath1DualSealAuthority(lane: DeliveryLane): LanePublishGateResult {
  if (!lane.path1CrossBotEnabled) {
    return {
      allowed: true,
      reason: "path1_off",
      sealKind: "accept",
      details: { path1: false },
    };
  }
  const accept = lane.acceptSeal;
  const impl = lane.implementSeal;
  if (!accept || accept.invalidatedAt || !impl || impl.invalidatedAt) {
    // Missing seals handled elsewhere (computeMissingKeys); no extra path1 refuse here.
    return {
      allowed: true,
      reason: "path1_seals_incomplete_deferred",
      sealKind: "accept",
      details: { path1: true },
    };
  }
  return canPublishLaneAcceptSeal({
    path1CrossBotEnabled: true,
    source: "direct",
    laneOwnerAgentId: lane.agentId,
    issuerAgentId: accept.issuer.agentId,
    issuerBotId: accept.issuer.botId,
    issuerKind: accept.issuer.kind,
    implementIssuerAgentId: impl.issuer.agentId,
    implementIssuerBotId: impl.issuer.botId,
  });
}
