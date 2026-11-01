/**
 * Human-attention card actions.
 *
 * On click: re-check actor permission, todo status, fingerprint, and version.
 * Action set is gated by failureKind — side_effect_unknown never allows blind retry.
 */
import type { OpenBotConfig } from "../../config/types.js";
import {
  assertsNoBlindRetryOption,
  buildHumanAttentionCard,
  optionsForHumanAttentionFailureKind,
  type HumanAttentionOptionId,
} from "./human-attention-card.js";
import { emitHumanAttentionResolutionReceipt } from "./human-attention-emit.js";
import {
  actorMatchesHumanAttentionOwners,
  getHumanAttentionTodo,
  resolveHumanAttentionTodo,
  type HumanAttentionTodo,
} from "./human-attention-inbox.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import { sanitizeDispatchErrorMessage } from "./sanitize-dispatch-error.js";

export type ActHumanAttentionParams = {
  todoId: string;
  action: HumanAttentionOptionId;
  actorId: string;
  /** Client-seen version; mismatch → stale_version. */
  expectedVersion: number;
  /** Client-seen fingerprint; mismatch → stale_fingerprint. */
  expectedFingerprint: string;
  nowMs?: number;
  authority?: RuntimeAuthority | null;
  cfg?: OpenBotConfig;
  transferOwnerId?: string;
  note?: string;
};

export type ActHumanAttentionResult =
  | {
      ok: true;
      todo: HumanAttentionTodo;
      evidence?: Record<string, unknown>;
      heartbeatCleared?: boolean;
    }
  | { ok: false; reason: string; message?: string; todo?: HumanAttentionTodo };

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function allowedActionsForTodo(todo: HumanAttentionTodo): Set<HumanAttentionOptionId> {
  return new Set(optionsForHumanAttentionFailureKind(todo.failureKind).map((o) => o.id));
}

function isMutatingAction(action: HumanAttentionOptionId): boolean {
  return (
    action === "retry_after_fix" ||
    action === "transfer" ||
    action === "cancel_task" ||
    action === "confirm_completed" ||
    action === "release_after_verify" ||
    action === "accept_submission" ||
    action === "return_submission" ||
    action === "take_over"
  );
}

function clearsHeartbeat(action: HumanAttentionOptionId): boolean {
  return (
    action === "retry_after_fix" ||
    action === "confirm_completed" ||
    action === "release_after_verify" ||
    action === "cancel_task" ||
    action === "take_over" ||
    action === "accept_submission" ||
    action === "return_submission"
  );
}

/**
 * Re-check permissions + latest state, then execute the card action.
 */
