/**
 * In-process OGUI WAIT set.
 *
 * Populated only when the lifecycle flag is on and a session read or
 * `updateSessionStore` write observes a waiting decision. Flag-off keeps
 * this empty, so tool hooks and settle do not change behavior.
 *
 * This is not a job queue. `filterToolsByPolicy` stays a name filter;
 * callers re-check this set before a tool starts.
 */

const waitsBySession = new Map<string, Set<string>>();

export function replaceOguiSessionWaits(
  sessionKey: string | undefined,
  decisionIds: readonly string[],
): void {
  const key = sessionKey?.trim() ?? "";
  if (!key) {
    return;
  }
  const ids = decisionIds.map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) {
    waitsBySession.delete(key);
    return;
  }
  waitsBySession.set(key, new Set(ids));
}

/** True when this process has a waiting decision for the session. */
export function oguiWaitBlocksSession(sessionKey: string | undefined): boolean {
  const key = sessionKey?.trim() ?? "";
  if (!key) {
    return false;
  }
  const ids = waitsBySession.get(key);
  return Boolean(ids && ids.size > 0);
}

export function clearOguiWaitRegistryForTests(): void {
  waitsBySession.clear();
}
