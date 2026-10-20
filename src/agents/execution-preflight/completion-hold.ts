import {
  judgeCompletionSend,
  type CompletionDecisionCode,
  type CompletionJudgement,
  type CompletionSendOutcome,
} from "./completion-claim.js";
import { confirmationGateRequired } from "./confirmation-gate.js";
import { evaluateDeliveryEvidence, resolveAttemptDelivery } from "./delivery.js";
import { recordExecutionTrace } from "./trace.js";
/**
 * Process-local hold for the current attempt.
 * Outbound, cron, and subagent relays consult it before calling a transport.
 * This is request-lifetime state, not a cross-process audit log.
 */
import type { DeliveryGateInput, ExecutionPreflight } from "./types.js";
import { readLatestValidationReceipt } from "./validation.js";

type Hold = {
  preflight: ExecutionPreflight;
  workspaceDir?: string;
};

const DEFAULT_DELIVERY_CONTEXT_TTL_MS = 15 * 60 * 1000;

type Retained = {
  hold: Hold;
  sessionKeys: string[];
  expiresAt: number;
};

const attemptHolds = new Map<string, Hold>();
/** Survives attempt finally. Keyed by task so concurrent tasks do not replace each other. */
const retainedByTask = new Map<string, Retained>();
const sessionTasks = new Map<string, string[]>();
const cleanupCounts = {
  delivered: 0,
  failed: 0,
  cancelled: 0,
  timeout: 0,
};

export type DeliveryContextReleaseReason = keyof typeof cleanupCounts;

const DELIVERY_CONTEXT_SWEEP_INTERVAL_MS = 60_000;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

export function resetCompletionHoldsForTest(): void {
  stopDeliveryContextSweep();
  attemptHolds.clear();
  retainedByTask.clear();
  sessionTasks.clear();
  cleanupCounts.delivered = 0;
  cleanupCounts.failed = 0;
  cleanupCounts.cancelled = 0;
  cleanupCounts.timeout = 0;
}

export function readAttemptHoldActive(key: string | undefined): boolean {
  const trimmed = key?.trim();
  return Boolean(trimmed && attemptHolds.has(trimmed));
}

export function hasDeliveryContext(taskId: string): boolean {
  return retainedByTask.has(taskId.trim());
}

export function readDeliveryContextMetrics(): {
  retained: number;
  cleaned: Record<DeliveryContextReleaseReason, number>;
} {
  return {
    retained: retainedByTask.size,
    cleaned: { ...cleanupCounts },
  };
}

export function armCompletionHold(params: {
  keys: string[];
  preflight: ExecutionPreflight;
  workspaceDir?: string;
  now?: number;
  ttlMs?: number;
}): void {
  const now = params.now ?? Date.now();
  sweepExpiredDeliveryContexts(now);
  const hold: Hold = {
    preflight: params.preflight,
    ...(params.workspaceDir ? { workspaceDir: params.workspaceDir } : {}),
  };
  const taskId = params.preflight.taskId.trim();
  const sessionKeys = params.keys.map((key) => key.trim()).filter((key) => key.length > 0);
  const previous = retainedByTask.get(taskId);
  if (previous) {
    detachSessionKeys(taskId, previous.sessionKeys);
  }
  retainedByTask.set(taskId, {
    hold,
    sessionKeys,
    expiresAt: now + (params.ttlMs ?? DEFAULT_DELIVERY_CONTEXT_TTL_MS),
  });
  for (const key of sessionKeys) {
    attemptHolds.set(key, hold);
    const list = sessionTasks.get(key) ?? [];
    if (!list.includes(taskId)) {
      list.push(taskId);
    }
    sessionTasks.set(key, list);
  }
}

/** Drops the in-attempt map only. Retained task context stays for a later send. */
export function disarmCompletionHold(keys: string[]): void {
  for (const key of keys) {
    const trimmed = key.trim();
    if (trimmed) {
      attemptHolds.delete(trimmed);
    }
  }
}

/** Single production entry for terminal cleanup. A second call for the same task does not count again. */
export function finalizeDeliveryContext(params: {
  taskId: string;
  outcome: DeliveryContextReleaseReason;
}): boolean {
  const taskId = params.taskId.trim();
  if (!taskId) {
    return false;
  }
  return releaseDeliveryContext(taskId, params.outcome);
}

/**
 * Gateway maintenance is the only sweep owner.
 * The timer is unref'd, idempotent, and stopped on gateway shutdown.
 */
