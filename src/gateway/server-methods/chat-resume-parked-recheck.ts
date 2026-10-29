/**
 * Live ResumeParkedRecheck for the chat.send entry path.
 *
 * applyFocusSwitchGate already fail-closes when authOk===false or stopActive===true.
 * chat.send must resolve those flags from real send-time signals before resume
 * proceeds — never call the gate without a recheck on the user resume path.
 *
 * ## Resume stop policy (authoritative by taskId)
 *
 * Ephemeral `chatAbortControllers` are NOT authoritative: `abortChatRunById`
 * aborts then deletes the controller, so a later resume that only scans live
 * aborted controllers can see false and wrongly allow resume.
 *
 * Authoritative stop is recorded by the **original taskId** when a user/RPC
 * stop or abort is accepted for that task. Resume of that taskId is denied
 * while the record exists — even after the AbortController entry is cleaned.
 * Other taskIds in the same session are not blocked by that record.
 * Undo clears the record for the task. Task-park aborts do not record a stop
 * (park is not a user stop barrier).
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

export type AuthoritativeTaskStopEntry = {
  taskId: string;
  sessionKey?: string;
  stoppedAtMs: number;
  reason?: string;
};

/** Process-local authoritative stop registry keyed by original taskId. */
const authoritativeTaskStops = new Map<string, AuthoritativeTaskStopEntry>();

export function resetAuthoritativeTaskStopsForTest(): void {
  authoritativeTaskStops.clear();
}

export function recordAuthoritativeTaskStop(params: {
  taskId: string;
  sessionKey?: string;
  reason?: string;
  nowMs?: number;
}): AuthoritativeTaskStopEntry | null {
  const taskId = params.taskId.trim();
  if (!taskId) {
    return null;
  }
  const entry: AuthoritativeTaskStopEntry = {
    taskId,
    stoppedAtMs: params.nowMs ?? Date.now(),
    ...(params.sessionKey?.trim() ? { sessionKey: params.sessionKey.trim() } : {}),
    ...(params.reason?.trim() ? { reason: params.reason.trim() } : {}),
  };
  authoritativeTaskStops.set(taskId, entry);
  return entry;
}

export function clearAuthoritativeTaskStop(taskId: string): boolean {
  const trimmed = taskId.trim();
  if (!trimmed) {
    return false;
  }
  return authoritativeTaskStops.delete(trimmed);
}

/** Authoritative stop for a taskId — survives AbortController cleanup. */
export function isAuthoritativeTaskStopActive(taskId: string): boolean {
  const trimmed = taskId.trim();
  if (!trimmed) {
    return false;
  }
  return authoritativeTaskStops.has(trimmed);
}

/**
 * True when stop should block resume.
 *
 * Prefer authoritative stop by `taskId` when provided. Live aborted controllers
 * are only a secondary signal (they disappear after abortChatRun deletes them).
 */
export function sessionStopBarrierActive(params: {
  sessionKeys: Iterable<string>;
  chatAbortControllers: ReadonlyMap<string, SessionStopBarrierEntry>;
  /** When set, query authoritative stop for this original taskId first. */
  taskId?: string;
  /** Optional external store; defaults to the module registry. */
  authoritativeStops?: ReadonlyMap<string, AuthoritativeTaskStopEntry>;
}): boolean {
  const taskId = params.taskId?.trim() ?? "";
  if (taskId) {
    const store = params.authoritativeStops ?? authoritativeTaskStops;
    if (store.has(taskId)) {
      return true;
    }
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
 * Combines authoritative task stops with any still-live aborted controllers.
 */
export function buildResumeTaskStopActive(params: {
  sessionKeys: Iterable<string>;
  chatAbortControllers: ReadonlyMap<string, SessionStopBarrierEntry>;
}): (taskId: string) => boolean {
  const sessionKeys = [...params.sessionKeys];
  const controllers = params.chatAbortControllers;
  return (taskId: string) =>
    sessionStopBarrierActive({
      sessionKeys,
      chatAbortControllers: controllers,
      taskId,
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
