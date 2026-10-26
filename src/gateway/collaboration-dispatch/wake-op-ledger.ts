/**
 * U3 — durable wake-op idempotency + resume ledger.
 *
 * Idempotency key scope (stable "same operation"):
 *   groupId | source | taskId | itemId | fromAgentId | sorted(toAgentIds)
 * Explicit `opKey` on the request overrides the derived key.
 * `reason` / `relatedId` are intentionally excluded (retry reason / result id).
 *
 * Persistent processing states (file under `<ns>/wake-ops/`, not memory):
 *   accepted → running → completed | failed | unknown
 *
 * Retry policy:
 *   - completed: reuse result; never re-dispatch
 *   - running / unknown / accepted: do not blind re-run
 *   - failed: retry allowed after U1 stop + U2 auth recheck
 *   - releaseWakeOpForRetry: unknown→failed only when trusted runtime operator passes
 *     release_for_retry Gate (≠ canRequestTaskStop), externalEffectVerified==="none"
 *     bound to a verifiable check record, and no prior/late receipt on the ledger.
 *     Refuses running/accepted. Does not dispatch.
 *   - confirmWakeOpCompleted: unknown→completed only when trusted runtime operator
 *     passes confirm_completed Gate (≠ stop/release), params.roundId matches prior
 *     ledger receipt; verbal/unmatched stay unknown (no auto-rerun).
 *
 * Memory-only dedup is forbidden as the sole proof of correctness.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../../config/types.js";
import { withRoundLock, writeJsonDurable } from "./round-store-io.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import { assertCollaborationRuntimeWritable } from "./runtime-namespace.js";
import {
  canConfirmWakeOpCompleted,
  canReleaseWakeOpForRetry,
  resolveTrustedWakeOpOperator,
  validateExternalEffectNoneCheck,
  type ExternalEffectCheckRecord,
  type TrustedWakeOpOperator,
  type WakeOpRecoveryAuthState,
} from "./wake-op-recovery-gate.js";

export type {
  ExternalEffectCheckRecord,
  TrustedWakeOpOperator,
  WakeOpRecoveryAction,
  WakeOpRecoveryAuthState,
} from "./wake-op-recovery-gate.js";
export {
  canConfirmWakeOpCompleted,
  canPerformWakeOpRecovery,
  canReleaseWakeOpForRetry,
  EXTERNAL_EFFECT_CHECK_MAX_AGE_MS,
  isActiveRecoveryIdentity,
  resolveTrustedWakeOpOperator,
  validateExternalEffectNoneCheck,
} from "./wake-op-recovery-gate.js";
export const WAKE_OP_PROCESSING_STATUSES = [
  "accepted",
  "running",
  "completed",
  "failed",
  "unknown",
] as const;

export type WakeOpProcessingStatus = (typeof WAKE_OP_PROCESSING_STATUSES)[number];

export type WakeOpRecord = Readonly<{
  opKey: string;
  groupId: string;
  source: string;
  taskId?: string;
  itemId?: string;
  fromAgentId: string;
  toAgentIds: readonly string[];
  status: WakeOpProcessingStatus;
  roundId?: string;
  detail?: string;
  /** Audit: who released unknown→failed (resume) — trusted runtime actor. */
  releasedBy?: string;
  /** Audit: required "none" proof when released. */
  externalEffectVerified?: "none";
  /** Verifiable check record bound to externalEffectVerified:"none". */
  externalEffectCheck?: ExternalEffectCheckRecord;
  /** Audit: who confirmed unknown→completed from a prior receipt. */
  confirmedBy?: string;
  createdAtMs: number;
  updatedAtMs: number;
}>;

export type WakeOpKeyInput = Readonly<{
  groupId: string;
  source: string;
  fromAgentId: string;
  toAgentIds: readonly string[];
  taskId?: string | null;
  itemId?: string | null;
  /** Explicit override; when set, becomes the sole key material. */
  opKey?: string | null;
}>;

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** Stable idempotency key for one wake operation. */
export function wakeOpIdempotencyKey(input: WakeOpKeyInput): string {
  const explicit = compact(input.opKey);
  if (explicit) {
    return explicit;
  }
  const to = input.toAgentIds
    .map((id) => compact(id))
    .filter(Boolean)
    .toSorted();
  return [
    compact(input.groupId),
    compact(input.source),
    compact(input.taskId),
    compact(input.itemId),
    compact(input.fromAgentId),
    to.join(","),
  ].join("|");
}

