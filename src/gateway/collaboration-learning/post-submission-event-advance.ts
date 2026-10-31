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
  clearBoundWakeExecutionAttemptId,
  commitBoardDispatchPermit,
  invalidateBoardDispatchPermitAttempt,
  loadBoardClaimItem,
  markBoardDispatchInvokeStarted,
  updateBoardPendingEventRelayStatus,
  type BoardPendingEventRelay,
  type ClaimResult,
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
  markWakeOpFailed,
  readWakeOpRecord,
  readWakeOpRecordDetailed,
} from "../collaboration-dispatch/wake-op-ledger.js";
import {
  classifyDispatchSideEffect,
  consumeWakeForRoundDispatch,
  getWakeRoundDispatcher,
  type ConsumeWakeRoundDispatchResult,
  type DispatchSideEffectClass,
  type WakeRoundDispatcher,
  type WakeRoundDispatchRequest,
} from "../collaboration-dispatch/wake-round-dispatch.js";
import { buildClaimAuthority, listCollaborationBoardItems } from "./claim-contract-entry.js";
import { deliveryActorIdsEqual } from "./delivery-actor-binding.js";
import {
  buildExecutionDeliverableBinding,
  runIdFromWakeOpAttempt,
} from "./execution-deliverable-binding.js";
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
    reason.includes("unknown") ||
    reason.includes("side_effect_started") ||
    reason.includes("execute_collaboration_round_failed") ||
    reason.includes("dispatch_invoke_mark_rejected") ||
    reason.includes("dispatch_invoke_mark_threw") ||
    reason.includes("dispatch_attempt_id_missing")
  ) {
    return "retain_unknown";
  }
  // Incomplete / recoverable: flag-off, dry-run, dispatcher unavailable, failed dispatch
  // ONLY when side effects are proven not started (see classifyDispatchSideEffect).
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
 * Distinct dispatch intents — review vs return-revise — not a generic "continue advance".
 */
