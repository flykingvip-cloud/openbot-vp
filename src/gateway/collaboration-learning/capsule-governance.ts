/**
 * 经验胶囊治理迁移（candidate 胶囊接入审批 UI 的后端）。
 *
 * 任务收尾生成的胶囊为 `status:"candidate"`（见 execution-outcome-capsule.ts），
 * 需人工/治理审批才能进入投影/晋升。本模块提供状态迁移：
 *   candidate → approved（可选同时升级 reusability，否则保持 group_only 不可投影）
 *   candidate | approved → revoked
 *
 * `approved` 只表示内容治理通过，不等于进化控制平面的效果 VERIFIED。
 * 投影/晋升必须再经过 Evolution Control Plane 的 application approval。
 *
 * 纯迁移逻辑（applyCapsuleGovernanceTransition）与存储读写（transitionGroupMemoryCapsule）分离，
 * 便于单测。复用与学习回流(backflow)相同的 learningStorage。
 */

import type {
  CapsuleReusability,
  CapsuleStatus,
  GroupMemoryCapsule,
} from "@openbot/collaboration-core";
import { resolveReusabilityOnApprove } from "./capsule-promotion.js";
import { createWorkspaceCollaborationStores } from "./shared.js";

/** 治理侧可迁移到的目标状态。 */
export type CapsuleGovernanceToStatus = "approved" | "revoked";

export class CapsuleGovernanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapsuleGovernanceError";
  }
}

/** 未标状态的历史胶囊在治理侧按 candidate 处理（显式化，不沿用投影策略的宽松默认）。 */
function normalizeStatus(status: CapsuleStatus | undefined): CapsuleStatus {
  return status ?? "candidate";
}

/**
 * 纯迁移：校验合法性并返回迁移后的胶囊副本（不写存储）。非法迁移抛 CapsuleGovernanceError。
 * 合法：candidate→approved；candidate|approved→revoked。
 */
export function applyCapsuleGovernanceTransition(
  capsule: GroupMemoryCapsule,
  toStatus: CapsuleGovernanceToStatus,
  opts?: { actor?: string; reusability?: CapsuleReusability; nowMs?: number },
): GroupMemoryCapsule {
  const from = normalizeStatus(capsule.status);
  const now = opts?.nowMs ?? Date.now();

  if (toStatus === "approved") {
    if (from !== "candidate") {
      throw new CapsuleGovernanceError(`cannot approve capsule from status "${from}"`);
    }
    const reusability = resolveReusabilityOnApprove(capsule, opts?.reusability);
    return {
      ...capsule,
      status: "approved",
      ...(opts?.actor ? { approvedBy: opts.actor } : {}),
      approvedAt: now,
      reusability,
      updatedAt: now,
    };
  }

  // revoked
  if (from !== "candidate" && from !== "approved") {
    throw new CapsuleGovernanceError(`cannot revoke capsule from status "${from}"`);
  }
  return { ...capsule, status: "revoked", updatedAt: now };
}

/** 读取组胶囊，迁移目标胶囊状态并写回；返回迁移后的胶囊。找不到/非法迁移抛错。 */
export async function transitionGroupMemoryCapsule(params: {
  groupId: string;
  capsuleId: string;
  toStatus: CapsuleGovernanceToStatus;
  actor?: string;
  reusability?: CapsuleReusability;
  nowMs?: number;
}): Promise<GroupMemoryCapsule> {
  const groupId = params.groupId.trim();
  const capsuleId = params.capsuleId.trim();
  if (!groupId || !capsuleId) {
    throw new CapsuleGovernanceError("groupId and capsuleId are required");
  }
  const { learningStorage } = createWorkspaceCollaborationStores();
  const capsules = await learningStorage.readCapsules(groupId);
  const capsule = capsules.find((entry) => entry.capsuleId === capsuleId);
  if (!capsule) {
    throw new CapsuleGovernanceError(`capsule not found: ${capsuleId}`);
  }
  const next = applyCapsuleGovernanceTransition(capsule, params.toStatus, {
    ...(params.actor ? { actor: params.actor } : {}),
    ...(params.reusability ? { reusability: params.reusability } : {}),
    ...(typeof params.nowMs === "number" ? { nowMs: params.nowMs } : {}),
  });
  const nextCapsules = capsules.map((entry) => (entry.capsuleId === capsuleId ? next : entry));
  await learningStorage.writeCapsules(groupId, nextCapsules);
  return next;
}

