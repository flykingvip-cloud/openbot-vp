/**
 * Working DNA 自调闭环编排：二阶评估 → 信号派生写入 → 三阶 adaptivity 调整。
 * recompute-growth 与 operational sync 共用，避免分叉。
 */

import type { OpenBotConfig } from "../../config/config.js";
import type { WorkingStyleEffectStatus } from "./genome.js";
import type { OperationalSignalsForStyle } from "./genome.js";
import {
  computeAdaptivityAdjustment,
  computeOperationalScore,
  type OperationalScoreSignals,
} from "./operational-score.js";
import {
  applyOperationalSignalsToWorkingStyle,
  assessAndMarkWorkingStyleEffect,
  readWorkingStyleEffectStats,
} from "./working-style-store.js";

export type WorkingStyleSelfTuningResult = {
  adaptivityAdjustment: number;
  workingStyleEffect: {
    status: WorkingStyleEffectStatus;
    deltaScore: number | null;
    newlyAssessed: boolean;
    rolledBack: boolean;
  } | null;
};

export async function runWorkingStyleSelfTuning(
  cfg: OpenBotConfig,
  agentId: string,
  operationalSignals?: OperationalScoreSignals,
  styleEvidence?: Pick<OperationalSignalsForStyle, "tasksTotal">,
): Promise<WorkingStyleSelfTuningResult> {
  const rawOperationalScore = operationalSignals
    ? computeOperationalScore(operationalSignals)
    : null;
  const workingStyleEffect = await assessAndMarkWorkingStyleEffect(
    cfg,
    agentId,
    rawOperationalScore,
  ).catch(() => null);
  if (operationalSignals || styleEvidence) {
    await applyOperationalSignalsToWorkingStyle(
      cfg,
      agentId,
      {
        ...operationalSignals,
        tasksTotal: styleEvidence?.tasksTotal ?? null,
      },
      rawOperationalScore,
    ).catch(() => null);
  }
  const adaptivityAdjustment = computeAdaptivityAdjustment(
    (await readWorkingStyleEffectStats(cfg, agentId).catch(() => null)) ?? undefined,
  );
  return { adaptivityAdjustment, workingStyleEffect };
}
