/**
 * P2.1 — Working DNA 档案投影（成长 tab 经验/偏好区）。
 */

import type { OpenBotConfig } from "../../config/config.js";
import {
  DEFAULT_WORKING_STYLE,
  describeWorkingStyleEvidenceGate,
  type WorkingStyle,
  type WorkingStyleEffectStatus,
  type WorkingStyleEvidenceGate,
} from "./genome.js";
import { readOperationalMetrics, type OperationalMetrics } from "./operational-metrics-store.js";
import {
  readRobotWorkingStyle,
  readWorkingStyleChange,
  type WorkingStyleChangeRecord,
} from "./working-style-store.js";

export type WorkingStyleDossierProjection = {
  learned: boolean;
  style: WorkingStyle;
  evidence: WorkingStyleEvidenceGate;
  updatedAtMs: number | null;
  lastChange: {
    changedAtMs: number;
    appliedDelta: Partial<WorkingStyle>;
    effectStatus: WorkingStyleEffectStatus | null;
    rolledBack: boolean;
  } | null;
};

function projectLastChange(
  change: WorkingStyleChangeRecord | null,
): WorkingStyleDossierProjection["lastChange"] {
  if (!change) {
    return null;
  }
  return {
    changedAtMs: change.changedAtMs,
    appliedDelta: change.appliedDelta,
    effectStatus: change.effectStatus ?? null,
    rolledBack: change.rolledBack ?? false,
  };
}

export async function buildWorkingStyleDossierProjection(
  cfg: OpenBotConfig,
  agentId: string,
): Promise<WorkingStyleDossierProjection> {
  const [stored, change, metrics] = await Promise.all([
    readRobotWorkingStyle(cfg, agentId).catch(() => null),
    readWorkingStyleChange(cfg, agentId).catch(() => null),
    readOperationalMetrics(cfg, agentId).catch(
      (): OperationalMetrics => ({
        tasksTotal: 0,
        tasksSucceeded: 0,
        toolsTotal: 0,
        toolsSucceeded: 0,
        humanTakeovers: 0,
        takeoverObservations: 0,
        satisfactionPositive: 0,
        satisfactionNegative: 0,
        updatedAtMs: 0,
      }),
    ),
  ]);
  const evidence = describeWorkingStyleEvidenceGate({ tasksTotal: metrics.tasksTotal });
  const lastChange = projectLastChange(change);
  return {
    learned: stored !== null,
    style: stored ? { ...DEFAULT_WORKING_STYLE, ...stored } : { ...DEFAULT_WORKING_STYLE },
    evidence,
    updatedAtMs: lastChange?.changedAtMs ?? null,
    lastChange,
  };
}
