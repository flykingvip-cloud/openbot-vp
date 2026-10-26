/**
 * T36 M1 — controlled composition-root entry for wake-op release / confirm.
 *
 * Resolves the subject from durable operating state + task responsibility
 * (not caller-supplied identitySource / operatingState / approver lists).
 * Mints a branded WakeOpRecoverySubject; internal ledger execute refuses
 * self-constructed identity tags.
 *
 * Inventory (T36): production RPC for release/confirm is not registered yet.
 * All internal library callers must go through this entry (or tests that mint
 * via resolveWakeOpRecoverySubjectForAction). Direct ledger calls with forged
 * operator objects are refused at runtime.
 */
import type { Task } from "@openbot/collaboration-core";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { RuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import {
  confirmWakeOpCompleted as confirmWakeOpCompletedExecute,
  releaseWakeOpForRetry as releaseWakeOpForRetryExecute,
  type ConfirmWakeOpResult,
  type ReleaseWakeOpResult,
} from "../collaboration-dispatch/wake-op-ledger.js";
import {
  canConfirmWakeOpCompleted,
  canReleaseWakeOpForRetry,
  mintWakeOpRecoverySubject,
  type WakeOpRecoveryAction,
  type WakeOpRecoverySubject,
} from "../collaboration-dispatch/wake-op-recovery-gate.js";
import { createWorkspaceCollaborationStores, readGroupOperatingState } from "./shared.js";

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function readTaskApproverIds(task: Task | null | undefined): string[] {
  const responsibility = (task as { responsibility?: { approvers?: unknown } } | null | undefined)
    ?.responsibility;
  const raw = responsibility?.approvers;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((id) => compact(typeof id === "string" ? id : "")).filter(Boolean);
}

export type ResolveWakeOpRecoverySubjectParams = {
  groupId: string;
  taskId: string;
  actorId: string;
  action: WakeOpRecoveryAction;
  cfg?: OpenBotConfig;
  nowMs?: number;
};

/**
 * Auth composition root for recovery: load OS + task approvers, check permission,
 * mint branded subject. Caller-supplied operatingState / approver lists are ignored.
 */
export async function resolveWakeOpRecoverySubjectForAction(
  params: ResolveWakeOpRecoverySubjectParams,
): Promise<{ ok: true; subject: WakeOpRecoverySubject } | { ok: false; reason: string }> {
  const actorId = compact(params.actorId);
  const groupId = compact(params.groupId);
  const taskId = compact(params.taskId);
  if (!actorId) {
    return { ok: false, reason: "missing_operator_actor_id" };
  }
  if (!groupId || !taskId) {
    return { ok: false, reason: "missing_task_scope" };
  }
  const cfg = params.cfg ?? loadConfig();
  const { fileStore, objectStorage } = createWorkspaceCollaborationStores(cfg);
  const operatingState = await readGroupOperatingState({ fileStore, groupId });
  const task = await objectStorage.readObject<Task>(groupId, "task", taskId);
  if (!task) {
    return { ok: false, reason: "task_not_found" };
  }
  const taskApproverIds = readTaskApproverIds(task);
  if (params.action === "release_for_retry") {
    if (!canReleaseWakeOpForRetry({ actorId, operatingState })) {
      return { ok: false, reason: "release_forbidden" };
    }
  } else if (params.action === "confirm_completed") {
    if (!canConfirmWakeOpCompleted({ actorId, operatingState, taskApproverIds })) {
      return { ok: false, reason: "confirm_forbidden" };
    }
  } else {
    return { ok: false, reason: "unknown_recovery_action" };
  }
  const subject = mintWakeOpRecoverySubject({
    actorId,
    action: params.action,
    groupId,
    taskId,
    taskApproverIds,
    nowMs: params.nowMs,
  });
  return { ok: true, subject };
}

export async function releaseWakeOpForRetryAuthorized(params: {
  authority: RuntimeAuthority;
  groupId: string;
  taskId: string;
  opKey: string;
  actorId: string;
  verificationId: string;
  cfg?: OpenBotConfig;
  nowMs?: number;
  detail?: string;
}): Promise<ReleaseWakeOpResult> {
  const resolved = await resolveWakeOpRecoverySubjectForAction({
    groupId: params.groupId,
    taskId: params.taskId,
    actorId: params.actorId,
    action: "release_for_retry",
    cfg: params.cfg,
    nowMs: params.nowMs,
  });
  if (!resolved.ok) {
    return resolved;
  }
  return releaseWakeOpForRetryExecute({
    authority: params.authority,
    opKey: params.opKey,
    cfg: params.cfg,
    nowMs: params.nowMs,
    detail: params.detail,
    externalEffectVerified: "none",
    verificationId: params.verificationId,
    subject: resolved.subject,
  });
}

export async function confirmWakeOpCompletedAuthorized(params: {
  authority: RuntimeAuthority;
  groupId: string;
  taskId: string;
  opKey: string;
  roundId: string;
  actorId: string;
  cfg?: OpenBotConfig;
  nowMs?: number;
  detail?: string;
}): Promise<ConfirmWakeOpResult> {
  const resolved = await resolveWakeOpRecoverySubjectForAction({
    groupId: params.groupId,
    taskId: params.taskId,
    actorId: params.actorId,
    action: "confirm_completed",
    cfg: params.cfg,
    nowMs: params.nowMs,
  });
  if (!resolved.ok) {
    return resolved;
  }
  return confirmWakeOpCompletedExecute({
    authority: params.authority,
    opKey: params.opKey,
    roundId: params.roundId,
    cfg: params.cfg,
    nowMs: params.nowMs,
    detail: params.detail,
    subject: resolved.subject,
  });
}
