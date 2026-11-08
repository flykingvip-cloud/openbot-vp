/**
 * Durable async-wait job intent for background exec with notifyOnExit.
 * Survives gateway restart so recovery can claim without a second scheduler.
 * Facts only: wait / exited / cleared + recovery stages. Not an executor.
 *
 * All status transitions read+decide+write under the per-job file lock so two
 * processes cannot dual-claim, and owner clear cannot be overwritten by a stale
 * snapshot from outside the lock.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { withFileLockSync, SESSION_TASK_BOARD_LOCK_OPTIONS } from "../../../infra/file-lock.js";
import { isEmbeddedPiRunActive } from "../../execution/runner/run-registry.js";
import { readSessionTaskBoard } from "./task-board-file.js";

export type AsyncWaitJobStatus = "waiting" | "exited" | "cleared";

/** Separate from status: claim ≠ execute ≠ delivery. Unconfirmed stages retry. */
export type AsyncWaitRecoveryStage =
  | "none"
  | "claimed"
  | "continue_armed"
  | "turn_bound"
  | "delivery_pending"
  | "delivered";

export type AsyncWaitResultEvidence = {
  /**
   * process_exit_observed = live child reported exit (credible).
   * process_missing_unconfirmed = pid gone at recovery; NOT success proof.
   * owner_marked_exited = explicit markExited without live observation fields.
   */
  kind: "process_exit_observed" | "process_missing_unconfirmed" | "owner_marked_exited";
  exitStatus?: "completed" | "failed" | "killed";
  exitCode?: number | null;
  summary?: string;
  observedAtMs: number;
};

export type AsyncWaitRecoveryState = {
  stage: AsyncWaitRecoveryStage;
  claimGeneration: number;
  claimToken?: string;
  claimedAtMs?: number;
  continueFocusRevision?: number;
  continueMessageId?: string;
  /** Real agent/followup run id once claimQueuedExecution accepts — never synthetic. */
  boundRunId?: string;
  /** Session id used with isEmbeddedPiRunActive for live-vs-dead claim distinction. */
  boundSessionId?: string;
  boundDeliveryId?: string;
  boundOutcomeTaskId?: string;
  lastAttemptAtMs?: number;
  deliveredAtMs?: number;
};

/** Trusted host identity snapshot for recovery followup — never invented from prompt text. */
export type AsyncWaitTrustedIdentity = {
  user?: string;
  platformUserId?: string;
  sessionDomain?: "platform" | "enterprise" | "employee";
  enterpriseId?: string;
  membershipId?: string;
  seatId?: string;
};

export type AsyncWaitJobIntent = {
  version: 2;
  jobId: string;
  sessionKey: string;
  sessionFile: string;
  taskId: string;
  executionAttempt: string;
  deliverableVersion: string;
  constraints: string[];
  pid?: number;
  startedAt: number;
  command?: string;
  status: AsyncWaitJobStatus;
  exitStatus?: "completed" | "failed" | "killed";
  exitedAtMs?: number;
  clearedAtMs?: number;
  resultEvidence?: AsyncWaitResultEvidence;
  /** Captured from the live host turn when the wait was recorded. */
  trustedIdentity?: AsyncWaitTrustedIdentity;
  recovery?: AsyncWaitRecoveryState;
};

const DIRNAME = "async-wait-jobs";

function jobsDir(sessionFile: string): string {
  return path.join(path.dirname(path.resolve(sessionFile)), DIRNAME);
}

function fileFor(sessionFile: string, jobId: string): string {
  return path.join(jobsDir(sessionFile), `${encodeURIComponent(jobId)}.json`);
}

