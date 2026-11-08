/**
 * Async-wait recovery claim: stage rank, liveness, claim, continue-armed, prompt appendix.
 * Stage names and evidence kinds unchanged. process_missing_unconfirmed is not success proof.
 */
import { randomUUID } from "node:crypto";
import { isEmbeddedPiRunActive } from "../../execution/runner/run-registry.js";
import type {
  AsyncWaitJobIntent,
  AsyncWaitRecoveryStage,
  AsyncWaitResultEvidence,
} from "./async-wait-job-store.js";
import { transitionAsyncWaitJobIntent } from "./async-wait-job.js";
import { readSessionTaskBoard } from "./task-board-file.js";

export type AsyncWaitClaimResult =
  | {
      ok: true;
      intent: AsyncWaitJobIntent;
      claimToken: string;
      /** True when this call newly acquired the claim (vs retrying an open stage). */
      freshClaim: boolean;
      /**
       * Business already executed; only delivery confirmation remains.
       * Caller must NOT re-enqueue business continue / re-run the model.
       */
      deliveryOnly?: boolean;
    }
  | {
      ok: false;
      reason:
        | "missing"
        | "cleared"
        | "still_waiting_pid"
        | "delivered"
        | "no_session"
        | "active_exec";
      intent?: AsyncWaitJobIntent;
    };

const STAGE_RANK: Record<AsyncWaitRecoveryStage, number> = {
  none: 0,
  claimed: 1,
  continue_armed: 2,
  turn_bound: 3,
  delivery_pending: 4,
  delivered: 5,
};

export function asyncWaitRecoveryStageRank(stage: AsyncWaitRecoveryStage): number {
  return STAGE_RANK[stage] ?? 0;
}

/** Prepare-phase grace when holderPid was not stamped (legacy rows only). */
const PREPARE_HOLDER_GRACE_MS = 120_000;

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Trusted run-liveness for turn_bound without delivery:
 * - board still bound to this attempt/runId
 * - AND holder still valid: embedded active (exec), OR holderPid alive
 *   (auth/prepare + cross-process), OR short legacy prepare grace
 * Missing/expired holder ⇒ dead (recoverable). Never permanent active_exec.
 */
export function isBoundAsyncWaitRunLive(
  intent: AsyncWaitJobIntent,
  opts?: {
    isEmbeddedPiRunActive?: (sessionId: string) => boolean;
    isPidAlive?: (pid: number) => boolean;
    nowMs?: number;
  },
): boolean {
  const recovery = intent.recovery;
  if (!recovery || recovery.stage !== "turn_bound" || !recovery.boundRunId) {
    return false;
  }
  if (recovery.boundDeliveryId) {
    return false;
  }
  const board = readSessionTaskBoard(intent.sessionFile);
  if (board.current?.executionAttempt !== recovery.boundRunId) {
    return false;
  }
  const active = opts?.isEmbeddedPiRunActive ?? isEmbeddedPiRunActive;
  const pidAlive = opts?.isPidAlive ?? defaultPidAlive;
  const sessionId = recovery.boundSessionId?.trim();
  if (sessionId && active(sessionId)) {
    return true;
  }
  if (typeof recovery.holderPid === "number" && Number.isFinite(recovery.holderPid)) {
    return pidAlive(recovery.holderPid);
  }
  // Legacy rows without holderPid: brief prepare-window only.
  const last = recovery.lastAttemptAtMs ?? recovery.claimedAtMs ?? 0;
  const now = opts?.nowMs ?? Date.now();
  return last > 0 && now - last < PREPARE_HOLDER_GRACE_MS;
}

/**
 * Atomic recovery claim. PID alive → leave waiting (not success proof).
 * PID gone → exited with process_missing_unconfirmed (not success packaging).
 * Unconfirmed stages (claimed..delivery_pending) are returned for retry — never
 * skipped as "already issued".
 */
