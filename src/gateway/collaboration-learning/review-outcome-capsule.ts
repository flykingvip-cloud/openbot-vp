/**
 * 评审收尾 → 经验胶囊生成的接线（Part 2：更丰富的任务收尾信号）。
 *
 * 相较 execution-outcome-capsule（只在 execution 记录 `failed` 时产出），评审收尾携带
 * 质量判定(verdict) + deliverable 修订/复用统计，让「已完成」的工作也能沉淀经验：
 *   verdict "reject" → outcome failure + reviewRejected → anti_pattern
 *   verdict "revise" → outcome partial + humanEditCount(=deliverable 修订次数) → lesson
 *   verdict "approve" + 同 lineage 跨任务复用数 ≥ 复用阈值 → outcome success + reuseCount → pattern
 *   否则（approve 未达阈值 / 无 verdict / 未 resolved）→ 跳过（不为每次通过刷 pattern）
 *
 * humanEditCount 来源：deliverable.version-1（真实修订次数）；reuseCount 取两者较大者：
 * (1) 同 sourceLineageId 下产出过已批准/已发布 deliverable 的**不同 taskId 数**（跨任务复用，非多版本膨胀）；
 * (2) **学习资产实际应用强度**（资产被读入运行时的最大次数，见 learning-asset-application-store.ts）——
 * 更能反映知识是否真的被反复复用。
 * comments→lesson 文本、suggestions→observation。复用 backflow 同款 learningStorage；产出 candidate 待审批。
 * 全程 fire-and-forget，try/catch 包裹，绝不影响评审状态迁移。
 */

import {
  generateCandidateCapsule,
  PATTERN_REUSE_THRESHOLD,
  type Deliverable,
  type Review,
  type TaskRunLearningSignal,
} from "@openbot/collaboration-core";
import {
  nativeMechanismClusterMetadata,
  SKILL_INVOCATION_DIAGNOSER,
  SKILL_INVOCATION_MECHANISM_VERSION,
} from "@openbot/evolution-core";
import { logVerbose } from "../../globals.js";
import { inspectTaskBoundFailureMechanism } from "../evolution-control/turn-sensors.js";
import { resolveLearningReuseForDeliverables } from "./learning-asset-application-store.js";
import { createWorkspaceCollaborationStores } from "./shared.js";

/** 评审信号映射的富信号入参（由存储侧计算后传入，保持纯函数可测）。 */
export type ReviewLearningOpts = {
  /** deliverable 真实修订次数（version-1），作为 humanEditCount 来源。 */
  deliverableRevisions?: number;
  /** 同 lineage 的已批准/发布次数，作为 approve→pattern 的复用计数。 */
  reuseCount?: number;
};

/**
 * 把已 resolved 的评审映射为可学习信号。
 * reject→failure(anti_pattern)；revise→partial+edits(lesson)；approve 仅在 reuseCount≥阈值时→success(pattern)。
 * 未 resolved / 无 verdict / approve 未达复用阈值 → null。纯函数，便于单测。
 */
export function reviewToLearningSignal(
  review: Review,
  opts?: ReviewLearningOpts,
): TaskRunLearningSignal | null {
  if (review.status !== "resolved") {
    return null;
  }
  const verdict = review.verdict;
  const revisions = Math.max(0, Math.trunc(opts?.deliverableRevisions ?? 0));
  const lesson = review.comments?.trim();
  const suggestions = (review.suggestions ?? [])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const sourceIds = [review.reviewId, review.deliverableId].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const base = {
    groupId: review.groupId,
    taskId: review.taskId ?? review.reviewId,
    title: review.deliverableId
      ? `review ${review.reviewId} · ${review.deliverableId}`
      : `review ${review.reviewId}`,
    createdBy: review.resolvedBy ?? review.reviewerMemberId,
    sourceType: "review" as const,
    ...(sourceIds.length > 0 ? { sourceIds } : {}),
    ...(lesson ? { lesson } : {}),
    ...(suggestions.length > 0 ? { observation: suggestions.join("; ") } : {}),
  };

  if (verdict === "approve") {
    const reuseCount = Math.max(0, Math.trunc(opts?.reuseCount ?? 0));
    // 仅反复验证过的成功才策展为 pattern（阈值控噪；未达阈值不产出）。
    if (reuseCount < PATTERN_REUSE_THRESHOLD) {
      return null;
    }
    return { ...base, outcome: "success", reuseCount };
  }

  if (verdict !== "reject" && verdict !== "revise") {
    return null;
  }
  return {
    ...base,
    outcome: verdict === "reject" ? "failure" : "partial",
    reviewRejected: verdict === "reject",
    // revise 至少计一次人工修正；否则用真实修订次数。
    humanEditCount: verdict === "revise" ? Math.max(1, revisions) : revisions,
  };
}