function validIntent(value: unknown): value is AsyncWaitJobIntent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as Partial<AsyncWaitJobIntent>;
  const versionOk = row.version === 2 || row.version === 1;
  return (
    versionOk &&
    typeof row.jobId === "string" &&
    row.jobId.trim().length > 0 &&
    typeof row.sessionKey === "string" &&
    row.sessionKey.trim().length > 0 &&
    typeof row.sessionFile === "string" &&
    row.sessionFile.trim().length > 0 &&
    typeof row.taskId === "string" &&
    row.taskId.trim().length > 0 &&
    typeof row.executionAttempt === "string" &&
    row.executionAttempt.trim().length > 0 &&
    typeof row.deliverableVersion === "string" &&
    row.deliverableVersion.trim().length > 0 &&
    Array.isArray(row.constraints) &&
    typeof row.startedAt === "number" &&
    Number.isFinite(row.startedAt) &&
    (row.status === "waiting" || row.status === "exited" || row.status === "cleared")
  );
}

/** Migrate v1 rows (issued marks) into v2 recovery stages — unconfirmed stays retryable. */
function normalizeIntent(row: AsyncWaitJobIntent): AsyncWaitJobIntent {
  if (row.version === 2 && row.recovery) {
    return row;
  }
  const legacy = row as AsyncWaitJobIntent & {
    recoveryWakeIssuedAtMs?: number;
    proactiveDeliveryIssuedAtMs?: number;
    proactiveDeliveryRunId?: string;
    completionSummary?: string;
  };
  let recovery: AsyncWaitRecoveryState = {
    stage: "none",
    claimGeneration: 0,
  };
  // v1 treated issued as terminal — that permanently skipped unfinished recovery.
  // Map issued → continue_armed (retryable) so crash windows can resume.
  if (typeof legacy.proactiveDeliveryIssuedAtMs === "number") {
    recovery = {
      stage: "continue_armed",
      claimGeneration: 1,
      claimToken: legacy.proactiveDeliveryRunId,
      claimedAtMs: legacy.proactiveDeliveryIssuedAtMs,
      lastAttemptAtMs: legacy.proactiveDeliveryIssuedAtMs,
    };
  } else if (typeof legacy.recoveryWakeIssuedAtMs === "number") {
    recovery = {
      stage: "continue_armed",
      claimGeneration: 1,
      claimedAtMs: legacy.recoveryWakeIssuedAtMs,
      lastAttemptAtMs: legacy.recoveryWakeIssuedAtMs,
    };
  }
  const evidence: AsyncWaitResultEvidence | undefined = row.resultEvidence
    ? row.resultEvidence
    : row.status === "exited"
      ? {
          kind: "owner_marked_exited",
          ...(row.exitStatus ? { exitStatus: row.exitStatus } : {}),
          ...(legacy.completionSummary?.trim()
            ? { summary: legacy.completionSummary.trim().slice(0, 2000) }
            : {}),
          observedAtMs: row.exitedAtMs ?? row.startedAt,
        }
      : undefined;
  return {
    ...row,
    version: 2,
    ...(evidence ? { resultEvidence: evidence } : {}),
    recovery,
  };
}

function readFileUnlocked(filePath: string): AsyncWaitJobIntent | undefined {
  try {
    const row = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!validIntent(row)) {
      return undefined;
    }
    return normalizeIntent(row);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    return undefined;
  }
}

function writeFileUnlocked(sessionFile: string, intent: AsyncWaitJobIntent): void {
  const dir = jobsDir(sessionFile);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = fileFor(sessionFile, intent.jobId);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(intent, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, target);
}

/**
 * Atomic read → decide → write under the per-job lock.
 * Decide must not perform nested locks on the same job file.
 */
export function transitionAsyncWaitJobIntent(
  sessionFile: string,
  jobId: string,
  decide: (current: AsyncWaitJobIntent | undefined) => AsyncWaitJobIntent | undefined | "keep",
): AsyncWaitJobIntent | undefined {
  const file = sessionFile.trim();
  const id = jobId.trim();
  if (!file || !id) {
    return undefined;
  }
  const target = fileFor(file, id);
  return withFileLockSync(target, SESSION_TASK_BOARD_LOCK_OPTIONS, () => {
    const current = readFileUnlocked(target);
    const decided = decide(current);
    if (decided === "keep") {
      return current;
    }
    if (!decided) {
      return undefined;
    }
    const next = normalizeIntent({ ...decided, version: 2 });
    writeFileUnlocked(file, next);
    return next;
  });
}

