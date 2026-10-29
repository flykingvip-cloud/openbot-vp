/**
 * Post-plan-confirm auto-advance (product wiring after #128).
 *
 * Uses existing wake contract + wake→round consumer — no second orchestrator.
 * After confirmCollaborationTodolist succeeds, nudge the **current effective
 * claimant** bound to the confirmed plan step and best-effort
 * consumeWakeForRoundDispatch(source=nudge).
 *
 * Does NOT hardcode writeMode=execute: gate uses resolveWakeRoundSelfAdvanceWriteMode
 * (cfg mode + executeGroupAllowlist). Binding failure refuses — never falls back
 * to another board work item.
 *
 * R3: final dispatch re-validates the same plan version, injects board summary /
 * context pointer / confirmed step into the member run prompt, and passes an
 * unconfusable executionDeliverableBinding on the wake request (no process Map).
 *
 * F4 R5: validate via loadExecutorTodolist(todolistId) + buildExecutionTaskBag —
 * never ownerMemberId-filtered bag ACL (board claimant `bot` ≠ todolist owner
 * `bot:bot`; confirmer email ≠ human:<uuid>). Log every finish reason.
 */
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  buildExecutionTaskBag,
  formatExecutionTaskBagForPrompt,
  loadExecutorTodolist,
} from "../collaboration-dispatch/executor-private-todolist.js";
import { SELF_ADVANCE_ACTIVE_BOARD_STATUSES } from "../collaboration-dispatch/self-advance.js";
import { recordNudgeWake } from "../collaboration-dispatch/wake-contract.js";
import {
  consumeWakeForRoundDispatch,
  getWakeRoundDispatcher,
  type WakeRoundDispatcher,
  type WakeRoundDispatchRequest,
} from "../collaboration-dispatch/wake-round-dispatch.js";
import { buildClaimAuthority, listCollaborationBoardItems } from "./claim-contract-entry.js";
import { ensureBoardActiveAfterConfirm } from "./ensure-board-active-after-confirm.js";
import {
  buildExecutionDeliverableBinding,
  runIdFromWakeOpAttempt,
} from "./execution-deliverable-binding.js";
import type { TeamResourceAuthOk, TrustedGroupStores } from "./team-resource-auth.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

const log = createSubsystemLogger("gateway/post-plan-confirm-advance");

function finishAdvance(result: PostPlanConfirmAdvanceResult): PostPlanConfirmAdvanceResult {
  const failedDispatch =
    result.wakeConsumed &&
    !result.dispatched &&
    (result.reason.startsWith("dispatch_failed") ||
      result.reason.includes("execute_collaboration_round_failed") ||
      result.reason.includes("mode_b_"));
  const level = failedDispatch ? "error" : result.wakeRecorded ? "info" : "warn";
  log[level]("triggerPostPlanConfirmAdvance", {
    reason: result.reason,
    wakeRecorded: result.wakeRecorded,
    wakeConsumed: result.wakeConsumed,
    dispatched: result.dispatched,
    targetAgentIds: result.targetAgentIds,
    anomaly: failedDispatch ? "plan_confirm_advance_dispatch_failed" : undefined,
  });
  return result;
}

export type PostPlanConfirmAdvanceResult = {
  /** True when this path attempted the existing wake/schedule mechanism. */
  autoAdvanceWired: true;
  wakeRecorded: boolean;
  wakeConsumed: boolean;
  dispatched: boolean;
  reason: string;
  targetAgentIds: string[];
};

