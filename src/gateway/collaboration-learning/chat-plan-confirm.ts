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
import {
  readOwnerDecisionDeliveries,
  type OwnerDecisionCardDelivery,
} from "./owner-decision-delivery.js";
import type { TeamResourceAuthOk, TrustedGroupStores } from "./team-resource-auth.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

export type ChatPlanConfirmIntent =
  | { kind: "not_confirm" }
  | { kind: "ambiguous"; reason: string }
  | { kind: "confirm" };

const CONFIRM_RE =
  /^(?:确认(?:计划|执行计划|该计划|此计划|todolist|看板计划)?|同意(?:该|此)?计划|按此执行|就按这个办|confirm(?:\s+plan)?)\s*[。.!！]?$/iu;

const REJECT_RE = /^(?:拒绝|不同意|退回|作废|revise|reject)(?:计划|该计划|此计划)?\s*[。.!！]?$/iu;

/**
 * Long operational / supervisory messages that happen to contain「确认」must NOT
 * be intercepted as planConfirm (NIGHT-20261028: task payloads + 合稿催促 stopped).
 */
export function isOperationalNonPlanConfirmMessage(message: string): boolean {
  const text = message.trim();
  if (!text) {
    return false;
  }
  if (text.includes("@")) {
    return true;
  }
  if (text.length > 120) {
    return true;
  }
  if ((text.match(/\n/g) ?? []).length >= 2) {
    return true;
  }
  if (
    /监管催促|一夜任务|合稿催促|宿主合入|NIGHT-\d{8}|grp-[a-z0-9-]+|taskId|boardItem|todolist|ACCEPTANCE|交卷指令|请刷新/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

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
  // Soft containments: only mixed messages anchored on a plan-confirm attempt stay ambiguous.
  // Ordinary group prose containing "确认" (e.g. "测试确认", "请确认分工") is not planConfirm.
  const hasPlanConfirmAnchor =
    /^(?:确认|同意|按此|就按|confirm\b)/iu.test(text) ||
    /(?:确认|同意)\s*(?:计划|执行|方案|todolist|看板)/iu.test(text);
  if (/确认/.test(text) && text.length > 24 && hasPlanConfirmAnchor) {
    if (isOperationalNonPlanConfirmMessage(text)) {
      return { kind: "not_confirm" };
    }
    return { kind: "ambiguous", reason: "confirm_word_mixed_with_other_content" };
  }
  if (/确认计划|确认执行|confirm plan/i.test(text) && !CONFIRM_RE.test(text)) {
    if (isOperationalNonPlanConfirmMessage(text)) {
      return { kind: "not_confirm" };
    }
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
  /** Trusted tenant SoT for confirm + delivery log. */
  auth?: TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  stores?: TrustedGroupStores | null;
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

export type PendingPlanConfirmBinding = {
  taskId: string;
  boardItemId: string;
  todolistId: string;
  version: number;
  decisionId?: string;
  source: "owner_decision_delivery";
};

export type ResolvePendingPlanConfirmBindingResult =
  | { status: "bound"; binding: PendingPlanConfirmBinding }
  | { status: "none"; reason: string }
  | {
      status: "ambiguous";
      reason: string;
      candidates: PendingPlanConfirmBinding[];
    };

export function deliveryCollapseKey(row: OwnerDecisionCardDelivery): string {
  const decisionId = compact(row.card?.decisionId);
  if (decisionId) {
    return `decision:${decisionId}`;
  }
  return `todolist:${compact(row.todolistId)}:v${Math.floor(row.version || 0)}`;
}

export function isTerminalDelivery(row: OwnerDecisionCardDelivery): boolean {
  if (row.userFacing === "consumed" || row.userFacing === "stale_version") {
    return true;
  }
  if (
    row.stage === "confirmation_consumed" ||
    row.stage === "skipped" ||
    row.stage === "delivery_failed"
  ) {
    return true;
  }
  return false;
}

export function actorMayConfirmDelivery(row: OwnerDecisionCardDelivery, actor: string): boolean {
  const id = compact(actor);
  if (!id) {
    return false;
  }
  const mentions = row.card?.mentionMemberIds ?? [];
  if (mentions.length === 0) {
    // No mention list on the card — refuse guessing; require explicit RPC binding.
    return false;
  }
  return mentions.some((memberId) => compact(memberId) === id);
}

function toBinding(row: OwnerDecisionCardDelivery): PendingPlanConfirmBinding | null {
  const todolistId = compact(row.todolistId);
  const boardItemId = compact(row.boardItemId);
  const boundTaskId = compact(row.taskId);
  const version =
    typeof row.version === "number" && Number.isFinite(row.version) ? Math.floor(row.version) : 0;
  if (!todolistId || !boardItemId || !boundTaskId || version <= 0) {
    return null;
  }
  return {
    taskId: boundTaskId,
    boardItemId,
    todolistId,
    version,
    decisionId: compact(row.card?.decisionId) || undefined,
    source: "owner_decision_delivery",
  };
}

/** Pure candidate selection after chronological collapse (testable). */
export function selectPendingPlanConfirmCandidates(params: {
  rows: OwnerDecisionCardDelivery[];
  actor: string;
  taskId?: string;
  boardItemId?: string;
  todolistId?: string;
  decisionId?: string;
}): PendingPlanConfirmBinding[] {
  const actor = compact(params.actor);
  const taskId = compact(params.taskId);
  const boardItemFilter = compact(params.boardItemId);
  const todolistFilter = compact(params.todolistId);
  const decisionFilter = compact(params.decisionId);

  const invalidated = new Set<string>();
  const latestByKey = new Map<string, OwnerDecisionCardDelivery>();
  for (const row of params.rows) {
    if (!row) {
      continue;
    }
    const key = deliveryCollapseKey(row);
    if (isTerminalDelivery(row)) {
      invalidated.add(key);
      latestByKey.delete(key);
      continue;
    }
    if (invalidated.has(key)) {
      continue;
    }
    latestByKey.set(key, row);
  }

  const candidates: PendingPlanConfirmBinding[] = [];
  for (const row of latestByKey.values()) {
    if (!actorMayConfirmDelivery(row, actor)) {
      continue;
    }
    const binding = toBinding(row);
    if (!binding) {
      continue;
    }
    if (taskId && binding.taskId !== taskId) {
      continue;
    }
    if (boardItemFilter && binding.boardItemId !== boardItemFilter) {
      continue;
    }
    if (todolistFilter && binding.todolistId !== todolistFilter) {
      continue;
    }
    if (decisionFilter && (binding.decisionId || "") !== decisionFilter) {
      continue;
    }
    candidates.push(binding);
  }
  return candidates;
}

/**
 * Resolve the plan the *current actor* may confirm from durable delivery log.
 * Collapses later consumed/stale events so they cannot fall back to an earlier
 * delivery of the same decision/todolist+version. Never picks "group latest".
 * Multiple distinct pending candidates → ambiguous (refuse to guess).
 */
export async function resolvePendingPlanConfirmBinding(params: {
  groupId: string;
  actor: string;
  taskId?: string;
  boardItemId?: string;
  todolistId?: string;
  decisionId?: string;
  cfg?: OpenBotConfig;
  auth?: TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  stores?: TrustedGroupStores | null;
}): Promise<ResolvePendingPlanConfirmBindingResult> {
  const groupId = compact(params.groupId);
  const actor = compact(params.actor);
  if (!groupId || !actor) {
    return { status: "none", reason: "missing_group_or_actor" };
  }
  const taskId = compact(params.taskId);
  const boardItemFilter = compact(params.boardItemId);
  const todolistFilter = compact(params.todolistId);
  const decisionFilter = compact(params.decisionId);

  let rows: OwnerDecisionCardDelivery[] = [];
  try {
    const locator = params.stores
      ? { groupRootDir: params.stores.groupsRoot, groupLocator: params.stores.groupLocator }
      : params.trusted
        ? { groupRootDir: params.trusted.groupsRoot, groupLocator: params.trusted.groupLocator }
        : params.auth
          ? { groupRootDir: params.auth.groupsRoot, groupLocator: params.auth.groupLocator }
          : {};
    rows = await readOwnerDecisionDeliveries({
      groupId,
      taskId: taskId || undefined,
      todolistId: todolistFilter || undefined,
      cfg: params.cfg,
      ...locator,
    });
  } catch {
    return { status: "none", reason: "delivery_log_unreadable" };
  }

  const candidates = selectPendingPlanConfirmCandidates({
    rows,
    actor,
    taskId: taskId || undefined,
    boardItemId: boardItemFilter || undefined,
    todolistId: todolistFilter || undefined,
    decisionId: decisionFilter || undefined,
  });

  if (candidates.length === 0) {
    return { status: "none", reason: "no_actor_accessible_pending_delivery" };
  }
  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      reason: "multiple_pending_deliveries_refuse_guess",
      candidates,
    };
  }
  return { status: "bound", binding: candidates[0] };
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
      auth: params.auth,
      trusted: params.trusted,
      stores: params.stores,
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
  // Never invent the version the user "must have seen".
  // todolistId+boardItemId alone is insufficient — the same todolist may revise.
  // expectedVersion must come from the caller or a trusted delivery/card binding
  // that already carries the version the user was shown.
  if (typeof params.expectedVersion !== "number" || !Number.isFinite(params.expectedVersion)) {
    return {
      status: "blocked",
      confirmed: false,
      reason: "expected_version_required",
      detail:
        "refusing to confirm without expectedVersion from the card/delivery the user replied to; current unique proposed plan is not proof the user saw it",
    };
  }
  const expectedVersion = Math.floor(params.expectedVersion);

  try {
    const confirmed = await confirmCollaborationTodolist({
      groupId,
      taskId: target.taskId,
      todolistId: target.todolistId,
      confirmerId: actor,
      actor,
      expectedVersion,
      tenant: params.tenant,
      auth: params.auth,
      trusted: params.trusted,
      stores: params.stores,
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
