/**
 * Human-attention card business fulfillment.
 *
 * Buttons must call existing task / review / wake-op recovery contracts — never
 * only flip the inbox row. Stale checks read authoritative board + fingerprint.
 */
import type { Task } from "@openbot/collaboration-core";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { createWorkspaceCollaborationStores } from "../collaboration-learning/shared.js";
import {
  createInternalLibraryRecoveryExecContext,
  confirmWakeOpCompletedAuthorized,
  releaseWakeOpForRetryAuthorized,
} from "../collaboration-learning/wake-op-recovery-entry.js";
import {
  acceptBoardItemSubmission,
  cancelBoardItem,
  loadBoardClaimItem,
  returnBoardItemSubmission,
  type GroupBoardClaimItem,
} from "./claim-contract.js";
import { episodeIdForClientRun } from "./collaboration-event-key.js";
import { progressFingerprint } from "./group-task-heartbeat.js";
import type { HumanAttentionOptionId } from "./human-attention-card.js";
import type { HumanAttentionTodo } from "./human-attention-inbox.js";
import { createRoundPolicySnapshot, generatePolicySnapshotId } from "./round-policy-snapshot.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";
import { sanitizeDispatchErrorMessage } from "./sanitize-dispatch-error.js";
import {
  mintWakeOpRecoverySubject,
  produceHumanNoneAttestation,
  readWakeOpRecord,
  type WakeOpRecord,
} from "./wake-op-ledger.js";

export type HumanAttentionAuthorityBundle = {
  authority: RuntimeAuthority;
  cfg: OpenBotConfig;
};

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** Build RuntimeAuthority for a human-attention todo's group (composition helper). */
export function buildHumanAttentionAuthority(params: {
  groupId: string;
  taskId: string;
  cfg?: OpenBotConfig;
}): HumanAttentionAuthorityBundle {
  const cfg = params.cfg ?? loadConfig();
  const groupId = compact(params.groupId);
  const taskId = compact(params.taskId) || "unknown";
  const now = Date.now();
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now, idGen: () => generatePolicySnapshotId(now) },
  );
  const authority = createRuntimeAuthority({
    snapshot,
    episodeId: episodeIdForClientRun(`human-attention:${groupId}:${taskId}`),
    tenant: { tenantId: null, trust: "none" },
    groupId,
    profile: "personal_local",
    cfg,
  });
  return { authority, cfg };
}

export type LiveTaskFacts = {
  boardItem: GroupBoardClaimItem | null;
  fingerprint: string | null;
  responsibility?: {
    owner?: string;
    reviewer?: string;
    executors?: string[];
    approver?: string;
  };
  submissionId?: string;
  artifactVersion?: string;
  boardStatus?: string;
};

/** Read authoritative board + task responsibility before mutating. */
export async function loadLiveHumanAttentionFacts(params: {
  authority: RuntimeAuthority;
  cfg?: OpenBotConfig;
  groupId: string;
  taskId: string;
  itemId: string;
}): Promise<LiveTaskFacts> {
  const boardItem = await loadBoardClaimItem(params.authority, {
    taskId: params.taskId,
    itemId: params.itemId,
  });
  let responsibility: LiveTaskFacts["responsibility"];
  try {
    const stores = createWorkspaceCollaborationStores(params.cfg);
    const task = await stores.objectStorage.readObject<Task>(params.groupId, "task", params.taskId);
    const resp = (task as { responsibility?: Record<string, unknown> } | null)?.responsibility;
    if (resp && typeof resp === "object") {
      responsibility = {
        owner: typeof resp.owner === "string" ? resp.owner : undefined,
        reviewer: typeof resp.reviewer === "string" ? resp.reviewer : undefined,
        approver: typeof resp.approver === "string" ? resp.approver : undefined,
        executors: Array.isArray(resp.executors)
          ? resp.executors.filter((id): id is string => typeof id === "string")
          : undefined,
      };
    }
  } catch {
    // best-effort
  }
  if (!boardItem) {
    return { boardItem: null, fingerprint: null, responsibility };
  }
  return {
    boardItem,
    fingerprint: progressFingerprint(boardItem),
    responsibility,
    submissionId: compact(boardItem.submissionId) || undefined,
    artifactVersion: compact(boardItem.artifactVersion) || undefined,
    boardStatus: boardItem.status,
  };
}

