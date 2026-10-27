/**
 * NL plan confirm on group chat.send (R2 包2).
 *
 * Binds expectedVersion from the durable owner-decision delivery the user was
 * shown. Awaits the same confirmCollaborationTodolist path as the UI card.
 * Failures surface as 尚未确认 — never invent confirm or swallow errors.
 */
import type { OpenBotConfig } from "../../config/types.js";
import {
  parseChatPlanConfirmIntent,
  resolvePendingPlanConfirmBinding,
  tryConfirmPlanFromChat,
  type TryConfirmPlanFromChatResult,
} from "./chat-plan-confirm.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

export type ChatPlanConfirmHookInput = {
  groupId: string;
  message: string;
  actor: string;
  taskId?: string | null;
  boardItemId?: string | null;
  todolistId?: string | null;
  expectedVersion?: number;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
};

export type ChatPlanConfirmHookResult =
  | { handled: false; reason: string }
  | {
      handled: true;
      result: TryConfirmPlanFromChatResult;
      /** Short user-visible summary for chat.send to present. */
      userMessage: string;
      /** When true, chat.send must not start confirm-dependent execution. */
      blockDependentExecution: boolean;
    };

function formatUserMessage(result: TryConfirmPlanFromChatResult): string {
  if (result.status === "confirmed" && result.confirmed) {
    return `计划已确认（todolist=${result.todolistId} v${result.version}）。`;
  }
  if (result.status === "ambiguous") {
    return `尚未确认：确认表述不唯一（${result.reason}）。请单独发送「确认计划」，或点选计划卡片。`;
  }
  if (result.status === "no_unique_plan") {
    return `尚未确认：${result.reason}。请绑定任务与计划卡片后再确认。`;
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
    };
  }

  let taskId = params.taskId?.trim() || "";
  let boardItemId = params.boardItemId?.trim() || "";
  let todolistId = params.todolistId?.trim() || "";
  let expectedVersion =
    typeof params.expectedVersion === "number" && Number.isFinite(params.expectedVersion)
      ? Math.floor(params.expectedVersion)
      : undefined;

  // Bind the version the user was shown from owner-decision delivery — never
  // invent from "current unique proposed".
  if (expectedVersion == null || !todolistId || !boardItemId || !taskId) {
    const binding = await resolvePendingPlanConfirmBinding({
      groupId: params.groupId,
      taskId: taskId || undefined,
      cfg: params.cfg,
    });
    if (binding) {
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
      reason: "taskId_required_to_bind_confirm",
      candidates: [],
    };
    return {
      handled: true,
      result,
      userMessage: formatUserMessage(result),
      blockDependentExecution: true,
    };
  }

  if (expectedVersion == null) {
    const result: TryConfirmPlanFromChatResult = {
      status: "blocked",
      confirmed: false,
      reason: "expected_version_required",
      detail:
        "no owner-decision delivery binding with version; refusing to confirm an unseen plan revision",
    };
    return {
      handled: true,
      result,
      userMessage: formatUserMessage(result),
      blockDependentExecution: true,
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
    cfg: params.cfg,
  });
  return {
    handled: true,
    result,
    userMessage: formatUserMessage(result),
    blockDependentExecution: !result.confirmed,
  };
}
