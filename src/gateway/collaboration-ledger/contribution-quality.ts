import type { CollaborationLedgerRecord } from "./types.js";

export type AgentContributionQuality = {
  agentId: string;
  turnsCompleted: number;
  turnsSkipped: number;
  turnsFailed: number;
  latencyP50Ms: number | null;
  handoffsGiven: number;
  handoffsReceived: number;
  reviewsAccepted: number;
  reviewsRejected: number;
  deliverablesAccepted: number;
  /** 0–1 when any quality or execution sample exists; otherwise null. */
  qualityScore: number | null;
};

function percentile50(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].toSorted((left, right) => left - right);
  const mid = Math.floor((sorted.length - 1) / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? null;
  }
  const high = sorted[mid + 1];
  const low = sorted[mid];
  if (high == null || low == null) {
    return low ?? high ?? null;
  }
  return Math.round((low + high) / 2);
}

function emptyQuality(agentId: string): AgentContributionQuality {
  return {
    agentId,
    turnsCompleted: 0,
    turnsSkipped: 0,
    turnsFailed: 0,
    latencyP50Ms: null,
    handoffsGiven: 0,
    handoffsReceived: 0,
    reviewsAccepted: 0,
    reviewsRejected: 0,
    deliverablesAccepted: 0,
    qualityScore: null,
  };
}

function scoreQuality(entry: AgentContributionQuality): number | null {
  const turns = entry.turnsCompleted + entry.turnsFailed;
  const reviews = entry.reviewsAccepted + entry.reviewsRejected;
  const signals: Array<{ value: number; weight: number }> = [];
  if (turns > 0) {
    signals.push({ value: entry.turnsCompleted / turns, weight: 0.5 });
  }
  if (reviews > 0) {
    signals.push({ value: entry.reviewsAccepted / reviews, weight: 0.3 });
  }
  if (entry.deliverablesAccepted > 0 || entry.handoffsGiven + entry.handoffsReceived > 0) {
    const delivered = entry.deliverablesAccepted > 0 ? 1 : 0.6;
    signals.push({ value: delivered, weight: 0.2 });
  }
  if (signals.length === 0) {
    return null;
  }
  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0);
  const weighted = signals.reduce((sum, signal) => sum + signal.value * signal.weight, 0);
  return Math.round((weighted / totalWeight) * 1000) / 1000;
}

export function aggregateContributionQuality(
  records: readonly CollaborationLedgerRecord[],
): AgentContributionQuality[] {
  const byAgent = new Map<string, AgentContributionQuality>();
  const latencies = new Map<string, number[]>();

  const touch = (agentId: string): AgentContributionQuality => {
    const current = byAgent.get(agentId) ?? emptyQuality(agentId);
    byAgent.set(agentId, current);
    return current;
  };

  for (const record of records) {
    if (record.kind === "execution") {
      const stats = touch(record.agentId);
      if (record.status === "completed") {
        stats.turnsCompleted += 1;
      } else if (record.status === "skipped") {
        stats.turnsSkipped += 1;
      } else {
        stats.turnsFailed += 1;
      }
      if (typeof record.latencyMs === "number") {
        const samples = latencies.get(record.agentId) ?? [];
        samples.push(record.latencyMs);
        latencies.set(record.agentId, samples);
      }
      continue;
    }
    if (record.kind !== "quality") {
      continue;
    }
    if (record.event === "handoff" && record.handoff) {
      touch(record.handoff.from).handoffsGiven += 1;
      touch(record.handoff.to).handoffsReceived += 1;
      continue;
    }
    const agentId = record.agentId?.trim();
    if (!agentId) {
      continue;
    }
    const stats = touch(agentId);
    if (typeof record.latencyMs === "number") {
      const samples = latencies.get(agentId) ?? [];
      samples.push(record.latencyMs);
      latencies.set(agentId, samples);
    }
    if (record.event === "review") {
      if (record.outcome === "accepted") {
        stats.reviewsAccepted += 1;
      } else if (record.outcome === "rejected") {
        stats.reviewsRejected += 1;
      }
    }
    if (record.event === "deliverable" && record.outcome === "accepted") {
      stats.deliverablesAccepted += 1;
    }
  }

  return [...byAgent.values()]
    .map((entry) => ({
      ...entry,
      latencyP50Ms: percentile50(latencies.get(entry.agentId) ?? []),
      qualityScore: scoreQuality(entry),
    }))
    .toSorted((left, right) => left.agentId.localeCompare(right.agentId));
}

export function averageContributionQualityScore(
  entries: readonly AgentContributionQuality[],
): number | null {
  const scored = entries
    .map((entry) => entry.qualityScore)
    .filter((value): value is number => typeof value === "number");
  if (scored.length === 0) {
    return null;
  }
  return Math.round((scored.reduce((sum, value) => sum + value, 0) / scored.length) * 1000) / 1000;
}
