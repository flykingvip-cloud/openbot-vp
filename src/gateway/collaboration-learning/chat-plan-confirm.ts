/**
 * TEAM-REAL F1.2 — Natural-language plan confirm → same confirmCollaborationTodolist entry.
 *
 * UI card confirm and chat confirm must share one runtime state. Ambiguous chat
 * must NOT flip confirmed; callers must surface "尚未确认".
 */
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { ExecutorPrivateTodolist } from "../collaboration-dispatch/executor-private-todolist.js";
import {
  ClaimContractEntryError,
  confirmCollaborationTodolist,
  listCollaborationTodolists,
} from "./claim-contract-entry.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

export type ChatPlanConfirmIntent =
  | { kind: "not_confirm" }
  | { kind: "ambiguous"; reason: string }
  | { kind: "confirm" };

const CONFIRM_RE =
  /^(?:确认(?:计划|执行计划|该计划|此计划|todolist|看板计划)?|同意(?:该|此)?计划|按此执行|就按这个办|confirm(?:\s+plan)?)\s*[。.!！]?$/iu;

const REJECT_RE = /^(?:拒绝|不同意|退回|作废|revise|reject)(?:计划|该计划|此计划)?\s*[。.!！]?$/iu;

export function parseChatPlanConfirmIntent(message: string): ChatPlanConfirmIntent {
  const text = message.trim();
  if (!text) {
    return { kind: "not_confirm" };
  }
  if (REJECT_RE.test(text)) {
    return { kind: "not_confirm" };
  }
  if (CONFIRM_RE.test(text)) {
    return { kind: "confirm" };
  }
  // Soft containments that are still ambiguous when mixed with other orders.
  if (/确认/.test(text) && text.length > 24) {
    return { kind: "ambiguous", reason: "confirm_word_mixed_with_other_content" };
  }
  if (/确认计划|确认执行|confirm plan/i.test(text) && !CONFIRM_RE.test(text)) {
    return { kind: "ambiguous", reason: "confirm_phrase_not_standalone" };
  }
  return { kind: "not_confirm" };
}

export type TryConfirmPlanFromChatInput = {
  groupId: string;
  message: string;
  actor: string;
  /** When set, only todolists for this task are considered. */
  taskId?: string;
  boardItemId?: string;
  todolistId?: string;
  expectedVersion?: number;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
};

export type TryConfirmPlanFromChatResult =
  | {
      status: "not_confirm_intent";
      confirmed: false;
      reason: string;
    }
  | {
      status: "ambiguous";
      confirmed: false;
      reason: string;
    }
  | {
      status: "no_unique_plan";
      confirmed: false;
      reason: string;
      candidates: Array<{
        taskId: string;
        todolistId: string;
        version: number;
        boardItemId: string;
      }>;
    }
  | {
      status: "confirmed";
      confirmed: true;
      todolist: ExecutorPrivateTodolist;
      taskId: string;
      boardItemId: string;
      todolistId: string;
      version: number;
    }
  | {
      status: "blocked";
      confirmed: false;
      reason: string;
      detail?: string;
    };

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/**
 * Parse chat and, when unambiguous, call the same confirmCollaborationTodolist entry
 * used by the UI card. Never invents confirm from coordinator oral acknowledgment alone.
 */
export async function tryConfirmPlanFromChat(
  params: TryConfirmPlanFromChatInput,
): Promise<TryConfirmPlanFromChatResult> {
  const intent = parseChatPlanConfirmIntent(params.message);
  if (intent.kind === "not_confirm") {
    return {
      status: "not_confirm_intent",
      confirmed: false,
      reason: "message_is_not_a_standalone_plan_confirm",
    };
  }
  if (intent.kind === "ambiguous") {
    return {
      status: "ambiguous",
      confirmed: false,
      reason: intent.reason,
    };
  }

  const groupId = compact(params.groupId);
  const actor = compact(params.actor);
  if (!groupId || !actor) {
    return {
      status: "blocked",
      confirmed: false,
      reason: "missing_group_or_actor",
    };
  }

  const cfg = params.cfg ?? loadConfig();
  const taskIdFilter = compact(params.taskId);
  const boardItemFilter = compact(params.boardItemId);
  const todolistFilter = compact(params.todolistId);

  let listed: ExecutorPrivateTodolist[] = [];
  try {
    if (!taskIdFilter) {
      return {
        status: "no_unique_plan",
        confirmed: false,
        reason: "taskId_required_to_bind_confirm",
        candidates: [],
      };
    }
    listed = await listCollaborationTodolists({
      groupId,
      taskId: taskIdFilter,
      boardItemId: boardItemFilter || undefined,
      actor,
      viewerId: actor,
      cfg,
      tenant: params.tenant,
    });
  } catch (error) {
    return {
      status: "blocked",
      confirmed: false,
      reason: "list_todolists_failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const proposed = listed.filter((row) => row.status === "proposed");
  const scoped = todolistFilter
    ? proposed.filter((row) => row.todolistId === todolistFilter)
    : proposed;

  if (scoped.length === 0) {
    return {
      status: "no_unique_plan",
      confirmed: false,
      reason: "no_proposed_todolist_for_task",
      candidates: [],
    };
  }
  if (scoped.length > 1) {
    return {
      status: "no_unique_plan",
      confirmed: false,
      reason: "multiple_proposed_todolists_ambiguous",
      candidates: scoped.map((row) => ({
        taskId: row.taskId,
        todolistId: row.todolistId,
        version: row.version,
        boardItemId: row.boardItemId,
      })),
    };
  }

  const target = scoped[0];
  // Never invent the version the user "must have seen". Require explicit
  // expectedVersion, or a card binding (todolistId + boardItemId) that uniquely
  // identifies the plan the user replied to.
  const hasCardBinding = Boolean(todolistFilter && boardItemFilter);
  if (typeof params.expectedVersion !== "number" && !hasCardBinding) {
    return {
      status: "blocked",
      confirmed: false,
      reason: "expected_version_or_card_binding_required",
      detail:
        "refusing to confirm without expectedVersion or todolistId+boardItemId; current unique proposed plan is not proof the user saw it",
    };
  }
  const expectedVersion =
    typeof params.expectedVersion === "number" ? params.expectedVersion : target.version;

  try {
    const confirmed = await confirmCollaborationTodolist({
      groupId,
      taskId: target.taskId,
      todolistId: target.todolistId,
      confirmerId: actor,
      actor,
      expectedVersion,
      tenant: params.tenant,
      cfg,
    });
    return {
      status: "confirmed",
      confirmed: true,
      todolist: confirmed,
      taskId: confirmed.taskId,
      boardItemId: confirmed.boardItemId,
      todolistId: confirmed.todolistId,
      version: confirmed.version,
    };
  } catch (error) {
    if (error instanceof ClaimContractEntryError) {
      return {
        status: "blocked",
        confirmed: false,
        reason: error.code || "confirm_failed",
        detail: error.message,
      };
    }
    return {
      status: "blocked",
      confirmed: false,
      reason: "confirm_failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
