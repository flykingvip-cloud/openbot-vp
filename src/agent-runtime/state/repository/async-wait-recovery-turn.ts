/**
 * Async-wait recovery turn bind / release / delivery.
 * boundRunId must come from a real run — never synthesize.
 */
import { randomUUID } from "node:crypto";
import type { AsyncWaitBoundPayload, AsyncWaitJobIntent } from "./async-wait-job-store.js";
import { listAsyncWaitJobIntents, transitionAsyncWaitJobIntent } from "./async-wait-job.js";
import {
  asyncWaitRecoveryStageRank,
  markAsyncWaitJobRecoveryWakeIssued,
} from "./async-wait-recovery-claim.js";

export function sanitizeAsyncWaitBoundPayloads(
  payloads: readonly AsyncWaitBoundPayload[] | undefined,
): AsyncWaitBoundPayload[] | undefined {
  if (!payloads?.length) {
    return undefined;
  }
  const out: AsyncWaitBoundPayload[] = [];
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object") {
      continue;
    }
    const next: AsyncWaitBoundPayload = {};
    if (typeof payload.text === "string") {
      next.text = payload.text;
    }
    if (typeof payload.mediaUrl === "string" && payload.mediaUrl.trim()) {
      next.mediaUrl = payload.mediaUrl;
    }
    if (Array.isArray(payload.mediaUrls) && payload.mediaUrls.length > 0) {
      next.mediaUrls = payload.mediaUrls.filter((u) => typeof u === "string" && u.trim());
    }
    if (typeof payload.replyToId === "string") {
      next.replyToId = payload.replyToId;
    }
    if (payload.audioAsVoice === true) {
      next.audioAsVoice = true;
    }
    if (payload.isError === true) {
      next.isError = true;
    }
    if (payload.channelData && typeof payload.channelData === "object") {
      next.channelData = { ...payload.channelData };
    }
    if (next.text || next.mediaUrl || (next.mediaUrls && next.mediaUrls.length > 0)) {
      out.push(next);
    }
  }
  return out.length > 0 ? out : undefined;
}

/** Bind a real followup/agent run id after claimQueuedExecution accepts. */
export type BindAsyncWaitRecoveryTurnResult =
  | { accepted: true; intent: AsyncWaitJobIntent }
  | {
      accepted: false;
      reason:
        | "missing_params"
        | "run_conflict"
        | "already_bound"
        | "no_candidate"
        | "token_mismatch"
        | "cleared"
        | "stage_regression"
        | "unchanged";
      intent?: AsyncWaitJobIntent;
    };