export function wakeOpsDir(authority: RuntimeAuthority): string {
  return path.join(authority.namespace.root, "wake-ops");
}

function wakeOpFile(ledgerDir: string, opKey: string): string {
  const digest = createHash("sha256").update(opKey).digest("hex");
  return path.join(ledgerDir, `${digest}.json`);
}

function lockStem(opKey: string): string {
  return createHash("sha256").update(opKey).digest("hex").slice(0, 32);
}

type WakeOpFileRead =
  | { state: "missing" }
  | { state: "ok"; record: WakeOpRecord }
  | { state: "corrupt"; detail: string };

/**
 * Distinguish missing vs corrupt. Corrupt must not be treated as absent
 * (B: no silent overwrite of damaged state).
 */
async function readWakeOpFile(file: string): Promise<WakeOpFileRead> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { state: "missing" };
    }
    return { state: "corrupt", detail: `read_error:${(error as Error).message ?? "unknown"}` };
  }
  if (!raw.trim()) {
    return { state: "corrupt", detail: "empty_file" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    return { state: "corrupt", detail: `json_parse:${(error as Error).message ?? "invalid"}` };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as WakeOpRecord).opKey !== "string" ||
    typeof (parsed as WakeOpRecord).status !== "string" ||
    !(WAKE_OP_PROCESSING_STATUSES as readonly string[]).includes((parsed as WakeOpRecord).status)
  ) {
    return { state: "corrupt", detail: "invalid_shape" };
  }
  return { state: "ok", record: parsed as WakeOpRecord };
}

async function readJsonFile(file: string): Promise<WakeOpRecord | null> {
  const result = await readWakeOpFile(file);
  return result.state === "ok" ? result.record : null;
}

/** Absolute path of the durable wake-op record file (tests / recovery tooling). */
export function wakeOpRecordPath(authority: RuntimeAuthority, opKey: string): string {
  return wakeOpFile(wakeOpsDir(authority), compact(opKey));
}

export async function readWakeOpRecord(params: {
  authority: RuntimeAuthority;
  opKey: string;
  cfg?: OpenBotConfig;
}): Promise<WakeOpRecord | null> {
  const opKey = compact(params.opKey);
  if (!opKey) {
    return null;
  }
  const dir = wakeOpsDir(params.authority);
  return readJsonFile(wakeOpFile(dir, opKey));
}

/** Detailed read for recovery: missing vs ok vs corrupt. */
export async function readWakeOpRecordDetailed(params: {
  authority: RuntimeAuthority;
  opKey: string;
}): Promise<WakeOpFileRead> {
  const opKey = compact(params.opKey);
  if (!opKey) {
    return { state: "missing" };
  }
  return readWakeOpFile(wakeOpFile(wakeOpsDir(params.authority), opKey));
}

export type InspectWakeOpResult =
  | { action: "proceed"; opKey: string; record: WakeOpRecord | null }
  | { action: "reuse"; opKey: string; record: WakeOpRecord }
  | {
      action: "suppress";
      opKey: string;
      record: WakeOpRecord | null;
      reason: "wake_op_in_flight" | "wake_op_unknown" | "wake_op_corrupt";
    };

/**
 * Read-only decision before stop/auth/dispatch. Does not claim.
 * completed → reuse; running|accepted → in_flight; unknown → unknown; failed|absent → proceed.
 */
export async function inspectWakeOp(params: {
  authority: RuntimeAuthority;
  keyInput: WakeOpKeyInput;
}): Promise<InspectWakeOpResult> {
  const opKey = wakeOpIdempotencyKey(params.keyInput);
  if (!opKey) {
    return { action: "proceed", opKey: "missing", record: null };
  }
  const detailed = await readWakeOpRecordDetailed({ authority: params.authority, opKey });
  if (detailed.state === "corrupt") {
    return { action: "suppress", opKey, record: null, reason: "wake_op_corrupt" };
  }
  if (detailed.state === "missing") {
    return { action: "proceed", opKey, record: null };
  }
  const existing = detailed.record;
  if (existing.status === "completed") {
    return { action: "reuse", opKey, record: existing };
  }
  if (existing.status === "failed") {
    return { action: "proceed", opKey, record: existing };
  }
  if (existing.status === "unknown") {
    return { action: "suppress", opKey, record: existing, reason: "wake_op_unknown" };
  }
  return { action: "suppress", opKey, record: existing, reason: "wake_op_in_flight" };
}

