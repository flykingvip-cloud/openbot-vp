import type { ChatAbortControllerEntry } from "./chat-abort.js";

export type PendingChatRestoreRequest = {
  sessionKey: string;
  checkpointId?: string;
  /** Best-effort client snapshot for queued auto-restore after run completes. */
  client: unknown;
  enqueuedAtMs: number;
};

const pendingBySession = new Map<string, PendingChatRestoreRequest>();

export function hasActiveChatRunForSession(
  controllers: Map<string, ChatAbortControllerEntry>,
  sessionKey: string,
): boolean {
  for (const active of controllers.values()) {
    if (active.sessionKey === sessionKey) {
      return true;
    }
  }
  return false;
}

export function enqueuePendingChatRestore(
  sessionKey: string,
  request: PendingChatRestoreRequest,
): void {
  pendingBySession.set(sessionKey, request);
}

export function peekPendingChatRestore(sessionKey: string): PendingChatRestoreRequest | undefined {
  return pendingBySession.get(sessionKey);
}

export function takePendingChatRestore(sessionKey: string): PendingChatRestoreRequest | undefined {
  const pending = pendingBySession.get(sessionKey);
  if (pending) {
    pendingBySession.delete(sessionKey);
  }
  return pending;
}

export function clearPendingChatRestoreForTests(): void {
  pendingBySession.clear();
}
