/**
 * Background growth + Working DNA recompute (evolution-runtime-closure Phase 3).
 * UI `agents.recompute-growth` remains a manual/diagnostic entry; this is the
 * production auto path triggered after operational metrics updates.
 */

import type { OpenBotConfig } from "../../config/config.js";
import { listRobotSkillAssets } from "../skill-lifecycle-store.js";
import { createInitialGrowthStatus, recomputeGrowthStatus } from "./factory.js";
import { emitGrowthEvents, getGrowthEventBroadcast } from "./growth-events.js";
import { computeOperationalSignals } from "./operational-metrics-store.js";
import { computeAdaptivityAdjustment, computeOperationalScore } from "./operational-score.js";
import { computeCapabilityDimension } from "./readiness.js";
import { collectCapabilityReadinessSignals } from "./signals.js";
import { readRobotGrowthStatus, updateRobotGrowthStatus } from "./store.js";
import { resolveTemplateOrDefault } from "./templates/index.js";
import type { AgentGrowthPathOpts } from "./tenant-agent-dir.js";
import type { GrowthDimension, GrowthStatus } from "./types.js";
import {
  applyOperationalSignalsToWorkingStyle,
  assessAndMarkWorkingStyleEffect,
  readWorkingStyleEffectStats,
} from "./working-style-store.js";

const lastRecomputeByAgent = new Map<string, number>();
const DEFAULT_MIN_INTERVAL_MS = 60_000;

function collectInstalledSkillKeys(agentId: string): string[] {
  const keys: string[] = [];
  for (const entry of listRobotSkillAssets(agentId)) {
    if (!entry.enabled) {
      continue;
    }
    if (typeof entry.id === "string" && entry.id) {
      keys.push(entry.id);
    }
    const name = entry.profile?.name?.trim();
    if (name) {
      keys.push(name);
    }
  }
  return keys;
}

function recomputeRobotLocal(
  current: GrowthStatus,
  agentId: string,
  operationalScore?: number | null,
): GrowthStatus {
  const template = resolveTemplateOrDefault(current.templateId);
  const installedSkillKeys = collectInstalledSkillKeys(agentId);
  const capability = computeCapabilityDimension(template, installedSkillKeys);
  const dimensions: GrowthDimension = { ...current.dimensions, capability };
  const signals = collectCapabilityReadinessSignals({ template, installedSkillKeys });
  return recomputeGrowthStatus(current, { dimensions, signals, operationalScore });
}

/**
 * Throttled full recompute + DNA assess/apply. Never throws (caller is record path).
 */
export async function maybeBackgroundRecomputeGrowthAndDna(params: {
  cfg: OpenBotConfig;
  agentId: string;
  opts?: AgentGrowthPathOpts;
  minIntervalMs?: number;
  nowMs?: number;
}): Promise<{ ran: boolean; reason?: string }> {
  const agentId = params.agentId.trim();
  if (!agentId) {
    return { ran: false, reason: "missing-agent" };
  }
  const now = params.nowMs ?? Date.now();
  const minInterval = params.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const last = lastRecomputeByAgent.get(agentId);
  // Only throttle when we have a prior run for this agent (last===undefined means first run).
  if (last !== undefined && now - last < minInterval) {
    return { ran: false, reason: "throttled" };
  }
  lastRecomputeByAgent.set(agentId, now);

  try {
    const operationalSignals = await computeOperationalSignals(params.cfg, agentId);
    if (!operationalSignals) {
      return { ran: false, reason: "no-signals" };
    }

    const rawOperationalScore = computeOperationalScore(operationalSignals);
    if (rawOperationalScore == null) {
      return { ran: false, reason: "no-score" };
    }
    const adaptivityAdjustment = computeAdaptivityAdjustment(
      (await readWorkingStyleEffectStats(params.cfg, agentId)) ?? undefined,
    );
    const storedOperationalScore = Math.max(
      0,
      Math.min(100, rawOperationalScore + adaptivityAdjustment),
    );

    const prevGrowth = await readRobotGrowthStatus(params.cfg, agentId, params.opts);
    const nextGrowth = await updateRobotGrowthStatus(
      params.cfg,
      agentId,
      (current) => {
        const base = current ?? createInitialGrowthStatus({ kind: "robot", atMs: Date.now() });
        return recomputeRobotLocal(base, agentId, storedOperationalScore);
      },
      params.opts,
    );
    if (nextGrowth) {
      emitGrowthEvents(
        getGrowthEventBroadcast(),
        { idKey: "agentId", id: agentId },
        prevGrowth,
        nextGrowth,
      );
    }

    // Second-order DNA effect on raw score (no adaptivity self-pollution).
    await assessAndMarkWorkingStyleEffect(params.cfg, agentId, rawOperationalScore);
    await applyOperationalSignalsToWorkingStyle(
      params.cfg,
      agentId,
      operationalSignals,
      rawOperationalScore,
    );

    return { ran: true };
  } catch {
    return { ran: false, reason: "error" };
  }
}

/** Test helper */
export function resetBackgroundRecomputeThrottleForTests(): void {
  lastRecomputeByAgent.clear();
}
