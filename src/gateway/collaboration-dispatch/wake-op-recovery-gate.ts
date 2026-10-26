/**
 * C1/C2 — wake-op unknown recovery gates.
 *
 * stop ≠ release_for_retry ≠ confirm_completed — three distinct permissions.
 * Do NOT reuse canRequestTaskStop: emergency stop must not imply resume or
 * confirm-completed.
 *
 * Operator identity must come from trusted runtime resolution (identitySource
 * "runtime"), not a free-form request declaration.
 *
 * externalEffectVerified:"none" must bind a verifiable check record
 * (source, op id, check time, outcome). Declaration alone is not enough.
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

/** Trusted runtime operator — forged / declared-only ids are refused. */
export type TrustedWakeOpOperator = Readonly<{
  actorId: string;
  identitySource: "runtime";
}>;

/**
 * Verifiable binding for externalEffectVerified:"none".
 * Human escalation may keep unknown; a checkbox/declaration is not a fact.
 */
export type ExternalEffectCheckRecord = Readonly<{
  source: string;
  /** Must match the wake op being released. */
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

/** Mapped + not revoked/removed. Coordinator-only mapping without a live row still counts via isMapped. */
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

export function resolveTrustedWakeOpOperator(
  operator: TrustedWakeOpOperator | null | undefined,
): { ok: true; actorId: string } | { ok: false; reason: string } {
  if (!operator || typeof operator !== "object") {
    return { ok: false, reason: "missing_trusted_operator" };
  }
  if (operator.identitySource !== "runtime") {
    return { ok: false, reason: "operator_identity_not_trusted" };
  }
  const actorId = compact(operator.actorId);
  if (!actorId) {
    return { ok: false, reason: "missing_operator_actor_id" };
  }
  return { ok: true, actorId };
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
