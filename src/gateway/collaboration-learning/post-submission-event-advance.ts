/**
 * P2 — post submit/return/accept relay via existing nudge consume path.
 *
 * Reuses consumeWakeForRoundDispatch(source=nudge) like post-plan-confirm-advance.
 * Does NOT expand WAKE_ROUND_DISPATCH_SOURCES; does NOT hardcode writeMode=execute.
 * Business event type / version / source id stay in reason + opKey (not a bare nudge).
 *
 * Durable pendingEventRelay on the board item makes write-ok/wake-fail recoverable
 * through the same opKey (idempotent). No in-memory queue.
 */
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  clearBoardPendingEventRelay,
  updateBoardPendingEventRelayStatus,
  type BoardPendingEventRelay,
  type GroupBoardClaimItem,
} from "../collaboration-dispatch/claim-contract.js";
import {
  loadExecutorTodolist,
  loadLatestOwnerTodolistForBoardItem,
  buildExecutionTaskBag,
} from "../collaboration-dispatch/executor-private-todolist.js";
import type { RuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import { SELF_ADVANCE_ACTIVE_BOARD_STATUSES } from "../collaboration-dispatch/self-advance.js";
import {
  consumeWakeForRoundDispatch,
  getWakeRoundDispatcher,
  type ConsumeWakeRoundDispatchResult,
  type WakeRoundDispatcher,
} from "../collaboration-dispatch/wake-round-dispatch.js";
import { buildClaimAuthority, listCollaborationBoardItems } from "./claim-contract-entry.js";
import type { TeamResourceAuthOk, TrustedGroupStores } from "./team-resource-auth.js";
import { TRUSTED_GROUP_LOCATOR_REQUIRED } from "./team-resource-auth.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";
import { trustedLocatorFromAuthority } from "./verify-linked-team-deliverable.js";

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

const log = createSubsystemLogger("gateway/post-submission-event-advance");

export type PostSubmissionEventAdvanceResult = {
  autoAdvanceWired: true;
  businessEvent: BoardPendingEventRelay["businessEvent"] | "none";
  wakeRecorded: boolean;
  wakeConsumed: boolean;
  dispatched: boolean;
  pendingRelay: boolean;
  reason: string;
  targetAgentIds: string[];
  opKey: string | null;
  /** When return needs plan reconfirm instead of forcing old binding. */
  planPendingConfirm?: boolean;
  pendingLifecycle?: "pending" | "dispatched" | "blocked" | "unknown" | "cleared";
};

function finish(result: PostSubmissionEventAdvanceResult): PostSubmissionEventAdvanceResult {
  log.info("triggerPostSubmissionEventAdvance", {
    businessEvent: result.businessEvent,
    reason: result.reason,
    wakeRecorded: result.wakeRecorded,
    wakeConsumed: result.wakeConsumed,
    dispatched: result.dispatched,
    pendingRelay: result.pendingRelay,
    targetAgentIds: result.targetAgentIds,
    opKey: result.opKey,
    planPendingConfirm: result.planPendingConfirm,
    pendingLifecycle: result.pendingLifecycle,
  });
  return result;
}

function emptyResult(
  businessEvent: PostSubmissionEventAdvanceResult["businessEvent"],
  reason: string,
  extra?: Partial<PostSubmissionEventAdvanceResult>,
): PostSubmissionEventAdvanceResult {
  return finish({
    autoAdvanceWired: true,
    businessEvent,
    wakeRecorded: false,
    wakeConsumed: false,
    dispatched: false,
    pendingRelay: false,
    reason,
    targetAgentIds: [],
    opKey: null,
    ...extra,
  });
}

/**
 * Classify consume outcome for pending lifecycle.
 * Never treat "reason non-empty" as success — flag-off / dry-run / no_consumer keep pending.
 */
export function classifyConsumePendingLifecycle(
  consume: Pick<ConsumeWakeRoundDispatchResult, "outcome" | "dispatched" | "reason" | "reused">,
): "clear_completed" | "clear_terminal" | "retain" | "retain_unknown" {
  const reason = compact(consume.reason);
  if (consume.dispatched || reason === "idempotent_reuse" || consume.reused) {
    return "clear_completed";
  }
  // Permanent terminal — do not pretend completed via generic clear-as-success,
  // but stop recoverable retries.
  if (
    reason === "task_stopped" ||
    reason === "task_stopped_in_flight" ||
    reason === "auth_revoked" ||
    reason === "membership_revoked" ||
    reason === "duty_revoked" ||
    (reason.startsWith("auth_") && reason.endsWith("_revoked"))
  ) {
    return "clear_terminal";
  }
  // Unknown: side-effect unproven — keep marker, do not auto-retry as success.
  if (
    reason.startsWith("dispatch_threw:") ||
    reason.startsWith("external_sent_") ||
    reason.includes("unknown")
  ) {
    return "retain_unknown";
  }
  // Incomplete / recoverable: flag-off, dry-run, dispatcher unavailable, failed dispatch.
  if (
    reason === "wake_contract_off" ||
    reason === "self_advance_not_execute" ||
    reason === "no_consumer" ||
    reason === "dispatch_missing_round_id" ||
    reason.startsWith("dispatch_failed:") ||
    reason === "dispatch_readiness_not_ready" ||
    reason === "eligibility_commit_failed" ||
    reason === "task_control_unreadable" ||
    reason === "auth_source_unreadable" ||
    reason === "missing_group_id"
  ) {
    return "retain";
  }
  // Default: retain recoverable pending (never clear on mere non-empty reason).
  return "retain";
}

type ReturnPlanBinding =
  | {
      ok: true;
      todolistId: string;
      planVersion: number;
      stepId?: string;
      claimantId: string;
    }
  | { ok: false; reason: string; pendingConfirm: boolean };

async function resolveReturnExecutionBinding(params: {
  authority: RuntimeAuthority;
  taskId: string;
  boardItemId: string;
  item: GroupBoardClaimItem;
  pending: BoardPendingEventRelay;
}): Promise<ReturnPlanBinding> {
  const claimantId = compact(params.pending.claimantId) || compact(params.item.claimantId) || "";
  if (!claimantId) {
    return { ok: false, reason: "return_claimant_missing", pendingConfirm: true };
  }
  try {
    const todolist = await loadLatestOwnerTodolistForBoardItem(params.authority, {
      taskId: params.taskId,
      boardItemId: params.boardItemId,
      ownerMemberId: claimantId,
    });
    if (!todolist) {
      return { ok: false, reason: "return_plan_missing", pendingConfirm: true };
    }
    if (todolist.status !== "confirmed") {
      return { ok: false, reason: "return_plan_not_confirmed", pendingConfirm: true };
    }
    const live = await loadExecutorTodolist(params.authority, {
      taskId: params.taskId,
      todolistId: todolist.todolistId,
    });
    if (!live || live.status !== "confirmed") {
      return { ok: false, reason: "return_plan_stale_or_revised", pendingConfirm: true };
    }
    // Exact binding: pending snapshot must still match live plan version when set.
    const boundTodolistId = compact(params.pending.todolistId);
    if (boundTodolistId && boundTodolistId !== compact(live.todolistId)) {
      return { ok: false, reason: "return_plan_binding_todolist_mismatch", pendingConfirm: true };
    }
    if (
      typeof params.pending.planVersion === "number" &&
      Number.isFinite(params.pending.planVersion) &&
      params.pending.planVersion !== live.version
    ) {
      return { ok: false, reason: "return_plan_binding_version_mismatch", pendingConfirm: true };
    }
    const bag = buildExecutionTaskBag({ boardItem: params.item, todolist: live });
    const step = bag.todolistCurrentStep;
    const stepId = compact(params.pending.stepId) || compact(step?.stepId) || undefined;
    if (params.pending.stepId && stepId && compact(params.pending.stepId) !== stepId) {
      return { ok: false, reason: "return_plan_binding_step_mismatch", pendingConfirm: true };
    }
    if (!bag.planGate.confirmed) {
      return { ok: false, reason: "return_plan_gate_unconfirmed", pendingConfirm: true };
    }
    return {
      ok: true,
      todolistId: compact(live.todolistId),
      planVersion: live.version,
      stepId,
      claimantId,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: `return_plan_unavailable:${detail}`.slice(0, 200),
      pendingConfirm: true,
    };
  }
}

/**
 * After durable board submit/return/accept, attempt existing nudge consume.
 * Clears pendingEventRelay only on explicit completed / terminal outcomes.
 * Leaves pending when consume cannot finish the relay — recovery rescans same opKey.
 */
export async function triggerPostSubmissionEventAdvance(params: {
  groupId: string;
  taskId: string;
  itemId: string;
  actorId: string;
  /** Prefer reading pending from live board; overrides allowed only when opKey matches live. */
  pending?: BoardPendingEventRelay | null;
  auth?: TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  stores?: TrustedGroupStores | null;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
  roundDispatcher?: WakeRoundDispatcher | null;
  /**
   * When true (heartbeat / managed recovery), missing trusted scope refuses —
   * never fall back to legacy/compat root.
   */
  requireTrustedScope?: boolean;
}): Promise<PostSubmissionEventAdvanceResult> {
  const cfg = params.cfg ?? loadConfig();
  const groupId = compact(params.groupId);
  const taskId = compact(params.taskId);
  const itemId = compact(params.itemId);
  const actorId = compact(params.actorId);
  if (!groupId || !taskId || !itemId || !actorId) {
    return emptyResult("none", "missing_group_task_item_or_actor");
  }

  if (params.requireTrustedScope) {
    const hasTrusted =
      Boolean(params.auth?.groupLocator) ||
      Boolean(params.trusted?.groupLocator) ||
      Boolean(params.stores?.groupLocator);
    if (!hasTrusted) {
      return emptyResult("none", TRUSTED_GROUP_LOCATOR_REQUIRED, {
        pendingRelay: true,
        pendingLifecycle: "pending",
      });
    }
  }

  const built = await buildClaimAuthority({
    groupId,
    taskId,
    cfg,
    tenant: params.tenant,
    auth: params.auth,
    trusted: params.trusted,
    stores: params.stores,
  });
  const { authority } = built;

  if (params.requireTrustedScope) {
    const loc = trustedLocatorFromAuthority(authority);
    if (!loc) {
      return emptyResult("none", TRUSTED_GROUP_LOCATOR_REQUIRED, {
        pendingRelay: true,
        pendingLifecycle: "pending",
      });
    }
    // Refuse silent drift onto a different root than the caller-supplied trusted scope.
    const expected =
      compact(params.trusted?.groupLocator) ||
      compact(params.auth?.groupLocator) ||
      compact(params.stores?.groupLocator);
    if (expected && path.resolve(expected) !== path.resolve(loc.groupLocator)) {
      return emptyResult("none", "trusted_scope_mismatch", {
        pendingRelay: true,
        pendingLifecycle: "pending",
      });
    }
  }

  const items = await listCollaborationBoardItems({
    groupId,
    taskId,
    cfg,
    auth: params.auth,
    trusted: params.trusted,
    stores: params.stores,
    tenant: params.tenant,
  });
  const item = items.find((row) => row.itemId === itemId);
  if (!item) {
    return emptyResult("none", "board_item_missing");
  }

  // Accepted: stop auto-advance for this item — clear any stale pending, do not dispatch.
  if (item.status === "accepted") {
    const stale = item.pendingEventRelay;
    if (stale && compact(stale.opKey)) {
      await clearBoardPendingEventRelay(
        authority,
        { taskId, itemId, expectedOpKey: stale.opKey },
        { cfg },
      );
    }
    return emptyResult("accepted", "accepted_no_further_exec_schedule", {
      pendingRelay: false,
      opKey: stale?.opKey ?? null,
      targetAgentIds: [],
      pendingLifecycle: "cleared",
    });
  }
  if (item.status === "cancelled") {
    const stale = item.pendingEventRelay;
    if (stale && compact(stale.opKey)) {
      await clearBoardPendingEventRelay(
        authority,
        { taskId, itemId, expectedOpKey: stale.opKey },
        { cfg },
      );
    }
    return emptyResult("none", "cancelled_no_further_exec_schedule", {
      pendingRelay: false,
      opKey: stale?.opKey ?? null,
      pendingLifecycle: "cleared",
    });
  }

  // Always bind to LIVE pending — stale recovery snapshots with a different opKey must not start.
  const livePending = item.pendingEventRelay;
  if (!livePending || livePending.status !== "pending") {
    if (livePending?.status === "unknown") {
      return emptyResult(livePending.businessEvent, "pending_relay_unknown_no_auto_retry", {
        pendingRelay: true,
        opKey: livePending.opKey,
        pendingLifecycle: "unknown",
        targetAgentIds: [...livePending.targetAgentIds],
      });
    }
    return emptyResult("none", "no_pending_event_relay", {
      pendingRelay: false,
      pendingLifecycle: livePending?.status,
    });
  }
  if (params.pending !== undefined && params.pending !== null) {
    const snapshotKey = compact(params.pending.opKey);
    if (snapshotKey && snapshotKey !== compact(livePending.opKey)) {
      return emptyResult(params.pending.businessEvent, "pending_opkey_stale_or_superseded", {
        pendingRelay: false,
        opKey: snapshotKey,
        pendingLifecycle: "blocked",
      });
    }
  }

  const pending = livePending;
  const businessEvent = pending.businessEvent;
  const opKey = compact(pending.opKey);
  const targetAgentIds = [...pending.targetAgentIds].map(compact).filter(Boolean);
  if (!opKey || targetAgentIds.length === 0) {
    return emptyResult(businessEvent, "pending_relay_incomplete", {
      pendingRelay: true,
      opKey: opKey || null,
      pendingLifecycle: "pending",
    });
  }

  // Stop / revoke / terminal gates are enforced inside consumeWake + callers;
  // additionally refuse when board is no longer actionable for this event.
  if (businessEvent === "submitted_for_review" && item.status !== "submitted_for_review") {
    await updateBoardPendingEventRelayStatus(
      authority,
      { taskId, itemId, expectedOpKey: opKey, status: "blocked" },
      { cfg },
    );
    return emptyResult(businessEvent, `status_not_submitted:${item.status}`, {
      pendingRelay: false,
      opKey,
      targetAgentIds,
      pendingLifecycle: "blocked",
    });
  }
  if (businessEvent === "returned" && item.status !== "returned") {
    await updateBoardPendingEventRelayStatus(
      authority,
      { taskId, itemId, expectedOpKey: opKey, status: "blocked" },
      { cfg },
    );
    return emptyResult(businessEvent, `status_not_returned:${item.status}`, {
      pendingRelay: false,
      opKey,
      targetAgentIds,
      pendingLifecycle: "blocked",
    });
  }

  // Return revision / board revision barrier (accept / revise / reassign supersede).
  if (
    businessEvent === "returned" &&
    typeof pending.returnRevision === "number" &&
    typeof item.returnCount === "number" &&
    pending.returnRevision !== item.returnCount
  ) {
    await updateBoardPendingEventRelayStatus(
      authority,
      { taskId, itemId, expectedOpKey: opKey, status: "blocked" },
      { cfg },
    );
    return emptyResult(businessEvent, "return_revision_superseded", {
      pendingRelay: false,
      opKey,
      targetAgentIds,
      pendingLifecycle: "blocked",
    });
  }
  if (
    typeof pending.boardRevision === "number" &&
    typeof item.revision === "number" &&
    pending.boardRevision !== item.revision
  ) {
    // Board moved (new submit / accept / reassign) — old relay must not start.
    await updateBoardPendingEventRelayStatus(
      authority,
      { taskId, itemId, expectedOpKey: opKey, status: "blocked" },
      { cfg },
    );
    return emptyResult(businessEvent, "board_revision_superseded", {
      pendingRelay: false,
      opKey,
      targetAgentIds,
      pendingLifecycle: "blocked",
    });
  }

  let planConfirmBinding:
    | { todolistId: string; confirmedVersion: number; stepId?: string | null }
    | undefined;
  if (businessEvent === "returned") {
    const planGate = await resolveReturnExecutionBinding({
      authority,
      taskId,
      boardItemId: itemId,
      item,
      pending,
    });
    if (!planGate.ok) {
      return finish({
        autoAdvanceWired: true,
        businessEvent,
        wakeRecorded: false,
        wakeConsumed: false,
        dispatched: false,
        pendingRelay: true,
        reason: planGate.reason,
        targetAgentIds,
        opKey,
        planPendingConfirm: planGate.pendingConfirm,
        pendingLifecycle: "pending",
      });
    }
    planConfirmBinding = {
      todolistId: planGate.todolistId,
      confirmedVersion: planGate.planVersion,
      stepId: planGate.stepId ?? null,
    };
    void SELF_ADVANCE_ACTIVE_BOARD_STATUSES;
  }

  const reason = [
    `board_event=${businessEvent}`,
    `sourceId=${pending.sourceId}`,
    `artifact=${pending.artifactVersion}`,
    pending.returnRevision != null ? `returnRevision=${pending.returnRevision}` : null,
    planConfirmBinding
      ? `todolist=${planConfirmBinding.todolistId}@v${planConfirmBinding.confirmedVersion}`
      : null,
    planConfirmBinding?.stepId ? `step=${planConfirmBinding.stepId}` : null,
    pending.linkedDeliverableId
      ? `deliverable=${pending.linkedDeliverableId}@v${pending.linkedDeliverableVersion ?? "?"}`
      : null,
    `item=${itemId}`,
  ]
    .filter(Boolean)
    .join(":");

  const roundDispatcher =
    params.roundDispatcher !== undefined ? params.roundDispatcher : getWakeRoundDispatcher();

  let consume: Awaited<ReturnType<typeof consumeWakeForRoundDispatch>>;
  try {
    consume = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      roundDispatcher,
      request: {
        groupId,
        tenantId: params.tenant?.tenantId ?? params.auth?.tenantId ?? authority.tenantId ?? null,
        fromAgentId: actorId,
        toAgentIds: targetAgentIds,
        // Reuse nudge gate — do NOT expand WAKE_ROUND_DISPATCH_SOURCES.
        source: "nudge",
        taskId,
        itemId,
        reason,
        opKey,
        ...(planConfirmBinding ? { planConfirmBinding } : {}),
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await updateBoardPendingEventRelayStatus(
      authority,
      { taskId, itemId, expectedOpKey: opKey, status: "unknown" },
      { cfg },
    );
    return finish({
      autoAdvanceWired: true,
      businessEvent,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      pendingRelay: true,
      reason: `consume_threw:${detail}`.slice(0, 240),
      targetAgentIds,
      opKey,
      pendingLifecycle: "unknown",
    });
  }

  const lifecycle = classifyConsumePendingLifecycle(consume);
  if (lifecycle === "clear_completed" || lifecycle === "clear_terminal") {
    await clearBoardPendingEventRelay(authority, { taskId, itemId, expectedOpKey: opKey }, { cfg });
  } else if (lifecycle === "retain_unknown") {
    await updateBoardPendingEventRelayStatus(
      authority,
      { taskId, itemId, expectedOpKey: opKey, status: "unknown" },
      { cfg },
    );
  }

  const cleared = lifecycle === "clear_completed" || lifecycle === "clear_terminal";
  return finish({
    autoAdvanceWired: true,
    businessEvent,
    wakeRecorded: Boolean(consume.wakeEvent) || consume.outcome === "recorded",
    wakeConsumed: cleared || Boolean(consume.dispatched),
    dispatched: Boolean(consume.dispatched),
    pendingRelay: !cleared,
    reason:
      consume.reason ||
      (consume.dispatched
        ? "dispatched"
        : lifecycle === "clear_terminal"
          ? "terminal"
          : "wake_recorded"),
    targetAgentIds,
    opKey,
    pendingLifecycle:
      lifecycle === "clear_completed" || lifecycle === "clear_terminal"
        ? "cleared"
        : lifecycle === "retain_unknown"
          ? "unknown"
          : "pending",
  });
}

/** Scan board items for durable pending relays (recovery / heartbeat reuse). */
export function listPendingBoardEventRelays(
  items: readonly GroupBoardClaimItem[],
): Array<{ item: GroupBoardClaimItem; pending: BoardPendingEventRelay }> {
  const out: Array<{ item: GroupBoardClaimItem; pending: BoardPendingEventRelay }> = [];
  for (const item of items) {
    const pending = item.pendingEventRelay;
    // Only auto-recover actionable pending — unknown must not auto-retry as success.
    if (pending && pending.status === "pending" && compact(pending.opKey)) {
      if (item.status === "accepted" || item.status === "cancelled") {
        continue;
      }
      out.push({ item, pending });
    }
  }
  return out;
}

/**
 * Idempotent recovery: re-issue consume for each pending relay using the same opKey.
 * Does not invent a new queue — callers (heartbeat / recovery entry) supply items.
 * Always re-validates LIVE pending at the dispatch boundary (ignores stale snapshots).
 */
export async function recoverPendingBoardEventRelays(params: {
  groupId: string;
  taskId: string;
  actorId: string;
  items: readonly GroupBoardClaimItem[];
  auth?: TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  stores?: TrustedGroupStores | null;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
  roundDispatcher?: WakeRoundDispatcher | null;
  requireTrustedScope?: boolean;
}): Promise<PostSubmissionEventAdvanceResult[]> {
  const pending = listPendingBoardEventRelays(params.items);
  const results: PostSubmissionEventAdvanceResult[] = [];
  for (const row of pending) {
    results.push(
      await triggerPostSubmissionEventAdvance({
        groupId: params.groupId,
        taskId: params.taskId,
        itemId: row.item.itemId,
        actorId: params.actorId,
        // Pass opKey hint only; trigger re-reads live pending and refuses mismatch.
        pending: row.pending,
        auth: params.auth,
        trusted: params.trusted,
        stores: params.stores,
        tenant: params.tenant,
        cfg: params.cfg,
        roundDispatcher: params.roundDispatcher,
        requireTrustedScope: params.requireTrustedScope,
      }),
    );
  }
  return results;
}
