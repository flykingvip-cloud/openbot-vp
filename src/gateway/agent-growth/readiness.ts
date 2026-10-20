/**
 * Agent Growth OS — Readiness 计算（spec: agent-growth-lifecycle, P0A 任务 2.1）。
 *
 * 纯函数，无 I/O。信号采集见 signals.ts（2.1a）。
 *
 * 评审决策（RISK-007）：P0A capabilityReadiness 仅依赖 skill；OAuth `"unknown"` 不计分不阻塞。
 * 三态 `requiredPermissionsGranted` 中仅显式 `false`（已检测未授权）才会拉低就绪，
 * 因此 P0A（恒 `"unknown"`）不受影响，未来接入 OAuth 真值后自动收紧。
 */

import type {
  AgentTemplate,
  CapabilityReadinessSignals,
  DimensionWeights,
  GrowthDimension,
} from "./types.js";

function clamp0to100(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

/**
 * 按模板权重对维度加权求和，归一化到 0–100。
 * 仅计入权重 > 0 的维度；`alignment` 仅在模板声明权重时参与（小组）。
 */
export function computeActivationScore(
  dimensions: GrowthDimension,
  template: Pick<AgentTemplate, "dimensionWeights">,
): number {
  const weights = template.dimensionWeights;
  const keys: Array<keyof DimensionWeights> = [
    "identity",
    "capability",
    "knowledge",
    "habits",
    "alignment",
  ];
  let weightedSum = 0;
  let totalWeight = 0;
  for (const key of keys) {
    const weight = weights[key];
    if (typeof weight !== "number" || weight <= 0) {
      continue;
    }
    const dim = dimensions[key];
    const value = typeof dim === "number" ? clamp0to100(dim) : 0;
    weightedSum += value * weight;
    totalWeight += weight;
  }
  if (totalWeight <= 0) {
    return 0;
  }
  return Math.round(weightedSum / totalWeight);
}

const DEFAULT_MIN_IDENTITY = 60;

/**
 * Capability Readiness（Mission Ready 硬门槛）：
 *  identity >= minIdentity AND requiredSkillsInstalled AND requiredPermissionsGranted !== false
 *
 * P0A：permissions 恒 `"unknown"` → 仅 identity + skill 决定（评审决策）。
 */
export function computeCapabilityReadiness(
  dimensions: GrowthDimension,
  template: Pick<AgentTemplate, "minIdentity">,
  signals: CapabilityReadinessSignals,
): boolean {
  const minIdentity = template.minIdentity ?? DEFAULT_MIN_IDENTITY;
  if (clamp0to100(dimensions.identity) < minIdentity) {
    return false;
  }
  if (!signals.requiredSkillsInstalled) {
    return false;
  }
  // 仅显式未授权（false）才阻塞；"unknown"（P0A）与 true 均放行。
  if (signals.requiredPermissionsGranted === false) {
    return false;
  }
  return true;
}

/** Alignment 输入（解耦 collaboration 类型，便于单测）。 */
export type AlignmentInput = {
  coordinatorBotId?: string | null;
  activeBots: Array<{ collaborationRole?: string | null }>;
  /** 显式工作流步骤数（TeamWorkflow.steps.length）。 */
  workflowStepCount?: number;
  /** systemInstructions 含顺序协作描述（P0 heuristic 兜底）。 */
  workflowDescribedInInstructions?: boolean;
  /** governance 已确认默认流程模板。 */
  workflowTemplateConfirmed?: boolean;
};

/** rolesAssigned：存在 coordinator 且每个 active bot 有非空 collaborationRole。 */
export function computeRolesAssigned(input: AlignmentInput): boolean {
  if (!input.coordinatorBotId) {
    return false;
  }
  if (input.activeBots.length === 0) {
    return false;
  }
  return input.activeBots.every(
    (bot) => typeof bot.collaborationRole === "string" && bot.collaborationRole.trim().length > 0,
  );
}

/** workflowDefined：显式 steps，或 instructions 顺序描述，或确认默认模板（任一）。 */
export function computeWorkflowDefined(input: AlignmentInput): boolean {
  if ((input.workflowStepCount ?? 0) > 0) {
    return true;
  }
  return Boolean(input.workflowDescribedInInstructions) || Boolean(input.workflowTemplateConfirmed);
}

/** alignmentComplete = rolesAssigned && workflowDefined（仅协作小组）。 */
export function computeAlignmentComplete(input: AlignmentInput): boolean {
  return computeRolesAssigned(input) && computeWorkflowDefined(input);
}

/** dimensions.alignment 计分：角色 0–50 + 工作流 0–50。 */
export function computeAlignmentDimension(input: AlignmentInput): number {
  const roles = computeRolesAssigned(input) ? 50 : 0;
  const workflow = computeWorkflowDefined(input) ? 50 : 0;
  return roles + workflow;
}

/**
 * P0A capability 维度（0–100），由真实 skill 信号驱动（评审决策：Skill 必须真实接入）。
 * - 模板有 required skill：覆盖率 = 已装 required / required 总数。
 * - 模板无 required skill（generic_worker）：装了任意 skill 即视为具备基础能力
 *   （1 个 → 50，≥2 个 → 100），避免「装了技能 Readiness 不变」的假数据。
 * OAuth 不参与维度计分（P0A `"unknown"`）。
 */
export function computeCapabilityDimension(
  template: Pick<AgentTemplate, "requiredCapabilities">,
  installedSkillKeys: Iterable<string>,
): number {
  const installed = new Set(installedSkillKeys);
  const required = template.requiredCapabilities.filter(
    (cap) => cap.required && cap.kind === "skill",
  );
  if (required.length > 0) {
    const covered = required.filter((cap) => installed.has(cap.key)).length;
    return Math.round((covered / required.length) * 100);
  }
  if (installed.size <= 0) {
    return 0;
  }
  return installed.size >= 2 ? 100 : 50;
}

/**
 * P2 knowledge 维度（0–100）：按模板 `preferredTags` 的覆盖度计分，降低「刷无关文件」收益（task 14.3）。
 * - 无绑定 → 0。
 * - 有绑定但模板未声明 preferredTags（无法判定相关性）→ 60（基础分）。
 * - 有绑定且有 preferredTags → 40 基础 + 60 × 命中标签占比（防刷文件：相关性驱动）。
 */
export function computeKnowledgeDimension(
  template: { knowledgeExpectations?: { preferredTags: string[] } },
  bindingTags: Iterable<string>,
): number {
  const tags = new Set(Array.from(bindingTags, (t) => t.toLowerCase()));
  if (tags.size <= 0) {
    return 0;
  }
  const preferred = (template.knowledgeExpectations?.preferredTags ?? []).map((t) =>
    t.toLowerCase(),
  );
  if (preferred.length === 0) {
    return 60;
  }
  const matched = preferred.filter((tag) => tags.has(tag)).length;
  const ratio = matched / preferred.length;
  return Math.min(100, Math.round(40 + 60 * ratio));
}
