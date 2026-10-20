/**
 * Pure deterministic ranking for guidance candidates (P2.1 / P2.2).
 *
 * Same inputs → same ordering. Missing signals score 0 (no invention).
 * permission_denied + high-risk outrank ordinary recommendations.
 * actionable=false blockers never contribute blocking score.
 */

import type {
  GuidancePersonalizationSignals,
  GuidanceRankableCandidate,
  GuidanceRankResult,
  GuidanceRankScoreBreakdown,
} from "./signals.js";
import { GUIDANCE_SIGNAL_PRIORITY } from "./signals.js";

const WEIGHTS: Record<(typeof GUIDANCE_SIGNAL_PRIORITY)[number], number> = {
  // Large gaps keep priority order stable under soft boosts.
  permission_and_risk: 1_000_000,
  current_blockers: 100_000,
  org_role: 10_000,
  workspace_or_robot_role: 1_000,
  recent_task_type: 100,
  installed_capabilities: 10,
  failure_or_abandonment: 1,
  pace_preference: 1,
};

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function tagsMatch(tags: readonly string[] | undefined, needle: string): boolean {
  if (!needle || !tags?.length) {
    return false;
  }
  const n = needle.toLowerCase();
  return tags.some((tag) => tag.trim().toLowerCase() === n || tag.trim().toLowerCase().includes(n));
}

function isActionPermitted(
  candidate: GuidanceRankableCandidate,
  signals: GuidancePersonalizationSignals,
): boolean {
  const allowed = signals.permission?.allowedActionKinds;
  if (allowed === undefined) {
    return true; // unknown permission context → do not invent a deny
  }
  return allowed.map((k) => k.trim()).includes(candidate.nextAction.kind);
}

/**
 * Score a single candidate. Pure function — no I/O, no LLM, no Growth FSM.
 */
export function scoreGuidanceCandidate(
  candidate: GuidanceRankableCandidate,
  signals: GuidancePersonalizationSignals = {},
): GuidanceRankResult {
  const permitted = isActionPermitted(candidate, signals);
  const risk = candidate.nextAction.risk;
  const isHighRisk = risk === "high";
  const isPermissionDegrade = candidate.degrade === "permission_denied";

  // permission_and_risk
  let permissionAndRisk = 0;
  if (isPermissionDegrade) {
    permissionAndRisk += 3; // surface permission issues over soft tips
  }
  if (isHighRisk) {
    permissionAndRisk += 2; // high-risk outranks ordinary low-risk tips
  } else if (risk === "medium") {
    permissionAndRisk += 1;
  }
  if (!permitted) {
    // Strongly demote — must not recommend unexecutable actions as primary.
    permissionAndRisk -= 10;
  }

  // current_blockers — only actionable codes; non-actionable ignored for blocking
  let currentBlockers = 0;
  const actionable = candidate.actionableBlockerCodes?.length ?? 0;
  if (candidate.nextAction.addressesTaskGap || actionable > 0) {
    currentBlockers += 3 + Math.min(actionable, 3);
  }
  // Explicitly: nonActionableBlockerCodes never add blocking weight
  void candidate.nonActionableBlockerCodes;

  // org_role
  let orgRole = 0;
  const org = normalize(signals.orgRole);
  if (
    org &&
    (tagsMatch(candidate.nextAction.tags, org) || normalize(candidate.scenario).includes(org))
  ) {
    orgRole += 2;
  }

  // workspace / robot role
  let workspaceOrRobotRole = 0;
  const ws = normalize(signals.workspaceRole);
  const robot = normalize(signals.robotRole);
  if (ws && tagsMatch(candidate.nextAction.tags, ws)) {
    workspaceOrRobotRole += 2;
  }
  if (robot && (tagsMatch(candidate.nextAction.tags, robot) || candidate.scope === "robot")) {
    workspaceOrRobotRole += 1;
  }

  // recent task type — task-gap actions preferred over general capability tips
  let recentTaskType = 0;
  const taskType = normalize(signals.recentTaskType);
  if (taskType) {
    if (candidate.nextAction.addressesTaskGap && tagsMatch(candidate.nextAction.tags, taskType)) {
      recentTaskType += 3;
    } else if (tagsMatch(candidate.nextAction.tags, taskType)) {
      recentTaskType += 1;
    }
  }

  // installed capabilities — prefer actions that close real gaps; never invent installs
  let installedCapabilities = 0;
  const installed = new Set(
    (signals.installedCapabilityKeys ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean),
  );
  const needed = (candidate.nextAction.capabilityKeys ?? []).map((k) => k.trim().toLowerCase());
  if (needed.length > 0 && installed.size >= 0) {
    const missing = needed.filter((k) => k && !installed.has(k));
    if (missing.length > 0) {
      installedCapabilities += Math.min(missing.length, 3);
    } else {
      // All needed already installed → soft demote generic "install" tips
      installedCapabilities -= 1;
    }
  }

  // failure / abandonment — demote noisy repeats; never fabricate lifecycle state
  let failureOrAbandonment = 0;
  const failures = typeof signals.failureCount === "number" ? Math.max(0, signals.failureCount) : 0;
  if (failures > 0) {
    failureOrAbandonment -= Math.min(failures, 5);
  }
  if (signals.abandonedRecently) {
    failureOrAbandonment -= 2;
  }

  // pace preference — quiet demotes auto tips slightly; aggressive mild boost
  let pacePreference = 0;
  if (signals.pacePreference === "quiet") {
    pacePreference -= 1;
  } else if (signals.pacePreference === "aggressive") {
    pacePreference += 1;
  }

  const breakdown: GuidanceRankScoreBreakdown = {
    permissionAndRisk,
    currentBlockers,
    orgRole,
    workspaceOrRobotRole,
    recentTaskType,
    installedCapabilities,
    failureOrAbandonment,
    pacePreference,
  };

  const score =
    breakdown.permissionAndRisk * WEIGHTS.permission_and_risk +
    breakdown.currentBlockers * WEIGHTS.current_blockers +
    breakdown.orgRole * WEIGHTS.org_role +
    breakdown.workspaceOrRobotRole * WEIGHTS.workspace_or_robot_role +
    breakdown.recentTaskType * WEIGHTS.recent_task_type +
    breakdown.installedCapabilities * WEIGHTS.installed_capabilities +
    breakdown.failureOrAbandonment * WEIGHTS.failure_or_abandonment +
    breakdown.pacePreference * WEIGHTS.pace_preference +
    // Stable tie-break: newer generatedAt wins slightly without overriding bands
    (candidate.generatedAt % 1000) * 0.000001;

  return {
    id: candidate.id,
    score,
    breakdown,
    permissionDenied: !permitted,
    suppressAutoPrompt: !permitted || (signals.pacePreference === "quiet" && failures >= 3),
  };
}

/**
 * Rank candidates deterministically. Permission-denied executables sink;
 * ties broken by generatedAt desc then id asc.
 */
export function rankGuidanceCandidates(
  candidates: readonly GuidanceRankableCandidate[],
  signals: GuidancePersonalizationSignals = {},
): GuidanceRankResult[] {
  const scored = candidates.map((c) => scoreGuidanceCandidate(c, signals));
  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.id.localeCompare(b.id);
  });
  return scored;
}

/** Pick the top permitted candidate id, or null when none are executable. */
export function selectTopPermittedCandidateId(
  candidates: readonly GuidanceRankableCandidate[],
  signals: GuidancePersonalizationSignals = {},
): string | null {
  const ranked = rankGuidanceCandidates(candidates, signals);
  const winner = ranked.find((r) => !r.permissionDenied);
  return winner?.id ?? null;
}
