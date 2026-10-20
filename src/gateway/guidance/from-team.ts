/**
 * Team-scope guidance adapter (P0: runtime hints only — not an onboarding coach).
 */

import { buildDegradedGuidanceSnapshot } from "./degrade.js";
import { GUIDANCE_NONE_ACTION, type GuidanceSnapshot } from "./types.js";

export type TeamGuidanceSignalInput = {
  /** Collaboration mission still in introductory / onboarding phase. */
  missionStale?: boolean;
  spaceLabel?: string;
};

export function buildTeamGuidanceSnapshot(params: {
  spaceId: string;
  tenantId?: string | null;
  userId?: string | null;
  signal?: TeamGuidanceSignalInput | null;
  nowMs?: number;
  degrade?: "no_data" | "analysis_failed" | "permission_denied" | "provider_unavailable";
}): GuidanceSnapshot {
  const spaceId = params.spaceId.trim();
  if (!spaceId) {
    return buildDegradedGuidanceSnapshot({
      scope: "team",
      entityId: "unknown",
      reason: "no_data",
      scenario: "team.collaboration",
      source: "collaboration",
      tenantId: params.tenantId,
      userId: params.userId,
      nowMs: params.nowMs,
      detail: "guidance.degrade.missing_space",
    });
  }
  if (params.degrade) {
    return buildDegradedGuidanceSnapshot({
      scope: "team",
      entityId: spaceId,
      reason: params.degrade,
      scenario: "team.collaboration",
      source: "collaboration",
      tenantId: params.tenantId,
      userId: params.userId,
      nowMs: params.nowMs,
    });
  }

  const signal = params.signal ?? {};
  const generatedAt = params.nowMs ?? Date.now();
  if (signal.missionStale) {
    return {
      scope: "team",
      scenario: "team.mission_stale",
      confidence: "medium",
      currentStage: "mission_stale",
      nextAction: {
        kind: "upgrade_mission",
        label: "guidance.action.upgrade_mission",
        reason: "guidance.recommend.upgrade_mission",
        canSkip: true,
        risk: "low",
        target: {
          module: "collaboration",
          deepLink: `space:${spaceId}`,
        },
      },
      optionalActions: [],
      blockers: [],
      degrade: "none",
      tenantId: params.tenantId ?? null,
      userId: params.userId ?? null,
      entityId: spaceId,
      source: "collaboration",
      generatedAt,
    };
  }

  return {
    scope: "team",
    scenario: "team.collaboration",
    confidence: "low",
    currentStage: "idle",
    nextAction: { ...GUIDANCE_NONE_ACTION },
    optionalActions: [],
    blockers: [],
    degrade: "none",
    tenantId: params.tenantId ?? null,
    userId: params.userId ?? null,
    entityId: spaceId,
    source: "collaboration",
    generatedAt,
  };
}