export async function listCandidateCapsules(params: {
  groupId: string;
}): Promise<GroupMemoryCapsule[]> {
  const groupId = params.groupId.trim();
  if (!groupId) {
    throw new CapsuleGovernanceError("groupId is required");
  }
  const { learningStorage } = createWorkspaceCollaborationStores();
  const capsules = await learningStorage.readCapsules(groupId);
  return capsules.filter((entry) => normalizeStatus(entry.status) === "candidate");
}

export type ApproveCandidateCapsuleResult = {
  capsuleId: string;
  approved: boolean;
  promoted: boolean;
  reason: string;
  assetId?: string;
};

export async function approveCandidateCapsule(params: {
  groupId: string;
  capsuleId: string;
  actorId: string;
  /** Explicit promote target (personal scope / fixture wiring). */
  targetBotId?: string;
}): Promise<ApproveCandidateCapsuleResult> {
  const groupId = params.groupId.trim();
  const capsuleId = params.capsuleId.trim();
  const actorId = params.actorId.trim();
  if (!groupId || !capsuleId) {
    return {
      capsuleId,
      approved: false,
      promoted: false,
      reason: "invalid_request",
    };
  }
  if (!actorId) {
    return {
      capsuleId,
      approved: false,
      promoted: false,
      reason: "actor_required",
    };
  }
  try {
    const { promoteApprovedCapsuleIfEligible } = await import("./capsule-promotion.js");
    const capsule = await transitionGroupMemoryCapsule({
      groupId,
      capsuleId,
      toStatus: "approved",
      actor: actorId,
    });
    const promotion = await promoteApprovedCapsuleIfEligible({
      groupId,
      capsule,
      actor: actorId,
      approvalMode: "approved",
      ...(params.targetBotId?.trim() ? { targetBotId: params.targetBotId.trim() } : {}),
    });
    return {
      capsuleId,
      approved: true,
      promoted: promotion.promoted,
      reason: promotion.reason,
      ...(promotion.assetId ? { assetId: promotion.assetId } : {}),
    };
  } catch (error) {
    const reason =
      error instanceof CapsuleGovernanceError
        ? error.message.includes("not found")
          ? "capsule_not_found"
          : error.message
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      capsuleId,
      approved: false,
      promoted: false,
      reason,
    };
  }
}

export type RejectCandidateCapsuleResult = {
  capsuleId: string;
  rejected: boolean;
  reason: string;
};

export async function rejectCandidateCapsule(params: {
  groupId: string;
  capsuleId: string;
  actorId: string;
  reason?: string;
}): Promise<RejectCandidateCapsuleResult> {
  const groupId = params.groupId.trim();
  const capsuleId = params.capsuleId.trim();
  const actorId = params.actorId.trim();
  if (!groupId || !capsuleId) {
    return { capsuleId, rejected: false, reason: "invalid_request" };
  }
  if (!actorId) {
    return { capsuleId, rejected: false, reason: "actor_required" };
  }
  try {
    await transitionGroupMemoryCapsule({
      groupId,
      capsuleId,
      toStatus: "revoked",
      actor: actorId,
    });
    return {
      capsuleId,
      rejected: true,
      reason: params.reason?.trim() || "rejected",
    };
  } catch (error) {
    const reason =
      error instanceof CapsuleGovernanceError
        ? error.message.includes("not found")
          ? "capsule_not_found"
          : error.message
        : error instanceof Error
          ? error.message
          : String(error);
    return { capsuleId, rejected: false, reason };
  }
}
