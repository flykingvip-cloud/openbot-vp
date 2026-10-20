import type { GrowthDimension } from "../agent-growth/types.js";
import {
  aggregateContributionQuality,
  averageContributionQualityScore,
} from "../collaboration-ledger/contribution-quality.js";
import { readCollaborationLedgerArchive } from "../collaboration-ledger/reader.js";
import type { CollaborationLedgerRecord } from "../collaboration-ledger/types.js";
import { createWorkspaceCollaborationStores } from "./shared.js";

export const BEHAVIOR_BUFFER_FILENAME = "runtime/behavior-buffer.json";

export type CollaborationBehaviorAgentStats = {
  agentId: string;
  dispatchInvites: number;
  executionsCompleted: number;
  executionsSkipped: number;
  executionsFailed: number;
  participationRate: number;
  lastRecordedAtMs: number;
  handoffsGiven?: number;
  reviewsAccepted?: number;
  reviewsRejected?: number;
  latencyP50Ms?: number | null;
  qualityScore?: number | null;
};

export type CollaborationBehaviorBufferSnapshot = {
  groupId: string;
  windowFromMs: number;
  windowToMs: number;
  agents: CollaborationBehaviorAgentStats[];
  aggregateParticipationRate: number;
  aggregateQualityScore: number | null;
  updatedAtMs: number;
};

export type CollaborationBehaviorGrowthHints = {
  habitsDelta: number;
  alignmentDelta: number;
  summary: string;
};

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function emptyAgentStats(agentId: string): CollaborationBehaviorAgentStats {
  return {
    agentId,
    dispatchInvites: 0,
    executionsCompleted: 0,
    executionsSkipped: 0,
    executionsFailed: 0,
    participationRate: 0,
    lastRecordedAtMs: 0,
  };
}

export function aggregateBehaviorBufferFromLedgerRecords(params: {
  groupId: string;
  records: CollaborationLedgerRecord[];
  windowFromMs?: number;
  nowMs?: number;
}): CollaborationBehaviorBufferSnapshot {
  const nowMs = params.nowMs ?? Date.now();
  const windowFromMs = params.windowFromMs ?? nowMs - DEFAULT_WINDOW_MS;
  const byAgent = new Map<string, CollaborationBehaviorAgentStats>();

  for (const record of params.records) {
    if (record.recordedAtMs < windowFromMs || record.recordedAtMs > nowMs) {
      continue;
    }
    if (record.kind === "dispatch") {
      for (const agentId of record.participantAgentIds) {
        const stats = byAgent.get(agentId) ?? emptyAgentStats(agentId);
        stats.dispatchInvites += 1;
        stats.lastRecordedAtMs = Math.max(stats.lastRecordedAtMs, record.recordedAtMs);
        byAgent.set(agentId, stats);
      }
      continue;
    }
    if (record.kind !== "execution") {
      continue;
    }
    const stats = byAgent.get(record.agentId) ?? emptyAgentStats(record.agentId);
    if (record.status === "completed") {
      stats.executionsCompleted += 1;
    } else if (record.status === "skipped") {
      stats.executionsSkipped += 1;
    } else {
      stats.executionsFailed += 1;
    }
    stats.lastRecordedAtMs = Math.max(stats.lastRecordedAtMs, record.recordedAtMs);
    byAgent.set(record.agentId, stats);
  }

  const qualityByAgent = new Map(
    aggregateContributionQuality(params.records).map((entry) => [entry.agentId, entry]),
  );
  for (const agentId of qualityByAgent.keys()) {
    if (!byAgent.has(agentId)) {
      byAgent.set(agentId, emptyAgentStats(agentId));
    }
  }

  const agents = [...byAgent.values()]
    .map((stats) => {
      const attempts = stats.executionsCompleted + stats.executionsSkipped + stats.executionsFailed;
      const participationRate =
        stats.dispatchInvites > 0
          ? Math.min(1, attempts / stats.dispatchInvites)
          : attempts > 0
            ? 1
            : 0;
      const quality = qualityByAgent.get(stats.agentId);
      return {
        ...stats,
        participationRate,
        ...(quality
          ? {
              handoffsGiven: quality.handoffsGiven,
              reviewsAccepted: quality.reviewsAccepted,
              reviewsRejected: quality.reviewsRejected,
              latencyP50Ms: quality.latencyP50Ms,
              qualityScore: quality.qualityScore,
            }
          : {}),
      };
    })
    .toSorted((left, right) => left.agentId.localeCompare(right.agentId));

  const aggregateParticipationRate =
    agents.length > 0
      ? agents.reduce((sum, entry) => sum + entry.participationRate, 0) / agents.length
      : 0;

  return {
    groupId: params.groupId,
    windowFromMs,
    windowToMs: nowMs,
    agents,
    aggregateParticipationRate,
    aggregateQualityScore: averageContributionQualityScore(
      agents.map((entry) => ({
        agentId: entry.agentId,
        turnsCompleted: entry.executionsCompleted,
        turnsSkipped: entry.executionsSkipped,
        turnsFailed: entry.executionsFailed,
        latencyP50Ms: entry.latencyP50Ms ?? null,
        handoffsGiven: entry.handoffsGiven ?? 0,
        handoffsReceived: 0,
        reviewsAccepted: entry.reviewsAccepted ?? 0,
        reviewsRejected: entry.reviewsRejected ?? 0,
        deliverablesAccepted: 0,
        qualityScore: entry.qualityScore ?? null,
      })),
    ),
    updatedAtMs: nowMs,
  };
}