/**
 * CAS-claim running after stop+auth passed. Concurrent second claim → suppress.
 */
export async function claimWakeOpRunning(params: {
  authority: RuntimeAuthority;
  keyInput: WakeOpKeyInput;
  cfg?: OpenBotConfig;
  nowMs?: number;
}): Promise<InspectWakeOpResult> {
  const opKey = wakeOpIdempotencyKey(params.keyInput);
  if (!opKey || !compact(params.keyInput.groupId)) {
    return { action: "proceed", opKey: opKey || "missing", record: null };
  }

  const dir = wakeOpsDir(params.authority);
  assertCollaborationRuntimeWritable(dir, params.cfg);
  await fs.mkdir(dir, { recursive: true });
  const file = wakeOpFile(dir, opKey);
  const nowMs = params.nowMs ?? Date.now();
  const toAgentIds = params.keyInput.toAgentIds.map((id) => compact(id)).filter(Boolean);

  return withRoundLock(dir, lockStem(opKey), async () => {
    const read = await readWakeOpFile(file);
    if (read.state === "corrupt") {
      // B: refuse to silently overwrite damaged state.
      return { action: "suppress", opKey, record: null, reason: "wake_op_corrupt" };
    }
    if (read.state === "ok") {
      const existing = read.record;
      if (existing.status === "completed") {
        return { action: "reuse", opKey, record: existing };
      }
      if (existing.status === "failed") {
        const next: WakeOpRecord = {
          ...existing,
          status: "running",
          detail: "retry_after_failed",
          updatedAtMs: nowMs,
          roundId: undefined,
        };
        await writeJsonDurable(file, next);
        return { action: "proceed", opKey, record: next };
      }
      if (existing.status === "unknown") {
        return { action: "suppress", opKey, record: existing, reason: "wake_op_unknown" };
      }
      return { action: "suppress", opKey, record: existing, reason: "wake_op_in_flight" };
    }

    const record: WakeOpRecord = {
      opKey,
      groupId: compact(params.keyInput.groupId),
      source: compact(params.keyInput.source),
      ...(compact(params.keyInput.taskId) ? { taskId: compact(params.keyInput.taskId) } : {}),
      ...(compact(params.keyInput.itemId) ? { itemId: compact(params.keyInput.itemId) } : {}),
      fromAgentId: compact(params.keyInput.fromAgentId),
      toAgentIds,
      status: "running",
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    };
    await writeJsonDurable(file, record);
    return { action: "proceed", opKey, record };
  });
}

async function updateWakeOp(
  params: {
    authority: RuntimeAuthority;
    opKey: string;
    cfg?: OpenBotConfig;
    nowMs?: number;
  },
  mutator: (current: WakeOpRecord | null) => WakeOpRecord | null,
): Promise<WakeOpRecord | null> {
  const opKey = compact(params.opKey);
  if (!opKey) {
    return null;
  }
  const dir = wakeOpsDir(params.authority);
  assertCollaborationRuntimeWritable(dir, params.cfg);
  await fs.mkdir(dir, { recursive: true });
  const file = wakeOpFile(dir, opKey);
  return withRoundLock(dir, lockStem(opKey), async () => {
    const read = await readWakeOpFile(file);
    if (read.state === "corrupt") {
      // B: do not invent a replacement over damaged bytes.
      return null;
    }
    const current = read.state === "ok" ? read.record : null;
    const next = mutator(current);
    if (!next) {
      return current;
    }
    await writeJsonDurable(file, next);
    return next;
  });
}

export async function markWakeOpCompleted(params: {
  authority: RuntimeAuthority;
  opKey: string;
  roundId: string;
  cfg?: OpenBotConfig;
  nowMs?: number;
  detail?: string;
}): Promise<WakeOpRecord | null> {
  const roundId = compact(params.roundId);
  const nowMs = params.nowMs ?? Date.now();
  return updateWakeOp(params, (current) => {
    if (!current) {
      return {
        opKey: params.opKey,
        groupId: "",
        source: "",
        fromAgentId: "",
        toAgentIds: [],
        status: "completed",
        roundId,
        detail: params.detail,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
      };
    }
    return {
      ...current,
      status: "completed",
      roundId,
      detail: params.detail ?? current.detail,
      updatedAtMs: nowMs,
    };
  });
}