/**
 * Reject when client/inbox fingerprint no longer matches live board progress.
 */
export async function assertHumanAttentionNotStale(params: {
  authority: RuntimeAuthority;
  cfg?: OpenBotConfig;
  todo: HumanAttentionTodo;
  expectedFingerprint: string;
}): Promise<{ ok: true; live: LiveTaskFacts } | { ok: false; reason: string; message: string }> {
  const live = await loadLiveHumanAttentionFacts({
    authority: params.authority,
    cfg: params.cfg,
    groupId: params.todo.groupId,
    taskId: params.todo.taskId,
    itemId: params.todo.itemId,
  });
  const expected = compact(params.expectedFingerprint) || compact(params.todo.fingerprint);
  if (!expected) {
    return { ok: false, reason: "missing_fingerprint", message: "缺少进展指纹" };
  }
  if (live.fingerprint && live.fingerprint !== expected) {
    return {
      ok: false,
      reason: "stale_progress",
      message: "看板已有新进展，旧卡片已失效，请刷新",
    };
  }
  if (compact(params.todo.fingerprint) && compact(params.todo.fingerprint) !== expected) {
    return {
      ok: false,
      reason: "stale_fingerprint",
      message: "卡片指纹与待办不一致，请刷新",
    };
  }
  return { ok: true, live };
}

export type BusinessActionResult =
  | {
      ok: true;
      evidence?: Record<string, unknown>;
      wakeOp?: WakeOpRecord | null;
      boardItem?: GroupBoardClaimItem | null;
      heartbeatShouldClear: boolean;
      closeTodo: boolean;
      transferOwnerId?: string;
      resultText: string;
    }
  | { ok: false; reason: string; message: string };

async function releaseWakeOpForHumanVerify(params: {
  authority: RuntimeAuthority;
  cfg: OpenBotConfig;
  todo: HumanAttentionTodo;
  actorId: string;
  note: string;
  nowMs: number;
}): Promise<{ ok: true; record: WakeOpRecord } | { ok: false; reason: string; message: string }> {
  const opKey = compact(params.todo.wakeOpKey);
  if (!opKey) {
    return { ok: false, reason: "missing_wake_op", message: "待办未绑定 wake-op，无法解除保护" };
  }
  const current = await readWakeOpRecord({ authority: params.authority, opKey });
  if (!current) {
    return { ok: false, reason: "missing_wake_op_record", message: "wake-op 账本记录不存在" };
  }
  if (current.status !== "unknown") {
    return {
      ok: false,
      reason: `wake_op_status_${current.status}`,
      message: `wake-op 状态为 ${current.status}，无法核实后重试`,
    };
  }
  const attemptId = compact(current.executionAttemptId);
  if (!attemptId) {
    return {
      ok: false,
      reason: "missing_execution_attempt",
      message: "wake-op 缺少 executionAttemptId",
    };
  }
  const execCreated = await createInternalLibraryRecoveryExecContext({
    groupId: params.todo.groupId,
    taskId: params.todo.taskId,
    actorId: params.actorId,
    action: "release_for_retry",
    cfg: params.cfg,
  });
  if (!execCreated.ok) {
    // Fall back to minted subject path when OS membership isn't seeded (still requires
    // releaseWakeOpForRetryAuthorized permission inside ledger). Prefer honest failure.
    return {
      ok: false,
      reason: execCreated.reason,
      message: `恢复身份未通过：${execCreated.reason}`,
    };
  }
  const subjectResolved = mintWakeOpRecoverySubject({
    actorId: execCreated.exec.actorId,
    action: "release_for_retry",
    groupId: params.todo.groupId,
    taskId: params.todo.taskId,
    nowMs: params.nowMs,
  });
  const attested = await produceHumanNoneAttestation({
    authority: params.authority,
    cfg: params.cfg,
    subject: subjectResolved,
    groupId: params.todo.groupId,
    taskId: params.todo.taskId,
    opKey,
    attemptId,
    basis: sanitizeDispatchErrorMessage(params.note, 400),
    scope: `human-attention:${params.todo.id}`,
    nowMs: params.nowMs,
  });
  if (!attested.ok) {
    return { ok: false, reason: attested.reason, message: `副作用核实失败：${attested.reason}` };
  }
  const released = await releaseWakeOpForRetryAuthorized({
    authority: params.authority,
    groupId: params.todo.groupId,
    taskId: params.todo.taskId,
    opKey,
    exec: execCreated.exec,
    verificationId: attested.record.verificationId,
    cfg: params.cfg,
    nowMs: params.nowMs,
    detail: `human_attention_release_after_verify:${sanitizeDispatchErrorMessage(params.note, 120)}`,
  });
  if (!released.ok) {
    return {
      ok: false,
      reason: released.reason,
      message: `wake-op 恢复失败：${released.reason}`,
    };
  }
  return { ok: true, record: released.record };
}

