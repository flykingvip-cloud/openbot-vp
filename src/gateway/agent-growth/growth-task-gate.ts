/**
 * Agent Growth OS — P1 C+3 任务发送前置门控（纯函数）。
 *
 * 有未满足任务技能时阻断真实 run；用户显式 proceed 后才放行。
 */

import type { GrowthCapabilityGapView } from "./next-action.js";
import type { GrowthPendingTaskContext } from "./types.js";

export function unmetSkillKeysFromTaskGaps(
  taskGaps: Array<{ key: string; status: string }> | null | undefined,
): string[] {
  if (!Array.isArray(taskGaps)) {
    return [];
  }
  return taskGaps
    .filter((gap) => gap.status === "missing" && typeof gap.key === "string" && gap.key.trim())
    .map((gap) => gap.key.trim());
}

/** 是否应阻断首条任务执行（存在缺失技能缺口）。 */
export function shouldBlockGrowthTaskSend(params: {
  growthBirthTurn?: boolean;
  growthGateProceed?: boolean;
  hadFirstMissionSent: boolean;
  pending: GrowthPendingTaskContext | null | undefined;
  recommendationGaps?: GrowthCapabilityGapView[];
}): boolean {
  if (params.growthBirthTurn || params.growthGateProceed || params.hadFirstMissionSent) {
    return false;
  }
  const fromPending = unmetSkillKeysFromTaskGaps(params.pending?.taskGaps);
  if (fromPending.length > 0) {
    return true;
  }
  // 分析失败降级也可能只填了 recommendation.gaps
  const fromRecommendation = unmetSkillKeysFromTaskGaps(
    (params.recommendationGaps ?? []).map((gap) => ({
      key: gap.key,
      status: gap.status,
    })),
  );
  return fromRecommendation.length > 0;
}
