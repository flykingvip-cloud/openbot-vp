/**
 * T36/T37 M1 — controlled composition-root entry for wake-op release / confirm.
 *
 * Resolves the subject from durable operating state + task responsibility
 * (not caller-supplied identitySource / operatingState / approver lists).
 * Mints a branded WakeOpRecoverySubject; internal ledger execute refuses
 * self-constructed identity tags and Symbol.for forgeries (module-private brand).
 *
 * T37 honesty / reachability:
 * - WAKE_OP_RECOVERY_IDENTITY_MODE = internal_library_not_e2e_authenticated
 * - Brand = misuse prevention only, NOT authentication proof
 * - Bare actorId proves "this id may", not "caller is this id"
 * - Production gateway-session → subject chain is NOT wired (no new RPC this round)
 * - Prefer {@link createInternalLibraryRecoveryExecContext} then Authorized* APIs;
 *   test harness mint is gated and labeled caller_asserted_internal
 */
import type { Task } from "@openbot/collaboration-core";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { RuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import {
  confirmWakeOpCompleted as confirmWakeOpCompletedExecute,
  producePlatformNoneVerificationViaAdapter,
  readWakeOpRecord,
  releaseWakeOpForRetry as releaseWakeOpForRetryExecute,
  type ConfirmWakeOpResult,
  type ReleaseWakeOpResult,
  type WakeOpEffectVerifyAdapterRegistry,
} from "../collaboration-dispatch/wake-op-ledger.js";
import {
  WAKE_OP_RECOVERY_IDENTITY_MODE,
  canConfirmWakeOpCompleted,
  canReleaseWakeOpForRetry,
  mintWakeOpRecoverySubject,
  type WakeOpRecoveryAction,
  type WakeOpRecoverySubject,
} from "../collaboration-dispatch/wake-op-recovery-gate.js";
import { createWorkspaceCollaborationStores, readGroupOperatingState } from "./shared.js";

export { WAKE_OP_RECOVERY_IDENTITY_MODE };

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function readTaskApproverIds(task: Task | null | undefined): string[] {
  const responsibility = (task as { responsibility?: { approvers?: unknown } } | null | undefined)
    ?.responsibility;
  const raw = responsibility?.approvers;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((id) => compact(typeof id === "string" ? id : "")).filter(Boolean);
}

/** Module-private — not Symbol.for; forgeries via Symbol.for are rejected. */
const EXEC_BRAND: unique symbol = Symbol("openbot.WakeOpRecoveryExecContext");

/**
 * Trusted-ish exec context for recovery. Until gateway session wiring exists,
 * provenance is always caller_asserted_internal (internal library, not e2e auth).
 */
export type WakeOpRecoveryExecContext = Readonly<{
  actorId: string;
  groupId: string;
  taskId: string;
  action: WakeOpRecoveryAction;
  /**
   * How actorId was established.
   * - caller_asserted_internal: test / internal DI — NOT proof the network caller is this id
   * - gateway_session: reserved; not minted in this build
   */
  identityProvenance: "caller_asserted_internal" | "gateway_session";
  identityMode: typeof WAKE_OP_RECOVERY_IDENTITY_MODE;
  readonly [EXEC_BRAND]: true;
}>;

export function isWakeOpRecoveryExecContext(value: unknown): value is WakeOpRecoveryExecContext {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { [EXEC_BRAND]?: unknown })[EXEC_BRAND] === true
  );
}

/**
 * Internal-library exec context. Checks permission against durable OS + task,
 * but does NOT authenticate that the caller is actorId. Marked
 * caller_asserted_internal / internal_library_not_e2e_authenticated.
 */
