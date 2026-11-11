/** Execution protocol v1 shared types for the signed isolation profile. */

export const EXEC_API_VERSION = 1;
export const EXEC_API_VERSION_FIELD = "exec-api-version";
export const ISOLATION_PROFILE_NAME = "exec-protocol-v1-isolation";

export const EXEC_ERROR_CODES = [
  "EXEC_VERSION_UNSUPPORTED",
  "EXEC_UNAUTHORIZED",
  "EXEC_REVOKED",
  "EXEC_NOT_FOUND",
  "EXEC_CONFLICT",
  "EXEC_UNREACHABLE",
  "EXEC_CHECKSUM_MISMATCH",
  "EXEC_INTERNAL",
] as const;

export type ExecErrorCode = (typeof EXEC_ERROR_CODES)[number];

export const HTTP_STATUS_BY_ERROR: Record<ExecErrorCode, number> = {
  EXEC_VERSION_UNSUPPORTED: 400,
  EXEC_UNAUTHORIZED: 401,
  EXEC_REVOKED: 403,
  EXEC_NOT_FOUND: 404,
  EXEC_CONFLICT: 409,
  EXEC_UNREACHABLE: 503,
  EXEC_CHECKSUM_MISMATCH: 422,
  EXEC_INTERNAL: 500,
};

export const SUCCESS_HTTP_NEW_ACCEPT = 201;
export const SUCCESS_HTTP_IDEMPOTENT_OR_READ = 200;

export type ExecTaskState =
  | "accepted"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancel_requested"
  | "cancelled"
  | "result_unconfirmed";

export const TERMINAL_STATES: ReadonlySet<ExecTaskState> = new Set([
  "succeeded",
  "failed",
  "cancelled",
]);

export function isTerminalState(state: ExecTaskState): boolean {
  return TERMINAL_STATES.has(state);
}

export type ExecTaskKind =
  | "echo"
  | "sleep"
  | "fail"
  | "side-effect-probe"
  | "corrupt-checksum"
  | "ignore-cancel";

export type ExecInlineJsonInput = {
  kind: "inline-json";
  json: unknown;
  sha256: string;
  byteCount: number;
};

export type ExecInlineBytesInput = {
  kind: "inline-bytes";
  bytesBase64: string;
  sha256: string;
  byteCount: number;
};

export type ExecArtifactInput = {
  kind: "artifact";
  artifactId: string;
};

export type ExecInput = ExecInlineJsonInput | ExecInlineBytesInput | ExecArtifactInput;

export type ExecArtifactRef = {
  artifactId: string;
  sha256: string;
  byteCount: number;
  toolCallId: string;
  taskId: string;
};

export type ExecLeaseRecord = {
  hash: string;
  subject: string;
  tenantId?: string;
  roles?: string[];
  iat: string;
  exp: string;
  iatMs: number;
  expMs: number;
};

export type ExecRevocationScope = {
  tenantId?: string;
  subject?: string;
  taskId?: string;
};

export type ExecRevocation = ExecRevocationScope & {
  revokedAt: string;
  revokedAtMs: number;
};

export type BExecutionOutcome = "produced" | "failed" | "cancelled" | "timeout" | "unconfirmed";

export type ExecTaskRecord = {
  taskId: string;
  toolCallId: string;
  tenantId: string;
  userId?: string;
  agentId?: string;
  subject: string;
  kind: ExecTaskKind;
  idempotencyKey: string;
  intentCanonical: string;
  state: ExecTaskState;
  input: ExecInput;
  createdAt: string;
  updatedAt: string;
  createdAtMs: number;
  updatedAtMs: number;
  idempotencyExpiresAtMs: number;
  artifacts: ExecArtifactRef[];
  errorCode?: ExecErrorCode;
  errorMessage?: string;
  /** A' only: whether a submit was sent to B'. */
  bSubmitAttempted?: boolean;
  /** A' only: whether B' acknowledged the task. */
  bAccepted?: boolean;
  cancelRequestedAtMs?: number;
  executionStartedAtMs?: number;
  sideEffectApplied?: boolean;
  probeId?: string;
  sleepMs?: number;
  bOutcome?: BExecutionOutcome;
  failureReason?: string;
  stateVersion: number;
};

export type ExecSubmitRequest = {
  [EXEC_API_VERSION_FIELD]: typeof EXEC_API_VERSION;
  taskId?: string;
  idempotencyKey: string;
  tenantId: string;
  toolCallId: string;
  kind: ExecTaskKind;
  input: ExecInput;
  userId?: string;
  agentId?: string;
  subject?: string;
  probeId?: string;
  sleepMs?: number;
};

export type ExecStatusRequest = {
  [EXEC_API_VERSION_FIELD]: typeof EXEC_API_VERSION;
  tenantId: string;
  taskId?: string;
  idempotencyKey?: string;
};

export type ExecCancelRequest = {
  [EXEC_API_VERSION_FIELD]: typeof EXEC_API_VERSION;
  tenantId: string;
  taskId: string;
  reason?: string;
};

export type ExecArtifactRequest = {
  [EXEC_API_VERSION_FIELD]: typeof EXEC_API_VERSION;
  tenantId: string;
  taskId: string;
  artifactId: string;
  includeBytes?: boolean;
};

export type ExecUploadArtifactRequest = {
  [EXEC_API_VERSION_FIELD]: typeof EXEC_API_VERSION;
  tenantId: string;
  bytesBase64: string;
  sha256: string;
  byteCount: number;
};

export const EXEC_RECONCILE_CONCLUSIONS = [
  "succeeded",
  "failed",
  "cancelled",
  "remain_unconfirmed",
] as const;

