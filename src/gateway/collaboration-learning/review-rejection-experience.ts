/**
 * 评审驳回 → 候选经验胶囊。
 *
 * 本仓库的交付物状态机里没有显式的 "rejected" 状态；真正的驳回信号是
 * **`in_review` → `submitted`**（评审把交付物退回给作者，见
 * `packages/collaboration-core/src/state-machines/deliverable.ts` 的转移表）。
 * 这里只认这一条边，避免把正常的 `submitted → draft` 编辑回退误判成驳回。
 *
 * 与失败复盘一致：产出 `candidate`，不自动晋升，必须走 `capsule-governance` 审批。
 */

import type { Deliverable, GroupMemoryCapsule } from "@openbot/collaboration-core";
import { logVerbose } from "../../globals.js";
import { deriveCandidateCapsule } from "../agent-growth/experience-capsule.js";
import { normalizeConfidentialityTier } from "./shared.js";

/** 判定一次交付物状态变化是否构成评审驳回。 */
export function isReviewRejection(params: {
  fromStatus: Deliverable["status"];
  toStatus: Deliverable["status"];
}): boolean {
  return params.fromStatus === "in_review" && params.toStatus === "submitted";
}

/**
 * 归属主体：被驳回的工作属于提交者。
 * 没有提交者时回落到创建者；都没有则无法归属，不产出胶囊。
 */
export function resolveRejectedDeliverableOwner(deliverable: Deliverable): string | null {
  return deliverable.submittedBy?.trim() || deliverable.createdBy?.trim() || null;
}

export function buildReviewRejectionCapsule(params: {
  deliverable: Deliverable;
  actor?: string;
  confidentialityTier?: string | null;
  atMs?: number;
}): GroupMemoryCapsule | null {
  const botId = resolveRejectedDeliverableOwner(params.deliverable);
  if (!botId) {
    return null;
  }
  const title = params.deliverable.title?.trim();
  return deriveCandidateCapsule({
    trigger: "review_rejected",
    scopeId: params.deliverable.groupId,
    botId,
    reason: "deliverable_returned_from_review",
    detail: [
      title ? `交付物「${title}」被评审退回` : "交付物被评审退回",
      params.actor?.trim() ? `退回人：${params.actor.trim()}` : "",
    ]
      .filter(Boolean)
      .join("；"),
    confidentialityTier: normalizeConfidentialityTier(params.confidentialityTier),
    sourceIds: [params.deliverable.deliverableId],
    ...(params.atMs !== undefined ? { atMs: params.atMs } : {}),
  });
}

/** 落盘（fire-and-forget 语义由调用方决定）；重复驳回同一交付物只保留最新一条候选。 */
export async function recordReviewRejectionExperience(params: {
  deliverable: Deliverable;
  fromStatus: Deliverable["status"];
  actor?: string;
  learningStorage: {
    readCapsules: (groupId: string) => Promise<GroupMemoryCapsule[]>;
    writeCapsules: (groupId: string, capsules: GroupMemoryCapsule[]) => Promise<void>;
    appendCapsule: (groupId: string, capsule: GroupMemoryCapsule) => Promise<void>;
  };
  metadataStorage?: {
    readGroupCapabilities: (
      groupId: string,
    ) => Promise<{ confidentialityTier?: string | null } | null>;
  };
  atMs?: number;
}): Promise<{ capsuleId?: string; skipped?: string }> {
  if (!isReviewRejection({ fromStatus: params.fromStatus, toStatus: params.deliverable.status })) {
    return { skipped: "not_a_review_rejection" };
  }
  const capabilities = await params.metadataStorage
    ?.readGroupCapabilities(params.deliverable.groupId)
    .catch(() => null);
  const capsule = buildReviewRejectionCapsule({
    deliverable: params.deliverable,
    ...(params.actor ? { actor: params.actor } : {}),
    confidentialityTier: capabilities?.confidentialityTier ?? null,
    ...(params.atMs !== undefined ? { atMs: params.atMs } : {}),
  });
  if (!capsule) {
    return { skipped: "missing_deliverable_owner" };
  }

  const existing = await params.learningStorage.readCapsules(params.deliverable.groupId);
  const supersededIds = new Set(
    existing
      .filter(
        (entry) =>
          entry.status === "candidate" &&
          entry.metadata?.trigger === "review_rejected" &&
          entry.sourceIds?.includes(params.deliverable.deliverableId),
      )
      .map((entry) => entry.capsuleId),
  );
  if (supersededIds.size > 0) {
    await params.learningStorage.writeCapsules(
      params.deliverable.groupId,
      existing.filter((entry) => !supersededIds.has(entry.capsuleId)),
    );
  }
  await params.learningStorage.appendCapsule(params.deliverable.groupId, capsule);
  return { capsuleId: capsule.capsuleId };
}

/** 永不 reject 的包装：状态机转移不能因为经验提炼失败而回滚。 */
export function recordReviewRejectionExperienceSafely(
  params: Parameters<typeof recordReviewRejectionExperience>[0],
): void {
  void recordReviewRejectionExperience(params)
    .then((result) => {
      if (result.capsuleId) {
        logVerbose(
          `review rejection experience: deliverable=${params.deliverable.deliverableId} capsule=${result.capsuleId}`,
        );
      }
    })
    .catch((err) => {
      logVerbose(`review rejection experience failed: ${String(err)}`);
    });
}
