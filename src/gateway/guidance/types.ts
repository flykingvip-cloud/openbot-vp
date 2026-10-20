/**
 * Guidance Orchestrator — shared snapshot contract (SoT:
 * docs/design/guidance-orchestrator-2026-09-03.md).
 *
 * Does not own Growth lifecycle. Maps existing providers into one CTA surface.
 */

export type GuidanceScope = "user" | "robot" | "team";

export type GuidanceConfidence = "high" | "medium" | "low";

export type GuidanceDegradeReason =
  | "none"
  | "no_data"
  | "analysis_failed"
  | "permission_denied"
  | "provider_unavailable";

export type GuidanceActionRisk = "low" | "medium" | "high";

export type GuidanceSource = "growth" | "daibai" | "protocol" | "collaboration" | "orchestrator";

export type GuidanceNextActionTarget = {
  module?: string;
  tab?: string;
  focusComposer?: boolean;
  prefill?: string;
  recommendedSkillKeys?: string[];
  resumePendingTask?: boolean;
  deepLink?: string;
};

export type GuidanceNextAction = {
  kind: string;
  label: string;
  reason: string;
  target?: GuidanceNextActionTarget;
  canSkip: boolean;
  risk: GuidanceActionRisk;
};

export type GuidanceBlockerKind =
  | "skill"
  | "oauth"
  | "knowledge_binding"
  | "workflow"
  | "permission"
  | "data"
  | "other";

export type GuidanceBlocker = {
  code: string;
  kind: GuidanceBlockerKind;
  label: string;
  /** false → must not block task send (no installer / no permission path). */
  actionable: boolean;
};

export type GuidanceSnapshot = {
  scope: GuidanceScope;
  scenario: string;
  confidence: GuidanceConfidence;
  currentStage: string;
  nextAction: GuidanceNextAction;
  optionalActions: GuidanceNextAction[];
  blockers: GuidanceBlocker[];
  degrade: GuidanceDegradeReason;
  tenantId?: string | null;
  userId?: string | null;
  entityId: string;
  source: GuidanceSource;
  expiresAt?: number;
  generatedAt: number;
};

export const GUIDANCE_NONE_ACTION: GuidanceNextAction = {
  kind: "none",
  label: "guidance.action.none",
  reason: "guidance.recommend.none",
  canSkip: true,
  risk: "low",
};

export function isGuidanceScope(value: unknown): value is GuidanceScope {
  return value === "user" || value === "robot" || value === "team";
}

export function isGuidanceDegradeReason(value: unknown): value is GuidanceDegradeReason {
  return (
    value === "none" ||
    value === "no_data" ||
    value === "analysis_failed" ||
    value === "permission_denied" ||
    value === "provider_unavailable"
  );
}
