/**
 * 协作生命周期 → operational satisfaction（best-effort，与 task/deliverable/review/memory flush 统一）。
 *
 * task/deliverable 状态迁移、评审 resolved、memory flush 成功完成时，向对应 agent 写入
 * satisfaction 累加器（仅已知 agent id；用户 id 会被忽略）。
 */

import type { Deliverable, Review, ReviewVerdict, Task } from "@openbot/collaboration-core";
import { listAgentIds } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/config.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  recordSatisfactionOutcome,
  satisfactionPolarityFromStatus,
} from "../agent-growth/operational-metrics-store.js";
import { recordCollaborationQualityBestEffort } from "../collaboration-ledger/writer.js";
import { createWorkspaceCollaborationStores, resolveCollaborationGroupTenantId } from "./shared.js";

/**
 * 向已知 agent 写入显式满意度（positive/negative）。非 agent id 或无配置 agent 时静默跳过。
 */
export async function recordCollaborationSatisfactionBestEffort(params: {
  agentId?: string;
  positive: boolean;
  groupId?: string;
  taskId?: string;
  deliverableId?: string;
  reviewId?: string;
}): Promise<void> {
  const raw = params.agentId?.trim();
  if (!raw) {
    return;
  }
  try {
    const cfg = loadConfig();
    const agentId = normalizeAgentId(raw);
    if (!listAgentIds(cfg).includes(agentId)) {
      return;
    }
    await recordSatisfactionOutcome(cfg, agentId, { positive: params.positive });
    if (params.groupId?.trim()) {
      const groupId = params.groupId.trim();
      const tenantId = resolveCollaborationGroupTenantId(groupId);
      recordCollaborationQualityBestEffort({
        groupId,
        event: "human_feedback",
        outcome: params.positive ? "accepted" : "rejected",
        agentId,
        ...(tenantId ? { tenantId } : {}),
        ...(params.taskId ? { taskId: params.taskId } : {}),
        ...(params.deliverableId ? { deliverableId: params.deliverableId } : {}),
        ...(params.reviewId ? { reviewId: params.reviewId } : {}),
        humanFeedback: params.positive ? "positive" : "negative",
      });
    }
  } catch {
    // best-effort only
  }
}

/** 从候选 id 中解析第一个已配置的 agent id（忽略 human operator id）。 */
export function resolveKnownCollaborationAgentId(
  cfg: OpenBotConfig,
  ...candidates: Array<string | undefined>
): string | undefined {
  const agents = listAgentIds(cfg);
  for (const raw of candidates) {
    const trimmed = raw?.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = normalizeAgentId(trimmed);
    if (agents.includes(normalized)) {
      return normalized;
    }
  }
  return undefined;
}

/** Task 终态满意度归属：assigned bot > owner > createdBy（不用 UI operator actor）。 */
export function resolveTaskSatisfactionAgentId(task: Task, cfg: OpenBotConfig): string | undefined {
  for (const memberId of task.assignedMemberIds ?? []) {
    const resolved = resolveKnownCollaborationAgentId(cfg, memberId);
    if (resolved) {
      return resolved;
    }
  }
  return resolveKnownCollaborationAgentId(cfg, task.ownerMemberId, task.createdBy, task.updatedBy);
}

/** Task 状态迁移 → 对执行 bot 记满意度（best-effort）。 */
export async function recordTaskTransitionSatisfactionBestEffort(task: Task): Promise<void> {
  const polarity = satisfactionPolarityFromStatus(task.status);
  if (polarity === null) {
    return;
  }
  const cfg = loadConfig();
  const agentId = resolveTaskSatisfactionAgentId(task, cfg);
  await recordCollaborationSatisfactionBestEffort({
    agentId,
    positive: polarity,
    groupId: task.groupId,
    taskId: task.taskId,
  });
}

/** Deliverable 状态迁移 → 对提交者记满意度（best-effort）。 */
export async function recordDeliverableTransitionSatisfactionBestEffort(
  deliverable: Deliverable,
): Promise<void> {
  const polarity = satisfactionPolarityFromStatus(deliverable.status);
  if (polarity === null) {
    return;
  }
  const cfg = loadConfig();
  const agentId = resolveKnownCollaborationAgentId(
    cfg,
    deliverable.submittedBy,
    deliverable.createdBy,
  );
  await recordCollaborationSatisfactionBestEffort({
    agentId,
    positive: polarity,
    groupId: deliverable.groupId,
    taskId: deliverable.taskId,
    deliverableId: deliverable.deliverableId,
  });
}

/** 评审 verdict → 满意度极性；无 verdict 时不记录。 */
export function satisfactionPolarityFromReviewVerdict(
  verdict: ReviewVerdict | undefined,
): boolean | null {
  switch (verdict) {
    case "approve":
      return true;
    case "reject":
    case "revise":
      return false;
    default:
      return null;
  }
}

/**
 * 评审 resolved → 对 deliverable 提交者（非 reviewer）记满意度。
 * approve 为正；reject/revise 为负。
 */
export async function recordReviewResolutionSatisfactionBestEffort(review: Review): Promise<void> {
  if (review.status !== "resolved") {
    return;
  }
  const polarity = satisfactionPolarityFromReviewVerdict(review.verdict);
  if (polarity === null) {
    return;
  }
  let agentId = review.submittedBy?.trim();
  if (review.deliverableId) {
    try {
      const { objectStorage } = createWorkspaceCollaborationStores();
      const deliverable = await objectStorage.readObject<Deliverable>(
        review.groupId,
        "deliverable",
        review.deliverableId,
      );
      agentId = deliverable?.submittedBy?.trim() || agentId;
    } catch {
      // fall back to review.submittedBy
    }
  }
  await recordCollaborationSatisfactionBestEffort({
    agentId,
    positive: polarity,
    groupId: review.groupId,
    taskId: review.taskId,
    deliverableId: review.deliverableId,
    reviewId: review.reviewId,
  });
}

/** 协作上下文内 memory flush 成功完成 → 对执行 bot 记正向满意度。 */
export async function recordMemoryFlushSatisfactionBestEffort(params: {
  botId?: string;
}): Promise<void> {
  await recordCollaborationSatisfactionBestEffort({
    agentId: params.botId,
    positive: true,
  });
}
