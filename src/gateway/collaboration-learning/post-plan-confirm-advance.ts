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
 */
import { randomUUID } from "node:crypto";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { formatExecutionTaskBagForPrompt } from "../collaboration-dispatch/executor-private-todolist.js";
import { SELF_ADVANCE_ACTIVE_BOARD_STATUSES } from "../collaboration-dispatch/self-advance.js";
import { recordNudgeWake } from "../collaboration-dispatch/wake-contract.js";
import {
  consumeWakeForRoundDispatch,
  getWakeRoundDispatcher,
  type WakeRoundDispatcher,
  type WakeRoundDispatchRequest,
} from "../collaboration-dispatch/wake-round-dispatch.js";
import {
  buildClaimAuthority,
  buildCollaborationExecutionTaskBag,
  listCollaborationBoardItems,
} from "./claim-contract-entry.js";
import { buildExecutionDeliverableBinding } from "./execution-deliverable-binding.js";
import type { TeamResourceAuthOk, TrustedGroupStores } from "./team-resource-auth.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
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
  bag: Awaited<ReturnType<typeof buildCollaborationExecutionTaskBag>>;
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
    return {
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: "missing_group_task_or_confirmer",
      targetAgentIds: [],
    };
  }
  if (!boardItemId || !todolistId || !Number.isFinite(confirmedVersion)) {
    return {
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: "confirm_binding_incomplete",
      targetAgentIds: [],
    };
  }

  const { authority, stores } = await buildClaimAuthority({
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
    stores: stores ?? params.stores,
    tenant: params.tenant,
  });

  // Strict bind: confirmed boardItemId must exist; never fall back to other items.
  const item = boardItems.find((row) => row.itemId === boardItemId);
  if (!item) {
    return {
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: "confirm_board_item_missing",
      targetAgentIds: [],
    };
  }
  if (compact(item.taskId) && compact(item.taskId) !== taskId) {
    return {
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: "confirm_board_task_mismatch",
      targetAgentIds: [],
    };
  }
  const activeStatuses = new Set<string>(SELF_ADVANCE_ACTIVE_BOARD_STATUSES);
  if (!activeStatuses.has(compact(item.status))) {
    return {
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: `confirm_board_not_active:${compact(item.status) || "unknown"}`,
      targetAgentIds: [],
    };
  }

  // Current effective responsibility only (claimant), not intendedClaimant fan-out.
  const claimant = compact(item.claimantId);
  if (!claimant) {
    return {
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: "confirm_board_no_claimant",
      targetAgentIds: [],
    };
  }
  if (claimant === confirmerId) {
    return {
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: "confirm_claimant_is_confirmer",
      targetAgentIds: [],
    };
  }

  // Reuse execution task bag: confirmed todolist/version/current step must still bind.
  let bagStepId = stepId;
  let initialBag: Awaited<ReturnType<typeof buildCollaborationExecutionTaskBag>>;
  try {
    initialBag = await buildCollaborationExecutionTaskBag({
      groupId,
      taskId,
      boardItemId,
      ownerMemberId: claimant,
      viewerId: confirmerId,
      actor: confirmerId,
      auth: params.auth,
      trusted: params.trusted,
      stores: stores ?? params.stores,
      tenant: params.tenant,
      cfg,
    });
    if (!initialBag.planGate.confirmed) {
      return {
        autoAdvanceWired: true,
        wakeRecorded: false,
        wakeConsumed: false,
        dispatched: false,
        reason: "execution_bag_plan_not_confirmed",
        targetAgentIds: [],
      };
    }
    const step = initialBag.todolistCurrentStep;
    if (!step) {
      return {
        autoAdvanceWired: true,
        wakeRecorded: false,
        wakeConsumed: false,
        dispatched: false,
        reason: "execution_bag_missing_current_step",
        targetAgentIds: [],
      };
    }
    if (compact(step.todolistId) !== todolistId) {
      return {
        autoAdvanceWired: true,
        wakeRecorded: false,
        wakeConsumed: false,
        dispatched: false,
        reason: "execution_bag_todolist_mismatch",
        targetAgentIds: [],
      };
    }
    if (step.version !== confirmedVersion) {
      return {
        autoAdvanceWired: true,
        wakeRecorded: false,
        wakeConsumed: false,
        dispatched: false,
        reason: `execution_bag_version_mismatch:bag=${step.version}:confirmed=${confirmedVersion}`,
        targetAgentIds: [],
      };
    }
    bagStepId = compact(step.stepId) || bagStepId;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: `execution_bag_unavailable:${detail}`,
      targetAgentIds: [],
    };
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
    return {
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: `nudge_failed:${nudge.reason ?? "unknown"}`,
      targetAgentIds,
    };
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
    let bag: Awaited<ReturnType<typeof buildCollaborationExecutionTaskBag>>;
    try {
      bag = await buildCollaborationExecutionTaskBag({
        groupId,
        taskId,
        boardItemId,
        ownerMemberId: claimant,
        viewerId: confirmerId,
        actor: confirmerId,
        auth: params.auth,
        trusted: params.trusted,
        stores: stores ?? params.stores,
        tenant: params.tenant,
        cfg,
      });
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

    const runId = `wake_deliverable_${randomUUID()}`;
    const executionDeliverableBinding = buildExecutionDeliverableBinding({
      tenantId: params.tenant?.tenantId ?? params.auth?.tenantId ?? req.tenantId ?? null,
      groupId,
      taskId,
      boardItemId,
      todolistId,
      planVersion: confirmedVersion,
      stepId: compact(step.stepId) || bagStepId,
      runId,
      attemptId: compact(req.opKey) || null,
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

  return {
    autoAdvanceWired: true,
    wakeRecorded: true,
    wakeConsumed: true,
    dispatched: Boolean(consume.dispatched),
    reason: consume.reason ?? (consume.dispatched ? "dispatched" : "wake_recorded"),
    targetAgentIds,
  };
}
