/**
 * projection.ts — build Supervisor-facing LaneProjection pointer (Tip A).
 */

import type { DeliveryLane, LaneProjection, LaneSeal } from "./types.js";

function sealActive(seal: LaneSeal | undefined): seal is LaneSeal {
  return Boolean(seal && !seal.invalidatedAt);
}

/** Keys still required before merge_ready can be granted. */
export function computeMissingKeys(lane: DeliveryLane): string[] {
  const missing: string[] = [];
  if (!sealActive(lane.implementSeal)) {
    missing.push("implementSeal");
  }
  if (!sealActive(lane.acceptSeal)) {
    missing.push("acceptSeal");
  }
  const tip = lane.tipSha?.trim();
  const head = lane.headSha?.trim() || tip;
  if (sealActive(lane.implementSeal) && sealActive(lane.acceptSeal)) {
    const implSha = lane.implementSeal.tipSha.trim();
    const acceptSha = lane.acceptSeal.tipSha.trim();
    if (!tip || implSha !== tip || acceptSha !== tip || (head && implSha !== head)) {
      missing.push("match-head");
    }
  } else if (tip && head && tip !== head) {
    missing.push("match-head");
  }
  return missing;
}

export function buildLaneProjection(lane: DeliveryLane, focusSummary?: string): LaneProjection {
  const accept = sealActive(lane.acceptSeal) ? lane.acceptSeal : undefined;
  return {
    laneId: lane.laneId,
    stage: lane.stage,
    tipSha: lane.tipSha,
    headSha: lane.headSha,
    prNumber: lane.prNumber,
    missingKeys: computeMissingKeys(lane),
    ...(focusSummary !== undefined ? { focusSummary } : {}),
    ...(accept
      ? {
          acceptSealStrength: accept.strength,
          acceptSealWeak: accept.strength === "weak",
        }
      : {}),
  };
}

export function buildFocusSummary(lane: DeliveryLane): string {
  const missing = computeMissingKeys(lane);
  const tip = lane.tipSha?.slice(0, 12) ?? "（未绑定 tipSha）";
  const keys = missing.length === 0 ? "双钥齐全且 match-head" : `缺：${missing.join("、")}`;
  const weak =
    sealActive(lane.acceptSeal) && lane.acceptSeal.strength === "weak"
      ? "；acceptSeal=weak（单机）"
      : "";
  return `【交付看板·回顾】stage=${lane.stage} tip=${tip}；${keys}${weak}。≠对话焦点看板。`;
}