export function bindAsyncWaitRecoveryTurn(input: {
  sessionFile: string;
  taskId: string;
  runId: string;
  /** Prefer explicit jobId — never bind the first open job by taskId alone when set. */
  jobId?: string;
  /** Required with jobId for exclusive bind; rejects late/stopped holders. */
  claimToken?: string;
  sessionId?: string;
  deliveryId?: string;
  outcomeTaskId?: string;
  /** Sync recovery intent to the live bound attempt so recheck cannot clear with a stale attempt. */
  executionAttempt?: string;
  deliverableVersion?: string;
  /** Original visible payloads for delivery-only retry (required when deliveryId set). */
  payloads?: readonly AsyncWaitBoundPayload[];
  /** Holder pid for prepare/cross-process liveness; defaults to process.pid on turn_bound. */
  holderPid?: number;
  /** Original canonical workspace identity for delivery-only revalidation. */
  boundWorkspace?: {
    resourceId: string;
    bindingId: string;
    contentVersion: string;
  };
}): BindAsyncWaitRecoveryTurnResult {
  const tid = input.taskId.trim();
  const runId = input.runId.trim();
  if (!tid || !runId) {
    return { accepted: false, reason: "missing_params" };
  }
  const jobIdFilter = input.jobId?.trim() || undefined;
  const tokenFilter = input.claimToken?.trim() || undefined;
  // Exclusive bind requires jobId + claimToken under lock — never first-open-by-taskId.
  if (!jobIdFilter || !tokenFilter) {
    return { accepted: false, reason: "missing_params" };
  }
  // Refuse if another job already owns this runId.
  for (const other of listAsyncWaitJobIntents(input.sessionFile)) {
    if (
      other.jobId !== jobIdFilter &&
      other.recovery?.boundRunId === runId &&
      other.recovery.stage !== "delivered" &&
      other.status !== "cleared"
    ) {
      return { accepted: false, reason: "run_conflict", intent: other };
    }
  }
  // Resolve by jobId+taskId first; token is verified under lock (explicit token_mismatch).
  const candidates = listAsyncWaitJobIntents(input.sessionFile).filter((intent) => {
    if (intent.taskId !== tid || intent.status === "cleared") {
      return false;
    }
    if (intent.jobId !== jobIdFilter) {
      return false;
    }
    const stage = intent.recovery?.stage;
    return (
      stage === "claimed" ||
      stage === "continue_armed" ||
      stage === "turn_bound" ||
      stage === "delivery_pending"
    );
  });
  const target = candidates[0];
  if (!target) {
    return { accepted: false, reason: "no_candidate" };
  }
  if (target.recovery?.claimToken !== tokenFilter) {
    return { accepted: false, reason: "token_mismatch", intent: target };
  }
  let rejectReason: Extract<BindAsyncWaitRecoveryTurnResult, { accepted: false }> = {
    accepted: false,
    reason: "unchanged",
  };
  // Track mutation explicitly — transition "keep" returns the existing record (≠ success).
  let mutated = false;
  const intent = transitionAsyncWaitJobIntent(input.sessionFile, target.jobId, (current) => {
    if (!current?.recovery?.claimToken) {
      rejectReason = { accepted: false, reason: "no_candidate", intent: current };
      return "keep";
    }
    if (tokenFilter && current.recovery.claimToken !== tokenFilter) {
      rejectReason = { accepted: false, reason: "token_mismatch", intent: current };
      return "keep";
    }
    if (current.status === "cleared") {
      rejectReason = { accepted: false, reason: "cleared", intent: current };
      return "keep";
    }
    // Same job/token already bound to another run → refuse overwrite.
    // Same-run idempotent retry OK; a different run must re-claim (new gen/token).
    const existingBound = current.recovery.boundRunId?.trim();
    if (existingBound && existingBound !== runId) {
      rejectReason = { accepted: false, reason: "already_bound", intent: current };
      return "keep";
    }
    const nextStage = input.deliveryId ? "delivery_pending" : "turn_bound";
    // No stage regression (e.g. delivery_pending must not fall back to turn_bound).
    if (
      asyncWaitRecoveryStageRank(nextStage) < asyncWaitRecoveryStageRank(current.recovery.stage)
    ) {
      rejectReason = { accepted: false, reason: "stage_regression", intent: current };
      return "keep";
    }
    const syncedAttempt = input.executionAttempt?.trim();
    const syncedDeliverable = input.deliverableVersion?.trim();
    const boundPayloads = input.deliveryId
      ? (sanitizeAsyncWaitBoundPayloads(input.payloads) ?? current.recovery.boundPayloads)
      : current.recovery.boundPayloads;
    const holderPid = input.deliveryId
      ? undefined
      : typeof input.holderPid === "number" && Number.isFinite(input.holderPid)
        ? input.holderPid
        : process.pid;
    mutated = true;
    return {
      ...current,
      ...(syncedAttempt ? { executionAttempt: syncedAttempt } : {}),
      ...(syncedDeliverable ? { deliverableVersion: syncedDeliverable } : {}),
      recovery: {
        ...current.recovery,
        stage: nextStage,
        boundRunId: runId,
        ...(input.sessionId?.trim() ? { boundSessionId: input.sessionId.trim() } : {}),
        ...(input.deliveryId ? { boundDeliveryId: input.deliveryId } : {}),
        ...(input.outcomeTaskId ? { boundOutcomeTaskId: input.outcomeTaskId } : {}),
        ...(boundPayloads ? { boundPayloads } : {}),
        ...(syncedDeliverable || input.deliverableVersion
          ? {
              boundDeliverableVersion:
                syncedDeliverable || input.deliverableVersion?.trim() || runId,
            }
          : {}),
        ...(holderPid !== undefined ? { holderPid } : { holderPid: undefined }),
        ...(input.boundWorkspace
          ? { boundWorkspace: input.boundWorkspace }
          : current.recovery.boundWorkspace
            ? { boundWorkspace: current.recovery.boundWorkspace }
            : {}),
        lastAttemptAtMs: Date.now(),
      },
    };
  });
  if (mutated && intent) {
    return { accepted: true, intent };
  }
  if (rejectReason.reason !== "unchanged") {
    return rejectReason;
  }
  return { accepted: false, reason: "unchanged", intent: intent ?? target };
}