export function claimAsyncWaitJobForRecovery(input: {
  sessionFile: string;
  jobId: string;
  /** Injected for tests: override pid liveness. */
  isPidAlive?: (pid: number) => boolean;
  /** Injected for tests: override embedded-run liveness. */
  isEmbeddedPiRunActive?: (sessionId: string) => boolean;
}): AsyncWaitClaimResult {
  const file = input.sessionFile.trim();
  const id = input.jobId.trim();
  if (!file || !id) {
    return { ok: false, reason: "no_session" };
  }
  const pidAlive =
    input.isPidAlive ??
    ((pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });

  let result: AsyncWaitClaimResult = { ok: false, reason: "missing" };
  transitionAsyncWaitJobIntent(file, id, (current) => {
    if (!current) {
      result = { ok: false, reason: "missing" };
      return undefined;
    }
    if (current.status === "cleared") {
      result = { ok: false, reason: "cleared", intent: current };
      return "keep";
    }
    const recovery = current.recovery ?? { stage: "none" as const, claimGeneration: 0 };
    if (recovery.stage === "delivered") {
      result = { ok: false, reason: "delivered", intent: current };
      return "keep";
    }
    // turn_bound without delivery: live run ⇒ active_exec; dead claim ⇒ reopen for recovery.
    if (recovery.stage === "turn_bound" && recovery.boundRunId && !recovery.boundDeliveryId) {
      if (
        isBoundAsyncWaitRunLive(current, {
          isEmbeddedPiRunActive: input.isEmbeddedPiRunActive,
          isPidAlive: input.isPidAlive,
        })
      ) {
        result = { ok: false, reason: "active_exec", intent: current };
        return "keep";
      }
      // Dead claim: fence old holders with a new generation/token (no dual exec).
      {
        const claimToken = randomUUID();
        const nextGen = (recovery.claimGeneration ?? 0) + 1;
        const next = {
          ...current,
          recovery: {
            ...recovery,
            stage: "continue_armed" as const,
            claimGeneration: nextGen,
            claimToken,
            boundRunId: undefined,
            boundSessionId: undefined,
            holderPid: undefined,
            lastAttemptAtMs: Date.now(),
          },
        };
        result = {
          ok: true,
          intent: next,
          claimToken,
          freshClaim: true,
        };
        return next;
      }
    }
    // Executed-not-delivered: delivery-only recovery (do not re-run business).
    if (recovery.stage === "delivery_pending" && recovery.claimToken) {
      result = {
        ok: true,
        intent: current,
        claimToken: recovery.claimToken,
        freshClaim: false,
        deliveryOnly: true,
      };
      return {
        ...current,
        recovery: {
          ...recovery,
          lastAttemptAtMs: Date.now(),
        },
      };
    }
    // claimed / continue_armed stay claimable for retry with the same token.
    if (
      (recovery.stage === "claimed" || recovery.stage === "continue_armed") &&
      recovery.claimToken
    ) {
      result = {
        ok: true,
        intent: current,
        claimToken: recovery.claimToken,
        freshClaim: false,
      };
      return {
        ...current,
        recovery: {
          ...recovery,
          lastAttemptAtMs: Date.now(),
        },
      };
    }
    // turn_bound with delivery id but not yet delivery_pending — treat as delivery-only.
    if (recovery.stage === "turn_bound" && recovery.boundDeliveryId && recovery.claimToken) {
      result = {
        ok: true,
        intent: current,
        claimToken: recovery.claimToken,
        freshClaim: false,
        deliveryOnly: true,
      };
      return {
        ...current,
        recovery: {
          ...recovery,
          lastAttemptAtMs: Date.now(),
        },
      };
    }
    if (current.status === "waiting") {
      if (typeof current.pid === "number" && pidAlive(current.pid)) {
        result = { ok: false, reason: "still_waiting_pid", intent: current };
        return "keep";
      }
      // PID gone ≠ success. Record unconfirmed missing evidence.
      const at = Date.now();
      const claimToken = randomUUID();
      const next: AsyncWaitJobIntent = {
        ...current,
        status: "exited",
        exitStatus: "failed",
        exitedAtMs: at,
        resultEvidence: {
          kind: "process_missing_unconfirmed",
          exitStatus: "failed",
          observedAtMs: at,
          summary:
            "Background job pid is not alive after restart; exit outcome is unconfirmed — do not treat as success.",
        },
        recovery: {
          stage: "claimed",
          claimGeneration: recovery.claimGeneration + 1,
          claimToken,
          claimedAtMs: at,
          lastAttemptAtMs: at,
        },
      };
      result = { ok: true, intent: next, claimToken, freshClaim: true };
      return next;
    }
    // status === exited
    const at = Date.now();
    const claimToken = randomUUID();
    const evidence =
      current.resultEvidence ??
      ({
        kind: "owner_marked_exited",
        ...(current.exitStatus ? { exitStatus: current.exitStatus } : {}),
        observedAtMs: current.exitedAtMs ?? at,
      } satisfies AsyncWaitResultEvidence);
    const next: AsyncWaitJobIntent = {
      ...current,
      resultEvidence: evidence,
      recovery: {
        stage: "claimed",
        claimGeneration: recovery.claimGeneration + 1,
        claimToken,
        claimedAtMs: at,
        lastAttemptAtMs: at,
      },
    };
    result = { ok: true, intent: next, claimToken, freshClaim: true };
    return next;
  });
  return result;
}