/** Record waiting intent when a notify-on-exit job is backgrounded with a live binding. */
export function recordAsyncWaitJobIntent(input: {
  jobId: string;
  sessionKey: string;
  sessionFile: string;
  taskId: string;
  executionAttempt: string;
  deliverableVersion: string;
  constraints?: string[];
  pid?: number;
  startedAt: number;
  command?: string;
  trustedIdentity?: AsyncWaitTrustedIdentity;
}): AsyncWaitJobIntent | undefined {
  const sessionFile = input.sessionFile.trim();
  const jobId = input.jobId.trim();
  const sessionKey = input.sessionKey.trim();
  const taskId = input.taskId.trim();
  const executionAttempt = input.executionAttempt.trim();
  const deliverableVersion = input.deliverableVersion.trim();
  if (
    !sessionFile ||
    !jobId ||
    !sessionKey ||
    !taskId ||
    !executionAttempt ||
    !deliverableVersion
  ) {
    return undefined;
  }
  return transitionAsyncWaitJobIntent(sessionFile, jobId, () => ({
    version: 2,
    jobId,
    sessionKey,
    sessionFile,
    taskId,
    executionAttempt,
    deliverableVersion,
    constraints: [...(input.constraints ?? [])],
    startedAt: input.startedAt,
    status: "waiting",
    recovery: { stage: "none", claimGeneration: 0 },
    ...(typeof input.pid === "number" && Number.isFinite(input.pid) ? { pid: input.pid } : {}),
    ...(input.command?.trim() ? { command: input.command.trim().slice(0, 500) } : {}),
    ...(input.trustedIdentity ? { trustedIdentity: { ...input.trustedIdentity } } : {}),
  }));
}

export function readAsyncWaitJobIntent(
  sessionFile: string,
  jobId: string,
): AsyncWaitJobIntent | undefined {
  const file = sessionFile.trim();
  const id = jobId.trim();
  if (!file || !id) {
    return undefined;
  }
  return readFileUnlocked(fileFor(file, id));
}

export function listAsyncWaitJobIntents(sessionFile: string): AsyncWaitJobIntent[] {
  const file = sessionFile.trim();
  if (!file) {
    return [];
  }
  const dir = jobsDir(file);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: AsyncWaitJobIntent[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const intent = readFileUnlocked(path.join(dir, name));
    if (intent) {
      out.push(intent);
    }
  }
  return out;
}

export function listWaitingAsyncWaitJobIntents(sessionFile: string): AsyncWaitJobIntent[] {
  return listAsyncWaitJobIntents(sessionFile).filter((row) => row.status === "waiting");
}

/** Live process exit observation — credible result evidence. */
export function markAsyncWaitJobExited(input: {
  sessionFile: string;
  jobId: string;
  exitStatus: "completed" | "failed" | "killed";
  exitCode?: number | null;
  summary?: string;
  exitedAtMs?: number;
}): AsyncWaitJobIntent | undefined {
  const at = input.exitedAtMs ?? Date.now();
  return transitionAsyncWaitJobIntent(input.sessionFile, input.jobId, (current) => {
    if (!current || current.status === "cleared") {
      return current;
    }
    return {
      ...current,
      status: "exited",
      exitStatus: input.exitStatus,
      exitedAtMs: at,
      resultEvidence: {
        kind: "process_exit_observed",
        exitStatus: input.exitStatus,
        ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
        ...(input.summary?.trim() ? { summary: input.summary.trim().slice(0, 2000) } : {}),
        observedAtMs: at,
      },
      recovery: current.recovery ?? { stage: "none", claimGeneration: 0 },
    };
  });
}

/** Owner stop / pause / cancel under lock — wins over in-flight claim writers. */
export function clearAsyncWaitJobIntent(sessionFile: string, jobId: string): boolean {
  const next = transitionAsyncWaitJobIntent(sessionFile, jobId, (current) => {
    if (!current) {
      return undefined;
    }
    if (current.status === "cleared") {
      return "keep";
    }
    return {
      ...current,
      status: "cleared",
      clearedAtMs: Date.now(),
      recovery: {
        ...(current.recovery ?? { stage: "none", claimGeneration: 0 }),
        stage: "none",
        claimToken: undefined,
      },
    };
  });
  return Boolean(next);
}

