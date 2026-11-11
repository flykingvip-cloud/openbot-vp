import { sha256Of } from "./checksum.js";
import type { ExecProtocolConfig } from "./config.js";
import { ExecProtocolError } from "./errors.js";
import { reconcileTransition } from "./state-machine.js";
import {
  EXEC_API_VERSION,
  EXEC_API_VERSION_FIELD,
  EXEC_RECONCILE_CONCLUSIONS,
  type ExecEvidenceRef,
  type ExecReconcileAudit,
  type ExecReconcileConclusion,
  type ExecReconcileRequest,
  type ExecReconcileResponse,
  type ExecReconcileSyncRecord,
  type ExecTaskRecord,
  type ExecTaskResponse,
  type ExecTaskState,
} from "./types.js";

export type ParsedReconcileRequest = ExecReconcileRequest;

function requireString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ExecProtocolError("EXEC_INTERNAL", `missing required field ${field}`);
  }
  return value;
}

export function assertReconcileRequestId(
  value: unknown,
  config: Pick<
    ExecProtocolConfig,
    "idempotencyKeyMinLength" | "idempotencyKeyMaxLength" | "idempotencyKeyPattern"
  >,
): string {
  if (typeof value !== "string") {
    throw new ExecProtocolError("EXEC_CONFLICT", "reconcileRequestId is required");
  }
  if (
    value.length < config.idempotencyKeyMinLength ||
    value.length > config.idempotencyKeyMaxLength
  ) {
    throw new ExecProtocolError(
      "EXEC_CONFLICT",
      `reconcileRequestId length must be ${config.idempotencyKeyMinLength}-${config.idempotencyKeyMaxLength}`,
    );
  }
  if (!new RegExp(config.idempotencyKeyPattern).test(value)) {
    throw new ExecProtocolError(
      "EXEC_CONFLICT",
      "reconcileRequestId must use charset [A-Za-z0-9._:-]",
    );
  }
  return value;
}

function parseEvidenceRef(raw: unknown): ExecEvidenceRef {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ExecProtocolError("EXEC_INTERNAL", "missing required field evidenceRef");
  }
  const value = raw as Record<string, unknown>;
  const kind = value.kind;
  if (kind === "artifact-verified") {
    const artifactId = value.artifactId;
    const sha256 = value.sha256;
    const byteCount = value.byteCount;
    if (typeof artifactId !== "string" || artifactId.length === 0) {
      throw new ExecProtocolError("EXEC_INTERNAL", "evidenceRef.artifactId is required");
    }
    if (typeof sha256 !== "string" || sha256.length === 0) {
      throw new ExecProtocolError("EXEC_INTERNAL", "evidenceRef.sha256 is required");
    }
    if (typeof byteCount !== "number" || !Number.isInteger(byteCount) || byteCount < 0) {
      throw new ExecProtocolError(
        "EXEC_INTERNAL",
        "evidenceRef.byteCount must be a non-negative integer",
      );
    }
    return { kind, artifactId, sha256, byteCount };
  }
  if (kind === "b-cancelled-confirmed" || kind === "b-failed-confirmed") {
    return { kind };
  }
  if (kind === "operator-note") {
    if (value.note !== undefined && typeof value.note !== "string") {
      throw new ExecProtocolError("EXEC_INTERNAL", "evidenceRef.note must be a string");
    }
    return { kind, note: typeof value.note === "string" ? value.note : undefined };
  }
  throw new ExecProtocolError("EXEC_CONFLICT", "unsupported evidenceRef.kind");
}

function assertEvidenceMatchesConclusion(
  conclusion: ExecReconcileConclusion,
  evidenceRef: ExecEvidenceRef,
): void {
  if (conclusion === "succeeded" && evidenceRef.kind !== "artifact-verified") {
    throw new ExecProtocolError(
      "EXEC_CONFLICT",
      "succeeded requires evidenceRef.kind artifact-verified",
    );
  }
  if (conclusion === "cancelled" && evidenceRef.kind !== "b-cancelled-confirmed") {
    throw new ExecProtocolError(
      "EXEC_CONFLICT",
      "cancelled requires evidenceRef.kind b-cancelled-confirmed",
    );
  }
  if (conclusion === "failed" && evidenceRef.kind !== "b-failed-confirmed") {
    throw new ExecProtocolError(
      "EXEC_CONFLICT",
      "failed requires evidenceRef.kind b-failed-confirmed",
    );
  }
  if (conclusion === "remain_unconfirmed" && evidenceRef.kind !== "operator-note") {
    throw new ExecProtocolError(
      "EXEC_CONFLICT",
      "remain_unconfirmed requires evidenceRef.kind operator-note",
    );
  }
}

