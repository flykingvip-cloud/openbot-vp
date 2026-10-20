/**
 * Unified nextAction entry — picks at most one primary GuidanceSnapshot.
 *
 * Priority (P0, deterministic): explicit degrade > robot growth CTA > user daibai >
 * team placeholder.
 * P2: optional personalization signals re-rank active CTAs deterministically.
 */

import { buildDegradedGuidanceSnapshot } from "./degrade.js";
import {
  rankGuidanceCandidates,
  type GuidancePersonalizationSignals,
  type GuidanceRankableCandidate,
} from "./personalization/index.js";
import type { GuidanceSnapshot } from "./types.js";

function hasActiveCta(snapshot: GuidanceSnapshot): boolean {
  return snapshot.degrade === "none" && snapshot.nextAction.kind !== "none";
}

function scopeRank(snapshot: GuidanceSnapshot): number {
  if (snapshot.scope === "robot") {
    return 30;
  }
  if (snapshot.scope === "user") {
    return 20;
  }
  return 10;
}

function toRankable(snapshot: GuidanceSnapshot, index: number): GuidanceRankableCandidate {
  const actionable = snapshot.blockers.filter((b) => b.actionable).map((b) => b.code);
  const nonActionable = snapshot.blockers.filter((b) => !b.actionable).map((b) => b.code);
  return {
    id: `${snapshot.scope}:${snapshot.entityId}:${snapshot.scenario}:${index}`,
    scope: snapshot.scope,
    scenario: snapshot.scenario,
    degrade: snapshot.degrade,
    generatedAt: snapshot.generatedAt,
    nextAction: {
      kind: snapshot.nextAction.kind,
      risk: snapshot.nextAction.risk,
      tags: [
        snapshot.scenario,
        snapshot.scope,
        ...(snapshot.nextAction.target?.recommendedSkillKeys ?? []),
      ],
      capabilityKeys: snapshot.nextAction.target?.recommendedSkillKeys,
      addressesTaskGap:
        actionable.length > 0 || Boolean(snapshot.nextAction.target?.resumePendingTask),
    },
    actionableBlockerCodes: actionable,
    nonActionableBlockerCodes: nonActionable,
  };
}

/**
 * Resolve the single primary guidance surface from provider snapshots.
 * Never merges CTAs — returns the winning snapshot unchanged (optionalActions
 * may be filled by callers).
 */
export function resolvePrimaryGuidance(
  candidates: Array<GuidanceSnapshot | null | undefined>,
  opts?: {
    /** When nothing actionable, emit an orchestrator idle snapshot. */
    fallbackEntityId?: string;
    nowMs?: number;
    /** P2 deterministic personalization signals (optional). */
    personalization?: GuidancePersonalizationSignals;
  },
): GuidanceSnapshot {
  const list = candidates.filter((item): item is GuidanceSnapshot => Boolean(item));
  if (list.length === 0) {
    return buildDegradedGuidanceSnapshot({
      scope: "user",
      entityId: opts?.fallbackEntityId?.trim() || "unknown",
      reason: "no_data",
      scenario: "orchestrator.empty",
      source: "orchestrator",
      nowMs: opts?.nowMs,
    });
  }

  const degraded = list.find((item) => item.degrade !== "none");
  if (degraded && !list.some(hasActiveCta)) {
    return degraded;
  }

  const active = list.filter(hasActiveCta);
  if (active.length === 0) {
    // Prefer an idle none-action snapshot over inventing work.
    const idle =
      list.find((item) => item.scope === "robot") ??
      list.find((item) => item.scope === "user") ??
      list[0];
    return idle;
  }

  if (opts?.personalization) {
    const rankables = active.map((snap, index) => toRankable(snap, index));
    const ranked = rankGuidanceCandidates(rankables, opts.personalization);
    const winner = ranked.find((r) => !r.permissionDenied) ?? ranked[0];
    const match = active.find((snap, index) => toRankable(snap, index).id === winner?.id);
    if (match) {
      return match;
    }
  }

  active.sort((a, b) => {
    const rank = scopeRank(b) - scopeRank(a);
    if (rank !== 0) {
      return rank;
    }
    return b.generatedAt - a.generatedAt;
  });
  return active[0];
}

/**
 * Build / select the guidance surface for a workbench context.
 * P0: callers assemble provider snapshots; this only picks the primary.
 * P2: pass personalization to re-rank active CTAs.
 */
export function buildGuidanceSnapshot(params: {
  candidates: Array<GuidanceSnapshot | null | undefined>;
  fallbackEntityId?: string;
  nowMs?: number;
  personalization?: GuidancePersonalizationSignals;
}): GuidanceSnapshot {
  return resolvePrimaryGuidance(params.candidates, {
    fallbackEntityId: params.fallbackEntityId,
    nowMs: params.nowMs,
    personalization: params.personalization,
  });
}
