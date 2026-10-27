/**
 * NL plan confirm on group chat.send (R3).
 *
 * Binds expectedVersion from an actor-accessible owner-decision delivery after
 * collapsing consumed/stale. Awaits the same confirmCollaborationTodolist path
 * as the UI card. Failures surface as 尚未确认 — never invent confirm.
 *
 * After successful confirm, triggers existing wake nudge + wake→round consumer
 * (autoAdvanceWired=true when that path is attempted).
 */
import type { OpenBotConfig } from "../../config/types.js";
import {
  parseChatPlanConfirmIntent,
  resolvePendingPlanConfirmBinding,
  tryConfirmPlanFromChat,
  type TryConfirmPlanFromChatResult,
} from "./chat-plan-confirm.js";
import { triggerPostPlanConfirmAdvance } from "./post-plan-confirm-advance.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

export type ChatPlanConfirmHookInput = {
  groupId: string;
  message: string;
  actor: string;
  /** Only when bound to the user's explicit reply / card — never group currentTaskId alone. */
  taskId?: string | null;
  boardItemId?: string | null;
  todolistId?: string | null;
  decisionId?: string | null;
  expectedVersion?: number;
  /** When true, taskId came from unreliable group operating-state currentTaskId. */
  taskIdFromGroupCurrent?: boolean;
  auth?: import("./team-resource-auth.js").TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  stores?: import("./team-resource-auth.js").TrustedGroupStores | null;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
};

export type ChatPlanConfirmHookResult =
  | { handled: false; reason: string }
  | {
      handled: true;
      result: TryConfirmPlanFromChatResult;
      /** Short user-visible summary for chat.send to present in the chat transcript/UI. */
      userMessage: string;
      /** When true, chat.send must not start confirm-dependent execution. */
      blockDependentExecution: boolean;
      /** True when confirm success attempted existing wake/schedule advance. */
      autoAdvanceWired: boolean;
    };

function formatUserMessage(result: TryConfirmPlanFromChatResult): string {
  if (result.status === "confirmed" && result.confirmed) {
    return `计划已确认（todolist=${result.todolistId} v${result.version}）。已按现有 wake/调度机制请求推进。`;
  }
  if (result.status === "ambiguous") {
    return `尚未确认：确认表述不唯一（${result.reason}）。请单独发送「确认计划」，或点选计划卡片。`;
  }
  if (result.status === "no_unique_plan") {
    return `尚未确认：${result.reason}。请绑定你可见的待确认卡片后再确认。`;
  }
  if (result.status === "blocked") {
    return `尚未确认：${result.reason}${result.detail ? `（${result.detail}）` : ""}。`;
  }
  return "尚未确认：消息不是独立的计划确认。";
}