/**
 * Stable digest of a reconcile conclusion identity: taskId + conclusion +
 * evidence key. Used together with reconcileRequestId for B-side idempotency.
 * A.stateVersion / expectedStateVersion and operator reason are intentionally
 * excluded so A and B versions are never part of the identity comparison.
 */
export function conclusionDigest(params: {
  taskId: string;
  conclusion: string;
  evidenceKey: string;
}): string {
  return sha256Of(
    Buffer.from(
      JSON.stringify({
        taskId: params.taskId,
        conclusion: params.conclusion,
        evidenceKey: params.evidenceKey,
      }),
      "utf8",
    ),
  );
}

export function digestForReconcileRequest(request: {
  taskId: string;
  conclusion: string;
  evidenceRef: ExecEvidenceRef;
}): string {
  return conclusionDigest({
    taskId: request.taskId,
    conclusion: request.conclusion,
    evidenceKey: evidenceKey(request.evidenceRef),
  });
}

export function evidenceKey(evidenceRef: ExecEvidenceRef): string {
  if (evidenceRef.kind === "artifact-verified") {
    return JSON.stringify({
      kind: evidenceRef.kind,
      artifactId: evidenceRef.artifactId,
      sha256: evidenceRef.sha256,
      byteCount: evidenceRef.byteCount,
    });
  }
  if (evidenceRef.kind === "operator-note") {
    return JSON.stringify({ kind: evidenceRef.kind, note: evidenceRef.note ?? null });
  }
  return JSON.stringify({ kind: evidenceRef.kind });
}

