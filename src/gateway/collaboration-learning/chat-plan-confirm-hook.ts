/**
 * Best-effort NL plan confirm on group chat.send (review D wiring).
 *
 * When the inbound message is an unambiguous plan confirm and the group has a
 * bound currentTaskId (or caller supplies taskId), invoke the same
 * tryConfirmPlanFromChat → confirmCollaborationTodolist path as the UI card.
 *
 * Does not invent confirm from coordinator oral acknowledgment alone.
 * Failures are returned to the caller for surfacing; never claim confirmed on error.
 */
import type { OpenBotConfig } from "../../config/types.js";
import {
  parseChatPlanConfirmIntent,
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
  | { handled: true; result: TryConfirmPlanFromChatResult };

export async function maybeConfirmPlanFromChatSend(
  params: ChatPlanConfirmHookInput,
): Promise<ChatPlanConfirmHookResult> {
  const intent = parseChatPlanConfirmIntent(params.message);
  if (intent.kind === "not_confirm") {
    return { handled: false, reason: "not_confirm_intent" };
  }
  if (intent.kind === "ambiguous") {
    return {
      handled: true,
      result: { status: "ambiguous", confirmed: false, reason: intent.reason },
    };
  }
  const taskId = params.taskId?.trim();
  if (!taskId) {
    return {
      handled: true,
      result: {
        status: "no_unique_plan",
        confirmed: false,
        reason: "taskId_required_to_bind_confirm",
        candidates: [],
      },
    };
  }
  const result = await tryConfirmPlanFromChat({
    groupId: params.groupId,
    message: params.message,
    actor: params.actor,
    taskId,
    boardItemId: params.boardItemId?.trim() || undefined,
    todolistId: params.todolistId?.trim() || undefined,
    expectedVersion: params.expectedVersion,
    tenant: params.tenant,
    cfg: params.cfg,
  });
  return { handled: true, result };
}