export async function syncCollaborationBehaviorBuffer(
  groupId: string,
  tenantId?: string | null,
): Promise<CollaborationBehaviorBufferSnapshot> {
  const archive = await readCollaborationLedgerArchive({
    groupId,
    kinds: ["dispatch", "execution", "quality"],
    limit: 1000,
    ...(tenantId ? { tenantId } : {}),
  });
  const snapshot = aggregateBehaviorBufferFromLedgerRecords({
    groupId,
    records: archive.records,
  });
  const { fileStore } = createWorkspaceCollaborationStores();
  await fileStore.writeGroupFile({
    groupId,
    filename: BEHAVIOR_BUFFER_FILENAME,
    data: snapshot,
  });
  return snapshot;
}

export async function readCollaborationBehaviorBuffer(
  groupId: string,
  _tenantId?: string | null,
): Promise<CollaborationBehaviorBufferSnapshot | null> {
  const { fileStore } = createWorkspaceCollaborationStores();
  return await fileStore.readGroupFile<CollaborationBehaviorBufferSnapshot>({
    groupId,
    filename: BEHAVIOR_BUFFER_FILENAME,
  });
}

export function deriveBehaviorGrowthHints(
  snapshot: CollaborationBehaviorBufferSnapshot | null,
): CollaborationBehaviorGrowthHints {
  if (!snapshot || snapshot.agents.length === 0) {
    return { habitsDelta: 0, alignmentDelta: 0, summary: "No collaboration behavior samples yet." };
  }
  const rate = snapshot.aggregateParticipationRate;
  const quality = snapshot.aggregateQualityScore;
  const blended = quality == null ? rate : rate * 0.6 + quality * 0.4;
  const habitsDelta = Math.round(Math.max(-3, Math.min(3, (blended - 0.5) * 6)));
  const alignmentDelta = Math.round(Math.max(-2, Math.min(2, (blended - 0.4) * 4)));
  const qualityText = quality == null ? "" : ` quality ${(quality * 100).toFixed(0)}%`;
  return {
    habitsDelta,
    alignmentDelta,
    summary: `Ledger window participation rate ${(rate * 100).toFixed(0)}%${qualityText} across ${snapshot.agents.length} agents.`,
  };
}

export function applyBehaviorHintsToDimensions(
  dimensions: GrowthDimension,
  hints: CollaborationBehaviorGrowthHints,
): GrowthDimension {
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  return {
    ...dimensions,
    habits: clamp(dimensions.habits + hints.habitsDelta),
    alignment:
      dimensions.alignment === undefined
        ? undefined
        : clamp(dimensions.alignment + hints.alignmentDelta),
  };
}
