/**
 * Human-attention card actions.
 *
 * On click: re-check actor permission, todo status/version, live board fingerprint,
 * then execute the real business contract. Inbox is closed only after success.
 * side_effect_unknown never allows blind retry.
 */
import type { OpenBotConfig } from "../../config/types.js";
import {
  executeHumanAttentionBusinessAction,
  buildHumanAttentionAuthority,
} from "./human-attention-business.js";
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
  transferHumanAttentionTodo,
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
  /** Required for mutating actions that clear heartbeat or call wake-op / board APIs. */
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
    status: todo.status,
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

  let authority = params.authority ?? null;
  if (!authority && (isMutatingAction(action) || action.startsWith("view_"))) {
    try {
      authority = buildHumanAttentionAuthority({
        groupId: todo.groupId,
        taskId: todo.taskId,
        cfg: params.cfg,
      }).authority;
    } catch {
      authority = null;
    }
  }

  if (!authority) {
    return {
      ok: false,
      reason: "authority_required",
      message: "缺少可信 RuntimeAuthority，无法执行业务操作",
      todo,
    };
  }

  const business = await executeHumanAttentionBusinessAction({
    action,
    todo,
    actorId,
    authority,
    cfg: params.cfg,
    nowMs: params.nowMs,
    note: params.note,
    transferOwnerId: params.transferOwnerId,
    expectedFingerprint: compact(params.expectedFingerprint) || todo.fingerprint,
  });

  if (!business.ok) {
    return { ok: false, reason: business.reason, message: business.message, todo };
  }

  // Read-only evidence / view actions: do not close todo.
  if (!business.closeTodo && action !== "transfer") {
    return {
      ok: true,
      todo,
      evidence: business.evidence,
      heartbeatCleared: false,
    };
  }

  if (action === "transfer") {
    const transferred = await transferHumanAttentionTodo({
      id: todo.id,
      actorId,
      transferOwnerId: business.transferOwnerId || params.transferOwnerId || "",
      result: business.resultText,
      nowMs: params.nowMs,
    });
    if (!transferred.ok) {
      return { ok: false, reason: transferred.reason, message: "转交待办失败", todo };
    }
    return {
      ok: true,
      todo: transferred.todo,
      heartbeatCleared: false,
      evidence: { transferOwnerId: business.transferOwnerId },
    };
  }

  // Mutating close path: only resolve after business succeeded; clear heartbeat under authority.
  const resolved = await resolveHumanAttentionTodo({
    id: todo.id,
    actorId,
    action,
    result: business.resultText,
    nowMs: params.nowMs,
    authority,
    cfg: params.cfg,
    clearHeartbeat: business.heartbeatShouldClear,
    requireHeartbeatClear: business.heartbeatShouldClear,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      message: resolved.message ?? "关闭待办失败（业务已执行时请人工核对）",
      todo: getHumanAttentionTodo(todo.id) ?? todo,
    };
  }

  if (resolved.todo.status === "recovered" || resolved.todo.status === "resolved") {
    await emitHumanAttentionResolutionReceipt({
      todo: resolved.todo,
      cfg: params.cfg,
      nowMs: params.nowMs,
    });
  }

  return {
    ok: true,
    todo: resolved.todo,
    evidence: business.evidence,
    heartbeatCleared: resolved.heartbeatCleared,
  };
}

/** @internal test helper */
export function describeHumanAttentionAction(action: HumanAttentionOptionId): string {
  return sanitizeDispatchErrorMessage(String(action), 80);
}