export async function markWakeOpFailed(params: {
  authority: RuntimeAuthority;
  opKey: string;
  cfg?: OpenBotConfig;
  nowMs?: number;
  detail?: string;
}): Promise<WakeOpRecord | null> {
  const nowMs = params.nowMs ?? Date.now();
  return updateWakeOp(params, (current) => {
    if (!current) {
      return null;
    }
    return {
      ...current,
      status: "failed",
      detail: params.detail ?? current.detail,
      updatedAtMs: nowMs,
      roundId: undefined,
    };
  });
}

/**
 * Execution may have happened but receipt was not written — do not blind re-run.
 */
export async function markWakeOpUnknown(params: {
  authority: RuntimeAuthority;
  opKey: string;
  cfg?: OpenBotConfig;
  nowMs?: number;
  detail?: string;
}): Promise<WakeOpRecord | null> {
  const nowMs = params.nowMs ?? Date.now();
  return updateWakeOp(params, (current) => {
    if (!current) {
      return null;
    }
    return {
      ...current,
      status: "unknown",
      detail: params.detail ?? "execution_uncertain",
      updatedAtMs: nowMs,
    };
  });
}

export type ReleaseWakeOpResult =
  | { ok: true; record: WakeOpRecord }
  | { ok: false; reason: string };

export type ConfirmWakeOpResult =
  | { ok: true; record: WakeOpRecord }
  | { ok: false; reason: string };

/**
 * Explicit resume recovery: unknown → failed so a later consume may retry.
 * C1: trusted runtime operator + release_for_retry Gate (≠ canRequestTaskStop).
 * C2: externalEffectVerified:"none" must bind externalEffectCheck (source/op/time).
 * Late receipt: completed or prior roundId on ledger → refuse (re-check; use confirm).
 * Caller must still recheck U1 stop + U2 auth on the subsequent consume.
 * Does not itself dispatch.
 */
export async function releaseWakeOpForRetry(params: {
  authority: RuntimeAuthority;
  opKey: string;
  cfg?: OpenBotConfig;
  nowMs?: number;
  detail?: string;
  /** Only allowed value: must match externalEffectCheck.outcome. */
  externalEffectVerified: "none";
  /** Verifiable check record bound to the "none" claim. */
  externalEffectCheck: ExternalEffectCheckRecord;
  /** Trusted runtime identity for the operator (not a free-form claim). */
  operator: TrustedWakeOpOperator;
  /** Current tenant/group operating state for Gate. */
  operatingState: WakeOpRecoveryAuthState;
}): Promise<ReleaseWakeOpResult> {
  const opKey = compact(params.opKey);
  if (!opKey) {
    return { ok: false, reason: "missing_op_key" };
  }
  const trusted = resolveTrustedWakeOpOperator(params.operator);
  if (!trusted.ok) {
    return trusted;
  }
  const releasedBy = trusted.actorId;
  if (!canReleaseWakeOpForRetry({ actorId: releasedBy, operatingState: params.operatingState })) {
    return { ok: false, reason: "release_forbidden" };
  }
  if (params.externalEffectVerified !== "none") {
    return { ok: false, reason: "external_effect_not_verified" };
  }
  const nowMs = params.nowMs ?? Date.now();
  const check = validateExternalEffectNoneCheck({
    opKey,
    check: params.externalEffectCheck,
    nowMs,
  });
  if (!check.ok) {
    return check;
  }
  const updated = await updateWakeOp(params, (current) => {
    if (!current) {
      return null;
    }
    // Late receipt: completion appeared after evidence collection — do not retry.
    if (current.status === "completed") {
      return current;
    }
    // Refuse running/accepted: releasing while old may still run would grant
    // dual write eligibility. Operator must verify effect, keep/mark unknown,
    // then release only from unknown with externalEffectVerified none.
    if (current.status !== "unknown") {
      return current;
    }
    // Prior/late receipt on ledger → re-check; confirm path, not blind release.
    if (compact(current.roundId)) {
      return current;
    }
    return {
      ...current,
      status: "failed",
      detail: params.detail ?? "released_for_retry",
      releasedBy,
      externalEffectVerified: "none",
      externalEffectCheck: check.check,
      updatedAtMs: nowMs,
      roundId: undefined,
    };
  });
  if (!updated) {
    return { ok: false, reason: "missing_record" };
  }
  if (updated.status === "completed") {
    return { ok: false, reason: "late_receipt_completed" };
  }
  if (updated.status === "running") {
    return { ok: false, reason: "status_running_keep_or_mark_unknown" };
  }
  if (updated.status === "accepted") {
    return { ok: false, reason: "status_accepted_in_flight" };
  }
  if (updated.status === "unknown" && compact(updated.roundId)) {
    return { ok: false, reason: "prior_receipt_recheck_use_confirm" };
  }
  if (updated.status !== "failed") {
    return { ok: false, reason: `status_${updated.status}` };
  }
  if (
    updated.releasedBy !== releasedBy ||
    updated.externalEffectVerified !== "none" ||
    !updated.externalEffectCheck ||
    updated.externalEffectCheck.opId !== check.check.opId
  ) {
    return { ok: false, reason: "release_audit_incomplete" };
  }
  return { ok: true, record: updated };
}