export async function maybeConfirmPlanFromChatSend(
  params: ChatPlanConfirmHookInput,
): Promise<ChatPlanConfirmHookResult> {
  const intent = parseChatPlanConfirmIntent(params.message);
  if (intent.kind === "not_confirm") {
    return { handled: false, reason: "not_confirm_intent" };
  }
  if (intent.kind === "ambiguous") {
    const result: TryConfirmPlanFromChatResult = {
      status: "ambiguous",
      confirmed: false,
      reason: intent.reason,
    };
    return {
      handled: true,
      result,
      userMessage: formatUserMessage(result),
      blockDependentExecution: true,
      autoAdvanceWired: false,
    };
  }

  // Group-level currentTaskId is unreliable — ignore unless paired with card binding.
  const explicitTaskId =
    params.taskIdFromGroupCurrent &&
    !params.boardItemId &&
    !params.todolistId &&
    !params.decisionId &&
    params.expectedVersion == null
      ? ""
      : params.taskId?.trim() || "";

  let taskId = explicitTaskId;
  let boardItemId = params.boardItemId?.trim() || "";
  let todolistId = params.todolistId?.trim() || "";
  let expectedVersion =
    typeof params.expectedVersion === "number" && Number.isFinite(params.expectedVersion)
      ? Math.floor(params.expectedVersion)
      : undefined;

  if (expectedVersion == null || !todolistId || !boardItemId || !taskId) {
    const resolved = await resolvePendingPlanConfirmBinding({
      groupId: params.groupId,
      actor: params.actor,
      taskId: taskId || undefined,
      boardItemId: boardItemId || undefined,
      todolistId: todolistId || undefined,
      decisionId: params.decisionId?.trim() || undefined,
      cfg: params.cfg,
      auth: params.auth,
      trusted: params.trusted,
      stores: params.stores,
    });
    if (resolved.status === "ambiguous") {
      const result: TryConfirmPlanFromChatResult = {
        status: "no_unique_plan",
        confirmed: false,
        reason: resolved.reason,
        candidates: resolved.candidates.map((row) => ({
          taskId: row.taskId,
          todolistId: row.todolistId,
          version: row.version,
          boardItemId: row.boardItemId,
        })),
      };
      return {
        handled: true,
        result,
        userMessage: formatUserMessage(result),
        blockDependentExecution: true,
        autoAdvanceWired: false,
      };
    }
    if (resolved.status === "bound") {
      const binding = resolved.binding;
      taskId = taskId || binding.taskId;
      boardItemId = boardItemId || binding.boardItemId;
      todolistId = todolistId || binding.todolistId;
      if (expectedVersion == null) {
        expectedVersion = binding.version;
      }
    }
  }

  if (!taskId) {
    const result: TryConfirmPlanFromChatResult = {
      status: "no_unique_plan",
      confirmed: false,
      reason: "no_actor_accessible_pending_delivery",
      candidates: [],
    };
    return {
      handled: true,
      result,
      userMessage: formatUserMessage(result),
      blockDependentExecution: true,
      autoAdvanceWired: false,
    };
  }

  if (expectedVersion == null) {
    const result: TryConfirmPlanFromChatResult = {
      status: "blocked",
      confirmed: false,
      reason: "expected_version_required",
      detail:
        "no actor-accessible pending delivery with version; refusing to confirm an unseen plan revision",
    };
    return {
      handled: true,
      result,
      userMessage: formatUserMessage(result),
      blockDependentExecution: true,
      autoAdvanceWired: false,
    };
  }

  const result = await tryConfirmPlanFromChat({
    groupId: params.groupId,
    message: params.message,
    actor: params.actor,
    taskId,
    boardItemId: boardItemId || undefined,
    todolistId: todolistId || undefined,
    expectedVersion,
    tenant: params.tenant,
    auth: params.auth,
    trusted: params.trusted,
    stores: params.stores,
    cfg: params.cfg,
  });

  let autoAdvanceWired = false;
  let userMessage = formatUserMessage(result);
  if (result.confirmed && result.status === "confirmed") {
    try {
      const advance = await triggerPostPlanConfirmAdvance({
        groupId: params.groupId,
        taskId,
        boardItemId: boardItemId || undefined,
        todolistId: todolistId || undefined,
        confirmerId: params.actor,
        tenant: params.tenant,
        auth: params.auth,
        trusted: params.trusted,
        stores: params.stores,
        cfg: params.cfg,
      });
      autoAdvanceWired = advance.autoAdvanceWired;
      userMessage =
        formatUserMessage(result) +
        (advance.dispatched
          ? ` 已派发执行（${advance.reason}）。`
          : advance.wakeRecorded
            ? ` 已写入推进 wake（${advance.reason}）。`
            : ` 推进请求未完成（${advance.reason}）。`);
    } catch (error) {
      autoAdvanceWired = true;
      const detail = error instanceof Error ? error.message : String(error);
      userMessage = formatUserMessage(result) + ` 自动推进异常（${detail}）。`;
    }
  }

  return {
    handled: true,
    result,
    userMessage,
    blockDependentExecution: !result.confirmed,
    autoAdvanceWired,
  };
}
