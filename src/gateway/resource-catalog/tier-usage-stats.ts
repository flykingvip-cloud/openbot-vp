/**
 * Tier 级平台用量统计（Usage Ledger 任务量 + Session 延迟/失败率）。
 */

import type { OpenBotConfig } from "../../config/types.js";
import { discoverAllSessions, loadSessionCostSummary } from "../../infra/session-cost-usage.js";
import type { UsageLedgerEntry } from "../package-entitlement/types.js";
import { listAgentsForGateway } from "../session-utils.js";
import type { ResourceModelCatalogEntry } from "./types.js";

const MAX_SESSIONS_SCAN = 160;

export type TierUsageStat = {
  tierId: string;
  taskCount: number;
  failureRate: number | null;
  avgLatencyMs: number | null;
};

export type TierUsageWindow = {
  startTime: string;
  endTime: string;
};

type TierRollup = {
  taskCount: number;
  errorCount: number;
  latencySum: number;
  latencyCount: number;
};

function emptyRollup(): TierRollup {
  return { taskCount: 0, errorCount: 0, latencySum: 0, latencyCount: 0 };
}

function normalizeModelRef(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed;
}

export function buildModelTierIndex(
  models: readonly ResourceModelCatalogEntry[],
): Map<string, string> {
  const index = new Map<string, string>();
  for (const model of models) {
    const modelId = model.modelId.trim();
    if (!modelId) {
      continue;
    }
    index.set(modelId, model.tier);
    const slash = modelId.indexOf("/");
    if (slash > 0) {
      index.set(modelId.slice(slash + 1), model.tier);
    }
  }
  return index;
}

export function resolveTierForModelRef(
  modelRef: string,
  modelTierIndex: Map<string, string>,
): string | null {
  const normalized = normalizeModelRef(modelRef);
  if (!normalized) {
    return null;
  }
  const direct = modelTierIndex.get(normalized);
  if (direct) {
    return direct;
  }
  const slash = normalized.indexOf("/");
  if (slash > 0) {
    return modelTierIndex.get(normalized.slice(slash + 1)) ?? null;
  }
  return null;
}

export function aggregateTierTaskCountsFromLedger(
  entries: readonly UsageLedgerEntry[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const tierId = entry.tier.trim();
    if (!tierId) {
      continue;
    }
    counts.set(tierId, (counts.get(tierId) ?? 0) + 1);
  }
  return counts;
}

async function aggregateTierSessionRollups(params: {
  cfg: OpenBotConfig;
  modelTierIndex: Map<string, string>;
  startMs: number;
  endMs: number;
}): Promise<Map<string, TierRollup>> {
  const rollups = new Map<string, TierRollup>();
  const agents = listAgentsForGateway(params.cfg).agents;
  const discovered = (
    await Promise.all(
      agents.map(async (agent) => {
        const sessions = await discoverAllSessions({
          agentId: agent.id,
          startMs: params.startMs,
          endMs: params.endMs,
        });
        return sessions.map((session) => ({ ...session, agentId: agent.id }));
      }),
    )
  )
    .flat()
    .toSorted((left, right) => right.mtime - left.mtime)
    .slice(0, MAX_SESSIONS_SCAN);

  for (const session of discovered) {
    const summary = await loadSessionCostSummary({
      sessionFile: session.sessionFile,
      config: params.cfg,
      agentId: session.agentId,
      startMs: params.startMs,
      endMs: params.endMs,
    });
    if (!summary?.modelUsage?.length) {
      continue;
    }
    const errors = summary.messageCounts?.errors ?? 0;
    const totalMessages = summary.messageCounts?.total ?? 0;
    const sessionErrorRate = totalMessages > 0 ? errors / totalMessages : 0;
    const avgLatency = summary.latency && summary.latency.count > 0 ? summary.latency.avgMs : null;

    for (const entry of summary.modelUsage) {
      const modelRef = normalizeModelRef(
        `${entry.provider ?? "unknown"}/${entry.model ?? "unknown"}`,
      );
      const tierId = resolveTierForModelRef(modelRef, params.modelTierIndex);
      if (!tierId) {
        continue;
      }
      const calls = Math.max(0, entry.count ?? 0);
      if (calls <= 0) {
        continue;
      }
      const bucket = rollups.get(tierId) ?? emptyRollup();
      bucket.taskCount += calls;
      bucket.errorCount += Math.round(calls * sessionErrorRate);
      if (avgLatency !== null) {
        bucket.latencySum += avgLatency * calls;
        bucket.latencyCount += calls;
      }
      rollups.set(tierId, bucket);
    }
  }
  return rollups;
}

export async function buildTierUsageStats(params: {
  cfg: OpenBotConfig;
  tiers: readonly { id: string }[];
  models: readonly ResourceModelCatalogEntry[];
  ledgerEntries: readonly UsageLedgerEntry[];
  window: TierUsageWindow;
}): Promise<{ window: TierUsageWindow; stats: TierUsageStat[] }> {
  const startMs = Date.parse(params.window.startTime);
  const endMs = Date.parse(params.window.endTime);
  const modelTierIndex = buildModelTierIndex(params.models);
  const ledgerCounts = aggregateTierTaskCountsFromLedger(params.ledgerEntries);
  const sessionRollups =
    Number.isFinite(startMs) && Number.isFinite(endMs)
      ? await aggregateTierSessionRollups({
          cfg: params.cfg,
          modelTierIndex,
          startMs,
          endMs,
        })
      : new Map<string, TierRollup>();

  const stats = params.tiers.map((tier) => {
    const ledgerTasks = ledgerCounts.get(tier.id) ?? 0;
    const session = sessionRollups.get(tier.id);
    const failureRate =
      session && session.taskCount > 0
        ? Number(((session.errorCount / session.taskCount) * 100).toFixed(1))
        : null;
    const avgLatencyMs =
      session && session.latencyCount > 0
        ? Number((session.latencySum / session.latencyCount).toFixed(1))
        : null;
    return {
      tierId: tier.id,
      taskCount: ledgerTasks,
      failureRate,
      avgLatencyMs,
    };
  });

  return { window: params.window, stats };
}