export async function actHumanAttentionCard(
  params: ActHumanAttentionParams,
): Promise<ActHumanAttentionResult> {
  const actorId = compact(params.actorId);
  const todoId = compact(params.todoId);
  const action = params.action;
  if (!actorId || !todoId || !action) {
    return { ok: false, reason: "invalid_input", message: "todoId, action, actorId required" };
  }

  const todo = getHumanAttentionTodo(todoId);
  if (!todo) {
    return { ok: false, reason: "not_found" };
  }

  if (todo.status === "recovered" || todo.status === "resolved") {
    return {
      ok: false,
      reason: "already_resolved",
      message: "待办已处理完成",
      todo,
    };
  }

  if (!actorMatchesHumanAttentionOwners(todo.ownerIds, actorId)) {
    if (compact(todo.claimedBy).toLowerCase() !== actorId.toLowerCase()) {
      return { ok: false, reason: "not_owner", message: "当前账号不是责任人", todo };
    }
  }

  if (
    typeof params.expectedVersion === "number" &&
    Number.isFinite(params.expectedVersion) &&
    params.expectedVersion > 0 &&
    params.expectedVersion !== todo.version
  ) {
    return {
      ok: false,
      reason: "stale_version",
      message: `卡片版本已过期（期望 v${params.expectedVersion}，当前 v${todo.version}）`,
      todo,
    };
  }

  if (
    compact(params.expectedFingerprint) &&
    compact(params.expectedFingerprint) !== compact(todo.fingerprint)
  ) {
    return {
      ok: false,
      reason: "stale_fingerprint",
      message: "任务进展已变化，请刷新卡片",
      todo,
    };
  }

  const card = buildHumanAttentionCard({
    todoId: todo.id,
    groupId: todo.groupId,
    taskId: todo.taskId,
    boardItemId: todo.itemId,
    fingerprint: todo.fingerprint,
    version: todo.version,
    failureKind: todo.failureKind,
    reason: todo.reason,
    ownerIds: todo.ownerIds,
    recoveryHint: todo.recoveryHint,
    taskTitle: todo.taskTitle,
    boardStatus: todo.boardStatus,
  });
  if (!card || !assertsNoBlindRetryOption(card)) {
    return { ok: false, reason: "invalid_card", todo };
  }

  // Hard ban first: never treat retry_after_fix as valid on unknown side effects.
  if (todo.failureKind === "side_effect_unknown" && action === "retry_after_fix") {
    return {
      ok: false,
      reason: "blind_retry_forbidden",
      message: "可能已产生外部操作：禁止直接重试，请先查看证据并核实",
      todo,
    };
  }

  const allowed = allowedActionsForTodo(todo);
  if (!allowed.has(action)) {
    return {
      ok: false,
      reason: "action_not_allowed",
      message: `失败类型 ${todo.failureKind} 不允许操作 ${action}`,
      todo,
    };
  }

  // Read-only evidence actions.
  if (
    action === "view_evidence" ||
    action === "view_failure_reason" ||
    action === "view_artifact"
  ) {
    return {
      ok: true,
      todo,
      evidence: {
        todoId: todo.id,
        taskId: todo.taskId,
        itemId: todo.itemId,
        fingerprint: todo.fingerprint,
        version: todo.version,
        failureKind: todo.failureKind,
        reason: todo.reason,
        recoveryHint: todo.recoveryHint,
        boardStatus: todo.boardStatus,
        wakeOpKey: todo.wakeOpKey,
        sideEffectClass: todo.sideEffectClass,
        sideEffectMayHaveOccurred: todo.failureKind === "side_effect_unknown",
      },
    };
  }

  if (!isMutatingAction(action)) {
    return { ok: false, reason: "action_not_allowed", todo };
  }

  if (action === "release_after_verify" && todo.failureKind === "side_effect_unknown") {
    const note = compact(params.note);
    if (!note) {
      return {
        ok: false,
        reason: "verification_note_required",
        message: "核实后允许重试前须填写副作用核实说明",
        todo,
      };
    }
  }

  const resultText =
    action === "retry_after_fix"
      ? "已确认未开始；清除人工闸后允许自动重试"
      : action === "release_after_verify"
        ? `已核实副作用：${compact(params.note)}；解除保护允许重试`
        : action === "confirm_completed"
          ? "人工确认结果已完成"
          : action === "cancel_task"
            ? "人工取消任务并关闭待办"
            : action === "take_over"
              ? "人工接管并恢复自动推进条件"
              : action === "transfer"
                ? `已转交给 ${compact(params.transferOwnerId)}`
                : action === "accept_submission"
                  ? "审核通过（待办关闭；板状态由审核链继续）"
                  : action === "return_submission"
                    ? "退回修改（待办关闭；板状态由审核链继续）"
                    : sanitizeDispatchErrorMessage(String(action), 120);

  const resolved = await resolveHumanAttentionTodo({
    id: todo.id,
    actorId,
    action,
    result: resultText,
    nowMs: params.nowMs,
    authority: params.authority,
    cfg: params.cfg,
    clearHeartbeat: clearsHeartbeat(action),
    transferOwnerId: params.transferOwnerId,
  });
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason, todo };
  }

  if (resolved.todo.resolution) {
    await emitHumanAttentionResolutionReceipt({
      todo: resolved.todo,
      cfg: params.cfg,
      nowMs: params.nowMs,
    });
  }

  return {
    ok: true,
    todo: resolved.todo,
    heartbeatCleared: resolved.heartbeatCleared,
  };
}
