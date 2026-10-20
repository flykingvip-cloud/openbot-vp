/**
 * 任务收尾 → 经验胶囊生成的接线（件事二的运行时接入）。
 *
 * 缝：group 协作轮次里每个 bot 完成/跳过/失败其回合时，`appendCollaborationExecutionRecord`
 * 是唯一咽喉点（src/gateway/collaboration-ledger/writer.ts，被 chat.ts 的 4 处调用共用）。
 * 本模块在该点把「任务结果」映射为可学习信号，交给 core 的 `generateCandidateCapsule`
 * 产出 **candidate** 胶囊，并复用与学习回流(backflow)相同的 `learningStorage` 持久化。
 *
 * 与 memory-flush-outcome-capsule / review-outcome-capsule 的区别（统一治理后）：
 *  - 三者均产出 `status:"candidate"` + `group_only`，**不自动投影**，等治理审批/升级后才可复用。
 *  - memory flush 曾自动 approved+promote，已收敛为同一 candidate 路径（见 memory-flush-outcome-capsule.ts）。
 *
 * 噪声控制：仅 `failed`（明确失败）值得沉淀为经验；`completed` 无摩擦信号 → 生成器自会跳过；
 * `skipped` 非任务失败 → 不学习。故 v1 实际只在失败时产出 anti_pattern 候选。
 *
 * 安全：全程 fire-and-forget，try/catch 包裹，绝不阻塞或影响账本写入与回复路径。
 */

import { generateCandidateCapsule, type TaskRunLearningSignal } from "@openbot/collaboration-core";
import {
  nativeMechanismClusterMetadata,
  SKILL_INVOCATION_DIAGNOSER,
  SKILL_INVOCATION_MECHANISM_VERSION,
} from "@openbot/evolution-core";
import { logVerbose } from "../../globals.js";
import type { CollaborationExecutionRecord } from "../collaboration-ledger/types.js";
import {
  inspectTurnFailureMechanism,
  inspectTurnSensorsFromSkillInvocations,
} from "../evolution-control/turn-sensors.js";
import { createWorkspaceCollaborationStores } from "./shared.js";

/**
 * 把 execution 账本记录映射为可学习信号；无学习价值（非 failed）→ null。
 * 纯函数，便于单测。
 */
export function executionRecordToLearningSignal(
  record: CollaborationExecutionRecord,
): TaskRunLearningSignal | null {
  // 只有明确失败才值得沉淀：completed 由生成器按无摩擦跳过，skipped 非任务失败不学习。
  if (record.status !== "failed") {
    return null;
  }
  const sourceIds = [record.sessionKey, record.roundId].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return {
    groupId: record.groupId,
    taskId: record.roundId,
    title: record.agentName ? `${record.agentName} · round ${record.roundId}` : record.roundId,
    outcome: "failure",
    createdBy: record.agentId,
    sourceType: "task",
    ...(sourceIds.length > 0 ? { sourceIds } : {}),
    ...(record.contributionRole
      ? { observation: `contributionRole=${record.contributionRole}` }
      : {}),
  };
}

export type ExecutionOutcomeCapsuleResult = {
  capsuleId?: string;
  skipped?: string;
};

/** Stamp security only when a real turn inspection returned a boolean. */
export function stampExecutionCapsuleSecurity(
  capsule: { metadata?: Record<string, unknown> },
  record: Pick<CollaborationExecutionRecord, "agentId" | "recordedAtMs" | "latencyMs">,
  inspect: typeof inspectTurnSensorsFromSkillInvocations = inspectTurnSensorsFromSkillInvocations,
): void {
  if (typeof record.latencyMs !== "number" || !Number.isFinite(record.latencyMs)) {
    return;
  }
  const sensors = inspect({
    agentId: record.agentId,
    startedAt: record.recordedAtMs - record.latencyMs,
    endedAt: record.recordedAtMs,
  });
  if (typeof sensors.securityViolation === "boolean") {
    capsule.metadata = {
      ...capsule.metadata,
      securityViolation: sensors.securityViolation,
    };
  }
}

/** Stamp a native cluster only from a unique trusted turn mechanism. */
export function stampExecutionCapsuleCluster(
  capsule: { metadata?: Record<string, unknown> },
  record: Pick<CollaborationExecutionRecord, "agentId" | "recordedAtMs" | "latencyMs">,
  inspect: typeof inspectTurnFailureMechanism = inspectTurnFailureMechanism,
): void {
  if (typeof record.latencyMs !== "number" || !Number.isFinite(record.latencyMs)) {
    return;
  }
  const mechanism = inspect({
    agentId: record.agentId,
    startedAt: record.recordedAtMs - record.latencyMs,
    endedAt: record.recordedAtMs,
  });
  const stamped = mechanism
    ? nativeMechanismClusterMetadata({
        diagnoserOrDomain: SKILL_INVOCATION_DIAGNOSER,
        cause: mechanism.cause,
        mechanismVersion: SKILL_INVOCATION_MECHANISM_VERSION,
      })
    : undefined;
  if (!stamped) {
    return;
  }
  capsule.metadata = {
    ...capsule.metadata,
    ...stamped,
  };
}

/** 生成并持久化 candidate 胶囊（无学习价值时跳过）。可 await（供测试/未来同步调用）。 */
export async function recordExecutionOutcomeCapsule(
  record: CollaborationExecutionRecord,
): Promise<ExecutionOutcomeCapsuleResult> {
  const signal = executionRecordToLearningSignal(record);
  if (!signal) {
    return { skipped: "no_learnable_signal" };
  }
  const capsule = generateCandidateCapsule(signal);
  if (!capsule) {
    return { skipped: "not_worth_capturing" };
  }
  // Task IDs stay instance keys. Cluster is stamped only when the turn has
  // exactly one trusted skill-invocation mechanism.
  void signal.taskId;
  stampExecutionCapsuleCluster(capsule, record);
  stampExecutionCapsuleSecurity(capsule, record);
  const { learningStorage } = createWorkspaceCollaborationStores();
  await learningStorage.appendCapsule(signal.groupId, capsule);
  return { capsuleId: capsule.capsuleId };
}

/** Fire-and-forget 包裹：绝不抛出，仅记 verbose 日志。用于账本写入后的旁路调用。 */
export async function recordExecutionOutcomeCapsuleSafely(
  record: CollaborationExecutionRecord,
): Promise<void> {
  try {
    const result = await recordExecutionOutcomeCapsule(record);
    logVerbose(
      `execution-outcome capsule: group=${record.groupId} round=${record.roundId} ` +
        `status=${record.status} capsule=${result.capsuleId ?? "none"} skipped=${result.skipped ?? "none"}`,
    );
  } catch (err) {
    logVerbose(`execution-outcome capsule failed: ${String(err)}`);
  }
}