/**
 * Promote unknown → completed only from a verifiable prior receipt on the ledger
 * (existing.roundId must match params.roundId). Verbal / unmatched stay unknown
 * (no auto-rerun). C1: trusted runtime operator + confirm_completed Gate
 * (≠ stop / release). Does not invent completed without receipt evidence.
 */
export async function confirmWakeOpCompleted(params: {
  authority: RuntimeAuthority;
  opKey: string;
  roundId: string;
  cfg?: OpenBotConfig;
  nowMs?: number;
  detail?: string;
  /** Trusted runtime identity for the confirmer. */
  operator: TrustedWakeOpOperator;
  /** Current tenant/group operating state for Gate. */
  operatingState: WakeOpRecoveryAuthState;
  /** Task-scoped approvers; confirm requires membership in this list. */
  taskApproverIds?: readonly string[] | null;
}): Promise<ConfirmWakeOpResult> {
  const opKey = compact(params.opKey);
  const roundId = compact(params.roundId);
  if (!opKey) {
    return { ok: false, reason: "missing_op_key" };
  }
  if (!roundId) {
    return { ok: false, reason: "missing_round_id" };
  }
  const trusted = resolveTrustedWakeOpOperator(params.operator);
  if (!trusted.ok) {
    return trusted;
  }
  const confirmedBy = trusted.actorId;
  if (
    !canConfirmWakeOpCompleted({
      actorId: confirmedBy,
      operatingState: params.operatingState,
      taskApproverIds: params.taskApproverIds,
    })
  ) {
    return { ok: false, reason: "confirm_forbidden" };
  }
  const nowMs = params.nowMs ?? Date.now();
  const updated = await updateWakeOp(
    { authority: params.authority, opKey, cfg: params.cfg, nowMs },
    (current) => {
      if (!current) {
        return null;
      }
      if (current.status !== "unknown") {
        return current;
      }
      const prior = compact(current.roundId);
      if (!prior || prior !== roundId) {
        return current;
      }
      return {
        ...current,
        status: "completed",
        roundId,
        detail: params.detail ?? "confirmed_completed",
        confirmedBy,
        updatedAtMs: nowMs,
      };
    },
  );
  if (!updated) {
    return { ok: false, reason: "missing_record" };
  }
  if (updated.status !== "completed") {
    if (updated.status !== "unknown") {
      return { ok: false, reason: `status_${updated.status}` };
    }
    const prior = compact(updated.roundId);
    if (!prior) {
      return { ok: false, reason: "no_prior_receipt_on_ledger" };
    }
    if (prior !== roundId) {
      return { ok: false, reason: "round_id_mismatch" };
    }
    return { ok: false, reason: "confirm_refused" };
  }
  if (updated.confirmedBy !== confirmedBy || compact(updated.roundId) !== roundId) {
    return { ok: false, reason: "confirm_audit_incomplete" };
  }
  return { ok: true, record: updated };
}
