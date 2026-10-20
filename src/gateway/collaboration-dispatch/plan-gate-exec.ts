/**
 * FINAL v3 S2 — Plan gate on all delivery execution paths (incl. applied self-advance).
 *
 * Inventory-first: reuses ExecutorPrivateTodolist / assertPlanGateAllowsDeliveryProgress /
 * buildExecutionTaskBag / claim-contract board statuses. Does NOT invent a second
 * orchestrator, flip LIVE/Floor, or default claim|wake|challenge|runtimeNamespace|
 * botMaySelfAdvanceWithoutHuman to true.
 *
 * Rules (FINAL v3 §A / expert S2):
 * - applied: draft Todolist OK; delivery-type self-advance FORBIDDEN until confirmed
 * - in_progress: confirmed Todolist owned by current claimant required
 * - Every delivery exec entry must inject 三件套 (board summary + group context pointer +
 *   confirmed current Todolist step); missing any → refuse delivery exec
 * - Unconfirmed / revise_requested → only plan_nudge (remind), never delivery_exec
 */
import type { GroupBoardClaimItem } from "./claim-contract.js";
import {
  assertPlanGateAllowsDeliveryProgress,
  buildExecutionTaskBag,
  isTodolistConfirmedForDelivery,
  loadLatestOwnerTodolistForBoardItem,
  resolveCurrentTodolistStep,
  type ExecutionTaskBag,
  type ExecutorPrivateTodolist,
  type TodolistResult,
} from "./executor-private-todolist.js";
import type { RuntimeAuthority } from "./runtime-authority.js";

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** Board statuses that still allow ordinary delivery work (not terminal / waiting review). */
export const DELIVERY_EXEC_BOARD_STATUSES = ["applied", "in_progress", "returned"] as const;

/** Board statuses that must never receive delivery-type self-advance. */
export const NO_DELIVERY_SELF_ADVANCE_BOARD_STATUSES = [
  "published",
  "claimed",
  "submitted_for_review",
  "accepted",
  "blocked",
  "cancelled",
] as const;

export type BoardTodolistDeliveryMapping = Readonly<{
  boardStatus: string;
  /** Draft/propose allowed without confirm. */
  draftAllowed: boolean;
  /** Delivery-type self-advance / exec inject allowed only when confirmed. */
  deliveryRequiresConfirmedPlan: boolean;
  /** Ordinary delivery self-advance permitted for this board status at all. */
  deliverySelfAdvanceEligible: boolean;
  note: string;
}>;

/**
 * FINAL v3 §A board ↔ Todolist cross-state mapping (code-enforced, not prompt-only).
 */
export function boardTodolistDeliveryMapping(boardStatus: string): BoardTodolistDeliveryMapping {
  const status = compact(boardStatus);
  switch (status) {
    case "published":
      return {
        boardStatus: status,
        draftAllowed: false,
        deliveryRequiresConfirmedPlan: true,
        deliverySelfAdvanceEligible: false,
        note: "published: claim first; no delivery self-advance",
      };
    case "claimed":
      return {
        boardStatus: status,
        draftAllowed: true,
        deliveryRequiresConfirmedPlan: true,
        deliverySelfAdvanceEligible: false,
        note: "claimed: ownership only; draft OK; no delivery self-advance yet",
      };
    case "applied":
      return {
        boardStatus: status,
        draftAllowed: true,
        deliveryRequiresConfirmedPlan: true,
        deliverySelfAdvanceEligible: true,
        note: "applied: draft OK unconfirmed; delivery self-advance requires confirmed plan",
      };
    case "in_progress":
      return {
        boardStatus: status,
        draftAllowed: false,
        deliveryRequiresConfirmedPlan: true,
        deliverySelfAdvanceEligible: true,
        note: "in_progress: must have confirmed Todolist owned by current claimant",
      };
    case "returned":
      return {
        boardStatus: status,
        draftAllowed: true,
        deliveryRequiresConfirmedPlan: true,
        deliverySelfAdvanceEligible: true,
        note: "returned: revise + re-confirm plan before delivery self-advance",
      };
    case "submitted_for_review":
      return {
        boardStatus: status,
        draftAllowed: false,
        deliveryRequiresConfirmedPlan: true,
        deliverySelfAdvanceEligible: false,
        note: "submitted_for_review: wait accept/return; do not re-exec same submission",
      };
    case "accepted":
      return {
        boardStatus: status,
        draftAllowed: false,
        deliveryRequiresConfirmedPlan: true,
        deliverySelfAdvanceEligible: false,
        note: "accepted: terminal; no auto advance",
      };
    case "blocked":
    case "cancelled":
      return {
        boardStatus: status,
        draftAllowed: false,
        deliveryRequiresConfirmedPlan: true,
        deliverySelfAdvanceEligible: false,
        note: `${status}: no ordinary delivery self-advance`,
      };
    default:
      return {
        boardStatus: status || "unknown",
        draftAllowed: false,
        deliveryRequiresConfirmedPlan: true,
        deliverySelfAdvanceEligible: false,
        note: "unknown board status; fail closed for delivery",
      };
  }
}

