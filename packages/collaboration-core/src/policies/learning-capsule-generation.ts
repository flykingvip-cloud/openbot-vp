/**
 * Learning capsule generation (件事二 · Phase 2 「经验提炼」引擎最小实现)。
 *
 * 现状：`GroupMemoryCapsule` 只有类型 + 投影/晋升治理（learning-projection.ts），
 * 但没有「任务运行 → 经验胶囊」的生成器（`reflect|principle|distill` 在 src 下零命中），
 * 胶囊只能靠外部 appendCapsule 手工写入。本模块补上这一段：
 *
 *   一次任务运行(结果 / 人工修改 / 评审)  →  deriveCandidateCapsule  →  status:"candidate"
 *                                                                          │
 *                                        复用现有治理：审批(→approved) → evaluateCapsuleProjectionEligibility
 *                                                                          → 投影/晋升到 AgentLearningAsset
 *
 * 设计约束（安全默认）：
 *  - 纯函数、无 I/O、无 node 依赖，便于单测与在任意收尾点调用。
 *  - 生成物恒为 `status:"candidate"` 且 `reusability:"group_only"`：未经治理审批/升级前
 *    不可投影（投影策略要求 approved 且非 group_only），避免自动学习绕过人工把关。
 *  - `shouldGenerateCapsule` 过滤无学习价值的平凡成功，避免胶囊噪声。
 */

import type {
  CapsuleReusability,
  CapsuleSensitivity,
  CapsuleSourceType,
  GroupMemoryCapsule,
  GroupMemoryCapsuleType,
} from "../types/learning.js";

/** 任务结果三态。 */
export type TaskRunOutcome = "success" | "partial" | "failure";

/** 生成置信度（写入 metadata，供治理审批参考）。 */
export type CapsuleGenerationConfidence = "low" | "medium" | "high";

/** 一次任务运行的可学习信号（生成器输入）。 */
export interface TaskRunLearningSignal {
  groupId: string;
  taskId?: string;
  /** 任务标题（用于胶囊标题）。 */
  title?: string;
  outcome: TaskRunOutcome;
  /** 评审是否被驳回。 */
  reviewRejected?: boolean;
  /** 交付前人工修改次数（如「客户投诉处理」用户修改回复两次）。 */
  humanEditCount?: number;
  /** 是否发生人工接管。 */
  humanTakeover?: boolean;
  /** 发生了什么（观察）。 */
  observation?: string;
  /** 已提炼的经验/原则文本（有则显著提升置信度）。 */
  lesson?: string;
  /** 该方式被验证/复用的次数（如同一交付物/任务的通过次数）；≥阈值的成功项才策展为 pattern。 */
  reuseCount?: number;
  sensitivity?: CapsuleSensitivity;
  createdBy?: string;
  sourceType?: CapsuleSourceType;
  sourceIds?: string[];
  /** 稳定 capsuleId（测试可注入）；缺省由 groupId + taskId/nowMs 组合。 */
  capsuleId?: string;
  nowMs?: number;
}

/** 人工修改达到此次数视为值得沉淀为 lesson。 */
const HUMAN_EDIT_LESSON_THRESHOLD = 2;

/** 成功项达到此复用/验证次数才值得策展为 pattern（否则平凡成功跳过，控噪）。 */
export const PATTERN_REUSE_THRESHOLD = 2;

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 是否值得为这次任务运行生成胶囊。
 * 有可学习信号才生成：非成功 / 评审驳回 / 人工接管 / 有人工修改 / 显式 lesson。
 * 平凡成功（无摩擦、无 lesson）跳过，避免噪声。
 */
export function shouldGenerateCapsule(input: TaskRunLearningSignal): boolean {
  if (input.outcome !== "success") {
    return true;
  }
  if (input.reviewRejected || input.humanTakeover) {
    return true;
  }
  if ((input.humanEditCount ?? 0) >= 1) {
    return true;
  }
  // 多次验证/复用的成功 → 值得策展为 pattern（复用阈值控噪，平凡首次成功仍跳过）。
  if ((input.reuseCount ?? 0) >= PATTERN_REUSE_THRESHOLD) {
    return true;
  }
  return hasText(input.lesson);
}

