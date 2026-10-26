/**
 * C1/C2 — wake-op unknown recovery gates (T36 M1/M2).
 *
 * stop ≠ release_for_retry ≠ confirm_completed — three distinct permissions.
 * Do NOT reuse canRequestTaskStop: emergency stop must not imply resume or
 * confirm-completed.
 *
 * M1: Operator subject must be minted at the controlled entry (Symbol brand).
 * Self-constructed identitySource / actorId / approver lists are NOT an auth basis.
 * TypeScript brands help misuse prevention but do not replace runtime checks.
 *
 * M2: externalEffectVerified:"none" must bind a verification record produced by
 * the controlled verifier (receipt / external state / authorized human attestation).
 * Caller-filled source/outcome fields alone are not facts.
 */
import { isMappedDeliveryIdentity } from "../collaboration-learning/delivery-actor-binding.js";

export const WAKE_OP_RECOVERY_ACTIONS = ["release_for_retry", "confirm_completed"] as const;
export type WakeOpRecoveryAction = (typeof WAKE_OP_RECOVERY_ACTIONS)[number];

export type WakeOpRecoveryAuthState = {
  governance?: {
    ownerUserId?: string | null;
    adminUserIds?: string[] | null;
    coordinatorBotId?: string | null;
  } | null;
  memberRoleMap?: ReadonlyArray<{
    memberId?: string | null;
    governanceRole?: string | null;
    status?: string | null;
  }> | null;
} | null;

/** @deprecated Plain runtime tag — NOT trusted as auth basis (T36 M1). */
export type TrustedWakeOpOperator = Readonly<{
  actorId: string;
  identitySource: "runtime";
}>;

const SUBJECT_BRAND: unique symbol = Symbol.for("openbot.WakeOpRecoverySubject");

/**
 * Minted recovery subject. Only {@link mintWakeOpRecoverySubject} produces this.
 * Plain objects with identitySource:"runtime" are refused at runtime.
 */
export type WakeOpRecoverySubject = Readonly<{
  actorId: string;
  action: WakeOpRecoveryAction;
  groupId: string;
  taskId: string;
  /** Snapshot of approvers loaded at mint time (confirm). */
  taskApproverIds: readonly string[];
  mintedAtMs: number;
  readonly [SUBJECT_BRAND]: true;
}>;

export function isWakeOpRecoverySubject(value: unknown): value is WakeOpRecoverySubject {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { [SUBJECT_BRAND]?: unknown })[SUBJECT_BRAND] === true
  );
}

/** Internal mint — composition root / recovery entry only. */
export function mintWakeOpRecoverySubject(params: {
  actorId: string;
  action: WakeOpRecoveryAction;
  groupId: string;
  taskId: string;
  taskApproverIds?: readonly string[] | null;
  nowMs?: number;
}): WakeOpRecoverySubject {
  const actorId = compact(params.actorId);
  const groupId = compact(params.groupId);
  const taskId = compact(params.taskId);
  if (!actorId || !groupId || !taskId) {
    throw new Error("mintWakeOpRecoverySubject: actorId/groupId/taskId required");
  }
  return Object.freeze({
    actorId,
    action: params.action,
    groupId,
    taskId,
    taskApproverIds: Object.freeze((params.taskApproverIds ?? []).map(compact).filter(Boolean)),
    mintedAtMs: params.nowMs ?? Date.now(),
    [SUBJECT_BRAND]: true as const,
  });
}

/**
 * Verifiable binding for externalEffectVerified:"none" (legacy shape kept for
 * audit copies on the wake-op ledger). Production unlock requires a stored
 * verification record — see wake-op-effect-verify.ts.
 */
export type ExternalEffectCheckRecord = Readonly<{
  source: string;
  opId: string;
  checkedAtMs: number;
  outcome: "none";
}>;

/** Default max age for an external-effect "none" check (30 minutes). */
export const EXTERNAL_EFFECT_CHECK_MAX_AGE_MS = 30 * 60 * 1000;

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function memberRow(
  state: WakeOpRecoveryAuthState,
  actorId: string,
): { memberId?: string | null; governanceRole?: string | null; status?: string | null } | null {
  const id = compact(actorId);
  if (!id) {
    return null;
  }
  return (state?.memberRoleMap ?? []).find((row) => compact(row.memberId) === id) ?? null;
}

/** Mapped + not revoked/removed. */
export function isActiveRecoveryIdentity(state: WakeOpRecoveryAuthState, actorId: string): boolean {
  const id = compact(actorId);
  if (!id) {
    return false;
  }
  const row = memberRow(state, id);
  if (row) {
    const status = compact(row.status).toLowerCase();
    if (status === "revoked" || status === "removed") {
      return false;
    }
  }
  return isMappedDeliveryIdentity(state, id);
}

