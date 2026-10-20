/**
 * Map Daibai guide snapshot signals → GuidanceSnapshot (user scope).
 * Limited personalization: capability / workspace signals only (SoT §1.5).
 */

import { buildDegradedGuidanceSnapshot } from "./degrade.js";
import { GUIDANCE_NONE_ACTION, type GuidanceNextAction, type GuidanceSnapshot } from "./types.js";

export type DaibaiGuideSignalInput = {
  /** True when the steward onboarding guide has not been acknowledged. */
  needsOnboardingGuide?: boolean;
  /** Capability or workspace hint keys already ranked by daibai-guide. */
  suggestedActionKinds?: string[];
  primaryLabel?: string;
  primaryReason?: string;
  canSkip?: boolean;
};

export function buildUserGuidanceSnapshotFromDaibai(params: {
  userId: string;
  tenantId?: string | null;
  signal?: DaibaiGuideSignalInput | null;
  nowMs?: number;
  degrade?: "no_data" | "analysis_failed" | "permission_denied" | "provider_unavailable";
}): GuidanceSnapshot {
  const userId = params.userId.trim();
  if (!userId) {
    return buildDegradedGuidanceSnapshot({
      scope: "user",
      entityId: "unknown",
      reason: "no_data",
      scenario: "user.steward_guide",
      source: "daibai",
      tenantId: params.tenantId,
      nowMs: params.nowMs,
      detail: "guidance.degrade.missing_user",
    });
  }
  if (params.degrade) {
    return buildDegradedGuidanceSnapshot({
      scope: "user",
      entityId: userId,
      reason: params.degrade,
      scenario: "user.steward_guide",
      source: "daibai",
      tenantId: params.tenantId,
      userId,
      nowMs: params.nowMs,
    });
  }

  const signal = params.signal ?? {};
  const generatedAt = params.nowMs ?? Date.now();
  let nextAction: GuidanceNextAction = { ...GUIDANCE_NONE_ACTION };

  if (signal.needsOnboardingGuide) {
    nextAction = {
      kind: "start_steward_guide",
      label: signal.primaryLabel?.trim() || "guidance.action.start_steward_guide",
      reason: signal.primaryReason?.trim() || "guidance.recommend.steward_onboarding",
      canSkip: signal.canSkip !== false,
      risk: "low",
      target: { focusComposer: true },
    };
  } else {
    const kind = signal.suggestedActionKinds?.find((item) => item.trim())?.trim();
    if (kind) {
      nextAction = {
        kind,
        label: signal.primaryLabel?.trim() || `guidance.action.${kind}`,
        reason: signal.primaryReason?.trim() || "guidance.recommend.daibai_signal",
        canSkip: signal.canSkip !== false,
        risk: "low",
      };
    }
  }

  return {
    scope: "user",
    scenario: signal.needsOnboardingGuide ? "user.steward_onboarding" : "user.steward_guide",
    confidence: nextAction.kind === "none" ? "low" : "medium",
    currentStage: signal.needsOnboardingGuide ? "first_guide" : "idle",
    nextAction,
    optionalActions: [],
    blockers: [],
    degrade: "none",
    tenantId: params.tenantId ?? null,
    userId,
    entityId: userId,
    source: "daibai",
    generatedAt,
  };
}
