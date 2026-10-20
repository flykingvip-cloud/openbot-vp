/**
 * Map Agent Growth OS recommendation → GuidanceSnapshot (robot scope).
 *
 * Robot CTA decisions MUST come from `resolveNextGrowthAction` — this module
 * only maps that output (plus gaps) into GuidanceSnapshot. No second decisioner.
 */

import {
  resolveNextGrowthAction,
  type GrowthCapabilityGapView,
  type GrowthFunnelFlags,
  type NextGrowthAction,
} from "../agent-growth/next-action.js";
import type { LifecycleState } from "../agent-growth/types.js";
import { buildDegradedGuidanceSnapshot } from "./degrade.js";
import {
  GUIDANCE_NONE_ACTION,
  type GuidanceActionRisk,
  type GuidanceBlocker,
  type GuidanceBlockerKind,
  type GuidanceNextAction,
  type GuidanceSnapshot,
} from "./types.js";

function mapGapKind(kind: GrowthCapabilityGapView["kind"]): GuidanceBlockerKind {
  if (kind === "skill" || kind === "oauth" || kind === "knowledge_binding" || kind === "workflow") {
    return kind;
  }
  return "other";
}

/** Gaps without an installer must not block task send. */
export function gapIsActionable(gap: GrowthCapabilityGapView): boolean {
  if (gap.status === "satisfied") {
    return false;
  }
  return gap.kind === "skill" && gap.status === "missing";
}

export function mapGrowthGapsToBlockers(gaps: GrowthCapabilityGapView[]): GuidanceBlocker[] {
  return gaps
    .filter((gap) => gap.status !== "satisfied")
    .map((gap) => ({
      code: gap.key,
      kind: mapGapKind(gap.kind),
      label: gap.label || gap.key,
      actionable: gapIsActionable(gap),
    }));
}

function riskForGrowthKind(kind: NextGrowthAction["kind"]): GuidanceActionRisk {
  if (kind === "install_capabilities") {
    return "medium";
  }
  return "low";
}

export function mapGrowthActionToGuidanceNextAction(action: NextGrowthAction): GuidanceNextAction {
  if (action.kind === "none") {
    return { ...GUIDANCE_NONE_ACTION, reason: action.reason };
  }
  return {
    kind: action.kind,
    label: `guidance.action.${action.kind}`,
    reason: action.reason,
    canSkip: action.canSkip,
    risk: riskForGrowthKind(action.kind),
    target: {
      module: action.target.module,
      tab: action.target.tab,
      focusComposer: action.target.focusComposer,
      prefill: action.target.prefill,
      recommendedSkillKeys: action.target.recommendedSkillKeys,
      resumePendingTask: action.target.resumePendingTask,
    },
  };
}

export function stageFromGrowthLifecycle(lifecycleState: LifecycleState): string {
  switch (lifecycleState) {
    case "birth":
      return "birth";
    case "growing":
      return "growing";
    case "mission_ready":
      return "mission_ready";
    case "activated":
      return "activated";
    case "evolution":
      return "evolution";
    default:
      return "unknown";
  }
}

/**
 * Preferred entry: calls `resolveNextGrowthAction` then maps to Snapshot.
 * This is the only robot CTA decision path for the orchestrator.
 */
export function buildRobotGuidanceSnapshot(params: {
  agentId: string;
  lifecycleState: LifecycleState;
  funnel: GrowthFunnelFlags;
  capabilityGaps: GrowthCapabilityGapView[];
  taskGaps?: GrowthCapabilityGapView[];
  preferCultivate?: boolean;
  pendingDraftText?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  nowMs?: number;
  degrade?: "no_data" | "analysis_failed" | "permission_denied" | "provider_unavailable";
}): GuidanceSnapshot {
  const recommendation = resolveNextGrowthAction({
    lifecycleState: params.lifecycleState,
    funnel: params.funnel,
    gaps: params.capabilityGaps,
    preferCultivate: params.preferCultivate,
    taskGaps: params.taskGaps,
    pendingDraftText: params.pendingDraftText,
  });
  return buildRobotGuidanceSnapshotFromGrowth({
    agentId: params.agentId,
    lifecycleState: params.lifecycleState,
    recommendation,
    capabilityGaps: params.capabilityGaps,
    taskGaps: params.taskGaps,
    tenantId: params.tenantId,
    userId: params.userId,
    nowMs: params.nowMs,
    degrade: params.degrade,
  });
}

/** Map an already-resolved Growth recommendation (tests / RPC façade). */
export function buildRobotGuidanceSnapshotFromGrowth(params: {
  agentId: string;
  lifecycleState: LifecycleState;
  recommendation: NextGrowthAction;
  capabilityGaps?: GrowthCapabilityGapView[];
  taskGaps?: GrowthCapabilityGapView[];
  tenantId?: string | null;
  userId?: string | null;
  nowMs?: number;
  /** When growth payload itself failed to load. */
  degrade?: "no_data" | "analysis_failed" | "permission_denied" | "provider_unavailable";
}): GuidanceSnapshot {
  const agentId = params.agentId.trim();
  if (!agentId) {
    return buildDegradedGuidanceSnapshot({
      scope: "robot",
      entityId: "unknown",
      reason: "no_data",
      scenario: "robot.onboarding",
      source: "growth",
      tenantId: params.tenantId,
      userId: params.userId,
      nowMs: params.nowMs,
      detail: "guidance.degrade.missing_agent",
    });
  }
  if (params.degrade) {
    return buildDegradedGuidanceSnapshot({
      scope: "robot",
      entityId: agentId,
      reason: params.degrade,
      scenario: "robot.onboarding",
      source: "growth",
      tenantId: params.tenantId,
      userId: params.userId,
      nowMs: params.nowMs,
    });
  }

  const gaps = [...(params.capabilityGaps ?? []), ...(params.taskGaps ?? [])];
  const blockers = mapGrowthGapsToBlockers(gaps);
  const generatedAt = params.nowMs ?? Date.now();

  return {
    scope: "robot",
    scenario: "robot.onboarding",
    confidence: params.recommendation.kind === "none" ? "medium" : "high",
    currentStage: stageFromGrowthLifecycle(params.lifecycleState),
    nextAction: mapGrowthActionToGuidanceNextAction(params.recommendation),
    optionalActions: [],
    blockers,
    degrade: "none",
    tenantId: params.tenantId ?? null,
    userId: params.userId ?? null,
    entityId: agentId,
    source: "growth",
    generatedAt,
  };
}