export function startDeliveryContextSweep(options?: {
  intervalMs?: number;
  now?: () => number;
}): void {
  if (sweepTimer) {
    return;
  }
  const now = options?.now ?? Date.now;
  sweepTimer = setInterval(() => {
    try {
      // Metrics keep the task id, reason, and count. They do not keep user text.
      sweepExpiredDeliveryContexts(now());
    } catch {
      // A sweep failure must not take down the gateway.
    }
  }, options?.intervalMs ?? DELIVERY_CONTEXT_SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

export function stopDeliveryContextSweep(): void {
  if (!sweepTimer) {
    return;
  }
  clearInterval(sweepTimer);
  sweepTimer = null;
}

export function readDeliveryContextSweepActive(): boolean {
  return sweepTimer !== null;
}

export function releaseDeliveryContext(
  taskId: string,
  reason: DeliveryContextReleaseReason,
): boolean {
  const trimmed = taskId.trim();
  const retained = retainedByTask.get(trimmed);
  if (!retained) {
    return false;
  }
  retainedByTask.delete(trimmed);
  detachSessionKeys(trimmed, retained.sessionKeys);
  cleanupCounts[reason] += 1;
  return true;
}

export function sweepExpiredDeliveryContexts(now: number): number {
  let removed = 0;
  for (const [taskId, retained] of retainedByTask) {
    if (retained.expiresAt > now) {
      continue;
    }
    if (releaseDeliveryContext(taskId, "timeout")) {
      removed += 1;
    }
  }
  return removed;
}

function detachSessionKeys(taskId: string, keys: string[]): void {
  for (const key of keys) {
    const list = (sessionTasks.get(key) ?? []).filter((id) => id !== taskId);
    if (list.length === 0) {
      sessionTasks.delete(key);
      continue;
    }
    sessionTasks.set(key, list);
  }
}

function retainedIdsForSession(sessionKey: string | undefined): string[] {
  const key = sessionKey?.trim();
  if (!key) {
    return [];
  }
  return sessionTasks.get(key) ?? [];
}

function holdForTask(taskId: string | undefined): Hold | undefined {
  const task = taskId?.trim();
  if (!task) {
    return undefined;
  }
  return retainedByTask.get(task)?.hold;
}

function evidenceFor(hold: Hold) {
  if (hold.workspaceDir) {
    return resolveAttemptDelivery({
      preflight: hold.preflight,
      workspaceDir: hold.workspaceDir,
    });
  }
  return evaluateDeliveryEvidence({ preflight: hold.preflight });
}

function validatorsRequiredFor(preflight: ExecutionPreflight): boolean {
  return (
    preflight.requiredValidators.length > 0 ||
    Boolean(preflight.deliveryBlockedUntil?.trim()) ||
    confirmationGateRequired(preflight.requiredConfirmations) ||
    preflight.decisionCode === "validator_unavailable"
  );
}

/** One retained hold, read for a close handshake. Does not authorize a send. */
export type DeliveryCloseConsultHold = {
  preflightTaskId: string;
  outcome: CompletionSendOutcome;
  decisionCode: CompletionDecisionCode;
  allowedToDeliver: boolean;
  validatorsRequired: boolean;
  validationResult: DeliveryGateInput["validationResult"];
  /** Latest in-memory receipt for this preflight task. Absent is not a pass. */
  latestReceiptResult: "passed" | "failed" | "absent";
};

/**
 * Read-only delivery snapshot for another domain's close path.
 * Does not write a trace, release a hold, or pick a transport target.
 */
export type DeliveryCloseConsult = {
  hasDeliveryContext: boolean;
  /** More than one retained hold shares the session. None is chosen as a writer. */
  sessionHoldAmbiguous: boolean;
  holds: DeliveryCloseConsultHold[];
  /** True when any consulted hold blocks this text as a completion claim. */
  completionClaimBlocked: boolean;
  /** True when any consulted hold still withholds completion claims. */
  deliveryBlocksCompletionClaims: boolean;
};

const EMPTY_DELIVERY_CLOSE_CONSULT: DeliveryCloseConsult = {
  hasDeliveryContext: false,
  sessionHoldAmbiguous: false,
  holds: [],
  completionClaimBlocked: false,
  deliveryBlocksCompletionClaims: false,
};

function snapshotHold(hold: Hold, text: string): DeliveryCloseConsultHold {
  const evidence = evidenceFor(hold);
  const validatorsRequired = validatorsRequiredFor(hold.preflight);
  const judged = judgeCompletionSend({
    text,
    validatorsRequired,
    allowedToDeliver: evidence.allowedToDeliver,
  });
  const latest = readLatestValidationReceipt(hold.preflight.taskId);
  return {
    preflightTaskId: hold.preflight.taskId,
    outcome: judged.outcome,
    decisionCode: judged.decisionCode,
    allowedToDeliver: evidence.allowedToDeliver,
    validatorsRequired,
    validationResult: evidence.gateInput.validationResult,
    latestReceiptResult: latest?.result ?? "absent",
  };
}

function summarizeDeliveryCloseConsult(
  holds: DeliveryCloseConsultHold[],
  sessionHoldAmbiguous: boolean,
): DeliveryCloseConsult {
  return {
    hasDeliveryContext: holds.length > 0,
    sessionHoldAmbiguous,
    holds,
    completionClaimBlocked: holds.some((row) => row.outcome === "completion_blocked"),
    deliveryBlocksCompletionClaims: holds.some(
      (row) => row.validatorsRequired && !row.allowedToDeliver,
    ),
  };
}

/**
 * Consult skill-delivery completion hold and the latest validation receipt.
 * An explicit preflight task id reads that hold only. A session key with no
 * task id reads every retained hold and does not collapse them into one send.
 */
export function consultDeliveryHoldForClose(params: {
  sessionKey?: string;
  taskId?: string;
  text: string;
}): DeliveryCloseConsult {
  const explicitTaskId = params.taskId?.trim();
  if (explicitTaskId) {
    const hold = holdForTask(explicitTaskId);
    if (!hold) {
      return { ...EMPTY_DELIVERY_CLOSE_CONSULT, holds: [] };
    }
    return summarizeDeliveryCloseConsult([snapshotHold(hold, params.text)], false);
  }
  const ids = retainedIdsForSession(params.sessionKey);
  if (ids.length === 0) {
    return { ...EMPTY_DELIVERY_CLOSE_CONSULT, holds: [] };
  }
  const holds: DeliveryCloseConsultHold[] = [];
  for (const id of ids) {
    const hold = holdForTask(id);
    if (hold) {
      holds.push(snapshotHold(hold, params.text));
    }
  }
  return summarizeDeliveryCloseConsult(holds, ids.length > 1);
}

export function judgeSessionOutbound(
  sessionKey: string | undefined,
  text: string,
  toolName?: string,
  taskId?: string,
): CompletionJudgement | undefined {
  const explicitTaskId = taskId?.trim();
  if (!explicitTaskId) {
    if (retainedIdsForSession(sessionKey).length === 0) {
      return undefined;
    }
    // A missing task id must not select the latest retained task.
    return judgeCompletionSend({
      text,
      validatorsRequired: true,
      allowedToDeliver: false,
    });
  }
  const hold = holdForTask(explicitTaskId);
  if (!hold) {
    return undefined;
  }
  const evidence = evidenceFor(hold);
  const validatorsRequired = validatorsRequiredFor(hold.preflight);
  const judged = judgeCompletionSend({
    text,
    validatorsRequired,
    allowedToDeliver: evidence.allowedToDeliver,
  });
  if (judged.outcome !== "progress_allowed") {
    recordExecutionTrace({
      taskId: hold.preflight.taskId,
      sessionId: hold.preflight.sessionId,
      attemptNumber: hold.preflight.attemptNumber,
      intentClass: hold.preflight.intentClass,
      decisionStage: "delivery",
      decisionCode: judged.decisionCode,
      ...(hold.preflight.primarySkill ? { primarySkill: hold.preflight.primarySkill } : {}),
      ...(toolName ? { toolName } : {}),
      retryable: false,
      deliveryOutcome: judged.outcome === "completion_allowed" ? "allowed" : "blocked",
    });
  }
  return judged;
}

/** Call the transport only when the shared judge allows the text. */
export async function dispatchGuardedSend(params: {
  sessionKey?: string;
  taskId?: string;
  text: string;
  toolName?: string;
  send: (text: string) => Promise<void> | void;
}): Promise<CompletionJudgement | undefined> {
  const judged = judgeSessionOutbound(
    params.sessionKey,
    params.text,
    params.toolName,
    params.taskId,
  );
  if (judged?.outcome === "completion_blocked") {
    return judged;
  }
  await params.send(judged?.visibleText ?? params.text);
  const taskId = params.taskId?.trim();
  if (judged?.outcome === "completion_allowed" && taskId) {
    finalizeDeliveryContext({ taskId, outcome: "delivered" });
  }
  return judged;
}