export type ReviewOutcomeCapsuleResult = {
  capsuleId?: string;
  skipped?: string;
};

/**
 * 真实「跨任务复用」计数：同一 `sourceLineageId` 下、产出过已批准/已发布 deliverable 的**不同 taskId 数**。
 * 用 distinct taskId 而非 deliverable 计数，避免同一任务的多版本把复用数灌水（纯函数，便于单测）。
 * 无 taskId 的 deliverable 以其 id 兜底各算一次。
 */
export function countCrossTaskReuse(deliverables: Deliverable[], lineageId: string): number {
  const target = lineageId.trim();
  if (!target) {
    return 0;
  }
  const reusedTaskIds = new Set<string>();
  for (const entry of deliverables) {
    if (
      entry.sourceLineageId?.trim() === target &&
      (entry.status === "approved" || entry.status === "published")
    ) {
      reusedTaskIds.add(entry.taskId?.trim() || `deliverable:${entry.deliverableId}`);
    }
  }
  return reusedTaskIds.size;
}

/** 由存储计算 deliverable 修订次数与同 lineage 的跨任务复用数。 */
async function resolveReviewLearningOpts(review: Review): Promise<ReviewLearningOpts> {
  const { objectStorage } = createWorkspaceCollaborationStores();
  const deliverable = review.deliverableId
    ? await objectStorage.readObject<Deliverable>(
        review.groupId,
        "deliverable",
        review.deliverableId,
      )
    : null;
  const deliverableRevisions = deliverable ? Math.max(0, (deliverable.version ?? 1) - 1) : 0;

  let crossTaskReuse = 0;
  let lineageDeliverableIds: string[] = [];
  const lineageId = deliverable?.sourceLineageId?.trim();
  if (lineageId) {
    const deliverables = await objectStorage.listObjects<Deliverable>(
      review.groupId,
      "deliverable",
    );
    crossTaskReuse = countCrossTaskReuse(deliverables, lineageId);
    lineageDeliverableIds = deliverables
      .filter((entry) => entry.sourceLineageId?.trim() === lineageId)
      .map((entry) => entry.deliverableId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }
  // 更强的复用信号：取"跨任务复用"与"该 lineage 相关学习资产的实际应用强度"的较大者。
  // 后者细化到 pattern 具体来源（该 lineage 派生的资产被反复应用到运行时），见 learning-asset-application-store.ts。
  const learningReuse =
    lineageDeliverableIds.length > 0
      ? await resolveLearningReuseForDeliverables(review.groupId, lineageDeliverableIds)
      : 0;
  return { deliverableRevisions, reuseCount: Math.max(crossTaskReuse, learningReuse) };
}

/** Stamp a native cluster only from a task-bound trusted mechanism. */
export function stampReviewCapsuleCluster(
  capsule: { metadata?: Record<string, unknown> },
  review: Pick<Review, "taskId">,
  inspect: typeof inspectTaskBoundFailureMechanism = inspectTaskBoundFailureMechanism,
): void {
  const taskId = review.taskId?.trim();
  if (!taskId) {
    return;
  }
  const mechanism = inspect({ taskId });
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

/** 生成并持久化 candidate 胶囊（无学习价值时跳过）。可 await（供测试）。 */
export async function recordReviewOutcomeCapsule(
  review: Review,
): Promise<ReviewOutcomeCapsuleResult> {
  const opts = await resolveReviewLearningOpts(review);
  const signal = reviewToLearningSignal(review, opts);
  if (!signal) {
    return { skipped: "no_learnable_signal" };
  }
  const capsule = generateCandidateCapsule(signal);
  if (!capsule) {
    return { skipped: "not_worth_capturing" };
  }
  // Review taskIds stay instance keys. Cluster requires an explicit task-bound
  // skill-invocation mechanism, never time proximity or review text.
  void signal.taskId;
  stampReviewCapsuleCluster(capsule, review);
  const { learningStorage } = createWorkspaceCollaborationStores();
  await learningStorage.appendCapsule(signal.groupId, capsule);
  return { capsuleId: capsule.capsuleId };
}

/** Fire-and-forget 包裹：绝不抛出，仅记 verbose 日志。用于评审迁移后的旁路调用。 */
export async function recordReviewOutcomeCapsuleSafely(review: Review): Promise<void> {
  try {
    const result = await recordReviewOutcomeCapsule(review);
    logVerbose(
      `review-outcome capsule: group=${review.groupId} review=${review.reviewId} ` +
        `verdict=${review.verdict ?? "none"} capsule=${result.capsuleId ?? "none"} ` +
        `skipped=${result.skipped ?? "none"}`,
    );
  } catch (err) {
    logVerbose(`review-outcome capsule failed: ${String(err)}`);
  }
}
