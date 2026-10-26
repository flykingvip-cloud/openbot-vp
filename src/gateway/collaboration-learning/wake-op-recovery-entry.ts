/**
 * W2/T36/T37 M1 — controlled composition-root entry for wake-op release / confirm.
 *
 * Resolves the subject from durable operating state + task responsibility
 * (not caller-supplied identitySource / operatingState / approver lists).
 * Mints a branded WakeOpRecoverySubject; internal ledger execute refuses
 * self-constructed identity tags and Symbol.for forgeries (module-private brand).
 *
 * W2 identity wiring:
 * - Production path: {@link createGatewaySessionRecoveryExecContext} mints from a
 *   branded {@link WakeOpTrustedGatewaySession} (actorId = session.authenticatedUserId).
 * - Test-only path: {@link createInternalLibraryRecoveryExecContext} stays labeled
 *   caller_asserted_internal / WAKE_OP_RECOVERY_IDENTITY_MODE_TEST_ONLY — NOT e2e auth.
 * - Brand = misuse prevention only; gateway_session provenance is the e2e claim.
 * - Bare actorId on Authorized* APIs still routes through the test-only path and
 *   MUST NOT be treated as gateway_session authenticated.
 */
import type { Task } from "@openbot/collaboration-core";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { RuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import {
  buildDeclaredWakeOpVerifyAdapterRegistry,
  confirmWakeOpCompleted as confirmWakeOpCompletedExecute,
  isWakeOpDeclaredVerifyCapableSource,
  producePlatformNoneVerificationViaAdapter,
  readWakeOpRecord,
  releaseWakeOpForRetry as releaseWakeOpForRetryExecute,
  type ConfirmWakeOpResult,
  type ReleaseWakeOpResult,
  type WakeOpEffectVerifyAdapterRegistry,
} from "../collaboration-dispatch/wake-op-ledger.js";
import {
  WAKE_OP_RECOVERY_IDENTITY_MODE,
  WAKE_OP_RECOVERY_IDENTITY_MODE_GATEWAY,
  WAKE_OP_RECOVERY_IDENTITY_MODE_TEST_ONLY,
  canConfirmWakeOpCompleted,
  canReleaseWakeOpForRetry,
  mintWakeOpRecoverySubject,
  type WakeOpRecoveryAction,
  type WakeOpRecoveryIdentityMode,
  type WakeOpRecoverySubject,
} from "../collaboration-dispatch/wake-op-recovery-gate.js";
import { createWorkspaceCollaborationStores, readGroupOperatingState } from "./shared.js";

export {
  WAKE_OP_RECOVERY_IDENTITY_MODE,
  WAKE_OP_RECOVERY_IDENTITY_MODE_GATEWAY,
  WAKE_OP_RECOVERY_IDENTITY_MODE_TEST_ONLY,
};
export type { WakeOpRecoveryIdentityMode };

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

/** Module-private gateway session brand — not Symbol.for. */
const SESSION_BRAND: unique symbol = Symbol("openbot.WakeOpTrustedGatewaySession");

/**
 * Branded gateway/session handle. actorId for recovery MUST come from
 * authenticatedUserId — callers cannot override with a bare actorId.
 */
export type WakeOpTrustedGatewaySession = Readonly<{
  authenticatedUserId: string;
  sessionStatus: "active";
  sessionKind: string;
  sessionId: string | null;
  /**
   * - platform_auth_context: minted from authenticated platform session fields
   * - test_only: harness stand-in for platform auth (never claim real platform cookie)
   */
  mintSource: "platform_auth_context" | "test_only";
  readonly [SESSION_BRAND]: true;
}>;

export function isWakeOpTrustedGatewaySession(
  value: unknown,
): value is WakeOpTrustedGatewaySession {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { [SESSION_BRAND]?: unknown })[SESSION_BRAND] === true
  );
}

/**
 * Production mint: build a trusted session handle from already-authenticated
 * platform auth session fields (composition root / HTTP / WS gateway).
 * Suspended / missing userId → refuse.
 */