function buildDispatchPrompt(params: {
  source: string;
  claimantName: string;
  reason: string;
  bag: ReturnType<typeof buildExecutionTaskBag>;
}): string {
  const header = [
    `【Mode B 自推进】来源=${params.source}`,
    `请继续推进你认领的看板项（责任人 ${params.claimantName}）。`,
    params.reason,
  ];
  try {
    if (params.bag?.boardSummary?.itemId && params.bag?.groupContextPointer?.groupId) {
      return [...header, "", formatExecutionTaskBagForPrompt(params.bag)].join("\n");
    }
  } catch {
    // fall through to minimal prompt
  }
  const step = params.bag?.todolistCurrentStep;
  return [
    ...header,
    params.bag?.boardSummary?.itemId ? `board=${params.bag.boardSummary.itemId}` : null,
    params.bag?.boardSummary?.goal ? `goal=${params.bag.boardSummary.goal}` : null,
    step ? `step=${step.stepId}:v${step.version}:${step.title ?? ""}` : null,
    params.bag?.groupContextPointer?.transcriptHint
      ? `transcript=${params.bag.groupContextPointer.transcriptHint}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function triggerPostPlanConfirmAdvance(params: {
  groupId: string;
  taskId: string;
  boardItemId: string;
  todolistId: string;
  /** Confirmed plan version the user actually saw. */
  confirmedVersion: number;
  /** Optional current step id from confirmed todolist (idempotency). */
  stepId?: string | null;
  confirmerId: string;
  auth?: TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  stores?: TrustedGroupStores | null;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
  /** Tests may inject the final dispatcher (still goes through real consumeWake). */
  roundDispatcher?: WakeRoundDispatcher | null;
}): Promise<PostPlanConfirmAdvanceResult> {
  const cfg = params.cfg ?? loadConfig();
  const groupId = compact(params.groupId);
  const taskId = compact(params.taskId);
  const boardItemId = compact(params.boardItemId);
  const todolistId = compact(params.todolistId);
  const confirmerId = compact(params.confirmerId);
  const confirmedVersion = Number(params.confirmedVersion);
  const stepId = compact(params.stepId) || null;

  if (!groupId || !taskId || !confirmerId) {
    return finishAdvance({
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: "missing_group_task_or_confirmer",
      targetAgentIds: [],
    });
  }
  if (!boardItemId || !todolistId || !Number.isFinite(confirmedVersion)) {
    return finishAdvance({
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: "confirm_binding_incomplete",
      targetAgentIds: [],
    });
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

  const boardItems = await listCollaborationBoardItems({
    groupId,
    taskId,
    cfg,
    auth: params.auth,
    trusted: params.trusted,
    stores: params.stores,
    tenant: params.tenant,
  });

  // Strict bind: confirmed boardItemId must exist; never fall back to other items.
  let item = boardItems.find((row) => row.itemId === boardItemId);
  if (!item) {
    return finishAdvance({
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: "confirm_board_item_missing",
      targetAgentIds: [],
    });
  }
  if (compact(item.taskId) && compact(item.taskId) !== taskId) {
    return finishAdvance({
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: "confirm_board_task_mismatch",
      targetAgentIds: [],
    });
  }
  // Confirm may land while the board is still `published` (short loop: publish→card→confirm).
  // Activate claim+apply for the intended claimant before the existing active gate so we do
  // not early-return confirm_board_not_active / confirm_board_no_claimant. Confirm itself is
  // already committed — activation is best-effort and never rolls it back.
  const activeStatuses = new Set<string>(SELF_ADVANCE_ACTIVE_BOARD_STATUSES);
  let liveItem = item;
  if (!activeStatuses.has(compact(liveItem.status)) || !compact(liveItem.claimantId)) {
    const ensured = await ensureBoardActiveAfterConfirm({
      groupId,
      taskId,
      item: liveItem,
      auth: params.auth,
      trusted: params.trusted,
      stores: params.stores,
      tenant: params.tenant,
      cfg,
    });
    liveItem = ensured.item;
    if (ensured.activated) {
      log.info("ensureBoardActiveAfterConfirm", {
        reason: ensured.reason,
        boardItemId,
        status: compact(liveItem.status),
        claimantId: compact(liveItem.claimantId),
      });
    } else if (ensured.reason !== "already_active") {
      log.warn("ensureBoardActiveAfterConfirm", {
        reason: ensured.reason,
        boardItemId,
        status: compact(liveItem.status),
      });
    }
  }
  if (!activeStatuses.has(compact(liveItem.status))) {
    return finishAdvance({
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: `confirm_board_not_active:${compact(liveItem.status) || "unknown"}`,
      targetAgentIds: [],
    });
  }

  // Current effective responsibility only (claimant), not intendedClaimant fan-out.
  const claimant = compact(liveItem.claimantId);
  if (!claimant) {
    return finishAdvance({
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: "confirm_board_no_claimant",
      targetAgentIds: [],
    });
  }
  // Keep `item` alias pointing at the post-ensure board row for any later reads.
  item = liveItem;
  if (claimant === confirmerId) {
    return finishAdvance({
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: "confirm_claimant_is_confirmer",
      targetAgentIds: [],
    });
  }

  // Load the JUST-CONFIRMED todolist by id. Do NOT re-derive via ownerMemberId
  // filter: live boards often store claimantId=`bot` while propose writes
  // ownerMemberId=`bot:bot`, and confirmer email≠human:<uuid> fails bag ACL —
  // both produced silent wakeRecorded=false after UI confirmTodolist (F4 R5).
  let bagStepId = stepId;
  let initialBag: ReturnType<typeof buildExecutionTaskBag>;
  try {
    const loaded = await loadExecutorTodolist(authority, { taskId, todolistId });
    if (!loaded) {
      return finishAdvance({
        autoAdvanceWired: true,
        wakeRecorded: false,
        wakeConsumed: false,
        dispatched: false,
        reason: "execution_bag_todolist_missing",
        targetAgentIds: [],
      });
    }
    if (compact(loaded.boardItemId) !== boardItemId) {
      return finishAdvance({
        autoAdvanceWired: true,
        wakeRecorded: false,
        wakeConsumed: false,
        dispatched: false,
        reason: "execution_bag_board_mismatch",
        targetAgentIds: [],
      });
    }
    if (loaded.status !== "confirmed") {
      return finishAdvance({
        autoAdvanceWired: true,
        wakeRecorded: false,
        wakeConsumed: false,
        dispatched: false,
        reason: "execution_bag_plan_not_confirmed",
        targetAgentIds: [],
      });
    }
    if (loaded.version !== confirmedVersion) {
      return finishAdvance({
        autoAdvanceWired: true,
        wakeRecorded: false,
        wakeConsumed: false,
        dispatched: false,
        reason: `execution_bag_version_mismatch:bag=${loaded.version}:confirmed=${confirmedVersion}`,
        targetAgentIds: [],
      });
    }
    initialBag = buildExecutionTaskBag({ boardItem: item, todolist: loaded });
    const step = initialBag.todolistCurrentStep;
    if (!step) {
      return finishAdvance({
        autoAdvanceWired: true,
        wakeRecorded: false,
        wakeConsumed: false,
        dispatched: false,
        reason: "execution_bag_missing_current_step",
        targetAgentIds: [],
      });
    }
    bagStepId = compact(step.stepId) || bagStepId;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return finishAdvance({
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: `execution_bag_unavailable:${detail}`,
      targetAgentIds: [],
    });
  }

  const targetAgentIds = [claimant];
  const advanceReason = `plan_confirmed_auto_advance:v${confirmedVersion}:step=${bagStepId ?? "none"}:board=${boardItemId}`;

  const nudge = await recordNudgeWake(
    authority,
    {
      groupId,
      fromAgentId: confirmerId,
      toAgentIds: targetAgentIds,
      taskId,
      itemId: boardItemId,
      reason: advanceReason,
    },
    { cfg },
  );
  if (!nudge.ok) {
    return finishAdvance({
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: `nudge_failed:${nudge.reason ?? "unknown"}`,
      targetAgentIds,
    });
  }

  // Do NOT pass writeMode:"execute" — let consumer resolve from cfg + allowlist.
  // Idempotency must include plan version/step so a later legitimate revision is not
  // treated as reuse of the prior wake op.
  const advanceOpKey = [
    "plan_confirm_advance",
    groupId,
    taskId,
    boardItemId,
    todolistId,
    `v${confirmedVersion}`,
    bagStepId ?? "nostep",
    claimant,
  ].join("|");

  const baseDispatcher: WakeRoundDispatcher | null =
    params.roundDispatcher !== undefined ? params.roundDispatcher : getWakeRoundDispatcher();

  const finalDispatcher: WakeRoundDispatcher = async (req: WakeRoundDispatchRequest) => {
    // Final dispatch entry: re-validate the SAME plan version after CAS take.
    let bag: ReturnType<typeof buildExecutionTaskBag>;
    try {
      const live = await loadExecutorTodolist(authority, { taskId, todolistId });
      if (!live || live.status !== "confirmed") {
        return { ok: false, reason: "plan_revised_or_unconfirmed_before_dispatch" };
      }
      if (compact(live.boardItemId) !== boardItemId || live.version !== confirmedVersion) {
        return {
          ok: false,
          reason: `plan_revised_before_dispatch:bag=${live?.version ?? "missing"}:confirmed=${confirmedVersion}`,
        };
      }
      bag = buildExecutionTaskBag({ boardItem: item, todolist: live });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `plan_revalidate_bag_unavailable:${detail}`.slice(0, 240) };
    }
    if (!bag.planGate.confirmed || !bag.todolistCurrentStep) {
      return { ok: false, reason: "plan_revised_or_unconfirmed_before_dispatch" };
    }
    const step = bag.todolistCurrentStep;
    if (compact(step.todolistId) !== todolistId || step.version !== confirmedVersion) {
      return {
        ok: false,
        reason: `plan_revised_before_dispatch:bag=${step.version}:confirmed=${confirmedVersion}`,
      };
    }
    if (bagStepId && compact(step.stepId) && compact(step.stepId) !== bagStepId) {
      return {
        ok: false,
        reason: `plan_step_changed_before_dispatch:bag=${step.stepId}:expected=${bagStepId}`,
      };
    }

    // Bind to the durable wake-op attempt claimed by consumeWake — never mint a
    // standalone UUID that pretends to be the execution identity.
    const wakeOpKey = compact(req.wakeOpKey) || compact(req.opKey) || compact(advanceOpKey);
    const attemptId = compact(req.wakeExecutionAttemptId);
    if (!wakeOpKey || !attemptId) {
      return { ok: false, reason: "wake_execution_attempt_required" };
    }
    const runId = runIdFromWakeOpAttempt({ opKey: wakeOpKey, attemptId });
    const stepForBind = compact(step.stepId) || bagStepId;
    if (!stepForBind) {
      return { ok: false, reason: "execution_deliverable_step_required" };
    }
    const executionDeliverableBinding = buildExecutionDeliverableBinding({
      tenantId: params.tenant?.tenantId ?? params.auth?.tenantId ?? req.tenantId ?? null,
      groupId,
      taskId,
      boardItemId,
      todolistId,
      planVersion: confirmedVersion,
      stepId: stepForBind,
      runId,
      attemptId,
      opKey: wakeOpKey,
      agentId: claimant,
      source: "wake_dispatch",
    });
    if (!executionDeliverableBinding) {
      return { ok: false, reason: "execution_deliverable_binding_incomplete" };
    }

    const dispatchPrompt = buildDispatchPrompt({
      source: req.source,
      claimantName: claimant,
      reason: advanceReason,
      bag,
    });
    const enriched: WakeRoundDispatchRequest = {
      ...req,
      planConfirmBinding: {
        todolistId,
        confirmedVersion,
        stepId: bagStepId,
      },
      dispatchPrompt,
      reason: advanceReason,
      executionDeliverableBinding,
    };

    if (!baseDispatcher) {
      // Keep parity with unbound registry: no fake dispatch success.
      return { ok: false, reason: "mode_b_dispatcher_unbound" };
    }
    return baseDispatcher(enriched);
  };

  const consume = await consumeWakeForRoundDispatch({
    authority,
    cfg,
    roundDispatcher: finalDispatcher,
    request: {
      groupId,
      tenantId: params.tenant?.tenantId ?? params.auth?.tenantId ?? null,
      fromAgentId: confirmerId,
      toAgentIds: targetAgentIds,
      source: "nudge",
      taskId,
      itemId: boardItemId,
      reason: advanceReason,
      opKey: advanceOpKey,
      planConfirmBinding: {
        todolistId,
        confirmedVersion,
        stepId: bagStepId,
      },
      dispatchPrompt: buildDispatchPrompt({
        source: "nudge",
        claimantName: claimant,
        reason: advanceReason,
        bag: initialBag,
      }),
    },
  });

  return finishAdvance({
    autoAdvanceWired: true,
    wakeRecorded: true,
    wakeConsumed: true,
    dispatched: Boolean(consume.dispatched),
    reason: consume.reason ?? (consume.dispatched ? "dispatched" : "wake_recorded"),
    targetAgentIds,
  });
}