export function markAsyncWaitRecoveryContinueArmed(input: {
  sessionFile: string;
  jobId: string;
  claimToken: string;
  focusRevision: number;
  messageId: string;
}): AsyncWaitJobIntent | undefined {
  return transitionAsyncWaitJobIntent(input.sessionFile, input.jobId, (current) => {
    if (!current || current.status === "cleared") {
      return current;
    }
    const recovery = current.recovery;
    // Token fence: late/stopped holders cannot overwrite.
    if (!recovery || recovery.claimToken !== input.claimToken) {
      return "keep";
    }
    // No stage regression: turn_bound / delivery_pending / delivered cannot fall back.
    if (
      recovery.stage !== "claimed" &&
      recovery.stage !== "continue_armed" &&
      recovery.stage !== "none"
    ) {
      return "keep";
    }
    return {
      ...current,
      recovery: {
        ...recovery,
        stage: "continue_armed",
        continueFocusRevision: input.focusRevision,
        continueMessageId: input.messageId,
        lastAttemptAtMs: Date.now(),
      },
    };
  });
}

/** Build continue prompt evidence — never packages unconfirmed missing as success. */
export function buildAsyncWaitRecoveryPromptAppendix(intent: AsyncWaitJobIntent): string {
  const evidence = intent.resultEvidence;
  const lines = [
    "Async-wait job recovery context (Package2):",
    `jobId=${intent.jobId}`,
    `taskId=${intent.taskId}`,
    `priorExecutionAttempt=${intent.executionAttempt}`,
  ];
  if (!evidence) {
    lines.push("resultEvidence=absent — treat outcome as unconfirmed; do not claim success.");
    return lines.join("\n");
  }
  lines.push(`evidenceKind=${evidence.kind}`);
  if (evidence.exitStatus) {
    lines.push(`observedExitStatus=${evidence.exitStatus}`);
  }
  if (evidence.exitCode !== undefined) {
    lines.push(`exitCode=${evidence.exitCode}`);
  }
  if (evidence.summary?.trim()) {
    lines.push(`summary=${evidence.summary.trim().slice(0, 500)}`);
  }
  if (evidence.kind === "process_missing_unconfirmed") {
    lines.push(
      "WARNING: pid was gone after restart; this is NOT proof the original job completed successfully. Investigate or re-run if the deliverable is missing.",
    );
  }
  return lines.join("\n");
}

/** @deprecated v1 API — maps to continue_armed retryable stage; prefer claim + continue. */
export function markAsyncWaitJobRecoveryWakeIssued(
  sessionFile: string,
  jobId: string,
  atMs: number = Date.now(),
): AsyncWaitJobIntent | undefined {
  return transitionAsyncWaitJobIntent(sessionFile, jobId, (current) => {
    if (!current || current.status === "cleared") {
      return current;
    }
    const recovery = current.recovery ?? { stage: "none" as const, claimGeneration: 0 };
    if (recovery.stage === "delivered") {
      return "keep";
    }
    return {
      ...current,
      recovery: {
        ...recovery,
        stage: recovery.stage === "none" ? "continue_armed" : recovery.stage,
        claimGeneration: Math.max(1, recovery.claimGeneration),
        claimedAtMs: recovery.claimedAtMs ?? atMs,
        lastAttemptAtMs: atMs,
      },
    };
  });
}
