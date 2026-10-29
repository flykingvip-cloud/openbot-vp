/**
 * Live ResumeParkedRecheck for the chat.send entry path.
 *
 * applyFocusSwitchGate already fail-closes when authOk===false or stopActive===true.
 * chat.send must resolve those flags from real send-time signals before resume
 * proceeds — never call the gate without a recheck on the user resume path.
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
  /** True when a stop/abort barrier is active for this session. */
  stopActive?: boolean;
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
  };
}

export type SessionStopBarrierEntry = {
  sessionKey: string;
  controller?: { signal?: { aborted?: boolean } };
};

/** True when any live abort controller for the session has already aborted. */
export function sessionStopBarrierActive(params: {
  sessionKeys: Iterable<string>;
  chatAbortControllers: ReadonlyMap<string, SessionStopBarrierEntry>;
}): boolean {
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
