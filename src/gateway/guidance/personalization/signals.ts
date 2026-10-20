/**
 * Deterministic personalization signals (P2).
 * Missing signals degrade safely — never invent facts.
 */

import type { GuidanceActionRisk, GuidanceScope } from "../types.js";

/** Stable priority order (highest influence first). */
export const GUIDANCE_SIGNAL_PRIORITY = [
  "permission_and_risk",
  "current_blockers",
  "org_role",
  "workspace_or_robot_role",
  "recent_task_type",
  "installed_capabilities",
  "failure_or_abandonment",
  "pace_preference",
] as const;

export type GuidanceSignalKind = (typeof GUIDANCE_SIGNAL_PRIORITY)[number];

export type GuidancePacePreference = "aggressive" | "balanced" | "quiet";

/**
 * Explicit allow-list of action kinds the actor may execute.
 * When omitted, permission filtering is skipped (unknown ≠ deny).
 * When provided (even empty), kinds not listed are treated as not permitted.
 */
export type GuidancePermissionContext = {
  /** Allowed nextAction.kind values. */
  allowedActionKinds?: readonly string[];
  /** When true, high-risk actions require confirmation flag (still ranked, risk preserved). */
  highRiskConfirmed?: boolean;
};

export type GuidancePersonalizationSignals = {
  orgRole?: string | null;
  workspaceRole?: string | null;
  robotRole?: string | null;
  recentTaskType?: string | null;
  /** Installed skill / capability keys — never inferred. */
  installedCapabilityKeys?: readonly string[];
  /** Preferred scenario / role tags for soft boosts. */
  preferredScenarioTags?: readonly string[];
  failureCount?: number;
  abandonedRecently?: boolean;
  pacePreference?: GuidancePacePreference | null;
  permission?: GuidancePermissionContext;
};

export type GuidanceRankableAction = {
  kind: string;
  risk: GuidanceActionRisk;
  /** Scenario / label tags used for role & task matching (optional). */
  tags?: readonly string[];
  /** Recommended capability keys this action would install/open. */
  capabilityKeys?: readonly string[];
  /** True when this action addresses a current task gap / actionable blocker. */
  addressesTaskGap?: boolean;
};

export type GuidanceRankableCandidate = {
  id: string;
  scope: GuidanceScope;
  scenario: string;
  degrade: string;
  generatedAt: number;
  nextAction: GuidanceRankableAction;
  /** Actionable blockers only contribute to ranking; non-actionable never block send. */
  actionableBlockerCodes?: readonly string[];
  /** Non-actionable blockers are informational only. */
  nonActionableBlockerCodes?: readonly string[];
};

export type GuidanceRankScoreBreakdown = {
  permissionAndRisk: number;
  currentBlockers: number;
  orgRole: number;
  workspaceOrRobotRole: number;
  recentTaskType: number;
  installedCapabilities: number;
  failureOrAbandonment: number;
  pacePreference: number;
};

export type GuidanceRankResult = {
  id: string;
  /** Total score — higher wins. Deterministic for identical inputs. */
  score: number;
  breakdown: GuidanceRankScoreBreakdown;
  /** True when permission context forbids executing this action. */
  permissionDenied: boolean;
  /** True when candidate should be excluded from auto-prompt (not from manual resume). */
  suppressAutoPrompt: boolean;
};