/** 依信号推断胶囊类型：负向→anti_pattern；有摩擦→lesson；干净成功→pattern。 */
function inferCapsuleType(input: TaskRunLearningSignal): GroupMemoryCapsuleType {
  if (input.reviewRejected || input.outcome === "failure") {
    return "anti_pattern";
  }
  const edits = input.humanEditCount ?? 0;
  if (input.outcome === "partial" || input.humanTakeover || edits >= 1) {
    return "lesson";
  }
  return "pattern";
}

/** 依信号强度 + 是否已有 lesson 文本推断置信度。 */
function inferConfidence(input: TaskRunLearningSignal): CapsuleGenerationConfidence {
  const hasLesson = hasText(input.lesson);
  const strongSignal =
    Boolean(input.reviewRejected) ||
    input.outcome === "failure" ||
    (input.humanEditCount ?? 0) >= HUMAN_EDIT_LESSON_THRESHOLD ||
    (input.reuseCount ?? 0) >= PATTERN_REUSE_THRESHOLD;
  if (hasLesson && strongSignal) {
    return "high";
  }
  if (hasLesson || strongSignal) {
    return "medium";
  }
  return "low";
}

function buildTitle(input: TaskRunLearningSignal, capsuleType: GroupMemoryCapsuleType): string {
  const label = hasText(input.title) ? input.title.trim() : (input.taskId ?? "task");
  return `[${capsuleType}] ${label}`;
}

function buildSummary(input: TaskRunLearningSignal, capsuleType: GroupMemoryCapsuleType): string {
  if (hasText(input.lesson)) {
    return input.lesson.trim();
  }
  if (hasText(input.observation)) {
    return input.observation.trim();
  }
  return `Auto-captured ${capsuleType} from task run (outcome: ${input.outcome}).`;
}

/**
 * 从一次任务运行派生一个 candidate 经验胶囊。
 * 生成物是 `status:"candidate"` 且 `reusability:"group_only"`（安全默认，需治理审批/升级后才可投影）。
 */
export function deriveCandidateCapsule(input: TaskRunLearningSignal): GroupMemoryCapsule {
  const now =
    typeof input.nowMs === "number" && Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const capsuleType = inferCapsuleType(input);
  const reusability: CapsuleReusability = "group_only";
  const capsuleId =
    input.capsuleId?.trim() || `cap-${input.groupId}-${input.taskId ?? String(now)}`;

  return {
    capsuleId,
    groupId: input.groupId,
    sourceType: input.sourceType ?? "task",
    ...(input.sourceIds && input.sourceIds.length > 0 ? { sourceIds: input.sourceIds } : {}),
    capsuleType,
    title: buildTitle(input, capsuleType),
    summary: buildSummary(input, capsuleType),
    structuredContent: {
      outcome: input.outcome,
      reviewRejected: Boolean(input.reviewRejected),
      humanEditCount: input.humanEditCount ?? 0,
      reuseCount: input.reuseCount ?? 0,
      humanTakeover: Boolean(input.humanTakeover),
      ...(hasText(input.observation) ? { observation: input.observation.trim() } : {}),
      ...(hasText(input.lesson) ? { lesson: input.lesson.trim() } : {}),
    },
    sensitivity: input.sensitivity ?? "internal",
    reusability,
    // 生成即候选：交由现有治理审批（→ approved）后才可被投影/晋升。
    status: "candidate",
    ...(hasText(input.createdBy) ? { createdBy: input.createdBy.trim() } : {}),
    createdAt: now,
    updatedAt: now,
    metadata: {
      generated: true,
      generator: "task-run-v1",
      confidence: inferConfidence(input),
    },
  };
}

/**
 * 便捷组合：无学习价值返回 null，否则返回 candidate 胶囊。
 * 典型用法：`const capsule = generateCandidateCapsule(signal); if (capsule) await appendCapsule(groupId, capsule);`
 */
export function generateCandidateCapsule(input: TaskRunLearningSignal): GroupMemoryCapsule | null {
  return shouldGenerateCapsule(input) ? deriveCandidateCapsule(input) : null;
}
