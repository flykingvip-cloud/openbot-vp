/**
 * P4c — async 责任·贡献·创新·共享 (RCIS) performance aggregation.
 *
 * Inventory-first: reuses collaboration ledger facts + contribution-quality.ts
 * counters. Writes an observe-only snapshot under runtime/rcis-aggregate.json
 * when collaboration.learning.rcisAggregate is ON.
 *
 * C7 / R5: Learning must not rewrite current-round Decision. This module is
 * never imported by admission.ts / decision-engine.ts / floor-bid.ts.
 * GrowthDimension (identity/capability/knowledge/habits/alignment) is NOT
 * renamed or extended into a second selection-driving dimension set.
 *
 * Explicit non-goals: Floor live, multi-beat, tip-prompt rules, HA, Growth
 * hot-path scoring, default-on flag.
 */
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  aggregateContributionQuality,
  type AgentContributionQuality,
} from "../collaboration-ledger/contribution-quality.js";
import { readCollaborationLedgerArchive } from "../collaboration-ledger/reader.js";
import type { CollaborationLedgerRecord } from "../collaboration-ledger/types.js";
import { createWorkspaceCollaborationStores } from "./shared.js";

export const RCIS_AGGREGATE_FILENAME = "runtime/rcis-aggregate.json";

/** Owner principles: 责任 · 贡献 · 创新 · 共享. Scores are 0–1 or null. */
export type RcisDimensionScores = {
  /** 责任 — claim / ownership / fulfillment vs idle when invited. */
  responsibility: number | null;
  /** 贡献 — completed turns, accepted deliverables, useful reviews. */
  contribution: number | null;
  /** 创新 — challenge role, incrementalContribution, non-duplicate. */
  innovation: number | null;
  /** 共享 — handoffs given, reviews shared, artifacts. */
  sharing: number | null;
};

export type AgentRcisScores = {
  agentId: string;
  dimensions: RcisDimensionScores;
  /** Equal-weight mean of non-null dimensions; null when all empty. */
  composite: number | null;
  signals: {
    claimsOrOwnershipTakes: number;
    idleWhenInvited: number;
    turnsCompleted: number;
    turnsFailed: number;
    deliverablesAccepted: number;
    reviewsAccepted: number;
    reviewsRejected: number;
    handoffsGiven: number;
    handoffsReceived: number;
    challengeTurns: number;
    incrementalTurns: number;
    duplicateSuppressions: number;
    pureAckOrNoIncrementSkips: number;
    artifactsShared: number;
  };
};

export type CollaborationRcisAggregateSnapshot = {
  groupId: string;
  windowFromMs: number;
  windowToMs: number;
  agents: AgentRcisScores[];
  updatedAtMs: number;
  /** Documentation: this snapshot must never feed Admission / Decision. */
  drivesAdmission: false;
  drivesGrowthDimensionSelection: false;
};

export type RcisAggregateOptions = {
  cfg?: OpenBotConfig;
  windowFromMs?: number;
  nowMs?: number;
};

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Plan flag `collab.learning.rcisAggregate` → default OFF. */
export function isCollabLearningRcisAggregateEnabled(cfg?: OpenBotConfig): boolean {
  try {
    return (cfg ?? loadConfig()).collaboration?.learning?.rcisAggregate === true;
  } catch {
    return false;
  }
}

/**
 * Hard invariant for tests and reviewers: RCIS is observe-only Learning.
 * Never wire this into decideParticipants / admit / floor bid.
 */
export function rcisScoresMustNotDriveAdmission(): true {
  return true;
}

/**
 * Hard invariant: do not invent a second GrowthDimension set that drives
 * selection. RCIS stays a named Learning ledger, adjacent to Growth.
 */
export function rcisScoresMustNotDriveGrowthDimensionSelection(): true {
  return true;
}

