/**
 * Floor Runtime v2.1 §5.8 P2-A — Shadow-A plan.
 * Composes L0, L1, and Admission. Pure and synchronous.
 * Attaches onto a decision only when collaboration.floor.shadowStage is "A" or "B".
 * Stage B uses the same pure plan and does not apply model bids.
 * Flag-off returns the same decision object. P0 G1 seals speaker fields so the
 * attachment cannot replace G8 participant lists.
 */
import { admit, type AdmissionResult } from "./admission.js";
import type { CollaborationIntentKind } from "./episode-intent.js";
import { assertFloorShadowDidNotReplaceSpeakers } from "./floor-live-cutover.js";
import {
  routeL0,
  type FloorRouterInput,
  type L0ExcludeReason,
  type L0Reason,
} from "./router-l0.js";
import { routeL1 } from "./router-l1.js";
import type { RuntimeAuthority, RuntimeFacts } from "./runtime-authority.js";
import { isCollabFloorShadowStageA, isCollabFloorShadowStageB } from "./shadow-stage-flag.js";
import type { ParticipationDecision } from "./types.js";

export type FloorShadowAttachment = {
  stage: "A" | "B";
  elapsedMs: number;
  episodeId: string;
  intent: CollaborationIntentKind;
  policyHash: string;
  l0: {
    rollCall: boolean;
    mustAdmit: Array<{ agentId: string; reason: L0Reason }>;
    excluded: Array<{ agentId: string; reason: L0ExcludeReason }>;
  };
  l1: {
    clear: Array<{ agentId: string; capabilityFit: number }>;
    ambiguous: Array<{ agentId: string; capabilityFit: number }>;
  };
  admission: Pick<AdmissionResult, "admitted" | "rejected" | "fuseTripped"> & {
    admittedCount: number;
  };
};

export type FloorLegacyCompare = {
  stage: "A" | "B";
  legacyAdmitted: string[];
  floorAdmitted: string[];
  onlyLegacy: string[];
  onlyFloor: string[];
  overlap: string[];
  /** |Need ∩ floorAdmitted| / |Need|. Null when Need is empty (not in Coverage). */
  eligibilityCoverage: number | null;
};

function uniqueIds(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const id = value.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}

export function compareLegacyFloorAdmission(params: {
  legacyAdmitted: readonly string[];
  floorAdmitted: readonly string[];
  needAgentIds: readonly string[];
  stage?: "A" | "B";
}): FloorLegacyCompare {
  const legacyAdmitted = uniqueIds(params.legacyAdmitted);
  const floorAdmitted = uniqueIds(params.floorAdmitted);
  const floorSet = new Set(floorAdmitted);
  const legacySet = new Set(legacyAdmitted);
  const need = uniqueIds(params.needAgentIds);
  const hit = need.filter((id) => floorSet.has(id)).length;
  return {
    stage: params.stage ?? "A",
    legacyAdmitted,
    floorAdmitted,
    overlap: legacyAdmitted.filter((id) => floorSet.has(id)),
    onlyLegacy: legacyAdmitted.filter((id) => !floorSet.has(id)),
    onlyFloor: floorAdmitted.filter((id) => !legacySet.has(id)),
    eligibilityCoverage: need.length === 0 ? null : hit / need.length,
  };
}

export function computeFloorShadowA(
  authority: RuntimeAuthority,
  facts: RuntimeFacts,
  input: FloorRouterInput,
): FloorShadowAttachment {
  const started = performance.now();
  const l0 = routeL0(authority, facts, input);
  const l1 = routeL1(authority, facts, l0, input);
  const admission = admit(authority, l0, l1);
  const elapsedMs = Math.round((performance.now() - started) * 1000) / 1000;
  return {
    stage: "A",
    elapsedMs,
    episodeId: authority.episodeId,
    intent: l0.intent,
    policyHash: authority.policy.policyHash,
    l0: {
      rollCall: l0.rollCall,
      mustAdmit: l0.mustAdmit.map((member) => ({ ...member })),
      excluded: l0.excluded.map((row) => ({ ...row })),
    },
    l1: {
      clear: l1.clear.map((row) => ({ agentId: row.agentId, capabilityFit: row.capabilityFit })),
      ambiguous: l1.ambiguous.map((row) => ({
        agentId: row.agentId,
        capabilityFit: row.capabilityFit,
      })),
    },
    admission: {
      admitted: admission.admitted,
      rejected: admission.rejected,
      fuseTripped: admission.fuseTripped,
      admittedCount: admission.admitted.length,
    },
  };
}

/**
 * Shadow-B attachment. Same L0/L1/Admission as Shadow-A, with no bids applied.
 * Flag-off or a throw keeps the original decision object.
 */
export function attachFloorShadowB(
  authority: RuntimeAuthority,
  facts: RuntimeFacts,
  input: FloorRouterInput,
  decision: ParticipationDecision,
): ParticipationDecision {
  if (!isCollabFloorShadowStageB()) {
    return decision;
  }
  let attached: ParticipationDecision;
  try {
    const shadow = computeFloorShadowA(authority, facts, input);
    attached = { ...decision, floorShadow: { ...shadow, stage: "B" } };
  } catch {
    return decision;
  }
  return assertFloorShadowDidNotReplaceSpeakers(decision, attached);
}

/** A, then B, otherwise the same decision object. */
export function attachFloorShadow(
  authority: RuntimeAuthority,
  facts: RuntimeFacts,
  input: FloorRouterInput,
  decision: ParticipationDecision,
): ParticipationDecision {
  if (isCollabFloorShadowStageB()) {
    return attachFloorShadowB(authority, facts, input, decision);
  }
  return attachFloorShadowA(authority, facts, input, decision);
}

/** Flag-off: same object. Flag-on: copy with floorShadow. A throw keeps the original. */
export function attachFloorShadowA(
  authority: RuntimeAuthority,
  facts: RuntimeFacts,
  input: FloorRouterInput,
  decision: ParticipationDecision,
): ParticipationDecision {
  if (!isCollabFloorShadowStageA()) {
    return decision;
  }
  let attached: ParticipationDecision;
  try {
    attached = { ...decision, floorShadow: computeFloorShadowA(authority, facts, input) };
  } catch {
    return decision;
  }
  return assertFloorShadowDidNotReplaceSpeakers(decision, attached);
}