async function confirmWakeOpForHuman(params: {
  authority: RuntimeAuthority;
  cfg: OpenBotConfig;
  todo: HumanAttentionTodo;
  actorId: string;
  nowMs: number;
}): Promise<{ ok: true; record: WakeOpRecord } | { ok: false; reason: string; message: string }> {
  const opKey = compact(params.todo.wakeOpKey);
  if (!opKey) {
    return { ok: false, reason: "missing_wake_op", message: "待办未绑定 wake-op，无法确认完成" };
  }
  const current = await readWakeOpRecord({ authority: params.authority, opKey });
  if (!current) {
    return { ok: false, reason: "missing_wake_op_record", message: "wake-op 账本记录不存在" };
  }
  if (current.status === "completed") {
    return { ok: true, record: current };
  }
  const roundId = compact(current.roundId);
  if (!roundId) {
    return {
      ok: false,
      reason: "no_prior_receipt_on_ledger",
      message: "账本无执行回执，无法确认完成；若确认无外部操作请改用「核实后允许重试」",
    };
  }
  const confirmed = await confirmWakeOpCompletedAuthorized({
    authority: params.authority,
    groupId: params.todo.groupId,
    taskId: params.todo.taskId,
    opKey,
    roundId,
    actorId: params.actorId,
    cfg: params.cfg,
    nowMs: params.nowMs,
    detail: "human_attention_confirm_completed",
  });
  if (!confirmed.ok) {
    return {
      ok: false,
      reason: confirmed.reason,
      message: `确认 wake-op 完成失败：${confirmed.reason}`,
    };
  }
  return { ok: true, record: confirmed.record };
}