export type DeliveryExecMode = "delivery_exec" | "plan_nudge" | "blocked";

export type DeliveryExecGate = Readonly<{
  mode: DeliveryExecMode;
  reason: string;
  message: string;
  mapping: BoardTodolistDeliveryMapping;
  todolist: ExecutorPrivateTodolist | null;
  taskBag: ExecutionTaskBag | null;
}>;

/**
 * 三件套 completeness for delivery exec (board + group context pointer + confirmed step).
 */
export function assertExecutionTaskBagAllowsDelivery(
  bag: ExecutionTaskBag | null | undefined,
): TodolistResult<ExecutionTaskBag> {
  if (!bag) {
    return {
      ok: false,
      reason: "exec_bag_incomplete",
      message: "execution task bag missing; refuse delivery exec",
    };
  }
  const itemId = compact(bag.boardSummary?.itemId);
  const goal = compact(bag.boardSummary?.goal);
  const groupId = compact(bag.groupContextPointer?.groupId);
  const transcriptHint = compact(bag.groupContextPointer?.transcriptHint);
  if (!itemId || !goal) {
    return {
      ok: false,
      reason: "exec_bag_incomplete",
      message: "execution bag missing shared board summary (itemId/goal)",
    };
  }
  if (!groupId || !transcriptHint) {
    return {
      ok: false,
      reason: "exec_bag_incomplete",
      message: "execution bag missing group context pointer (groupId/transcriptHint)",
    };
  }
  if (!bag.todolistCurrentStep || !compact(bag.todolistCurrentStep.stepId)) {
    return {
      ok: false,
      reason: "exec_bag_incomplete",
      message: "execution bag missing confirmed executor Todolist current step",
    };
  }
  if (!bag.planGate?.confirmed) {
    return {
      ok: false,
      reason: "plan_gate_unconfirmed",
      message: `Todolist not confirmed (status=${bag.planGate?.todolistStatus ?? "missing"}); refuse delivery exec`,
    };
  }
  if (bag.todolistCurrentStep.status !== "confirmed") {
    return {
      ok: false,
      reason: "plan_gate_unconfirmed",
      message: `Todolist step inject status is ${bag.todolistCurrentStep.status}; confirmed plan required`,
    };
  }
  return { ok: true, value: bag };
}

/**
 * Evaluate whether a board item may receive **delivery-type** self-advance / exec.
 * Unconfirmed applied → plan_nudge only (remind / ask to complete plan).
 */