function clamp01(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return clamp01(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function emptySignals(): AgentRcisScores["signals"] {
  return {
    claimsOrOwnershipTakes: 0,
    idleWhenInvited: 0,
    turnsCompleted: 0,
    turnsFailed: 0,
    deliverablesAccepted: 0,
    reviewsAccepted: 0,
    reviewsRejected: 0,
    handoffsGiven: 0,
    handoffsReceived: 0,
    challengeTurns: 0,
    incrementalTurns: 0,
    duplicateSuppressions: 0,
    pureAckOrNoIncrementSkips: 0,
    artifactsShared: 0,
  };
}

function scoreResponsibility(signals: AgentRcisScores["signals"]): number | null {
  const takes = signals.claimsOrOwnershipTakes + signals.handoffsReceived;
  const fulfilled = signals.turnsCompleted + signals.deliverablesAccepted;
  const idleOrFail = signals.idleWhenInvited + signals.turnsFailed;
  if (takes + fulfilled + idleOrFail === 0) {
    return null;
  }
  const positive = takes + fulfilled;
  const denom = positive + idleOrFail;
  return clamp01(positive / Math.max(1, denom));
}

function scoreContribution(
  signals: AgentRcisScores["signals"],
  quality: AgentContributionQuality | undefined,
): number | null {
  if (typeof quality?.qualityScore === "number") {
    return clamp01(quality.qualityScore);
  }
  const turns = signals.turnsCompleted + signals.turnsFailed;
  const delivered = signals.deliverablesAccepted;
  if (turns + delivered === 0) {
    return null;
  }
  const completion = turns > 0 ? signals.turnsCompleted / turns : 0;
  const deliverableBoost = delivered > 0 ? 1 : 0;
  return clamp01(completion * 0.7 + deliverableBoost * 0.3);
}

function scoreInnovation(signals: AgentRcisScores["signals"]): number | null {
  const positive = signals.challengeTurns + signals.incrementalTurns + signals.reviewsRejected;
  const negative = signals.duplicateSuppressions + signals.pureAckOrNoIncrementSkips;
  if (positive + negative === 0) {
    return null;
  }
  return clamp01(positive / Math.max(1, positive + negative));
}

function scoreSharing(signals: AgentRcisScores["signals"]): number | null {
  const shared = signals.handoffsGiven + signals.reviewsAccepted + signals.artifactsShared;
  if (shared === 0 && signals.handoffsReceived === 0) {
    return null;
  }
  // Soft saturation: 1 handoff/review/artifact → ~0.5, 3+ → ~1.
  return clamp01(1 - Math.exp(-shared / 2));
}

function scoreAgent(
  agentId: string,
  signals: AgentRcisScores["signals"],
  quality: AgentContributionQuality | undefined,
): AgentRcisScores {
  const dimensions: RcisDimensionScores = {
    responsibility: scoreResponsibility(signals),
    contribution: scoreContribution(signals, quality),
    innovation: scoreInnovation(signals),
    sharing: scoreSharing(signals),
  };
  const composite = mean(
    Object.values(dimensions).filter((value): value is number => typeof value === "number"),
  );
  return { agentId, dimensions, composite, signals };
}

/**
 * Pure aggregation from existing ledger kinds (dispatch / execution / quality / fact).
 * Claim board JSONL is not required: ownership takes come from handoff facts +
 * handoffsReceived; idle from dispatch invites without execution in the same round.
 */
export function aggregateRcisFromLedgerRecords(params: {
  groupId: string;
  records: readonly CollaborationLedgerRecord[];
  windowFromMs?: number;
  nowMs?: number;
}): CollaborationRcisAggregateSnapshot {
  const nowMs = params.nowMs ?? Date.now();
  const windowFromMs = params.windowFromMs ?? nowMs - DEFAULT_WINDOW_MS;
  const inWindow = params.records.filter(
    (record) => record.recordedAtMs >= windowFromMs && record.recordedAtMs <= nowMs,
  );

  const byAgent = new Map<string, AgentRcisScores["signals"]>();
  const touch = (agentId: string): AgentRcisScores["signals"] => {
    const id = agentId.trim();
    const current = byAgent.get(id) ?? emptySignals();
    byAgent.set(id, current);
    return current;
  };

  const invitedByRound = new Map<string, Set<string>>();
  const executedByRound = new Map<string, Set<string>>();

  for (const record of inWindow) {
    if (record.kind === "dispatch") {
      const set = invitedByRound.get(record.roundId) ?? new Set<string>();
      for (const agentId of record.participantAgentIds) {
        if (agentId.trim()) {
          set.add(agentId.trim());
          touch(agentId);
        }
      }
      invitedByRound.set(record.roundId, set);
      continue;
    }

    if (record.kind === "execution") {
      const agentId = record.agentId.trim();
      if (!agentId) {
        continue;
      }
      const signals = touch(agentId);
      const executed = executedByRound.get(record.roundId) ?? new Set<string>();
      executed.add(agentId);
      executedByRound.set(record.roundId, executed);

      if (record.status === "completed") {
        signals.turnsCompleted += 1;
      } else if (record.status === "failed") {
        signals.turnsFailed += 1;
      }
      if (record.contributionRole === "challenge") {
        signals.challengeTurns += 1;
      }
      if (record.incrementalContribution === true) {
        signals.incrementalTurns += 1;
      }
      if (record.suppressedAsDuplicate === true) {
        signals.duplicateSuppressions += 1;
      }
      if (record.skipReason === "pure_ack" || record.skipReason === "no_increment") {
        signals.pureAckOrNoIncrementSkips += 1;
      }
      continue;
    }

    if (record.kind === "quality") {
      if (record.event === "handoff" && record.handoff) {
        touch(record.handoff.from).handoffsGiven += 1;
        touch(record.handoff.to).handoffsReceived += 1;
        continue;
      }
      const agentId = record.agentId?.trim();
      if (!agentId) {
        continue;
      }
      const signals = touch(agentId);
      if (record.event === "review") {
        if (record.outcome === "accepted") {
          signals.reviewsAccepted += 1;
        } else if (record.outcome === "rejected") {
          signals.reviewsRejected += 1;
        }
      }
      if (record.event === "deliverable" && record.outcome === "accepted") {
        signals.deliverablesAccepted += 1;
      }
      if (Array.isArray(record.artifacts) && record.artifacts.length > 0) {
        signals.artifactsShared += record.artifacts.length;
      }
      continue;
    }

    if (record.kind === "fact") {
      if (record.type === "TaskResponsibilityChanged" && record.ownerAfter?.trim()) {
        touch(record.ownerAfter).claimsOrOwnershipTakes += 1;
      } else if (record.type === "TaskHandoffReceiverAccepted" && record.toAgentId.trim()) {
        touch(record.toAgentId).claimsOrOwnershipTakes += 1;
      }
    }
  }

  for (const [roundId, invited] of invitedByRound) {
    const executed = executedByRound.get(roundId) ?? new Set<string>();
    for (const agentId of invited) {
      if (!executed.has(agentId)) {
        touch(agentId).idleWhenInvited += 1;
      }
    }
  }

  const qualityByAgent = new Map(
    aggregateContributionQuality(inWindow).map((entry) => [entry.agentId, entry]),
  );
  for (const agentId of qualityByAgent.keys()) {
    touch(agentId);
  }

  const agents = [...byAgent.entries()]
    .map(([agentId, signals]) => scoreAgent(agentId, signals, qualityByAgent.get(agentId)))
    .toSorted((left, right) => left.agentId.localeCompare(right.agentId));

  return {
    groupId: params.groupId,
    windowFromMs,
    windowToMs: nowMs,
    agents,
    updatedAtMs: nowMs,
    drivesAdmission: false,
    drivesGrowthDimensionSelection: false,
  };
}

/**
 * Flag-gated async sync (recompute-growth adjacent). Flag-off → no write;
 * returns null so callers stay observe-only.
 */
export async function syncCollaborationRcisAggregate(
  groupId: string,
  tenantId?: string | null,
  options?: RcisAggregateOptions,
): Promise<CollaborationRcisAggregateSnapshot | null> {
  const cfg = options?.cfg;
  if (!isCollabLearningRcisAggregateEnabled(cfg)) {
    return null;
  }
  const archive = await readCollaborationLedgerArchive({
    groupId,
    kinds: ["dispatch", "execution", "quality", "fact"],
    limit: 1000,
    ...(tenantId ? { tenantId } : {}),
  });
  const snapshot = aggregateRcisFromLedgerRecords({
    groupId,
    records: archive.records,
    windowFromMs: options?.windowFromMs,
    nowMs: options?.nowMs,
  });
  const { fileStore } = createWorkspaceCollaborationStores();
  await fileStore.writeGroupFile({
    groupId,
    filename: RCIS_AGGREGATE_FILENAME,
    data: snapshot,
  });
  return snapshot;
}

export async function readCollaborationRcisAggregate(
  groupId: string,
): Promise<CollaborationRcisAggregateSnapshot | null> {
  const { fileStore } = createWorkspaceCollaborationStores();
  return await fileStore.readGroupFile<CollaborationRcisAggregateSnapshot>({
    groupId,
    filename: RCIS_AGGREGATE_FILENAME,
  });
}
