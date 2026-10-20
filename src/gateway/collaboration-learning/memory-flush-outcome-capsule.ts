/**
 * Memory flush → 经验胶囊（与 task/review 治理统一）。
 *
 * 原先 backflow 产出 `status:"approved"` 并自动投影/晋升，绕过治理审批。
 * 现与 execution-outcome-capsule / review-outcome-capsule 对齐：
 *   - 产出 `status:"candidate"` + `reusability:"group_only"`
 *   - 仅 appendCapsule，不自动 promote
 *   - 治理侧 `collaboration.capsule.transition(approved)` → promoteApprovedCapsuleIfEligible
 *   - 协作 flush 成功 → `recordMemoryFlushSatisfactionBestEffort`（与 task/review 共用 satisfaction 模块）
 */

import {
  generateCandidateCapsule,
  type CapsuleSensitivity,
  type GroupMemoryCapsule,
  type ParticipationConfidentialityTier,
  type TaskRunLearningSignal,
} from "@openbot/collaboration-core";
import { logVerbose } from "../../globals.js";
import { createWorkspaceCollaborationStores } from "./shared.js";

export type MemoryFlushOutcomeInput = {
  groupId: string;
  botId: string;
  participationId?: string;
  confidentialityTier: ParticipationConfidentialityTier;
  memoryFlushWritePath: string;
  appendedMarkdown: string;
  flushedAt: number;
  memoryCompactionCompleted: boolean;
  workspaceDir: string;
  sessionKey?: string;
  sessionId?: string;
};

function mapTierToSensitivity(tier: ParticipationConfidentialityTier): CapsuleSensitivity {
  switch (tier) {
    case "public":
      return "public";
    case "restricted":
      return "restricted";
    case "secret":
      return "secret";
    default:
      return "internal";
  }
}

function stripMarkdownLine(line: string): string {
  return line.replace(/^\s*(?:[#>*-]+|\d+\.)\s*/, "").trim();
}

function buildCapsuleSummary(markdown: string): { title?: string; summary?: string } {
  const lines = markdown
    .split(/\r?\n+/)
    .map(stripMarkdownLine)
    .filter((line) => line.length > 0);
  const title = lines[0]?.slice(0, 120);
  const summary = lines.slice(0, 3).join(" ").slice(0, 600);
  return {
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
  };
}

/** 纯函数：memory flush 内容 → 可学习信号（与 task/review 生成器共用 core）。 */
export function memoryFlushToLearningSignal(input: MemoryFlushOutcomeInput): TaskRunLearningSignal {
  const { title, summary } = buildCapsuleSummary(input.appendedMarkdown);
  const sourceIds = [
    ...(input.sessionId ? [input.sessionId] : []),
    ...(input.sessionKey ? [input.sessionKey] : []),
    input.memoryFlushWritePath,
  ];
  return {
    groupId: input.groupId,
    taskId: input.sessionKey ?? input.sessionId,
    title: title ?? "Memory flush lesson",
    // 预压实记忆提炼：有明确 lesson 文本，按 partial 沉淀（非平凡 success）。
    outcome: "partial",
    lesson: summary ?? input.appendedMarkdown.slice(0, 600),
    observation: "Pre-compaction memory flush distilled session notes.",
    createdBy: input.botId,
    sourceType: "memory",
    ...(sourceIds.length > 0 ? { sourceIds } : {}),
    sensitivity: mapTierToSensitivity(input.confidentialityTier),
    nowMs: input.flushedAt,
  };
}

/** 在 candidate 基座上保留 memory flush 专有 structuredContent / metadata。 */
export function buildMemoryFlushCandidateCapsule(
  input: MemoryFlushOutcomeInput,
): GroupMemoryCapsule | null {
  const signal = memoryFlushToLearningSignal(input);
  const base = generateCandidateCapsule(signal);
  if (!base) {
    return null;
  }
  const { title, summary } = buildCapsuleSummary(input.appendedMarkdown);
  return {
    ...base,
    sourceType: "memory",
    capsuleType: "lesson",
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
    sensitivity: mapTierToSensitivity(input.confidentialityTier),
    structuredContent: {
      ...(typeof base.structuredContent === "object" && base.structuredContent
        ? base.structuredContent
        : {}),
      memoryFlushWritePath: input.memoryFlushWritePath,
      appendedMarkdown: input.appendedMarkdown.slice(0, 8_000),
      memoryCompactionCompleted: input.memoryCompactionCompleted,
      workspaceDir: input.workspaceDir,
    },
    metadata: {
      ...base.metadata,
      origin: "memory_flush",
      generator: "memory-flush-v1",
      ...(input.participationId ? { sourceParticipationId: input.participationId } : {}),
    },
  };
}

export type MemoryFlushOutcomeCapsuleResult = {
  capsuleId?: string;
  skipped?: string;
};

/** 生成并持久化 candidate 胶囊（不自动投影/晋升）。 */
export async function recordMemoryFlushOutcomeCapsule(
  input: MemoryFlushOutcomeInput,
): Promise<MemoryFlushOutcomeCapsuleResult> {
  const capsule = buildMemoryFlushCandidateCapsule(input);
  if (!capsule) {
    return { skipped: "not_worth_capturing" };
  }
  const { learningStorage } = createWorkspaceCollaborationStores();
  await learningStorage.appendCapsule(input.groupId, capsule);
  return { capsuleId: capsule.capsuleId };
}

/** Fire-and-forget 包裹：绝不抛出。 */
export async function recordMemoryFlushOutcomeCapsuleSafely(
  input: MemoryFlushOutcomeInput,
): Promise<void> {
  try {
    const result = await recordMemoryFlushOutcomeCapsule(input);
    logVerbose(
      `memory-flush-outcome capsule: group=${input.groupId} bot=${input.botId} ` +
        `capsule=${result.capsuleId ?? "none"} skipped=${result.skipped ?? "none"}`,
    );
  } catch (err) {
    logVerbose(`memory-flush-outcome capsule failed: ${String(err)}`);
  }
}
