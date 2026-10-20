/**
 * Map employee-surface signals → UiGuidanceSnapshot for orchestrated CTA.
 * Does not re-decide Growth nextAction kinds — callers pass resolved recommendation.
 */

import type { NextGrowthActionView } from "../../../controllers/agent-growth.ts";
import type { UiGuidanceNextAction, UiGuidanceSnapshot } from "./orchestrate-surface.ts";
import { GUIDANCE_CONTENT_VERSION } from "./ui-control-state.ts";

function mapGrowthRisk(kind: string): UiGuidanceNextAction["risk"] {
  if (kind === "install_capabilities") {
    return "medium";
  }
  if (kind === "confirm_high_risk" || kind === "revoke_access") {
    return "high";
  }
  return "low";
}

function labelForGrowthKind(kind: string): string {
  switch (kind) {
    case "start_work":
      return "开始工作";
    case "confirm_identity":
      return "确认身份";
    case "install_capabilities":
      return "安装能力";
    case "verify_with_task":
      return "用任务验证";
    case "start_steward_guide":
      return "开始引导";
    default:
      return kind === "none" ? "无下一步" : kind;
  }
}

export function growthRecommendationToNextAction(
  recommendation: NextGrowthActionView,
): UiGuidanceNextAction {
  return {
    kind: recommendation.kind,
    label: labelForGrowthKind(recommendation.kind),
    reason: recommendation.reason,
    canSkip: recommendation.canSkip,
    risk: mapGrowthRisk(recommendation.kind),
    target: {
      module: recommendation.target.module,
      tab: recommendation.target.tab,
      focusComposer: recommendation.target.focusComposer,
      prefill: recommendation.target.prefill,
      recommendedSkillKeys: recommendation.target.recommendedSkillKeys,
      resumePendingTask: recommendation.target.resumePendingTask,
    },
  };
}

export function buildRobotUiSnapshotFromGrowth(params: {
  entityId: string;
  lifecycleState: string;
  recommendation: NextGrowthActionView;
  optionalActions?: UiGuidanceNextAction[];
  tenantId?: string | null;
  userId?: string | null;
  generatedAt?: number;
  degrade?: UiGuidanceSnapshot["degrade"];
}): UiGuidanceSnapshot {
  const nextAction = growthRecommendationToNextAction(params.recommendation);
  return {
    scope: "robot",
    scenario: `robot.${params.lifecycleState}`,
    confidence: "high",
    currentStage: params.lifecycleState,
    nextAction,
    optionalActions: params.optionalActions ?? [],
    blockers: [],
    degrade: params.degrade ?? (nextAction.kind === "none" ? "no_data" : "none"),
    tenantId: params.tenantId ?? null,
    userId: params.userId ?? null,
    entityId: params.entityId,
    source: "growth",
    generatedAt: params.generatedAt ?? Date.now(),
    contentVersion: GUIDANCE_CONTENT_VERSION,
  };
}

export function buildUserUiSnapshotFromDaibai(params: {
  userId: string;
  needsOnboardingGuide: boolean;
  tenantId?: string | null;
  stewardSuggestion?: UiGuidanceNextAction | null;
  generatedAt?: number;
}): UiGuidanceSnapshot {
  const optionalActions: UiGuidanceNextAction[] = [];
  if (params.stewardSuggestion) {
    optionalActions.push({
      ...params.stewardSuggestion,
      risk: params.stewardSuggestion.risk ?? "low",
    });
  }
  const nextAction: UiGuidanceNextAction = params.needsOnboardingGuide
    ? {
        kind: "start_steward_guide",
        label: "开始引导",
        reason: "guidance.recommend.steward_onboarding",
        canSkip: true,
        risk: "low",
        target: { focusComposer: true },
      }
    : {
        kind: "none",
        label: "无下一步",
        reason: "guidance.none",
        canSkip: true,
        risk: "low",
      };
  return {
    scope: "user",
    scenario: params.needsOnboardingGuide ? "user.steward_onboarding" : "user.steward_guide",
    confidence: "high",
    currentStage: params.needsOnboardingGuide ? "onboarding" : "idle",
    nextAction,
    optionalActions,
    blockers: [],
    degrade: nextAction.kind === "none" && optionalActions.length === 0 ? "no_data" : "none",
    tenantId: params.tenantId ?? null,
    userId: params.userId,
    entityId: params.userId,
    source: "daibai",
    generatedAt: params.generatedAt ?? Date.now(),
    contentVersion: GUIDANCE_CONTENT_VERSION,
  };
}

export function buildTeamUiSnapshot(params: {
  entityId: string;
  hasStaleMission: boolean;
  tenantId?: string | null;
  userId?: string | null;
  generatedAt?: number;
}): UiGuidanceSnapshot {
  const nextAction: UiGuidanceNextAction = params.hasStaleMission
    ? {
        kind: "advance_team_mission",
        label: "升级群使命",
        reason: "guidance.recommend.team_stale_mission",
        canSkip: true,
        risk: "medium",
        target: { module: "collaboration" },
      }
    : {
        kind: "none",
        label: "无下一步",
        reason: "guidance.none",
        canSkip: true,
        risk: "low",
      };
  return {
    scope: "team",
    scenario: "team.stale_mission",
    confidence: params.hasStaleMission ? "medium" : "low",
    currentStage: params.hasStaleMission ? "stale_mission" : "idle",
    nextAction,
    optionalActions: [],
    blockers: [],
    degrade: nextAction.kind === "none" ? "no_data" : "none",
    tenantId: params.tenantId ?? null,
    userId: params.userId ?? null,
    entityId: params.entityId,
    source: "team",
    generatedAt: params.generatedAt ?? Date.now(),
    contentVersion: GUIDANCE_CONTENT_VERSION,
  };
}

/** Steward suggestions are optional-only — never promoted to nextAction here. */
export function stewardSuggestionAsOptional(params: {
  kind: string;
  label: string;
  reason?: string;
}): UiGuidanceNextAction {
  return {
    kind: params.kind,
    label: params.label,
    reason: params.reason ?? "guidance.optional.steward_suggestion",
    canSkip: true,
    risk: "low",
  };
}
