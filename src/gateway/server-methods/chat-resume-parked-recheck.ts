/**
 * Live ResumeParkedRecheck for the chat.send entry path.
 *
 * applyFocusSwitchGate already fail-closes when authOk===false or stopActive===true.
 * chat.send must resolve those flags from real send-time signals before resume
 * proceeds — never call the gate without a recheck on the user resume path.
 *
 * ## Resume stop policy (authoritative by trusted scope + taskId)
 *
 * Ephemeral `chatAbortControllers` are NOT authoritative: `abortChatRunById`
 * aborts then deletes the controller, so a later resume that only scans live
 * aborted controllers can see false and wrongly allow resume.
 *
 * Authoritative stop is recorded under a **trusted scope** (tenantId + userId +
 * sessionKey) plus the **original taskId**. taskId alone is never a registry
 * key — identical task text hashes to the same taskId across sessions/tenants,
 * and must not leak stop state. Missing scope refuses record/query/clear
 * (no global taskId fallback).
 *
 * Resume of that scoped taskId is denied while the record exists — even after
 * the AbortController entry is cleaned. Other taskIds in the same scope, and
 * the same taskId under another session/tenant/user, are unaffected. Undo
 * clears only the matching scope+taskId. Task-park aborts do not record a stop
 * (park is not a user stop barrier).
 *
 * ## Durability boundary (disclose)
 *
 * The registry is a **process-local Map**. It survives AbortController delete
 * within one gateway process for single-gateway, no-mid-restart exploratory
 * tests. It is **not** durable across process restart / multi-host; cross-
 * process stop authority remains separately unproven.
 */
import type { ResumeParkedRecheck } from "../../conversation-task/session-task-board.js";
import {
  applyFocusSwitchGate,
  type FocusSwitchGateDecision,
} from "../../conversation-task/session-task-board.js";

export type ResolveResumeParkedRecheckParams = {
  /** Session send policy already resolved for this turn. */
  sendPolicy?: string;
  /**
   * False when personal-workbench / ownership checks failed (caller may still
   * invoke for belt-and-suspenders after an early return path).
   */
  accessAuthorized?: boolean;
  /**
   * False when the WS client has no usable identity after hydrate
   * (user / platformUserId / pairedDeviceId / membership / connect role).
   */
  clientIdentityOk?: boolean;
  /** True when a session-wide stop/abort barrier is active (broad deny). */
  stopActive?: boolean;
  /**
   * Authoritative per-taskId stop lookup. When provided, resumeParkedTask
   * queries this with the resume target taskId (wins over boolean stopActive
   * for that task).
   */
  isTaskStopActive?: (taskId: string) => boolean;
};

/**
 * Build the recheck object chat.send passes into applyFocusSwitchGate.
 * Missing optional flags stay permissive only when not explicitly false/deny;
 * stopActive is fail-closed when true.
 */
export function resolveResumeParkedRecheck(
  params: ResolveResumeParkedRecheckParams = {},
): ResumeParkedRecheck {
  const authOk =
    params.sendPolicy !== "deny" &&
    params.accessAuthorized !== false &&
    params.clientIdentityOk !== false;
  return {
    authOk,
    stopActive: params.stopActive === true,
    ...(typeof params.isTaskStopActive === "function"
      ? { isTaskStopActive: params.isTaskStopActive }
      : {}),
  };
}

export type SessionStopBarrierEntry = {
  sessionKey: string;
  controller?: { signal?: { aborted?: boolean } };
};

/** Trusted scope dimensions that must bind with taskId — never taskId alone. */
export type AuthoritativeTaskStopScope = {
  /** Trusted tenant id; empty string for non-enterprise personal sessions. */
  tenantId: string;
  /** Trusted user id (platformUserId / user); may be empty when identity absent. */
  userId: string;
  /** Trusted session key — required; missing sessionKey = missing scope. */
  sessionKey: string;
};

