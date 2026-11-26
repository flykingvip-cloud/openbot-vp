/**
 * Durable async-wait job persistence record.
 * Types, validation, v1→v2 normalize, and locked file I/O helpers.
 * Lock scope for transitions remains in async-wait-job.ts (lock-read-judge-write).
 */
import fs from "node:fs";
import path from "node:path";

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

/** Serializable visible payloads retained for delivery-only retry (original result). */
export type AsyncWaitBoundPayload = {
  text?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  replyToId?: string;
  audioAsVoice?: boolean;
  isError?: boolean;
  channelData?: Record<string, unknown>;
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
  /** Process that holds turn_bound through auth/prepare/exec (cross-process liveness). */
  holderPid?: number;
  /** Original visible payloads + version for delivery-only resend (never a placeholder). */
  boundPayloads?: AsyncWaitBoundPayload[];
  boundDeliverableVersion?: string;
  /** Canonical workspace identity from the original run, copied onto delivery-only retries. */
  boundWorkspace?: {
    resourceId: string;
    bindingId: string;
    contentVersion: string;
  };
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
  /** Storage-level monotonic fencing generation (synchronized with recovery.claimGeneration). */
  fencingGeneration?: number;
  recovery?: AsyncWaitRecoveryState;
};

const DIRNAME = "async-wait-jobs";

export function jobsDir(sessionFile: string): string {
  return path.join(path.dirname(path.resolve(sessionFile)), DIRNAME);
}

export function fileFor(sessionFile: string, jobId: string): string {
  return path.join(jobsDir(sessionFile), `${encodeURIComponent(jobId)}.json`);
}

export function validIntent(value: unknown): value is AsyncWaitJobIntent {
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
export function normalizeIntent(row: AsyncWaitJobIntent): AsyncWaitJobIntent {
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

export function readFileUnlocked(filePath: string): AsyncWaitJobIntent | undefined {
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

export function writeFileUnlocked(sessionFile: string, intent: AsyncWaitJobIntent): void {
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