export type ExecReconcileConclusion = (typeof EXEC_RECONCILE_CONCLUSIONS)[number];

/**
 * Operator-visible A→B reconcile sync states.
 * `pending_sync` means A has committed a conclusion ("结论已提交") but B has
 * not confirmed the apply. `synced` means B confirmed ("B 已确认同步").
 * `sync_conflict` is a permanent conflict that requires human attention
 * (`needsHuman`); it is not retried automatically.
 * These are independent of `result_unconfirmed`, which remains the task
 * state until a closing conclusion is committed.
 */
export const EXEC_RECONCILE_SYNC_STATES = ["pending_sync", "synced", "sync_conflict"] as const;

export type ExecReconcileSyncState = (typeof EXEC_RECONCILE_SYNC_STATES)[number];

export type ExecEvidenceRef =
  | {
      kind: "artifact-verified";
      artifactId: string;
      sha256: string;
      byteCount: number;
    }
  | {
      kind: "b-cancelled-confirmed";
    }
  | {
      kind: "b-failed-confirmed";
    }
  | {
      kind: "operator-note";
      note?: string;
    };

export type ExecReconcileRequest = {
  [EXEC_API_VERSION_FIELD]: typeof EXEC_API_VERSION;
  tenantId: string;
  taskId: string;
  expectedStateVersion: number;
  reconcileRequestId: string;
  conclusion: ExecReconcileConclusion;
  reason: string;
  evidenceRef: ExecEvidenceRef;
};

/**
 * Durable A-side record of a committed reconcile conclusion that must be
 * applied on B. A.stateVersion and B.stateVersion are independently owned
 * and must never be compared to each other. `aStateVersionAtCommit` is
 * recorded for audit only. `requestExpectedStateVersion` is the original
 * A-side CAS identity of the operator request, not a CAS key on B.
 */
export type ExecReconcileSyncRecord = {
  tenantId: string;
  taskId: string;
  reconcileRequestId: string;
  conclusion: ExecReconcileConclusion;
  conclusionDigest: string;
  syncState: ExecReconcileSyncState;
  aStateVersionAtCommit: number;
  requestExpectedStateVersion: number;
  previousAState: ExecTaskState;
  newAState: ExecTaskState;
  applyPayload: ExecReconcileRequest;
  attemptCount: number;
  committedAt: string;
  committedAtMs: number;
  lastAttemptAtMs?: number;
  lastErrorCode?: ExecErrorCode;
  lastErrorMessage?: string;
  syncedAt?: string;
  syncedAtMs?: number;
  conflictReason?: string;
  needsHuman: boolean;
};

export type ExecReconcileAudit = {
  taskId: string;
  tenantId: string;
  operator: string;
  at: string;
  atMs: number;
  previousState: ExecTaskState;
  newState: ExecTaskState;
  conclusion: ExecReconcileConclusion;
  reason: string;
  evidenceRef: ExecEvidenceRef;
  reconcileRequestId: string;
  previousStateVersion: number;
  newStateVersion: number;
};

export type ExecReconcileResponse = ExecTaskResponse & {
  reconcileRequestId: string;
  operator: string;
  reconciledAt: string;
  previousState: ExecTaskState;
  newState: ExecTaskState;
  conclusion: ExecReconcileConclusion;
  reason: string;
  conclusionDigest: string;
  reconcileSyncState: ExecReconcileSyncState;
  conclusionCommitted: boolean;
  bSyncConfirmed: boolean;
  needsHuman: boolean;
};

export type ExecRevokeRequest = {
  [EXEC_API_VERSION_FIELD]: typeof EXEC_API_VERSION;
  tenantId?: string;
  subject?: string;
  taskId?: string;
};

export type ExecTaskResponse = {
  [EXEC_API_VERSION_FIELD]: typeof EXEC_API_VERSION;
  taskId: string;
  toolCallId: string;
  tenantId: string;
  state: ExecTaskState;
  artifacts: ExecArtifactRef[];
  createdAt: string;
  updatedAt: string;
  errorCode?: ExecErrorCode;
  errorMessage?: string;
  bOutcome?: BExecutionOutcome;
  stateVersion: number;
  sideEffectApplied?: boolean;
  /**
   * A-side operator visibility. Absent when no reconcile conclusion has
   * been committed yet. `conclusionCommitted` is not the same as
   * `bSyncConfirmed`.
   */
  reconcileRequestId?: string;
  conclusionDigest?: string;
  reconcileSyncState?: ExecReconcileSyncState;
  conclusionCommitted?: boolean;
  bSyncConfirmed?: boolean;
  needsHuman?: boolean;
};

export type ExecArtifactResponse = {
  [EXEC_API_VERSION_FIELD]: typeof EXEC_API_VERSION;
  taskId: string;
  toolCallId: string;
  artifactId: string;
  sha256: string;
  byteCount: number;
  bytesBase64?: string;
  delivered: boolean;
};

export type ExecErrorResponse = {
  [EXEC_API_VERSION_FIELD]: typeof EXEC_API_VERSION;
  error: {
    code: ExecErrorCode;
    message: string;
  };
  taskId?: string;
  state?: ExecTaskState;
};

export type HostCommandProbe = {
  calls: Array<{ reason: string; atMs: number; taskId?: string }>;
  attempt: (reason: string, taskId?: string) => void;
};

export const ROLE_CONTROL_PLANE = "control-plane";
export const ROLE_EXECUTION_SITE = "execution-site";

export type ExecSiteDebug = {
  role: typeof ROLE_CONTROL_PLANE | typeof ROLE_EXECUTION_SITE;
  executionsStarted: number;
  hostCommands: number;
  probes: Record<string, number>;
};