export async function createInternalLibraryRecoveryExecContext(params: {
  groupId: string;
  taskId: string;
  actorId: string;
  action: WakeOpRecoveryAction;
  cfg?: OpenBotConfig;
}): Promise<{ ok: true; exec: WakeOpRecoveryExecContext } | { ok: false; reason: string }> {
  const actorId = compact(params.actorId);
  const groupId = compact(params.groupId);
  const taskId = compact(params.taskId);
  if (!actorId) {
    return { ok: false, reason: "missing_operator_actor_id" };
  }
  if (!groupId || !taskId) {
    return { ok: false, reason: "missing_task_scope" };
  }
  const cfg = params.cfg ?? loadConfig();
  const { fileStore, objectStorage } = createWorkspaceCollaborationStores(cfg);
  const operatingState = await readGroupOperatingState({ fileStore, groupId });
  const task = await objectStorage.readObject<Task>(groupId, "task", taskId);
  if (!task) {
    return { ok: false, reason: "task_not_found" };
  }
  const taskApproverIds = readTaskApproverIds(task);
  if (params.action === "release_for_retry") {
    if (!canReleaseWakeOpForRetry({ actorId, operatingState })) {
      return { ok: false, reason: "release_forbidden" };
    }
  } else if (params.action === "confirm_completed") {
    if (!canConfirmWakeOpCompleted({ actorId, operatingState, taskApproverIds })) {
      return { ok: false, reason: "confirm_forbidden" };
    }
  } else {
    return { ok: false, reason: "unknown_recovery_action" };
  }
  const exec: WakeOpRecoveryExecContext = Object.freeze({
    actorId,
    groupId,
    taskId,
    action: params.action,
    identityProvenance: "caller_asserted_internal",
    identityMode: WAKE_OP_RECOVERY_IDENTITY_MODE,
    [EXEC_BRAND]: true as const,
  });
  return { ok: true, exec };
}

/**
 * Test-only harness: mint subject via composition root after internal exec
 * context. Not a public authentication API.
 */
export async function mintWakeOpRecoverySubjectForTests(params: {
  groupId: string;
  taskId: string;
  actorId: string;
  action: WakeOpRecoveryAction;
  cfg?: OpenBotConfig;
  nowMs?: number;
}): Promise<{ ok: true; subject: WakeOpRecoverySubject } | { ok: false; reason: string }> {
  const created = await createInternalLibraryRecoveryExecContext(params);
  if (!created.ok) {
    return created;
  }
  return resolveSubjectFromExecContext({
    exec: created.exec,
    cfg: params.cfg,
    nowMs: params.nowMs,
  });
}

async function resolveSubjectFromExecContext(params: {
  exec: WakeOpRecoveryExecContext;
  cfg?: OpenBotConfig;
  nowMs?: number;
}): Promise<{ ok: true; subject: WakeOpRecoverySubject } | { ok: false; reason: string }> {
  if (!isWakeOpRecoveryExecContext(params.exec)) {
    return { ok: false, reason: "operator_identity_not_trusted" };
  }
  // gateway_session not minted in this build; caller_asserted_internal is the only path.
  if (params.exec.identityProvenance !== "caller_asserted_internal") {
    return { ok: false, reason: "operator_identity_not_trusted" };
  }
  if (params.exec.identityMode !== WAKE_OP_RECOVERY_IDENTITY_MODE) {
    return { ok: false, reason: "operator_identity_not_trusted" };
  }
  const cfg = params.cfg ?? loadConfig();
  const { objectStorage } = createWorkspaceCollaborationStores(cfg);
  const task = await objectStorage.readObject<Task>(
    params.exec.groupId,
    "task",
    params.exec.taskId,
  );
  if (!task) {
    return { ok: false, reason: "task_not_found" };
  }
  const subject = mintWakeOpRecoverySubject({
    actorId: params.exec.actorId,
    action: params.exec.action,
    groupId: params.exec.groupId,
    taskId: params.exec.taskId,
    taskApproverIds: readTaskApproverIds(task),
    nowMs: params.nowMs,
  });
  return { ok: true, subject };
}

export type ResolveWakeOpRecoverySubjectParams = {
  groupId: string;
  taskId: string;
  actorId: string;
  action: WakeOpRecoveryAction;
  cfg?: OpenBotConfig;
  nowMs?: number;
};

/**
 * @deprecated Prefer {@link createInternalLibraryRecoveryExecContext} —
 * this still accepts bare actorId (permission check only, not caller auth).
 * Kept for transitional callers; labeled internal-library.
 */
export async function resolveWakeOpRecoverySubjectForAction(
  params: ResolveWakeOpRecoverySubjectParams,
): Promise<{ ok: true; subject: WakeOpRecoverySubject } | { ok: false; reason: string }> {
  return mintWakeOpRecoverySubjectForTests(params);
}