export function evaluateDeliveryExecGate(params: {
  boardItem: GroupBoardClaimItem;
  todolist: ExecutorPrivateTodolist | null;
  /** Expected executor (lead / claimant). */
  ownerMemberId: string;
  groupContextPointer?: { transcriptHint?: string; note?: string };
}): DeliveryExecGate {
  const mapping = boardTodolistDeliveryMapping(params.boardItem.status);
  const owner = compact(params.ownerMemberId);
  const claimant = compact(params.boardItem.claimantId);
  const todolist = params.todolist;

  if (!mapping.deliverySelfAdvanceEligible) {
    return {
      mode: "blocked",
      reason: "board_status_blocks_delivery",
      message: mapping.note,
      mapping,
      todolist,
      taskBag: null,
    };
  }

  if (!owner) {
    return {
      mode: "blocked",
      reason: "invalid_owner",
      message: "delivery exec requires a valid ownerMemberId / claimant",
      mapping,
      todolist,
      taskBag: null,
    };
  }

  if (claimant && claimant !== owner) {
    return {
      mode: "blocked",
      reason: "owner_not_claimant",
      message: `owner ${owner} is not board claimant ${claimant}`,
      mapping,
      todolist,
      taskBag: null,
    };
  }

  if (todolist && compact(todolist.ownerMemberId) !== owner) {
    return {
      mode: "blocked",
      reason: "todolist_owner_mismatch",
      message: "Todolist owner must match current claimant for delivery exec",
      mapping,
      todolist,
      taskBag: null,
    };
  }

  if (!isTodolistConfirmedForDelivery(todolist)) {
    const status = todolist?.status ?? "missing";
    return {
      mode: "plan_nudge",
      reason: "plan_gate_unconfirmed",
      message:
        status === "missing"
          ? "no confirmed Todolist; remind executor to proposeTodolist → confirmTodolist (no delivery exec)"
          : `todolist status is ${status}; only plan_nudge allowed until confirmTodolist`,
      mapping,
      todolist,
      taskBag: null,
    };
  }

  // Confirmed — build bag and require 三件套 complete.
  const bag = buildExecutionTaskBag({
    boardItem: params.boardItem,
    todolist,
    groupContextPointer: params.groupContextPointer,
  });
  const complete = assertExecutionTaskBagAllowsDelivery(bag);
  if (!complete.ok) {
    return {
      mode: "plan_nudge",
      reason: complete.reason,
      message: complete.message,
      mapping,
      todolist,
      taskBag: bag,
    };
  }

  return {
    mode: "delivery_exec",
    reason: "delivery_exec_eligible",
    message: "confirmed plan + complete 三件套; delivery-type self-advance allowed",
    mapping,
    todolist,
    taskBag: complete.value,
  };
}

/**
 * Authority-backed gate used by self-advance and other exec entries.
 */
export async function evaluateDeliveryExecGateForBoardItem(
  authority: RuntimeAuthority,
  params: {
    boardItem: GroupBoardClaimItem;
    ownerMemberId: string;
    groupContextPointer?: { transcriptHint?: string; note?: string };
  },
): Promise<DeliveryExecGate> {
  const ownerMemberId = compact(params.ownerMemberId);
  const todolist = ownerMemberId
    ? await loadLatestOwnerTodolistForBoardItem(authority, {
        taskId: params.boardItem.taskId,
        boardItemId: params.boardItem.itemId,
        ownerMemberId,
      })
    : null;
  return evaluateDeliveryExecGate({
    boardItem: params.boardItem,
    todolist,
    ownerMemberId,
    groupContextPointer: params.groupContextPointer,
  });
}

/**
 * Shared hard gate: confirmed plan required (same as markInProgress).
 * Re-export path for call sites that already use assertPlanGateAllowsDeliveryProgress.
 */
export async function assertDeliveryPlanConfirmed(
  authority: RuntimeAuthority,
  params: { taskId: string; boardItemId: string; ownerMemberId: string },
): Promise<TodolistResult<ExecutorPrivateTodolist>> {
  return assertPlanGateAllowsDeliveryProgress(authority, params);
}

/** True when Todolist has a resolvable current step (for bag inject). */
export function todolistHasCurrentStep(
  todolist: ExecutorPrivateTodolist | null | undefined,
): boolean {
  if (!todolist) {
    return false;
  }
  return resolveCurrentTodolistStep(todolist) != null;
}

/** Compile-time / docs contract: platform never defaults self-advance on. */
export function s2DoesNotDefaultSelfAdvanceOn(): true {
  return true;
}
