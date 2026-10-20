/**
 * handoff-bridge.ts — Tip D sealLaneFromHandoff (HandoffContract snapshot → LaneSeal).
 *
 * collaboration.task.handoffContract remains default false (collab writes unchanged).
 * Cross-bot path requires explicit path1 on the lane.
 */

import {
  canPublishLaneAcceptSeal,
  runtimePhaseForSealKind,
  type HandoffSealSnapshot,
  type LanePublishGateResult,
} from "./publish-gate.js";
import { DeliveryLaneError, sealLane, type SealLaneInput } from "./service.js";
import { getLane } from "./store.js";
import type {
  DeliveryLane,
  EvidencePackage,
  LaneProjection,
  LaneSealKind,
  LaneSealVerdict,
} from "./types.js";

export {
  assertPath1DualSealAuthority,
  canPublishLaneAcceptSeal,
  HANDOFF_KINDS_FOR_LANE_SEAL,
  HANDOFF_STATUSES_FOR_LANE_SEAL,
  isSameOriginIssuer,
  isSelfSignAcceptVsImplement,
  mapHandoffKindToLaneSealKind,
  runtimePhaseForSealKind,
  type HandoffSealSnapshot,
  type LanePublishGateResult,
  type RuntimePhase,
} from "./publish-gate.js";

export type SealLaneFromHandoffInput = {
  laneId: string;
  handoff: HandoffSealSnapshot;
  tipSha: string;
  verdict?: LaneSealVerdict;
  headSha?: string;
  storeDir?: string;
  supervisorStoreDir?: string;
  evidence?: EvidencePackage;
};

function buildHandoffEvidence(
  handoff: HandoffSealSnapshot,
  sealKind: LaneSealKind,
  extra?: EvidencePackage,
): EvidencePackage {
  const phase = runtimePhaseForSealKind(sealKind);
  const refs: Array<{ type: string; value: string }> = [
    { type: "handoffId", value: handoff.handoffId },
    { type: "handoffKind", value: handoff.kind },
    { type: "handoffStatus", value: handoff.status },
    { type: "runtimePhase", value: phase },
    ...(handoff.completedArtifacts ?? []).map((a) => ({ type: "artifact", value: a })),
    ...(extra?.refs ?? []),
  ];
  return {
    kind: extra?.kind ?? "handoff-seal",
    refs,
    ...(extra?.hashes ? { hashes: extra.hashes } : {}),
    ...(extra?.notes || handoff.acceptanceCriteria?.length
      ? {
          notes:
            extra?.notes ?? `acceptanceCriteria=${(handoff.acceptanceCriteria ?? []).join(",")}`,
        }
      : {}),
  };
}

/**
 * Import handoff kind=review|evidence as LaneSeal (typically acceptSeal).
 */
export async function sealLaneFromHandoff(input: SealLaneFromHandoffInput): Promise<{
  lane: DeliveryLane;
  projection: LaneProjection;
  gate: Extract<LanePublishGateResult, { allowed: true }>;
}> {
  const tipSha = input.tipSha.trim();
  if (!tipSha) {
    throw new DeliveryLaneError("tipSha is required");
  }
  const lane = await getLane(input.laneId, input.storeDir);
  if (!lane) {
    throw new DeliveryLaneError(`delivery lane "${input.laneId}" not found`, "NOT_FOUND");
  }

  const issuerAgentId = input.handoff.toAgentId.trim();
  const gate = canPublishLaneAcceptSeal({
    path1CrossBotEnabled: lane.path1CrossBotEnabled,
    source: "handoff",
    laneOwnerAgentId: lane.agentId,
    issuerAgentId,
    implementIssuerAgentId: lane.implementSeal?.issuer.agentId,
    handoff: input.handoff,
  });
  if (!gate.allowed) {
    throw new DeliveryLaneError(`handoff→seal refused: ${gate.reason}`, "REFUSED");
  }

  const sealInput: SealLaneInput = {
    laneId: input.laneId,
    kind: gate.sealKind,
    verdict: input.verdict ?? "PASS",
    tipSha,
    headSha: input.headSha,
    issuer: {
      agentId: issuerAgentId,
      botId: issuerAgentId,
      mode: gate.sealKind === "accept" ? "accept" : "review",
    },
    evidence: buildHandoffEvidence(input.handoff, gate.sealKind, input.evidence),
    storeDir: input.storeDir,
    supervisorStoreDir: input.supervisorStoreDir,
  };

  const result = await sealLane(sealInput);
  return { ...result, gate };
}