export type AuthoritativeTaskStopEntry = AuthoritativeTaskStopScope & {
  taskId: string;
  stoppedAtMs: number;
  reason?: string;
};

/**
 * Process-local authoritative stop registry.
 * Key = tenantId + userId + sessionKey + taskId (see {@link authoritativeStopRegistryKey}).
 * NOT durable across gateway restart / multi-host.
 */
const authoritativeTaskStops = new Map<string, AuthoritativeTaskStopEntry>();

function normalizeStopScopePart(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Build a trusted stop scope. Requires non-empty sessionKey.
 * Missing sessionKey → null (callers must NOT fall back to taskId-only).
 */
export function resolveAuthoritativeTaskStopScope(params: {
  tenantId?: string | null;
  userId?: string | null;
  sessionKey?: string | null;
}): AuthoritativeTaskStopScope | null {
  const sessionKey = normalizeStopScopePart(params.sessionKey);
  if (!sessionKey) {
    return null;
  }
  return {
    tenantId: normalizeStopScopePart(params.tenantId),
    userId: normalizeStopScopePart(params.userId),
    sessionKey,
  };
}

/** Stable Map key — all scope dimensions always present; never taskId alone. */
export function authoritativeStopRegistryKey(
  scope: AuthoritativeTaskStopScope,
  taskId: string,
): string {
  return `t:${scope.tenantId}\0u:${scope.userId}\0s:${scope.sessionKey}\0task:${taskId}`;
}

export function resetAuthoritativeTaskStopsForTest(): void {
  authoritativeTaskStops.clear();
}

export function recordAuthoritativeTaskStop(params: {
  taskId: string;
  tenantId?: string | null;
  userId?: string | null;
  sessionKey?: string | null;
  reason?: string;
  nowMs?: number;
}): AuthoritativeTaskStopEntry | null {
  const taskId = normalizeStopScopePart(params.taskId);
  const scope = resolveAuthoritativeTaskStopScope(params);
  // Missing scope or taskId — refuse. Do NOT fall back to global taskId keying.
  if (!taskId || !scope) {
    return null;
  }
  const entry: AuthoritativeTaskStopEntry = {
    ...scope,
    taskId,
    stoppedAtMs: params.nowMs ?? Date.now(),
    ...(params.reason?.trim() ? { reason: params.reason.trim() } : {}),
  };
  authoritativeTaskStops.set(authoritativeStopRegistryKey(scope, taskId), entry);
  return entry;
}

export function clearAuthoritativeTaskStop(params: {
  taskId: string;
  tenantId?: string | null;
  userId?: string | null;
  sessionKey?: string | null;
}): boolean {
  const taskId = normalizeStopScopePart(params.taskId);
  const scope = resolveAuthoritativeTaskStopScope(params);
  // Missing scope — refuse. Do NOT clear every session that shares this taskId.
  if (!taskId || !scope) {
    return false;
  }
  return authoritativeTaskStops.delete(authoritativeStopRegistryKey(scope, taskId));
}

/**
 * Authoritative stop for a scoped taskId — survives AbortController cleanup.
 * Missing scope → false (no global taskId lookup).
 */
export function isAuthoritativeTaskStopActive(params: {
  taskId: string;
  tenantId?: string | null;
  userId?: string | null;
  sessionKey?: string | null;
  /** Optional external store for tests. */
  store?: ReadonlyMap<string, AuthoritativeTaskStopEntry>;
}): boolean {
  const taskId = normalizeStopScopePart(params.taskId);
  const scope = resolveAuthoritativeTaskStopScope(params);
  if (!taskId || !scope) {
    return false;
  }
  const store = params.store ?? authoritativeTaskStops;
  return store.has(authoritativeStopRegistryKey(scope, taskId));
}

/**
 * True when stop should block resume.
 *
 * Prefer authoritative stop by trusted scope + `taskId` when provided. Live
 * aborted controllers are only a secondary signal (they disappear after
 * abortChatRun deletes them). Missing scope never falls back to taskId-only.
 */
export function sessionStopBarrierActive(params: {
  sessionKeys: Iterable<string>;
  chatAbortControllers: ReadonlyMap<string, SessionStopBarrierEntry>;
  /** When set, query authoritative stop for this original taskId first. */
  taskId?: string;
  tenantId?: string | null;
  userId?: string | null;
  /** Optional external store; defaults to the module registry. */
  authoritativeStops?: ReadonlyMap<string, AuthoritativeTaskStopEntry>;
}): boolean {
  const taskId = params.taskId?.trim() ?? "";
  if (taskId) {
    const store = params.authoritativeStops ?? authoritativeTaskStops;
    for (const rawKey of params.sessionKeys) {
      if (
        isAuthoritativeTaskStopActive({
          taskId,
          tenantId: params.tenantId,
          userId: params.userId,
          sessionKey: rawKey,
          store,
        })
      ) {
        return true;
      }
    }
    // Scoped miss: do NOT fall back to a global taskId lookup.
  }

  const keys = new Set<string>();
  for (const key of params.sessionKeys) {
    const trimmed = key.trim();
    if (trimmed) {
      keys.add(trimmed);
    }
  }
  if (keys.size === 0) {
    return false;
  }
  for (const entry of params.chatAbortControllers.values()) {
    const sessionKey = entry.sessionKey.trim();
    if (!sessionKey || !keys.has(sessionKey)) {
      continue;
    }
    if (entry.controller?.signal?.aborted === true) {
      return true;
    }
  }
  return false;
}

/**
 * Build the resume-time per-taskId stop predicate used by chat.send.
 * Combines scoped authoritative task stops with any still-live aborted controllers.
 */
export function buildResumeTaskStopActive(params: {
  sessionKeys: Iterable<string>;
  chatAbortControllers: ReadonlyMap<string, SessionStopBarrierEntry>;
  tenantId?: string | null;
  userId?: string | null;
}): (taskId: string) => boolean {
  const sessionKeys = [...params.sessionKeys];
  const controllers = params.chatAbortControllers;
  const tenantId = params.tenantId;
  const userId = params.userId;
  return (taskId: string) =>
    sessionStopBarrierActive({
      sessionKeys,
      chatAbortControllers: controllers,
      taskId,
      tenantId,
      userId,
    });
}

export function clientIdentityOkForResume(
  client:
    | {
        user?: string;
        platformUserId?: string;
        pairedDeviceId?: string;
        sessionMembershipId?: string;
        connect?: { role?: string };
      }
    | null
    | undefined,
): boolean {
  if (!client) {
    // Non-WS / internal callers (tests, ACP) — do not fail-close on identity alone.
    return true;
  }
  if (typeof client.user === "string" && client.user.trim()) {
    return true;
  }
  if (typeof client.platformUserId === "string" && client.platformUserId.trim()) {
    return true;
  }
  if (typeof client.pairedDeviceId === "string" && client.pairedDeviceId.trim()) {
    return true;
  }
  if (typeof client.sessionMembershipId === "string" && client.sessionMembershipId.trim()) {
    return true;
  }
  if (typeof client.connect?.role === "string" && client.connect.role.trim()) {
    return true;
  }
  return false;
}

/**
 * Production chat.send entry: always inject a live ResumeParkedRecheck so the
 * resume path cannot bypass auth/stop revalidation.
 */
export function applyChatFocusSwitchGateWithResumeRecheck(params: {
  sessionFile?: string;
  incomingText: string;
  nowMs?: number;
  workspacePaths?: string[];
  proceed?: boolean;
  recheckInputs: ResolveResumeParkedRecheckParams;
}): FocusSwitchGateDecision {
  return applyFocusSwitchGate({
    sessionFile: params.sessionFile,
    incomingText: params.incomingText,
    nowMs: params.nowMs,
    workspacePaths: params.workspacePaths,
    proceed: params.proceed,
    recheck: resolveResumeParkedRecheck(params.recheckInputs),
  });
}
