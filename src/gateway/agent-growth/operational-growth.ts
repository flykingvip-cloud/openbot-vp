/**
 * Projects observed runtime outcomes into the dimensions that can be supported by
 * operational evidence. Identity and knowledge remain driven by explicit product signals.
 */

import type { OpenBotConfig } from "../../config/config.js";
import { createInitialGrowthStatus, recomputeGrowthStatus } from "./factory.js";
import { buildGrowthReportSnapshot, estimateHoursSaved } from "./growth-report.js";
import { collectInstalledSkillKeys } from "./installed-skills.js";
import { applyActivationTransition, deriveLifecycleState } from "./lifecycle.js";
import { recordMilestone } from "./milestones.js";
import {
  deriveOperationalSignals,
  readOperationalMetrics,
  type OperationalMetrics,
} from "./operational-metrics-store.js";
import { computeOperationalScore } from "./operational-score.js";
import { collectCapabilityReadinessSignals } from "./signals.js";
import { updateRobotGrowthStatus } from "./store.js";
import { resolveTemplateOrDefault } from "./templates/index.js";
import type { GrowthStatus } from "./types.js";
import { runWorkingStyleSelfTuning } from "./working-style-self-tuning.js";

/** Twenty observed turns are enough for full confidence in the first growth projection. */
export const OPERATIONAL_GROWTH_CONFIDENCE_TASKS = 20;

const REPORT_PERIOD_DAYS = 30;

/** Persist a GrowthReportSnapshot from operational metrics (P2 dossier / evolution). */
export function attachGrowthReportFromMetrics(
  status: GrowthStatus,
  metrics: OperationalMetrics,
  nowMs = Date.now(),
): GrowthStatus {
  if (metrics.tasksTotal <= 0) {
    return status;
  }
  const signals = deriveOperationalSignals(metrics);
  const hoursSaved = estimateHoursSaved({ tasksCompleted: metrics.tasksSucceeded });
  const growthReport = buildGrowthReportSnapshot({
    periodDays: REPORT_PERIOD_DAYS,
    generatedAtMs: nowMs,
    tasksCompleted: metrics.tasksSucceeded,
    learningMaterialsCount: 0,
    toolInvocations: metrics.toolsTotal,
    taskSuccessRate: signals?.taskSuccessRate ?? null,
    toolSuccessRate: signals?.toolSuccessRate ?? null,
    humanTakeoverRate: signals?.humanTakeoverRate ?? null,
    businessImpactInput:
      hoursSaved > 0
        ? {
            hours_saved: {
              value: hoursSaved,
              unit: "hours",
              description: "节省工时",
            },
          }
        : undefined,
  });
  const next: GrowthStatus = { ...status, growthReport };
  const template = resolveTemplateOrDefault(next.templateId);
  return {
    ...next,
    lifecycleState: deriveLifecycleState(next, template.missionReadyThreshold),
  };
}

/**
 * Project operational metrics into growth dimensions.
 *
 * `installedSkillKeys` is required (no default `[]`) so callers cannot silently
 * recompute readiness as if the robot had zero installs — see
 * docs/design/guidance-orchestrator-2026-09-03.md §1.2 / P0.
 */
export function projectOperationalGrowth(
  current: GrowthStatus,
  metrics: OperationalMetrics,
  nowMs: number,
  installedSkillKeys: Iterable<string>,
  adaptivityAdjustment = 0,
): GrowthStatus {
  const signals = deriveOperationalSignals(metrics);
  if (!signals || metrics.tasksTotal <= 0) {
    return current;
  }

  const rawScore = computeOperationalScore(signals) ?? 0;
  const score = Math.max(0, Math.min(100, rawScore + adaptivityAdjustment));
  const confidence = Math.min(1, metrics.tasksTotal / OPERATIONAL_GROWTH_CONFIDENCE_TASKS);
  const capabilityEvidence = Math.round(score * confidence);
  const taskSuccessRate = metrics.tasksSucceeded / metrics.tasksTotal;
  const habitEvidence = Math.round(taskSuccessRate * 100 * confidence);
  const dimensions = {
    ...current.dimensions,
    capability: Math.max(current.dimensions.capability, capabilityEvidence),
    habits: Math.max(current.dimensions.habits, habitEvidence),
  };
  const template = resolveTemplateOrDefault(current.templateId);
  // Always recompute readiness from real installs — never trust a stale true
  // that may have been produced when installedSkillKeys was empty.
  const signalsForReadiness = collectCapabilityReadinessSignals({
    template,
    installedSkillKeys,
  });
  let next = recomputeGrowthStatus(current, {
    dimensions,
    signals: signalsForReadiness,
    operationalScore: score,
    nowMs,
  });
  next = {
    ...next,
    milestones: recordMilestone(next.milestones, "firstMissionSentAtMs", nowMs),
  };
  if (metrics.tasksSucceeded > 0) {
    next = applyActivationTransition(next, { type: "first_mission_success", atMs: nowMs });
  }
  return attachGrowthReportFromMetrics(next, metrics, nowMs);
}

/** Reconcile persisted metrics into growth status. Safe to call after every completed turn. */
export async function syncRobotGrowthFromOperationalMetrics(
  cfg: OpenBotConfig,
  agentId: string,
  metrics?: OperationalMetrics,
): Promise<GrowthStatus | null> {
  const observed = metrics ?? (await readOperationalMetrics(cfg, agentId));
  const signals = deriveOperationalSignals(observed);
  const { adaptivityAdjustment } = await runWorkingStyleSelfTuning(
    cfg,
    agentId,
    signals ?? undefined,
    { tasksTotal: observed.tasksTotal },
  );
  const installedSkillKeys = collectInstalledSkillKeys(agentId);
  return await updateRobotGrowthStatus(cfg, agentId, (current) =>
    projectOperationalGrowth(
      current ?? createInitialGrowthStatus({ kind: "robot", atMs: Date.now() }),
      observed,
      Date.now(),
      installedSkillKeys,
      adaptivityAdjustment,
    ),
  );
}