export function mintWakeOpTrustedGatewaySessionFromPlatformAuth(params: {
  userId: string;
  userStatus: string;
  sessionKind: string;
  sessionId?: string | null;
}): { ok: true; session: WakeOpTrustedGatewaySession } | { ok: false; reason: string } {
  const userId = compact(params.userId);
  if (!userId) {
    return { ok: false, reason: "missing_gateway_session_user" };
  }
  if (compact(params.userStatus).toLowerCase() !== "active") {
    return { ok: false, reason: "gateway_session_not_active" };
  }
  const sessionKind = compact(params.sessionKind) || "unknown";
  const session: WakeOpTrustedGatewaySession = Object.freeze({
    authenticatedUserId: userId,
    sessionStatus: "active" as const,
    sessionKind,
    sessionId: compact(params.sessionId) || null,
    mintSource: "platform_auth_context" as const,
    [SESSION_BRAND]: true as const,
  });
  return { ok: true, session };
}

/**
 * Test-only mint of a branded gateway session handle. Labeled mintSource=test_only.
 * Does NOT prove a real platform cookie/session existed.
 */
export function mintWakeOpTrustedGatewaySessionForTests(params: {
  userId: string;
  sessionKind?: string;
  sessionId?: string | null;
}): { ok: true; session: WakeOpTrustedGatewaySession } | { ok: false; reason: string } {
  const userId = compact(params.userId);
  if (!userId) {
    return { ok: false, reason: "missing_gateway_session_user" };
  }
  const session: WakeOpTrustedGatewaySession = Object.freeze({
    authenticatedUserId: userId,
    sessionStatus: "active" as const,
    sessionKind: compact(params.sessionKind) || "test",
    sessionId: compact(params.sessionId) || null,
    mintSource: "test_only" as const,
    [SESSION_BRAND]: true as const,
  });
  return { ok: true, session };
}

/**
 * Exec context for recovery. Provenance distinguishes gateway_session (e2e claim)
 * from caller_asserted_internal (test-only / internal library).
 */
export type WakeOpRecoveryExecContext = Readonly<{
  actorId: string;
  groupId: string;
  taskId: string;
  action: WakeOpRecoveryAction;
  /**
   * How actorId was established.
   * - gateway_session: from branded WakeOpTrustedGatewaySession.authenticatedUserId
   * - caller_asserted_internal: test / internal DI — NOT proof the network caller is this id
   */
  identityProvenance: "caller_asserted_internal" | "gateway_session";
  identityMode: WakeOpRecoveryIdentityMode;
  readonly [EXEC_BRAND]: true;
}>;

export function isWakeOpRecoveryExecContext(value: unknown): value is WakeOpRecoveryExecContext {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { [EXEC_BRAND]?: unknown })[EXEC_BRAND] === true
  );
}