async function transferTaskResponsibility(params: {
  cfg: OpenBotConfig;
  groupId: string;
  taskId: string;
  transferOwnerId: string;
  failureKind: HumanAttentionTodo["failureKind"];
}): Promise<{ ok: true } | { ok: false; reason: string; message: string }> {
  const target = compact(params.transferOwnerId);
  if (!target) {
    return { ok: false, reason: "transfer_owner_required", message: "转交需要目标责任人" };
  }
  try {
    const stores = createWorkspaceCollaborationStores(params.cfg);
    const current = await stores.objectStorage.readObject<Task>(
      params.groupId,
      "task",
      params.taskId,
    );
    if (!current) {
      // No task object yet — inbox ownerOverride contract still applies.
      return { ok: true };
    }
    const prev = (current as { responsibility?: Record<string, unknown> }).responsibility ?? {};
    const nextResp: Record<string, unknown> = { ...prev };
    if (params.failureKind === "awaiting_review") {
      nextResp.reviewer = target;
    } else {
      nextResp.owner = target;
      const executors = Array.isArray(prev.executors)
        ? prev.executors.filter((id): id is string => typeof id === "string")
        : [];
      nextResp.executors = executors.includes(target) ? executors : [...executors, target];
    }
    await stores.objectStorage.writeObject(params.groupId, "task", params.taskId, {
      ...current,
      responsibility: nextResp,
      updatedAt: Date.now(),
    } as Task);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: "responsibility_write_failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute the business action promised by the card button.
 * Does NOT mutate the human-attention inbox — caller closes todo only on success.
 */
export async function executeHumanAttentionBusinessAction(params: {
  action: HumanAttentionOptionId;
  todo: HumanAttentionTodo;
  actorId: string;
  authority: RuntimeAuthority;
  cfg?: OpenBotConfig;
  nowMs?: number;
  note?: string;
  transferOwnerId?: string;
  expectedFingerprint: string;
}): Promise<BusinessActionResult> {
  const cfg = params.cfg ?? loadConfig();
  const nowMs = params.nowMs ?? Date.now();
  const actorId = compact(params.actorId);
  const action = params.action;

  const stale = await assertHumanAttentionNotStale({
    authority: params.authority,
    cfg,
    todo: params.todo,
    expectedFingerprint: params.expectedFingerprint,
  });
  if (!stale.ok) {
    return stale;
  }
  const live = stale.live;

  if (
    action === "view_evidence" ||
    action === "view_failure_reason" ||
    action === "view_artifact"
  ) {
    let wakeOp: WakeOpRecord | null = null;
    const opKey = compact(params.todo.wakeOpKey);
    if (opKey) {
      wakeOp = await readWakeOpRecord({ authority: params.authority, opKey });
    }
    return {
      ok: true,
      heartbeatShouldClear: false,
      closeTodo: false,
      resultText: "opened_evidence",
      boardItem: live.boardItem,
      wakeOp,
      evidence: {
        todoId: params.todo.id,
        taskId: params.todo.taskId,
        itemId: params.todo.itemId,
        fingerprint: params.todo.fingerprint,
        liveFingerprint: live.fingerprint,
        boardStatus: live.boardStatus ?? params.todo.boardStatus,
        submissionId: live.submissionId,
        artifactVersion: live.artifactVersion,
        wakeOpKey: opKey || undefined,
        wakeOpStatus: wakeOp?.status,
        wakeOpDetail: wakeOp?.detail ? sanitizeDispatchErrorMessage(wakeOp.detail, 240) : undefined,
        wakeOpRoundId: wakeOp?.roundId,
        reason: params.todo.reason,
        recoveryHint: params.todo.recoveryHint,
        sideEffectClass: params.todo.sideEffectClass,
        responsibility: live.responsibility,
        boardItemPath: live.boardItem
          ? {
              taskId: live.boardItem.taskId,
              itemId: live.boardItem.itemId,
              status: live.boardItem.status,
              claimantId: live.boardItem.claimantId,
              linkedDeliverableId: live.boardItem.linkedDeliverableId,
              linkedDeliverableVersion: live.boardItem.linkedDeliverableVersion,
            }
          : null,
      },
    };
  }

  if (action === "release_after_verify") {
    const note = compact(params.note);
    if (!note) {
      return {
        ok: false,
        reason: "verification_note_required",
        message: "核实后允许重试前须填写副作用核实说明",
      };
    }
    const released = await releaseWakeOpForHumanVerify({
      authority: params.authority,
      cfg,
      todo: params.todo,
      actorId,
      note,
      nowMs,
    });
    if (!released.ok) {
      return released;
    }
    return {
      ok: true,
      heartbeatShouldClear: true,
      closeTodo: true,
      wakeOp: released.record,
      resultText: `已核实副作用：${sanitizeDispatchErrorMessage(note, 160)}；wake-op 已解除保护允许重试`,
    };
  }

  if (action === "confirm_completed") {
    const confirmed = await confirmWakeOpForHuman({
      authority: params.authority,
      cfg,
      todo: params.todo,
      actorId,
      nowMs,
    });
    if (!confirmed.ok) {
      return confirmed;
    }
    return {
      ok: true,
      heartbeatShouldClear: true,
      closeTodo: true,
      wakeOp: confirmed.record,
      resultText: "人工确认结果已完成；wake-op 已标记 completed",
    };
  }

  if (action === "retry_after_fix") {
    // not_started: wake-op already failed/retryable; just clear heartbeat gate.
    return {
      ok: true,
      heartbeatShouldClear: true,
      closeTodo: true,
      resultText: "已确认未开始；清除人工闸后允许自动重试",
    };
  }

  if (action === "cancel_task") {
    const cancelled = await cancelBoardItem(
      params.authority,
      {
        taskId: params.todo.taskId,
        itemId: params.todo.itemId,
        actorId,
        reason: `human_attention_cancel:${params.todo.id}`,
      },
      { cfg, nowMs },
    );
    if (!cancelled.ok) {
      return {
        ok: false,
        reason: cancelled.reason,
        message: cancelled.message || `取消任务失败：${cancelled.reason}`,
      };
    }
    return {
      ok: true,
      heartbeatShouldClear: true,
      closeTodo: true,
      boardItem: cancelled.value,
      resultText: "已取消看板任务项",
    };
  }

  if (action === "accept_submission") {
    const submissionId = compact(live.submissionId);
    if (!submissionId) {
      return {
        ok: false,
        reason: "missing_submission",
        message: "当前看板无待审提交，无法通过",
      };
    }
    const accepted = await acceptBoardItemSubmission(
      params.authority,
      {
        taskId: params.todo.taskId,
        itemId: params.todo.itemId,
        actorId,
        expectedSubmissionId: submissionId,
        reason: `human_attention_accept:${params.todo.id}`,
        checkedAcceptanceCriteria: live.boardItem?.acceptanceCriteria ?? ["human_attention_accept"],
      },
      { cfg, nowMs },
    );
    if (!accepted.ok) {
      return {
        ok: false,
        reason: accepted.reason,
        message: accepted.message || `审核通过失败：${accepted.reason}`,
      };
    }
    return {
      ok: true,
      heartbeatShouldClear: true,
      closeTodo: true,
      boardItem: accepted.value,
      resultText: "审核通过；看板状态已更新",
    };
  }

  if (action === "return_submission") {
    const submissionId = compact(live.submissionId);
    if (!submissionId) {
      return {
        ok: false,
        reason: "missing_submission",
        message: "当前看板无待审提交，无法退回",
      };
    }
    const returned = await returnBoardItemSubmission(
      params.authority,
      {
        taskId: params.todo.taskId,
        itemId: params.todo.itemId,
        actorId,
        expectedSubmissionId: submissionId,
        reason: `human_attention_return:${params.todo.id}`,
      },
      { cfg, nowMs },
    );
    if (!returned.ok) {
      return {
        ok: false,
        reason: returned.reason,
        message: returned.message || `退回修改失败：${returned.reason}`,
      };
    }
    return {
      ok: true,
      heartbeatShouldClear: true,
      closeTodo: true,
      boardItem: returned.value,
      resultText: "已退回修改；看板状态已更新",
    };
  }

  if (action === "transfer") {
    const target = compact(params.transferOwnerId);
    if (!target) {
      return { ok: false, reason: "transfer_owner_required", message: "转交需要目标责任人" };
    }
    const resp = await transferTaskResponsibility({
      cfg,
      groupId: params.todo.groupId,
      taskId: params.todo.taskId,
      transferOwnerId: target,
      failureKind: params.todo.failureKind,
    });
    if (!resp.ok) {
      return resp;
    }
    return {
      ok: true,
      heartbeatShouldClear: false,
      closeTodo: false,
      transferOwnerId: target,
      resultText: `已转交给 ${target}`,
    };
  }

  if (action === "take_over") {
    return {
      ok: true,
      heartbeatShouldClear: true,
      closeTodo: true,
      resultText: "人工接管并恢复自动推进条件",
    };
  }

  return {
    ok: false,
    reason: "action_not_supported",
    message: `操作 ${String(action)} 尚未接入业务契约`,
  };
}