function buildBoardEventDispatchPrompt(params: {
  businessEvent: BoardPendingEventRelay["businessEvent"];
  claimantName: string;
  reason: string;
  bag?: ReturnType<typeof buildExecutionTaskBag> | null;
}): string {
  if (params.businessEvent === "returned") {
    const header = [
      "【Mode B 退回修订】来源=board_event=returned",
      `请按审查意见修订你认领的看板项（责任人 ${params.claimantName}），完成后正式提交成果。`,
      params.reason,
    ];
    const step = params.bag?.todolistCurrentStep;
    return [
      ...header,
      params.bag?.boardSummary?.itemId ? `board=${params.bag.boardSummary.itemId}` : null,
      params.bag?.boardSummary?.goal ? `goal=${params.bag.boardSummary.goal}` : null,
      step ? `step=${step.stepId}:v${step.version}:${step.title ?? ""}` : null,
      "intent=return_revise",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (params.businessEvent === "submitted_for_review") {
    return [
      "【Mode B 审查派发】来源=board_event=submitted_for_review",
      `请审查责任人 ${params.claimantName} 的交卷并给出接受/退回裁决。`,
      params.reason,
      "intent=review_submission",
    ].join("\n");
  }
  return [
    `【Mode B 事件中继】来源=board_event=${params.businessEvent}`,
    params.reason,
    `intent=board_event_${params.businessEvent}`,
  ].join("\n");
}

type CommitBoundaryAdjudication =
  | {
      ok: true;
      liveItem: GroupBoardClaimItem;
      livePending: BoardPendingEventRelay;
      todolistId?: string;
      planVersion?: number;
      stepId?: string;
      claimantId: string;
      bag?: ReturnType<typeof buildExecutionTaskBag>;
    }
  | { ok: false; reason: string; markBlocked?: boolean };

/**
 * Pre-permit adjudication read (after wake CAS take, before dispatch-permit commit).
 * Order: live item → pending opKey → pending status → board status → returnRevision →
 * boardRevision → effective claimant → plan version/step (returned).
 * Board conditions are re-checked atomically inside commitBoardDispatchPermit
 * (pending → dispatched) — that CAS is the dispatch-permit linearization point.
 */
async function adjudicatePendingAtDispatchCommit(params: {
  authority: RuntimeAuthority;
  taskId: string;
  itemId: string;
  expectedOpKey: string;
  expectedBusinessEvent: BoardPendingEventRelay["businessEvent"];
  expectedReturnRevision?: number;
  expectedBoardRevision?: number;
  expectedClaimantId?: string;
  expectedTodolistId?: string;
  expectedPlanVersion?: number;
  expectedStepId?: string;
}): Promise<CommitBoundaryAdjudication> {
  const liveItem = await loadBoardClaimItem(params.authority, {
    taskId: params.taskId,
    itemId: params.itemId,
  });
  if (!liveItem) {
    return { ok: false, reason: "commit_board_item_missing", markBlocked: true };
  }
  const livePending = liveItem.pendingEventRelay;
  if (!livePending) {
    return { ok: false, reason: "commit_pending_missing", markBlocked: true };
  }
  if (compact(livePending.opKey) !== compact(params.expectedOpKey)) {
    return { ok: false, reason: "commit_pending_opkey_mismatch", markBlocked: true };
  }
  if (livePending.status !== "pending") {
    return {
      ok: false,
      reason: `commit_pending_status:${livePending.status}`,
      markBlocked: true,
    };
  }
  if (livePending.businessEvent !== params.expectedBusinessEvent) {
    return {
      ok: false,
      reason: `commit_business_event_mismatch:${livePending.businessEvent}`,
      markBlocked: true,
    };
  }
  if (params.expectedBusinessEvent === "returned" && liveItem.status !== "returned") {
    return {
      ok: false,
      reason: `commit_status_not_returned:${liveItem.status}`,
      markBlocked: true,
    };
  }
  if (
    params.expectedBusinessEvent === "submitted_for_review" &&
    liveItem.status !== "submitted_for_review"
  ) {
    return {
      ok: false,
      reason: `commit_status_not_submitted:${liveItem.status}`,
      markBlocked: true,
    };
  }
  if (
    typeof params.expectedReturnRevision === "number" &&
    typeof livePending.returnRevision === "number" &&
    params.expectedReturnRevision !== livePending.returnRevision
  ) {
    return { ok: false, reason: "commit_return_revision_superseded", markBlocked: true };
  }
  if (
    typeof params.expectedReturnRevision === "number" &&
    typeof liveItem.returnCount === "number" &&
    params.expectedReturnRevision !== liveItem.returnCount
  ) {
    return { ok: false, reason: "commit_return_count_superseded", markBlocked: true };
  }
  if (
    typeof params.expectedBoardRevision === "number" &&
    typeof liveItem.revision === "number" &&
    params.expectedBoardRevision !== liveItem.revision
  ) {
    return { ok: false, reason: "commit_board_revision_superseded", markBlocked: true };
  }
  if (
    typeof params.expectedBoardRevision === "number" &&
    typeof livePending.boardRevision === "number" &&
    params.expectedBoardRevision !== livePending.boardRevision
  ) {
    return { ok: false, reason: "commit_pending_board_revision_mismatch", markBlocked: true };
  }

  const claimantId = compact(livePending.claimantId) || compact(liveItem.claimantId) || "";
  if (!claimantId) {
    return { ok: false, reason: "commit_claimant_missing", markBlocked: true };
  }
  if (params.expectedClaimantId && !deliveryActorIdsEqual(claimantId, params.expectedClaimantId)) {
    return {
      ok: false,
      reason: `commit_claimant_reassigned:live=${claimantId}:expected=${params.expectedClaimantId}`,
      markBlocked: true,
    };
  }
  const targets = (livePending.targetAgentIds ?? []).map(compact).filter(Boolean);
  if (
    targets.length > 0 &&
    !targets.some((id) => deliveryActorIdsEqual(id, claimantId)) &&
    params.expectedBusinessEvent === "returned"
  ) {
    // Return revise targets the claimant; mismatch means responsibility moved.
    return {
      ok: false,
      reason: `commit_target_claimant_mismatch:claimant=${claimantId}`,
      markBlocked: true,
    };
  }

  if (params.expectedBusinessEvent !== "returned") {
    return {
      ok: true,
      liveItem,
      livePending,
      claimantId,
    };
  }

  // Returned: re-validate exact plan version at commit (same order as plan-confirm).
  try {
    const todolist = await loadLatestOwnerTodolistForBoardItem(params.authority, {
      taskId: params.taskId,
      boardItemId: params.itemId,
      ownerMemberId: claimantId,
    });
    if (!todolist || todolist.status !== "confirmed") {
      return { ok: false, reason: "commit_plan_not_confirmed", markBlocked: false };
    }
    const live = await loadExecutorTodolist(params.authority, {
      taskId: params.taskId,
      todolistId: todolist.todolistId,
    });
    if (!live || live.status !== "confirmed") {
      return { ok: false, reason: "commit_plan_stale_or_revised", markBlocked: false };
    }
    const expectedTodolistId =
      compact(params.expectedTodolistId) || compact(livePending.todolistId);
    if (expectedTodolistId && expectedTodolistId !== compact(live.todolistId)) {
      return { ok: false, reason: "commit_plan_todolist_mismatch", markBlocked: false };
    }
    const expectedPlanVersion =
      typeof params.expectedPlanVersion === "number"
        ? params.expectedPlanVersion
        : typeof livePending.planVersion === "number"
          ? livePending.planVersion
          : undefined;
    if (
      typeof expectedPlanVersion === "number" &&
      Number.isFinite(expectedPlanVersion) &&
      expectedPlanVersion !== live.version
    ) {
      return {
        ok: false,
        reason: `commit_plan_version_mismatch:live=${live.version}:expected=${expectedPlanVersion}`,
        markBlocked: false,
      };
    }
    const bag = buildExecutionTaskBag({ boardItem: liveItem, todolist: live });
    const step = bag.todolistCurrentStep;
    const stepId =
      compact(params.expectedStepId) ||
      compact(livePending.stepId) ||
      compact(step?.stepId) ||
      undefined;
    if (params.expectedStepId && stepId && compact(params.expectedStepId) !== stepId) {
      return { ok: false, reason: "commit_plan_step_mismatch", markBlocked: false };
    }
    if (!bag.planGate.confirmed || !stepId) {
      return { ok: false, reason: "commit_plan_gate_or_step_required", markBlocked: false };
    }
    return {
      ok: true,
      liveItem,
      livePending,
      todolistId: compact(live.todolistId),
      planVersion: live.version,
      stepId,
      claimantId,
      bag,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: `commit_plan_unavailable:${detail}`.slice(0, 200),
      markBlocked: false,
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
  /**
   * Test-only: after live pending/opKey/revision checks (+ plan gate for return),
   * before consumeWakeForRoundDispatch. Legacy earlier window (still useful).
   */
  _testAfterLiveCheckBeforeConsumeBarrier?: () => Promise<void>;
  /**
   * Test-only: after adjudication read inside the dispatcher wrapper,
   * before commitBoardDispatchPermit (pending→dispatched CAS).
   * Proves the post-adjudication / pre-permit-commit race window is closed.
   */
  _testAfterAdjudicationReadBeforePermitCommit?: () => Promise<void>;
  /**
   * Test-only: after permit CAS commit, before dispatchInvokeStarted mark / baseDispatcher.
   * Crash-window for P2 R5/R6: permit acquired but dispatch not started.
   */
  _testAfterPermitCommitBeforeDispatcher?: () => Promise<void>;
  /**
   * Test-only P2 R6: force markBoardDispatchInvokeStarted to throw or reject so
   * callers can assert dispatcher is never invoked (dispatcher=0).
   */
  _testMarkInvokeStartedFault?: "throw" | "reject";
  /** Forwarded to consumeWakeForRoundDispatch (post-readiness, pre-CAS take). */
  _testAfterReadinessBarrier?: () => Promise<void>;
  /** Forwarded to consumeWakeForRoundDispatch (post-eligibility, pre-CAS take). */
  _testAfterEligibilityBarrier?: () => Promise<void>;
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
  let returnClaimantId: string | undefined;
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
    returnClaimantId = planGate.claimantId;
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
    businessEvent === "returned"
      ? "intent=return_revise"
      : businessEvent === "submitted_for_review"
        ? "intent=review_submission"
        : `intent=board_event_${businessEvent}`,
  ]
    .filter(Boolean)
    .join(":");

  // Snapshot versions for commit-boundary adjudication (post-CAS).
  const expectedReturnRevision =
    typeof pending.returnRevision === "number" ? pending.returnRevision : undefined;
  const expectedBoardRevision =
    typeof pending.boardRevision === "number"
      ? pending.boardRevision
      : typeof item.revision === "number"
        ? item.revision
        : undefined;
  const expectedClaimantId =
    returnClaimantId || compact(pending.claimantId) || compact(item.claimantId) || undefined;

  if (params._testAfterLiveCheckBeforeConsumeBarrier) {
    await params._testAfterLiveCheckBeforeConsumeBarrier();
  }

  const baseDispatcher: WakeRoundDispatcher | null =
    params.roundDispatcher !== undefined ? params.roundDispatcher : getWakeRoundDispatcher();

  // After wake CAS take: adjudicate (read) → atomic dispatch-permit CAS → external dispatch.
  // Permit linearization = commitBoardDispatchPermit (pending → dispatched under withRoundLock).
  // Model / Mode B execution stays outside the board lock; post-permit board changes are in-flight.
  const finalDispatcher: WakeRoundDispatcher = async (req: WakeRoundDispatchRequest) => {
    const gate = await adjudicatePendingAtDispatchCommit({
      authority,
      taskId,
      itemId,
      expectedOpKey: opKey,
      expectedBusinessEvent: businessEvent,
      expectedReturnRevision,
      expectedBoardRevision,
      expectedClaimantId,
      expectedTodolistId: planConfirmBinding?.todolistId,
      expectedPlanVersion: planConfirmBinding?.confirmedVersion,
      expectedStepId: planConfirmBinding?.stepId ?? undefined,
    });
    if (!gate.ok) {
      if (gate.markBlocked) {
        try {
          await updateBoardPendingEventRelayStatus(
            authority,
            { taskId, itemId, expectedOpKey: opKey, status: "blocked" },
            { cfg },
          );
        } catch {
          // best-effort; consume still records dispatch_failed
        }
      }
      return { ok: false, reason: gate.reason };
    }

    if (params._testAfterAdjudicationReadBeforePermitCommit) {
      await params._testAfterAdjudicationReadBeforePermitCommit();
    }

    // Linearization point: conditional pending → dispatched under board lock/version.
    // P2 R8: bind wake executionAttemptId at permit so invalidate cleanup uses the
    // original attempt — never re-select the wake ledger's current id.
    const wakeAttemptAtPermit = compact(req.wakeExecutionAttemptId);
    if (!wakeAttemptAtPermit) {
      return {
        ok: false,
        reason: "wake_execution_attempt_required_at_permit",
        sideEffectClass: "not_started",
      };
    }
    const permit = await commitBoardDispatchPermit(
      authority,
      {
        taskId,
        itemId,
        expectedOpKey: opKey,
        expectedBusinessEvent: businessEvent,
        expectedReturnRevision,
        expectedBoardRevision,
        expectedClaimantId,
        wakeExecutionAttemptId: wakeAttemptAtPermit,
      },
      { cfg },
    );
    if (!permit.ok) {
      const permitReason = compact(permit.reason) || "commit_dispatch_permit_failed";
      if (
        permitReason.startsWith("commit_status_") ||
        permitReason.startsWith("commit_claimant_") ||
        permitReason.startsWith("commit_return_") ||
        permitReason.startsWith("commit_board_") ||
        permitReason.startsWith("commit_pending_") ||
        permitReason.startsWith("commit_business_")
      ) {
        try {
          await updateBoardPendingEventRelayStatus(
            authority,
            { taskId, itemId, expectedOpKey: opKey, status: "blocked" },
            { cfg },
          );
        } catch {
          // best-effort
        }
      }
      return { ok: false, reason: permitReason };
    }

    const releaseDispatchPermitBestEffort = async (): Promise<void> => {
      try {
        await updateBoardPendingEventRelayStatus(
          authority,
          { taskId, itemId, expectedOpKey: opKey, status: "pending" },
          { cfg },
        );
      } catch {
        // best-effort
      }
    };

    let executionDeliverableBinding = req.executionDeliverableBinding ?? null;
    let enrichedPlan = planConfirmBinding;
    let dispatchPrompt = req.dispatchPrompt;

    if (businessEvent === "returned") {
      const wakeOpKey = compact(req.wakeOpKey) || compact(req.opKey) || opKey;
      const attemptId = compact(req.wakeExecutionAttemptId);
      if (!wakeOpKey || !attemptId) {
        await releaseDispatchPermitBestEffort();
        return {
          ok: false,
          reason: "wake_execution_attempt_required",
          sideEffectClass: "not_started",
        };
      }
      const todolistId = compact(gate.todolistId) || compact(planConfirmBinding?.todolistId);
      const planVersion =
        typeof gate.planVersion === "number"
          ? gate.planVersion
          : planConfirmBinding?.confirmedVersion;
      const stepId = compact(gate.stepId) || compact(planConfirmBinding?.stepId);
      if (!todolistId || typeof planVersion !== "number" || !stepId) {
        await releaseDispatchPermitBestEffort();
        return {
          ok: false,
          reason: "execution_deliverable_plan_required",
          sideEffectClass: "not_started",
        };
      }
      const runId = runIdFromWakeOpAttempt({ opKey: wakeOpKey, attemptId });
      executionDeliverableBinding = buildExecutionDeliverableBinding({
        tenantId:
          params.tenant?.tenantId ??
          params.auth?.tenantId ??
          req.tenantId ??
          authority.tenantId ??
          null,
        groupId,
        taskId,
        boardItemId: itemId,
        todolistId,
        planVersion,
        stepId,
        runId,
        attemptId,
        opKey: wakeOpKey,
        agentId: gate.claimantId,
        source: "wake_dispatch",
      });
      if (!executionDeliverableBinding) {
        await releaseDispatchPermitBestEffort();
        return {
          ok: false,
          reason: "execution_deliverable_binding_incomplete",
          sideEffectClass: "not_started",
        };
      }
      enrichedPlan = {
        todolistId,
        confirmedVersion: planVersion,
        stepId,
      };
      dispatchPrompt = buildBoardEventDispatchPrompt({
        businessEvent,
        claimantName: gate.claimantId,
        reason,
        bag: gate.bag,
      });
    } else if (businessEvent === "submitted_for_review") {
      dispatchPrompt = buildBoardEventDispatchPrompt({
        businessEvent,
        claimantName: expectedClaimantId || "claimant",
        reason,
      });
    }

    if (params._testAfterPermitCommitBeforeDispatcher) {
      await params._testAfterPermitCommitBeforeDispatcher();
    }

    if (!baseDispatcher) {
      // Permit held but execution never started — release for recoverable retry.
      await releaseDispatchPermitBestEffort();
      return {
        ok: false,
        reason: "mode_b_dispatcher_unbound",
        sideEffectClass: "not_started",
      };
    }
    const enriched: WakeRoundDispatchRequest = {
      ...req,
      ...(enrichedPlan ? { planConfirmBinding: enrichedPlan } : {}),
      ...(dispatchPrompt ? { dispatchPrompt } : {}),
      ...(executionDeliverableBinding ? { executionDeliverableBinding } : {}),
      reason,
    };
    // P2 R6: durable mark success is a necessary condition before baseDispatcher.
    // Capture attempt id from permit commit; gate mark on it so invalidate wins races.
    const permitAttemptId = compact(permit.value.pendingEventRelay?.dispatchAttemptId);
    if (!permitAttemptId) {
      try {
        await updateBoardPendingEventRelayStatus(
          authority,
          {
            taskId,
            itemId,
            expectedOpKey: opKey,
            status: "unknown",
            pendingVerification: true,
          },
          { cfg },
        );
      } catch {
        // best-effort
      }
      return {
        ok: false,
        reason: "dispatch_attempt_id_missing_after_permit",
        sideEffectClass: "started_or_unknown",
      };
    }

    let markResult: ClaimResult<GroupBoardClaimItem>;
    try {
      if (params._testMarkInvokeStartedFault === "throw") {
        throw new Error("test_mark_invoke_threw");
      }
      if (params._testMarkInvokeStartedFault === "reject") {
        markResult = {
          ok: false,
          reason: "test_mark_invoke_rejected",
          message: "injected mark reject",
        };
      } else {
        markResult = await markBoardDispatchInvokeStarted(
          authority,
          {
            taskId,
            itemId,
            expectedOpKey: opKey,
            expectedAttemptId: permitAttemptId,
          },
          { cfg },
        );
      }
    } catch {
      // Write result unconfirmed → pending-verification; MUST NOT release; MUST NOT dispatch.
      try {
        await updateBoardPendingEventRelayStatus(
          authority,
          {
            taskId,
            itemId,
            expectedOpKey: opKey,
            status: "unknown",
            pendingVerification: true,
          },
          { cfg },
        );
      } catch {
        // best-effort
      }
      return {
        ok: false,
        reason: "dispatch_invoke_mark_threw",
        sideEffectClass: "started_or_unknown",
      };
    }
    if (!markResult.ok) {
      // Rejected mark → MUST NOT call dispatcher.
      const markReason = compact(markResult.reason) || "unknown";
      // Invalidated / superseded attempt: invalidate already released to pending for recovery.
      // Do not overwrite that pending into unknown (would disturb the winning recovery path).
      if (
        markReason === "invoke_attempt_invalidated" ||
        markReason === "invoke_pending_missing" ||
        markReason === "invoke_pending_opkey_mismatch" ||
        markReason.startsWith("invoke_pending_status:")
      ) {
        // Attempt already invalidated/released to pending for recovery — do not
        // surface as mark_rejected (that would classify retain_unknown and clobber pending).
        return {
          ok: false,
          reason: `dispatch_invoke_mark_attempt_invalidated:${markReason}`,
          sideEffectClass: "not_started",
        };
      }
      // Still holding permit but mark refused — pending-verification; do NOT release for retry.
      try {
        await updateBoardPendingEventRelayStatus(
          authority,
          {
            taskId,
            itemId,
            expectedOpKey: opKey,
            status: "unknown",
            pendingVerification: true,
          },
          { cfg },
        );
      } catch {
        // best-effort
      }
      return {
        ok: false,
        reason: `dispatch_invoke_mark_rejected:${markReason}`,
        sideEffectClass: "started_or_unknown",
      };
    }
    const dispatched = await baseDispatcher(enriched);
    if (!dispatched.ok) {
      const side: DispatchSideEffectClass = classifyDispatchSideEffect(dispatched);
      if (side === "not_started") {
        // Definitely not started: release permit so recovery can retry same opKey.
        await releaseDispatchPermitBestEffort();
        return dispatched;
      }
      // Started or outcome unknown: keep unknown — do NOT auto-retry / release.
      // Completed-with-receipt on ok:false is anomalous; still do not blind-retry.
      try {
        await updateBoardPendingEventRelayStatus(
          authority,
          {
            taskId,
            itemId,
            expectedOpKey: opKey,
            status: "unknown",
            pendingVerification: true,
            dispatchInvokeStarted: true,
          },
          { cfg },
        );
      } catch {
        // best-effort
      }
      return {
        ok: false,
        reason: `side_effect_started_or_unknown:${dispatched.reason}`,
        message: dispatched.message,
        sideEffectClass: side === "completed_with_receipt" ? "started_or_unknown" : side,
      };
    }
    return dispatched;
  };

  let consume: Awaited<ReturnType<typeof consumeWakeForRoundDispatch>>;
  try {
    consume = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      roundDispatcher: finalDispatcher,
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
        ...(businessEvent === "returned" || businessEvent === "submitted_for_review"
          ? {
              dispatchPrompt: buildBoardEventDispatchPrompt({
                businessEvent,
                claimantName: expectedClaimantId || targetAgentIds[0] || "member",
                reason,
              }),
            }
          : {}),
      },
      ...(params._testAfterReadinessBarrier
        ? { _testAfterReadinessBarrier: params._testAfterReadinessBarrier }
        : {}),
      ...(params._testAfterEligibilityBarrier
        ? { _testAfterEligibilityBarrier: params._testAfterEligibilityBarrier }
        : {}),
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
 * P2 R5: permit-acquired (status=dispatched) relays needing reconcile — NOT auto-dispatch.
 * Must not be silently treated as already completed; must not timeout-blind-retry.
 */
export function listPermitAcquiredBoardEventRelays(
  items: readonly GroupBoardClaimItem[],
): Array<{ item: GroupBoardClaimItem; pending: BoardPendingEventRelay }> {
  const out: Array<{ item: GroupBoardClaimItem; pending: BoardPendingEventRelay }> = [];
  for (const item of items) {
    const pending = item.pendingEventRelay;
    if (pending && pending.status === "dispatched" && compact(pending.opKey)) {
      if (item.status === "accepted" || item.status === "cancelled") {
        continue;
      }
      out.push({ item, pending });
    }
  }
  return out;
}

export type PermitAcquiredReconcileAction =
  | "released_for_retry"
  | "marked_unknown_pending_verification"
  | "cleared_completed"
  | "left_unchanged";

export type PermitAcquiredReconcileResult = {
  itemId: string;
  opKey: string;
  action: PermitAcquiredReconcileAction;
  reason: string;
  pendingVerification?: boolean;
};

/**
 * Reconcile permit-acquired vs dispatch-completed (P2 R6).
 * - Wake completed with receipt → clear pending (dispatch completed).
 * - Otherwise: missing mark / timeout alone does NOT prove the original executor is dead.
 *   Conservatively leave pending-verification; NEVER auto-release / re-dispatch.
 * - To take over a not-started attempt, callers must invalidateBoardDispatchPermitAttempt
 *   (same-conditional CAS that prevents the old attempt from marking/starting).
 */
export async function reconcilePermitAcquiredBoardEventRelays(params: {
  authority: RuntimeAuthority;
  items: readonly GroupBoardClaimItem[];
  cfg?: OpenBotConfig;
}): Promise<PermitAcquiredReconcileResult[]> {
  const cfg = params.cfg;
  const results: PermitAcquiredReconcileResult[] = [];
  for (const row of listPermitAcquiredBoardEventRelays(params.items)) {
    const opKey = compact(row.pending.opKey);
    const itemId = compact(row.item.itemId);
    const taskId = compact(row.item.taskId);
    if (!opKey || !itemId || !taskId) {
      continue;
    }
    let wake = null as Awaited<ReturnType<typeof readWakeOpRecord>>;
    try {
      wake = await readWakeOpRecord({ authority: params.authority, opKey });
    } catch {
      wake = null;
    }
    const invokeStarted = row.pending.dispatchInvokeStarted === true;
    const attemptId = compact(row.pending.dispatchAttemptId);

    if (wake?.status === "completed") {
      try {
        await clearBoardPendingEventRelay(
          params.authority,
          { taskId, itemId, expectedOpKey: opKey },
          { cfg },
        );
      } catch {
        // best-effort
      }
      results.push({
        itemId,
        opKey,
        action: "cleared_completed",
        reason: "wake_op_completed_receipt",
      });
      continue;
    }

    // P2 R6: cannot prove original executor dead from missing mark or wake timeout.
    // Keep status=dispatched so a live executor still in the permit→mark gap can proceed;
    // set pendingVerification only (no auto-release, no wake status mutation, no re-dispatch).
    if (!row.pending.pendingVerification) {
      try {
        await updateBoardPendingEventRelayStatus(
          params.authority,
          {
            taskId,
            itemId,
            expectedOpKey: opKey,
            status: "dispatched",
            pendingVerification: true,
            ...(invokeStarted ? { dispatchInvokeStarted: true } : {}),
          },
          { cfg },
        );
      } catch {
        // best-effort
      }
    }
    results.push({
      itemId,
      opKey,
      action: "marked_unknown_pending_verification",
      reason: invokeStarted
        ? "dispatch_invoke_started_executor_liveness_unproven"
        : attemptId
          ? "permit_acquired_executor_liveness_unproven"
          : "permit_acquired_missing_attempt_unproven",
      pendingVerification: true,
    });
  }
  return results;
}

/**
 * Idempotent recovery: reconcile permit-acquired first, then re-issue consume for
 * each pending relay using the same opKey.
 * Does not invent a new queue — callers (heartbeat / recovery entry) supply items.
 * Always re-validates LIVE pending at the dispatch boundary (ignores stale snapshots).
 * Never silently treats permit-acquired as dispatched-complete; never timeout-blind-retries.
 * Heartbeat reconcile alone does not invalidate/release a live permit attempt (P2 R6).
 */

/**
 * P2 R7/R8 — proven-dead take-over (order-safe + original wake binding):
 * 1) Board CAS invalidate first. If rejected → wake AND board unchanged.
 * 2) Only after board wins: wake conditional fail using the **original**
 *    `boundWakeExecutionAttemptId` persisted at permit — never re-read the
 *    wake ledger's current executionAttemptId.
 * 3) Wake lock requires exact attempt AND status still `running`; mismatch
 *    refuses and keeps unknown/completed/new-attempt.
 * 4) Two-write recovery: board invalidate keeps `boundWakeExecutionAttemptId`
 *    until wake CAS finishes (or reconcile proves safe). Re-dispatch is allowed
 *    only after wake conditional update completed, or claim/reconcile proves
 *    the wake is already failed/unknown/completed (safe not to overwrite).
 *    P2 R9: unverifiable cleanup (read/CAS/clear throw) retains binding and
 *    stops automatic recovery — exception ≠ safe reject.
 * 5) Never convert unknown/started → failed solely because executor process died.
 * Do NOT call from heartbeat alone.
 */
export async function invalidatePermitAttemptForProvenDeadExecutor(params: {
  authority: RuntimeAuthority;
  taskId: string;
  itemId: string;
  expectedOpKey: string;
  expectedAttemptId: string;
  cfg?: OpenBotConfig;
  /**
   * Test-only P2 R8: after board invalidate CAS succeeds, before wake conditional
   * fail. Injects mid-cleanup races (new attempt / unknown / completed).
   */
  _testAfterBoardInvalidateBeforeWakeFail?: () => Promise<void>;
}): Promise<ClaimResult<GroupBoardClaimItem>> {
  const opKey = compact(params.expectedOpKey);

  // Read-only guard: unknown means pending-verification — do not release/retry.
  if (opKey) {
    try {
      const wakeBefore = await readWakeOpRecord({ authority: params.authority, opKey });
      if (wakeBefore?.status === "unknown") {
        return {
          ok: false,
          reason: "invalidate_wake_unknown_pending_verification",
          message:
            "wake-op is unknown; process death does not prove absence of side effects — keep pending-verification",
        };
      }
    } catch {
      // Missing/unreadable wake: proceed to board adjudication.
    }
  }

  // Board adjudication FIRST — rejection leaves wake untouched.
  // On success, dispatchAttemptId is cleared but boundWakeExecutionAttemptId is kept.
  const boardResult = await invalidateBoardDispatchPermitAttempt(
    params.authority,
    {
      taskId: params.taskId,
      itemId: params.itemId,
      expectedOpKey: params.expectedOpKey,
      expectedAttemptId: params.expectedAttemptId,
    },
    { cfg: params.cfg },
  );
  if (!boardResult.ok) {
    return boardResult;
  }

  // Original binding from permit — do NOT re-select current wake executionAttemptId.
  const boundWakeAttemptId = compact(
    boardResult.value.pendingEventRelay?.boundWakeExecutionAttemptId,
  );

  if (params._testAfterBoardInvalidateBeforeWakeFail) {
    await params._testAfterBoardInvalidateBeforeWakeFail();
  }

  // Board won (proven not-started). Conditional wake fail: exact attempt + running.
  if (opKey && boundWakeAttemptId) {
    try {
      await markWakeOpFailed({
        authority: params.authority,
        opKey,
        cfg: params.cfg,
        detail: "permit_attempt_invalidated_executor_proven_dead",
        expectedExecutionAttemptId: boundWakeAttemptId,
      });
      // Success or safe reject (attempt/status mismatch): clear binding so
      // recover may re-dispatch only when wake claim/reconcile allows.
      await clearBoundWakeExecutionAttemptAfterCleanup({
        authority: params.authority,
        taskId: params.taskId,
        itemId: params.itemId,
        expectedOpKey: opKey,
        expectedBoundWakeAttemptId: boundWakeAttemptId,
        cfg: params.cfg,
      });
    } catch {
      // Crash/throw between board write and wake CAS: binding retained on board.
      // Recover must finish wake conditional fail (or prove safe) before re-dispatch.
    }
  }
  return boardResult;
}

/**
 * P2 R8: drop permit→wake binding after wake conditional cleanup attempted.
 * Only clears when the live bound id still matches the original (no newer bind).
 */
async function clearBoundWakeExecutionAttemptAfterCleanup(params: {
  authority: RuntimeAuthority;
  taskId: string;
  itemId: string;
  expectedOpKey: string;
  expectedBoundWakeAttemptId: string;
  cfg?: OpenBotConfig;
}): Promise<void> {
  const expectedBound = compact(params.expectedBoundWakeAttemptId);
  const expectedOpKey = compact(params.expectedOpKey);
  if (!expectedBound || !expectedOpKey) {
    return;
  }
  try {
    await clearBoundWakeExecutionAttemptId(
      params.authority,
      {
        taskId: params.taskId,
        itemId: params.itemId,
        expectedOpKey,
        expectedBoundWakeAttemptId: expectedBound,
      },
      { cfg: params.cfg },
    );
  } catch {
    // best-effort
  }
}

/**
 * P2 R9 — deferred wake cleanup outcome for two-write recovery.
 * Only `completed` and `determined_no_change_needed` may clear the board binding
 * and allow redispatch. `unverifiable` retains binding and stops auto-recovery.
 */
export type DeferredWakeFailCleanupOutcome =
  | "completed"
  | "determined_no_change_needed"
  | "unverifiable"
  | "not_applicable";

export type DeferredWakeFailCleanupResult = {
  outcome: DeferredWakeFailCleanupOutcome;
  attempted: boolean;
  wakeStatus?: string;
  clearedBinding: boolean;
  reason?: string;
};

export type DeferredWakeFailCleanupFault =
  | "wake_read_throw"
  | "wake_cas_throw"
  | "clear_binding_throw";

/**
 * P2 R8/R9 two-write recovery: if a prior invalidate left boundWakeExecutionAttemptId
 * on a pending relay, finish the wake conditional fail (exact attempt + running)
 * before allowing re-dispatch.
 *
 * Classification (P2 R9):
 * - completed: wake fail CAS applied successfully
 * - determined_no_change_needed: safe reject (unknown/completed/new attempt /
 *   already failed for that attempt) — proven we must not / need not modify
 * - unverifiable: read/write/CAS throw, corrupt/unexplained missing, clear failure
 *
 * Only completed | determined_no_change_needed may clear the binding. Exception
 * is never treated as safe reject.
 */
export async function finishDeferredWakeFailBeforeRedispatch(params: {
  authority: RuntimeAuthority;
  item: GroupBoardClaimItem;
  cfg?: OpenBotConfig;
  /** Test-only: inject I/O faults for deferred cleanup contract. */
  _testDeferredCleanupFault?: DeferredWakeFailCleanupFault;
}): Promise<DeferredWakeFailCleanupResult> {
  const pending = params.item.pendingEventRelay;
  if (!pending || pending.status !== "pending") {
    return { outcome: "not_applicable", attempted: false, clearedBinding: false };
  }
  const opKey = compact(pending.opKey);
  const bound = compact(pending.boundWakeExecutionAttemptId);
  const taskId = compact(params.item.taskId);
  const itemId = compact(params.item.itemId);
  if (!opKey || !bound || !taskId || !itemId) {
    return { outcome: "not_applicable", attempted: false, clearedBinding: false };
  }

  const fault = params._testDeferredCleanupFault;
  let wakeStatus: string | undefined;
  let outcome: DeferredWakeFailCleanupOutcome;

  try {
    if (fault === "wake_read_throw") {
      throw new Error("test_deferred_wake_read_throw");
    }
    const detailed = await readWakeOpRecordDetailed({
      authority: params.authority,
      opKey,
    });
    if (detailed.state === "corrupt") {
      return {
        outcome: "unverifiable",
        attempted: true,
        clearedBinding: false,
        reason: "wake_record_corrupt",
      };
    }
    if (detailed.state === "missing") {
      // Binding present but wake absent cannot be explained as a safe reject.
      return {
        outcome: "unverifiable",
        attempted: true,
        clearedBinding: false,
        reason: "wake_record_missing",
      };
    }
    const wake = detailed.record;
    wakeStatus = wake.status;
    const wakeAttempt = compact(wake.executionAttemptId);
    if (wakeAttempt !== bound || wake.status !== "running") {
      // Safe reject: new attempt / unknown / completed / already failed / mismatch.
      outcome = "determined_no_change_needed";
    } else {
      try {
        if (fault === "wake_cas_throw") {
          throw new Error("test_deferred_wake_cas_throw");
        }
        const after = await markWakeOpFailed({
          authority: params.authority,
          opKey,
          cfg: params.cfg,
          detail: "deferred_permit_invalidate_wake_fail",
          expectedExecutionAttemptId: bound,
        });
        if (after && after.status === "failed" && compact(after.executionAttemptId) === bound) {
          wakeStatus = after.status;
          outcome = "completed";
        } else {
          // Race under lock: status/attempt changed — proven safe not to overwrite.
          wakeStatus = after?.status ?? wakeStatus;
          outcome = "determined_no_change_needed";
        }
      } catch (error) {
        return {
          outcome: "unverifiable",
          attempted: true,
          wakeStatus,
          clearedBinding: false,
          reason: `wake_cas_throw:${(error as Error).message ?? "unknown"}`,
        };
      }
    }
  } catch (error) {
    return {
      outcome: "unverifiable",
      attempted: true,
      wakeStatus,
      clearedBinding: false,
      reason: `wake_read_throw:${(error as Error).message ?? "unknown"}`,
    };
  }

  // Only completed | determined_no_change_needed may clear the board binding.
  try {
    if (fault === "clear_binding_throw") {
      throw new Error("test_deferred_clear_binding_throw");
    }
    const cleared = await clearBoundWakeExecutionAttemptId(
      params.authority,
      {
        taskId,
        itemId,
        expectedOpKey: opKey,
        expectedBoundWakeAttemptId: bound,
      },
      { cfg: params.cfg },
    );
    if (!cleared.ok) {
      return {
        outcome: "unverifiable",
        attempted: true,
        wakeStatus,
        clearedBinding: false,
        reason: `clear_binding_failed:${cleared.reason}`,
      };
    }
    return {
      outcome,
      attempted: true,
      wakeStatus,
      clearedBinding: true,
    };
  } catch (error) {
    // Clear failure after a successful wake CAS is still unverifiable for
    // "binding cleared" — retain binding / 待核验; do not invent auto-retry.
    return {
      outcome: "unverifiable",
      attempted: true,
      wakeStatus,
      clearedBinding: false,
      reason: `clear_binding_throw:${(error as Error).message ?? "unknown"}`,
    };
  }
}

export { invalidateBoardDispatchPermitAttempt };

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
  /** Optional authority override (tests / callers that already built claim authority). */
  authority?: RuntimeAuthority | null;
  /** Test-only: inject deferred wake cleanup I/O faults. */
  _testDeferredCleanupFault?: DeferredWakeFailCleanupFault;
}): Promise<PostSubmissionEventAdvanceResult[]> {
  const results: PostSubmissionEventAdvanceResult[] = [];

  // Build authority for reconcile when possible (same root as trigger).
  let authority = params.authority ?? null;
  if (!authority) {
    try {
      const cfg = params.cfg ?? loadConfig();
      const built = await buildClaimAuthority({
        groupId: params.groupId,
        taskId: params.taskId,
        cfg,
        auth: params.auth,
        trusted: params.trusted,
        stores: params.stores,
        tenant: params.tenant,
      });
      authority = built.authority;
    } catch {
      authority = null;
    }
  }

  let workingItems = [...params.items];
  if (authority) {
    try {
      await reconcilePermitAcquiredBoardEventRelays({
        authority,
        items: workingItems,
        cfg: params.cfg,
      });
      // Reload live rows so released permits appear as pending for the scan below.
      const reloaded: GroupBoardClaimItem[] = [];
      for (const item of workingItems) {
        const live = await loadBoardClaimItem(authority, {
          taskId: compact(item.taskId) || params.taskId,
          itemId: item.itemId,
        });
        if (live) {
          reloaded.push(live);
        }
      }
      if (reloaded.length > 0) {
        workingItems = reloaded;
      }
    } catch {
      // Reconcile is best-effort; pending markers remain durable.
    }
  }

  const pending = listPendingBoardEventRelays(workingItems);
  for (const row of pending) {
    // P2 R8/R9: complete deferred wake conditional fail before re-dispatch when a
    // prior invalidate left boundWakeExecutionAttemptId (two-write crash window).
    // Unverifiable cleanup must NOT clear binding or continue advance/redispatch.
    let itemForAdvance = row.item;
    if (authority && compact(row.pending.boundWakeExecutionAttemptId)) {
      const cleanup = await finishDeferredWakeFailBeforeRedispatch({
        authority,
        item: row.item,
        cfg: params.cfg,
        _testDeferredCleanupFault: params._testDeferredCleanupFault,
      });
      if (cleanup.outcome === "unverifiable") {
        results.push(
          emptyResult(
            row.pending.businessEvent,
            `deferred_wake_cleanup_unverifiable:${cleanup.reason ?? "unknown"}`,
            {
              pendingRelay: true,
              opKey: compact(row.pending.opKey) || null,
              targetAgentIds: [...row.pending.targetAgentIds],
              pendingLifecycle: "unknown",
            },
          ),
        );
        continue;
      }
      try {
        const live = await loadBoardClaimItem(authority, {
          taskId: compact(row.item.taskId) || params.taskId,
          itemId: row.item.itemId,
        });
        if (live) {
          itemForAdvance = live;
        }
      } catch {
        // use snapshot
      }
    }
    results.push(
      await triggerPostSubmissionEventAdvance({
        groupId: params.groupId,
        taskId: params.taskId,
        itemId: itemForAdvance.itemId,
        actorId: params.actorId,
        // Pass opKey hint only; trigger re-reads live pending and refuses mismatch.
        pending: itemForAdvance.pendingEventRelay ?? row.pending,
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