export function clearAsyncWaitJobsForTask(sessionFile: string, taskId: string): number {
  const tid = taskId.trim();
  if (!tid) {
    return 0;
  }
  let n = 0;
  for (const intent of listAsyncWaitJobIntents(sessionFile)) {
    if (intent.taskId === tid && intent.status !== "cleared") {
      if (clearAsyncWaitJobIntent(sessionFile, intent.jobId)) {
        n += 1;
      }
    }
  }
  return n;
}

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

/**
 * Trusted run-liveness: board still bound to this attempt AND embedded run active
 * for the bound session id. Missing session id or inactive registry ⇒ dead claim
 * (recoverable). Never treats turn_bound as permanently unreclaimable.
 */
export function isBoundAsyncWaitRunLive(
  intent: AsyncWaitJobIntent,
  opts?: { isEmbeddedPiRunActive?: (sessionId: string) => boolean },
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
  const sessionId = recovery.boundSessionId?.trim();
  if (!sessionId) {
    return false;
  }
  const active = opts?.isEmbeddedPiRunActive ?? isEmbeddedPiRunActive;
  return active(sessionId);
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
        isBoundAsyncWaitRunLive(current, { isEmbeddedPiRunActive: input.isEmbeddedPiRunActive })
      ) {
        result = { ok: false, reason: "active_exec", intent: current };
        return "keep";
      }
      // Dead claim: allow existing recovery continue path (not delivery-only, not permanent).
      if (recovery.claimToken) {
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
            // Re-open to continue_armed fence so arm can re-enqueue without stage regression refusal.
            stage: "continue_armed",
            lastAttemptAtMs: Date.now(),
          },
        };
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

/** Bind a real followup/agent run id after claimQueuedExecution accepts. */
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
}): AsyncWaitJobIntent | undefined {
  const tid = input.taskId.trim();
  const runId = input.runId.trim();
  if (!tid || !runId) {
    return undefined;
  }
  const jobIdFilter = input.jobId?.trim() || undefined;
  const tokenFilter = input.claimToken?.trim() || undefined;
  // Exclusive bind requires jobId + claimToken under lock — never first-open-by-taskId.
  if (!jobIdFilter || !tokenFilter) {
    return undefined;
  }
  // Refuse if another job already owns this runId.
  for (const other of listAsyncWaitJobIntents(input.sessionFile)) {
    if (
      other.jobId !== jobIdFilter &&
      other.recovery?.boundRunId === runId &&
      other.recovery.stage !== "delivered" &&
      other.status !== "cleared"
    ) {
      return undefined;
    }
  }
  const candidates = listAsyncWaitJobIntents(input.sessionFile).filter((intent) => {
    if (intent.taskId !== tid || intent.status === "cleared") {
      return false;
    }
    if (intent.jobId !== jobIdFilter) {
      return false;
    }
    if (intent.recovery?.claimToken !== tokenFilter) {
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
    return undefined;
  }
  return transitionAsyncWaitJobIntent(input.sessionFile, target.jobId, (current) => {
    if (!current?.recovery?.claimToken) {
      return "keep";
    }
    if (tokenFilter && current.recovery.claimToken !== tokenFilter) {
      return "keep";
    }
    if (current.status === "cleared") {
      return "keep";
    }
    const nextStage = input.deliveryId ? "delivery_pending" : "turn_bound";
    // No stage regression (e.g. delivery_pending must not fall back to turn_bound).
    if (
      asyncWaitRecoveryStageRank(nextStage) < asyncWaitRecoveryStageRank(current.recovery.stage)
    ) {
      return "keep";
    }
    const syncedAttempt = input.executionAttempt?.trim();
    const syncedDeliverable = input.deliverableVersion?.trim();
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
        lastAttemptAtMs: Date.now(),
      },
    };
  });
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

export function clearAsyncWaitJobsForTests(sessionFile: string): void {
  const dir = jobsDir(sessionFile);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
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