export function parseReconcileRequest(
  payload: Record<string, unknown>,
  config: Pick<
    ExecProtocolConfig,
    "idempotencyKeyMinLength" | "idempotencyKeyMaxLength" | "idempotencyKeyPattern"
  >,
): ParsedReconcileRequest {
  const tenantId = requireString(payload, "tenantId");
  const taskId = requireString(payload, "taskId");
  const expectedStateVersion = payload.expectedStateVersion;
  if (
    typeof expectedStateVersion !== "number" ||
    !Number.isInteger(expectedStateVersion) ||
    expectedStateVersion <= 0
  ) {
    throw new ExecProtocolError("EXEC_INTERNAL", "expectedStateVersion must be a positive integer");
  }
  const reconcileRequestId = assertReconcileRequestId(payload.reconcileRequestId, config);
  const conclusionRaw = requireString(payload, "conclusion");
  if (!EXEC_RECONCILE_CONCLUSIONS.includes(conclusionRaw as ExecReconcileConclusion)) {
    throw new ExecProtocolError("EXEC_CONFLICT", "unsupported reconcile conclusion");
  }
  const conclusion = conclusionRaw as ExecReconcileConclusion;
  const reason = requireString(payload, "reason");
  if (reason.length > 512) {
    throw new ExecProtocolError("EXEC_INTERNAL", "reason must be 1-512 characters");
  }
  const evidenceRef = parseEvidenceRef(payload.evidenceRef);
  assertEvidenceMatchesConclusion(conclusion, evidenceRef);
  return {
    [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
    tenantId,
    taskId,
    expectedStateVersion,
    reconcileRequestId,
    conclusion,
    reason,
    evidenceRef,
  };
}

export function assertIdenticalReconcileReplay(params: {
  stored: {
    taskId: string;
    conclusion: string;
    expectedStateVersion: number;
    evidenceKey: string;
  };
  request: ParsedReconcileRequest;
}): void {
  const same =
    params.stored.taskId === params.request.taskId &&
    params.stored.conclusion === params.request.conclusion &&
    params.stored.expectedStateVersion === params.request.expectedStateVersion &&
    params.stored.evidenceKey === evidenceKey(params.request.evidenceRef);
  if (!same) {
    throw new ExecProtocolError(
      "EXEC_CONFLICT",
      "reconcileRequestId reused with conflicting fields",
      { taskId: params.request.taskId },
    );
  }
}

/**
 * B-side apply identity: same reconcileRequestId + same conclusion digest is
 * idempotent. A expectedStateVersion is not compared to B.stateVersion.
 */
export function assertIdenticalApplyReplay(params: {
  stored: { taskId: string; conclusionDigest: string };
  request: { taskId: string; conclusionDigest: string };
}): void {
  if (
    params.stored.taskId !== params.request.taskId ||
    params.stored.conclusionDigest !== params.request.conclusionDigest
  ) {
    throw new ExecProtocolError(
      "EXEC_CONFLICT",
      "reconcileRequestId reused with a conflicting conclusion digest",
      { taskId: params.request.taskId },
    );
  }
}

export function isPermanentReconcileSyncFailure(error: unknown): boolean {
  if (!(error instanceof ExecProtocolError)) {
    return false;
  }
  return (
    error.code === "EXEC_CONFLICT" ||
    error.code === "EXEC_CHECKSUM_MISMATCH" ||
    error.code === "EXEC_UNAUTHORIZED" ||
    error.code === "EXEC_REVOKED" ||
    error.code === "EXEC_VERSION_UNSUPPORTED"
  );
}

export function toSyncOperatorFields(sync: ExecReconcileSyncRecord | undefined): {
  reconcileRequestId?: string;
  conclusionDigest?: string;
  reconcileSyncState?: ExecReconcileSyncRecord["syncState"];
  conclusionCommitted?: boolean;
  bSyncConfirmed?: boolean;
  needsHuman?: boolean;
} {
  if (!sync) {
    return { conclusionCommitted: false, bSyncConfirmed: false, needsHuman: false };
  }
  return {
    reconcileRequestId: sync.reconcileRequestId,
    conclusionDigest: sync.conclusionDigest,
    reconcileSyncState: sync.syncState,
    conclusionCommitted: true,
    bSyncConfirmed: sync.syncState === "synced",
    needsHuman: sync.syncState === "sync_conflict" || sync.needsHuman,
  };
}

export function withTaskSyncStatus<T extends ExecTaskResponse>(
  task: T,
  sync: ExecReconcileSyncRecord | undefined,
): T {
  return { ...task, ...toSyncOperatorFields(sync) };
}

export function isClosingReconcileConclusion(conclusion: string): boolean {
  return conclusion === "succeeded" || conclusion === "failed" || conclusion === "cancelled";
}

export function nextReconcileState(
  from: ExecTaskState,
  conclusion: ExecReconcileConclusion,
  taskId?: string,
): ExecTaskState {
  return reconcileTransition(from, conclusion, { taskId });
}

export function toReconcileResponse(params: {
  task: ExecTaskRecord;
  audit: Pick<
    ExecReconcileAudit,
    | "reconcileRequestId"
    | "operator"
    | "at"
    | "previousState"
    | "newState"
    | "conclusion"
    | "reason"
  >;
  sync?: ExecReconcileSyncRecord;
  conclusionDigest?: string;
  applyConfirmed?: boolean;
}): ExecReconcileResponse {
  const fields = toSyncOperatorFields(params.sync);
  const digest = params.conclusionDigest ?? params.sync?.conclusionDigest ?? "";
  const synced = params.applyConfirmed === true || fields.bSyncConfirmed === true;
  return {
    [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
    taskId: params.task.taskId,
    toolCallId: params.task.toolCallId,
    tenantId: params.task.tenantId,
    state: params.task.state,
    artifacts: params.task.artifacts,
    createdAt: params.task.createdAt,
    updatedAt: params.task.updatedAt,
    errorCode: params.task.errorCode,
    errorMessage: params.task.errorMessage,
    bOutcome: params.task.bOutcome,
    stateVersion: params.task.stateVersion ?? 0,
    reconcileRequestId: params.audit.reconcileRequestId,
    operator: params.audit.operator,
    reconciledAt: params.audit.at,
    previousState: params.audit.previousState,
    newState: params.audit.newState,
    conclusion: params.audit.conclusion,
    reason: params.audit.reason,
    conclusionDigest: digest,
    reconcileSyncState:
      fields.reconcileSyncState ?? (params.applyConfirmed ? "synced" : "pending_sync"),
    conclusionCommitted: Boolean(params.sync) || params.applyConfirmed === true,
    bSyncConfirmed: synced,
    needsHuman: fields.needsHuman === true,
  };
}

export function hasPersistedCancelledConfirmation(task: ExecTaskRecord): boolean {
  return task.bOutcome === "cancelled";
}

export function hasPersistedFailedConfirmation(task: ExecTaskRecord): boolean {
  return task.bOutcome === "failed" || task.bOutcome === "timeout";
}

export function isFailedOrTimeoutState(state: ExecTaskState, bOutcome?: string): boolean {
  return state === "failed" || bOutcome === "failed" || bOutcome === "timeout";
}
