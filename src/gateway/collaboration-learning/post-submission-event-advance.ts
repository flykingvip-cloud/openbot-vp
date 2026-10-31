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
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  clearBoardPendingEventRelay,
  type BoardPendingEventRelay,
  type GroupBoardClaimItem,
} from "../collaboration-dispatch/claim-contract.js";
import {
  loadExecutorTodolist,
  listExecutorTodolists,
} from "../collaboration-dispatch/executor-private-todolist.js";
import { SELF_ADVANCE_ACTIVE_BOARD_STATUSES } from "../collaboration-dispatch/self-advance.js";
import {
  consumeWakeForRoundDispatch,
  getWakeRoundDispatcher,
  type WakeRoundDispatcher,
} from "../collaboration-dispatch/wake-round-dispatch.js";
import { buildClaimAuthority, listCollaborationBoardItems } from "./claim-contract-entry.js";
import type { TeamResourceAuthOk, TrustedGroupStores } from "./team-resource-auth.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

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

async function resolveReturnPlanGate(params: {
  authority: Awaited<ReturnType<typeof buildClaimAuthority>>["authority"];
  taskId: string;
  boardItemId: string;
}): Promise<{ ok: true } | { ok: false; reason: string; pendingConfirm: boolean }> {
  try {
    const bound = await listExecutorTodolists(params.authority, {
      taskId: params.taskId,
      boardItemId: params.boardItemId,
    });
    if (bound.length === 0) {
      return { ok: false, reason: "return_plan_missing", pendingConfirm: true };
    }
    const confirmed = bound.find((tl) => tl.status === "confirmed");
    if (!confirmed) {
      return { ok: false, reason: "return_plan_not_confirmed", pendingConfirm: true };
    }
    const live = await loadExecutorTodolist(params.authority, {
      taskId: params.taskId,
      todolistId: confirmed.todolistId,
    });
    if (!live || live.status !== "confirmed") {
      return { ok: false, reason: "return_plan_stale_or_revised", pendingConfirm: true };
    }
    return { ok: true };
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
 * Clears pendingEventRelay only when consume ran (including idempotent_reuse /
 * flag_off / dry_run recorded outcomes that still used the same op).
 * Leaves pending when consume throws or cannot start — recovery rescans same opKey.
 */
export async function triggerPostSubmissionEventAdvance(params: {
  groupId: string;
  taskId: string;
  itemId: string;
  actorId: string;
  /** Prefer reading pending from live board; overrides allowed for recovery. */
  pending?: BoardPendingEventRelay | null;
  auth?: TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  stores?: TrustedGroupStores | null;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
  roundDispatcher?: WakeRoundDispatcher | null;
}): Promise<PostSubmissionEventAdvanceResult> {
  const cfg = params.cfg ?? loadConfig();
  const groupId = compact(params.groupId);
  const taskId = compact(params.taskId);
  const itemId = compact(params.itemId);
  const actorId = compact(params.actorId);
  if (!groupId || !taskId || !itemId || !actorId) {
    return emptyResult("none", "missing_group_task_item_or_actor");
  }

  const { authority } = await buildClaimAuthority({
    groupId,
    taskId,
    cfg,
    tenant: params.tenant,
    auth: params.auth,
    trusted: params.trusted,
    stores: params.stores,
  });

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
    if (stale?.status === "pending" && compact(stale.opKey)) {
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
    });
  }

  const pending: BoardPendingEventRelay | null | undefined =
    params.pending !== undefined ? params.pending : item.pendingEventRelay;
  if (!pending || pending.status !== "pending") {
    return emptyResult("none", "no_pending_event_relay", {
      pendingRelay: false,
    });
  }

  const businessEvent = pending.businessEvent;
  const opKey = compact(pending.opKey);
  const targetAgentIds = [...pending.targetAgentIds].map(compact).filter(Boolean);
  if (!opKey || targetAgentIds.length === 0) {
    return emptyResult(businessEvent, "pending_relay_incomplete", {
      pendingRelay: true,
      opKey: opKey || null,
    });
  }

  // Stop / revoke / terminal gates are enforced inside consumeWake + callers;
  // additionally refuse when board is no longer actionable for this event.
  if (businessEvent === "submitted_for_review" && item.status !== "submitted_for_review") {
    return emptyResult(businessEvent, `status_not_submitted:${item.status}`, {
      pendingRelay: true,
      opKey,
      targetAgentIds,
    });
  }
  if (businessEvent === "returned" && item.status !== "returned") {
    return emptyResult(businessEvent, `status_not_returned:${item.status}`, {
      pendingRelay: true,
      opKey,
      targetAgentIds,
    });
  }

  if (businessEvent === "returned") {
    const planGate = await resolveReturnPlanGate({
      authority,
      taskId,
      boardItemId: itemId,
    });
    if (!planGate.ok) {
      // Do not force old binding; leave durable pending recognizable for later
      // reconfirm → recovery, but do not consume/dispatch yet.
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
      });
    }
    // Claimant still required; returned items may need mark_in_progress later —
    // consume still targets claimant; active status not required for revision wake.
    void SELF_ADVANCE_ACTIVE_BOARD_STATUSES;
  }

  const reason = [
    `board_event=${businessEvent}`,
    `sourceId=${pending.sourceId}`,
    `artifact=${pending.artifactVersion}`,
    pending.returnRevision != null ? `returnRevision=${pending.returnRevision}` : null,
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
        tenantId: params.tenant?.tenantId ?? params.auth?.tenantId ?? null,
        fromAgentId: actorId,
        toAgentIds: targetAgentIds,
        // Reuse nudge gate — do NOT expand WAKE_ROUND_DISPATCH_SOURCES.
        source: "nudge",
        taskId,
        itemId,
        reason,
        opKey,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
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
    });
  }

  // Consume ran: clear durable pending (idempotent reuse / flag_off / dry_run all used same op).
  // Unknown ≠ auto-release: if consume returns without a reason and without wakeEvent, keep pending.
  // Consume always returns a reason/outcome when it completes normally.
  const consumeRecognized = Boolean(consume.reason) || Boolean(consume.outcome);

  if (consumeRecognized) {
    await clearBoardPendingEventRelay(authority, { taskId, itemId, expectedOpKey: opKey }, { cfg });
  }

  return finish({
    autoAdvanceWired: true,
    businessEvent,
    wakeRecorded: Boolean(consume.wakeEvent) || consume.outcome === "recorded",
    wakeConsumed: consumeRecognized,
    dispatched: Boolean(consume.dispatched),
    pendingRelay: !consumeRecognized,
    reason: consume.reason || (consume.dispatched ? "dispatched" : "wake_recorded"),
    targetAgentIds,
    opKey,
  });
}

/** Scan board items for durable pending relays (recovery / heartbeat reuse). */
export function listPendingBoardEventRelays(
  items: readonly GroupBoardClaimItem[],
): Array<{ item: GroupBoardClaimItem; pending: BoardPendingEventRelay }> {
  const out: Array<{ item: GroupBoardClaimItem; pending: BoardPendingEventRelay }> = [];
  for (const item of items) {
    const pending = item.pendingEventRelay;
    if (pending && pending.status === "pending" && compact(pending.opKey)) {
      // accepted / cancelled must not re-dispatch old events
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
        pending: row.pending,
        auth: params.auth,
        trusted: params.trusted,
        stores: params.stores,
        tenant: params.tenant,
        cfg: params.cfg,
        roundDispatcher: params.roundDispatcher,
      }),
    );
  }
  return results;
}