export async function releaseWakeOpForRetryAuthorized(params: {
  authority: RuntimeAuthority;
  groupId: string;
  taskId: string;
  opKey: string;
  /**
   * Preferred: branded exec context. Bare actorId still accepted but does NOT
   * prove caller identity (internal library mode).
   */
  exec?: WakeOpRecoveryExecContext;
  /** @deprecated Use exec — actorId alone is not authentication. */
  actorId?: string;
  verificationId: string;
  cfg?: OpenBotConfig;
  nowMs?: number;
  detail?: string;
}): Promise<ReleaseWakeOpResult> {
  let exec = params.exec;
  if (exec && !isWakeOpRecoveryExecContext(exec)) {
    return { ok: false, reason: "operator_identity_not_trusted" };
  }
  if (!exec) {
    const actorId = compact(params.actorId);
    if (!actorId) {
      return { ok: false, reason: "missing_operator_actor_id" };
    }
    const created = await createInternalLibraryRecoveryExecContext({
      groupId: params.groupId,
      taskId: params.taskId,
      actorId,
      action: "release_for_retry",
      cfg: params.cfg,
    });
    if (!created.ok) {
      return created;
    }
    exec = created.exec;
  }
  if (exec.action !== "release_for_retry") {
    return { ok: false, reason: "recovery_action_mismatch" };
  }
  const resolved = await resolveSubjectFromExecContext({
    exec,
    cfg: params.cfg,
    nowMs: params.nowMs,
  });
  if (!resolved.ok) {
    return resolved;
  }
  return releaseWakeOpForRetryExecute({
    authority: params.authority,
    opKey: params.opKey,
    cfg: params.cfg,
    nowMs: params.nowMs,
    detail: params.detail,
    externalEffectVerified: "none",
    verificationId: params.verificationId,
    subject: resolved.subject,
  });
}

export async function confirmWakeOpCompletedAuthorized(params: {
  authority: RuntimeAuthority;
  groupId: string;
  taskId: string;
  opKey: string;
  roundId: string;
  exec?: WakeOpRecoveryExecContext;
  /** @deprecated Use exec — actorId alone is not authentication. */
  actorId?: string;
  cfg?: OpenBotConfig;
  nowMs?: number;
  detail?: string;
}): Promise<ConfirmWakeOpResult> {
  let exec = params.exec;
  if (exec && !isWakeOpRecoveryExecContext(exec)) {
    return { ok: false, reason: "operator_identity_not_trusted" };
  }
  if (!exec) {
    const actorId = compact(params.actorId);
    if (!actorId) {
      return { ok: false, reason: "missing_operator_actor_id" };
    }
    const created = await createInternalLibraryRecoveryExecContext({
      groupId: params.groupId,
      taskId: params.taskId,
      actorId,
      action: "confirm_completed",
      cfg: params.cfg,
    });
    if (!created.ok) {
      return created;
    }
    exec = created.exec;
  }
  if (exec.action !== "confirm_completed") {
    return { ok: false, reason: "recovery_action_mismatch" };
  }
  const resolved = await resolveSubjectFromExecContext({
    exec,
    cfg: params.cfg,
    nowMs: params.nowMs,
  });
  if (!resolved.ok) {
    return resolved;
  }
  return confirmWakeOpCompletedExecute({
    authority: params.authority,
    opKey: params.opKey,
    roundId: params.roundId,
    cfg: params.cfg,
    nowMs: params.nowMs,
    detail: params.detail,
    subject: resolved.subject,
  });
}

/**
 * Composition-root platform none verification: load op from ledger, select
 * adapter by operation type, bind attemptId from the op record.
 */
export async function producePlatformNoneVerificationAtRoot(params: {
  authority: RuntimeAuthority;
  opKey: string;
  registry: WakeOpEffectVerifyAdapterRegistry;
  cfg?: OpenBotConfig;
  nowMs?: number;
}) {
  const wake = await readWakeOpRecord({
    authority: params.authority,
    opKey: params.opKey,
  });
  if (!wake) {
    return { ok: false as const, reason: "missing_record" };
  }
  return producePlatformNoneVerificationViaAdapter({
    authority: params.authority,
    cfg: params.cfg,
    op: wake,
    registry: params.registry,
    nowMs: params.nowMs,
  });
}