function isGovernanceOwner(state: WakeOpRecoveryAuthState, actorId: string): boolean {
  const id = compact(actorId);
  if (!id) {
    return false;
  }
  if (compact(state?.governance?.ownerUserId) === id) {
    return true;
  }
  const row = memberRow(state, id);
  return compact(row?.governanceRole).toLowerCase() === "owner";
}

/**
 * Release (unknown→failed for retry): active mapped **owner** only.
 * Admin / coordinator who canRequestTaskStop do **not** get release by default.
 */
export function canReleaseWakeOpForRetry(params: {
  actorId: string;
  operatingState: WakeOpRecoveryAuthState;
}): boolean {
  const actorId = compact(params.actorId);
  if (!actorId) {
    return false;
  }
  if (!isActiveRecoveryIdentity(params.operatingState, actorId)) {
    return false;
  }
  return isGovernanceOwner(params.operatingState, actorId);
}

/**
 * Confirm (unknown→completed): active mapped actor listed as task approver.
 * Stop authority and release authority do **not** imply confirm.
 */
export function canConfirmWakeOpCompleted(params: {
  actorId: string;
  operatingState: WakeOpRecoveryAuthState;
  taskApproverIds?: readonly string[] | null;
}): boolean {
  const actorId = compact(params.actorId);
  if (!actorId) {
    return false;
  }
  if (!isActiveRecoveryIdentity(params.operatingState, actorId)) {
    return false;
  }
  const approvers = (params.taskApproverIds ?? []).map(compact).filter(Boolean);
  return approvers.includes(actorId);
}

export function canPerformWakeOpRecovery(params: {
  actorId: string;
  action: WakeOpRecoveryAction;
  operatingState: WakeOpRecoveryAuthState;
  taskApproverIds?: readonly string[] | null;
}): boolean {
  if (params.action === "release_for_retry") {
    return canReleaseWakeOpForRetry(params);
  }
  return canConfirmWakeOpCompleted(params);
}

/**
 * Resolve a minted subject. Self-constructed identity tags are refused.
 * Does NOT accept TrustedWakeOpOperator / identitySource strings as auth basis.
 */
export function resolveWakeOpRecoverySubject(
  subject: WakeOpRecoverySubject | null | undefined,
  expectedAction?: WakeOpRecoveryAction,
): { ok: true; subject: WakeOpRecoverySubject } | { ok: false; reason: string } {
  if (!isWakeOpRecoverySubject(subject)) {
    return { ok: false, reason: "operator_identity_not_trusted" };
  }
  if (!compact(subject.actorId)) {
    return { ok: false, reason: "missing_operator_actor_id" };
  }
  if (expectedAction && subject.action !== expectedAction) {
    return { ok: false, reason: "recovery_action_mismatch" };
  }
  return { ok: true, subject };
}

/**
 * @deprecated T36 M1 — string identitySource is not an auth basis.
 * Kept only so forge tests / old call sites get a clear refuse.
 */
export function resolveTrustedWakeOpOperator(
  operator: TrustedWakeOpOperator | null | undefined,
): { ok: true; actorId: string } | { ok: false; reason: string } {
  // Always refuse: callers must use minted WakeOpRecoverySubject.
  void operator;
  return { ok: false, reason: "operator_identity_not_trusted" };
}

export function validateExternalEffectNoneCheck(params: {
  opKey: string;
  check: ExternalEffectCheckRecord | null | undefined;
  nowMs: number;
  maxAgeMs?: number;
}): { ok: true; check: ExternalEffectCheckRecord } | { ok: false; reason: string } {
  const check = params.check;
  if (!check || typeof check !== "object") {
    return { ok: false, reason: "missing_external_effect_check" };
  }
  const source = compact(check.source);
  if (!source) {
    return { ok: false, reason: "missing_effect_check_source" };
  }
  const opId = compact(check.opId);
  if (!opId) {
    return { ok: false, reason: "missing_effect_check_op_id" };
  }
  if (opId !== compact(params.opKey)) {
    return { ok: false, reason: "effect_check_op_mismatch" };
  }
  if (check.outcome !== "none") {
    return { ok: false, reason: "effect_check_contradictory_outcome" };
  }
  if (!Number.isFinite(check.checkedAtMs)) {
    return { ok: false, reason: "missing_effect_check_time" };
  }
  if (check.checkedAtMs > params.nowMs + 60_000) {
    return { ok: false, reason: "effect_check_time_invalid" };
  }
  const maxAge = params.maxAgeMs ?? EXTERNAL_EFFECT_CHECK_MAX_AGE_MS;
  if (params.nowMs - check.checkedAtMs > maxAge) {
    return { ok: false, reason: "effect_check_expired" };
  }
  return {
    ok: true,
    check: {
      source,
      opId,
      checkedAtMs: check.checkedAtMs,
      outcome: "none",
    },
  };
}
