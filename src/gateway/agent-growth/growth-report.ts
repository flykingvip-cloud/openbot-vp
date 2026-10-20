/**
 * Agent Growth OS — Growth Report 聚合（spec: agent-growth-lifecycle, P2 任务 14.1）。
 *
 * 由活动量 + 实战率 + 业务影响构建 GrowthReportSnapshot（design §9）。纯函数，无 I/O。
 * Evolution 阶段 UI 优先展示 businessImpact，其次才是 toolInvocations。
 */

import { computeBusinessImpact, type BusinessImpactInput } from "./impact-metrics.js";
import type { GrowthReportSnapshot, ImpactMetric } from "./types.js";

/** 单个任务节省工时的默认估算（分钟）；hoursSavedEstimate 未显式给出时使用。 */
const DEFAULT_MINUTES_SAVED_PER_TASK = 20;

export type GrowthReportInput = {
  periodDays: number;
  generatedAtMs: number;
  tasksCompleted: number;
  learningMaterialsCount: number;
  toolInvocations: number;
  collaborationMemberCount?: number | null;
  hoursSavedEstimate?: number | null;
  taskSuccessRate?: number | null;
  toolSuccessRate?: number | null;
  humanTakeoverRate?: number | null;
  /** 业务影响计数（领域相关）；或直接提供 businessImpact 列表。 */
  businessImpactInput?: BusinessImpactInput;
  businessImpact?: ImpactMetric[];
  topInsights?: string[];
  suggestedWorkflows?: string[];
};

function nonNegative(value: number | undefined | null): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** 估算节省工时（小时）：显式优先，否则 tasksCompleted × 默认每任务分钟数 / 60。 */
export function estimateHoursSaved(
  input: Pick<GrowthReportInput, "tasksCompleted" | "hoursSavedEstimate">,
): number {
  if (typeof input.hoursSavedEstimate === "number" && Number.isFinite(input.hoursSavedEstimate)) {
    return Math.max(0, input.hoursSavedEstimate);
  }
  const minutes = nonNegative(input.tasksCompleted) * DEFAULT_MINUTES_SAVED_PER_TASK;
  return Math.round((minutes / 60) * 10) / 10;
}

/** 构建 Growth Report 快照。businessImpact 显式优先，否则由计数输入推导。 */
export function buildGrowthReportSnapshot(input: GrowthReportInput): GrowthReportSnapshot {
  const businessImpact = input.businessImpact ?? computeBusinessImpact(input.businessImpactInput);
  return {
    periodDays: input.periodDays,
    generatedAtMs: input.generatedAtMs,
    tasksCompleted: nonNegative(input.tasksCompleted),
    hoursSavedEstimate: estimateHoursSaved(input),
    learningMaterialsCount: nonNegative(input.learningMaterialsCount),
    toolInvocations: nonNegative(input.toolInvocations),
    collaborationMemberCount: input.collaborationMemberCount ?? null,
    taskSuccessRate: input.taskSuccessRate ?? null,
    toolSuccessRate: input.toolSuccessRate ?? null,
    humanTakeoverRate: input.humanTakeoverRate ?? null,
    businessImpact,
    ...(input.topInsights ? { topInsights: input.topInsights } : {}),
    ...(input.suggestedWorkflows ? { suggestedWorkflows: input.suggestedWorkflows } : {}),
  };
}