async function authorizeActorForAction(params: {
  actorId: string;
  groupId: string;
  taskId: string;
  action: WakeOpRecoveryAction;
  cfg?: OpenBotConfig;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
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
  return { ok: true };
}

/**
 * Production / trusted path: mint exec from branded gateway session.
 * actorId is ALWAYS session.authenticatedUserId — caller cannot supply a different id.
 */
export async function createGatewaySessionRecoveryExecContext(params: {
  session: WakeOpTrustedGatewaySession;
  groupId: string;
  taskId: string;
  action: WakeOpRecoveryAction;
  /** Ignored if supplied — cannot override session identity. */
  actorId?: string;
  cfg?: OpenBotConfig;
}): Promise<{ ok: true; exec: WakeOpRecoveryExecContext } | { ok: false; reason: string }> {
  if (!isWakeOpTrustedGatewaySession(params.session)) {
    return { ok: false, reason: "operator_identity_not_trusted" };
  }
  const actorId = compact(params.session.authenticatedUserId);
  // Refuse if a caller tried to pass a conflicting bare actorId.
  if (
    params.actorId !== undefined &&
    compact(params.actorId) &&
    compact(params.actorId) !== actorId
  ) {
    return { ok: false, reason: "operator_identity_not_trusted" };
  }
  const authorized = await authorizeActorForAction({
    actorId,
    groupId: params.groupId,
    taskId: params.taskId,
    action: params.action,
    cfg: params.cfg,
  });
  if (!authorized.ok) {
    return authorized;
  }
  const exec: WakeOpRecoveryExecContext = Object.freeze({
    actorId,
    groupId: compact(params.groupId),
    taskId: compact(params.taskId),
    action: params.action,
    identityProvenance: "gateway_session" as const,
    identityMode: WAKE_OP_RECOVERY_IDENTITY_MODE_GATEWAY,
    [EXEC_BRAND]: true as const,
  });
  return { ok: true, exec };
}

/**
 * Test-only / internal-library exec context. Checks permission against durable OS + task,
 * but does NOT authenticate that the caller is actorId. Marked
 * caller_asserted_internal / WAKE_OP_RECOVERY_IDENTITY_MODE_TEST_ONLY.
 * MUST NOT be treated as e2e authenticated.
 */
export async function createInternalLibraryRecoveryExecContext(params: {
  groupId: string;
  taskId: string;
  actorId: string;
  action: WakeOpRecoveryAction;
  cfg?: OpenBotConfig;
}): Promise<{ ok: true; exec: WakeOpRecoveryExecContext } | { ok: false; reason: string }> {
  const actorId = compact(params.actorId);
  const authorized = await authorizeActorForAction({
    actorId,
    groupId: params.groupId,
    taskId: params.taskId,
    action: params.action,
    cfg: params.cfg,
  });
  if (!authorized.ok) {
    return authorized;
  }
  const exec: WakeOpRecoveryExecContext = Object.freeze({
    actorId,
    groupId: compact(params.groupId),
    taskId: compact(params.taskId),
    action: params.action,
    identityProvenance: "caller_asserted_internal" as const,
    identityMode: WAKE_OP_RECOVERY_IDENTITY_MODE_TEST_ONLY,
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
  const provenance = params.exec.identityProvenance;
  const mode = params.exec.identityMode;
  if (provenance === "gateway_session") {
    if (mode !== WAKE_OP_RECOVERY_IDENTITY_MODE_GATEWAY) {
      return { ok: false, reason: "operator_identity_not_trusted" };
    }
  } else if (provenance === "caller_asserted_internal") {
    // Test-only path — must stay labeled TEST_ONLY; cannot claim gateway mode.
    if (mode !== WAKE_OP_RECOVERY_IDENTITY_MODE_TEST_ONLY) {
      return { ok: false, reason: "operator_identity_not_trusted" };
    }
  } else {
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
 * @deprecated Prefer {@link createGatewaySessionRecoveryExecContext} (production) or
 * {@link createInternalLibraryRecoveryExecContext} (test-only).
 * This still accepts bare actorId (permission check only, not caller auth).
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
   * Preferred: branded exec context (gateway_session for production).
   * Bare actorId still accepted but routes through test-only internal library
   * and does NOT prove caller identity.
   */
  exec?: WakeOpRecoveryExecContext;
  /** @deprecated Use gateway session exec — actorId alone is not authentication. */
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
  /** @deprecated Use gateway session exec — actorId alone is not authentication. */
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

/**
 * W3 composition-root: verify via **declared** durable adapters only.
 * Undeclared source / missing receipt → verify_capability_unavailable.
 * Does NOT auto-release or re-dispatch (no side-effect retry).
 */
export async function produceDeclaredPlatformNoneVerificationAtRoot(params: {
  authority: RuntimeAuthority;
  opKey: string;
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
  if (!isWakeOpDeclaredVerifyCapableSource(wake.source)) {
    return { ok: false as const, reason: "verify_capability_unavailable" };
  }
  return producePlatformNoneVerificationViaAdapter({
    authority: params.authority,
    cfg: params.cfg,
    op: wake,
    registry: buildDeclaredWakeOpVerifyAdapterRegistry(),
    nowMs: params.nowMs,
  });
}