/**
 * Release a turn_bound recovery claim after controlled-turn prepare/exec failure
 * or other terminal exit without delivery. Fences the old holder with a new
 * generation/token so Gateway-alive PID alone cannot keep permanent active_exec.
 * delivery_pending / delivered are left untouched (delivery owns those stages).
 */
export function releaseAsyncWaitRecoveryTurn(input: {
  sessionFile: string;
  jobId: string;
  claimToken: string;
  /** When set, only release if boundRunId still matches this turn. */
  runId?: string;
}):
  | { released: true; intent: AsyncWaitJobIntent; claimToken: string }
  | {
      released: false;
      reason:
        | "missing_params"
        | "no_candidate"
        | "token_mismatch"
        | "not_turn_bound"
        | "run_mismatch"
        | "unchanged";
      intent?: AsyncWaitJobIntent;
    } {
  const jobId = input.jobId.trim();
  const token = input.claimToken.trim();
  const runId = input.runId?.trim() || undefined;
  if (!input.sessionFile.trim() || !jobId || !token) {
    return { released: false, reason: "missing_params" };
  }
  let outcome:
    | { released: true; intent: AsyncWaitJobIntent; claimToken: string }
    | {
        released: false;
        reason: "no_candidate" | "token_mismatch" | "not_turn_bound" | "run_mismatch" | "unchanged";
        intent?: AsyncWaitJobIntent;
      } = { released: false, reason: "unchanged" };
  let mutated = false;
  const intent = transitionAsyncWaitJobIntent(input.sessionFile, jobId, (current) => {
    if (!current?.recovery) {
      outcome = { released: false, reason: "no_candidate", intent: current };
      return "keep";
    }
    if (current.recovery.claimToken !== token) {
      outcome = { released: false, reason: "token_mismatch", intent: current };
      return "keep";
    }
    if (current.recovery.stage !== "turn_bound" || current.recovery.boundDeliveryId) {
      outcome = { released: false, reason: "not_turn_bound", intent: current };
      return "keep";
    }
    if (
      runId &&
      current.recovery.boundRunId?.trim() &&
      current.recovery.boundRunId.trim() !== runId
    ) {
      outcome = { released: false, reason: "run_mismatch", intent: current };
      return "keep";
    }
    const nextToken = randomUUID();
    const nextGen = (current.recovery.claimGeneration ?? 0) + 1;
    mutated = true;
    const next = {
      ...current,
      recovery: {
        ...current.recovery,
        stage: "continue_armed" as const,
        claimGeneration: nextGen,
        claimToken: nextToken,
        boundRunId: undefined,
        boundSessionId: undefined,
        holderPid: undefined,
        lastAttemptAtMs: Date.now(),
      },
    };
    outcome = { released: true, intent: next, claimToken: nextToken };
    return next;
  });
  if (mutated && outcome.released) {
    return outcome;
  }
  if (!outcome.released && outcome.reason !== "unchanged") {
    return outcome;
  }
  return { released: false, reason: "unchanged", intent: intent };
}

export function markAsyncWaitRecoveryDelivered(input: {
  sessionFile: string;
  runId: string;
}): AsyncWaitJobIntent | undefined {
  const runId = input.runId.trim();
  if (!runId) {
    return undefined;
  }
  for (const intent of listAsyncWaitJobIntents(input.sessionFile)) {
    if (intent.recovery?.boundRunId !== runId) {
      continue;
    }
    return transitionAsyncWaitJobIntent(input.sessionFile, intent.jobId, (current) => {
      if (!current?.recovery || current.recovery.boundRunId !== runId) {
        return "keep";
      }
      if (current.recovery.stage === "delivered") {
        return "keep";
      }
      return {
        ...current,
        recovery: {
          ...current.recovery,
          stage: "delivered",
          deliveredAtMs: Date.now(),
          lastAttemptAtMs: Date.now(),
        },
      };
    });
  }
  return undefined;
}

/** @deprecated v1 API — do not treat as delivery proof. */
export function markAsyncWaitJobProactiveDeliveryIssued(input: {
  sessionFile: string;
  jobId: string;
  runId: string;
  summary?: string;
  atMs?: number;
}): AsyncWaitJobIntent | undefined {
  return markAsyncWaitJobRecoveryWakeIssued(
    input.sessionFile,
    input.jobId,
    input.atMs ?? Date.now(),
  );
}
