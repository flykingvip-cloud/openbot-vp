import { isAbortRequestText } from "../auto-reply/reply/abort.js";

export type ChatAbortControllerEntry = {
  controller: AbortController;
  sessionId: string;
  sessionKey: string;
  startedAtMs: number;
  expiresAtMs: number;
  /**
   * Whether this run can still be fully undone without leaving an assistant
   * abort stub in history. Once any visible assistant text or other outbound
   * side effect has happened, this flips false and `undo` degrades to stop.
   */
  undoable?: boolean;
  /**
   * Local user message id/idempotency bound to this run so UI surfaces may
   * remove the optimistic row when an undo succeeds.
   */
  userMessageId?: string;
  /**
   * Sanitized user body captured at run start. Used only to recognize a
   * same-session, same-body retry while this run is still active.
   */
  userMessageText?: string;
};

export function isChatStopCommandText(text: string): boolean {
  return isAbortRequestText(text);
}

function normalizeChatSendBody(text: string): string {
  return text.trim();
}

/**
 * Same session + same body + still-active run → treat as in-flight retry.
 * Missing `userMessageText` fails open so older entries and child bot runs
 * are never collapsed. After the controller is removed, a later send proceeds.
 */
export function findActiveDuplicateChatSend(
  controllers: Map<string, ChatAbortControllerEntry>,
  params: { sessionKey: string; userMessageText: string },
): { runId: string; entry: ChatAbortControllerEntry } | undefined {
  const needle = normalizeChatSendBody(params.userMessageText);
  if (!needle) {
    return undefined;
  }
  for (const [runId, entry] of controllers) {
    if (entry.sessionKey !== params.sessionKey) {
      continue;
    }
    if (entry.userMessageText === undefined) {
      continue;
    }
    if (normalizeChatSendBody(entry.userMessageText) === needle) {
      return { runId, entry };
    }
  }
  return undefined;
}

export function resolveChatRunExpiresAtMs(params: {
  now: number;
  timeoutMs: number;
  graceMs?: number;
  minMs?: number;
  maxMs?: number;
}): number {
  const { now, timeoutMs, graceMs = 60_000, minMs = 2 * 60_000, maxMs = 24 * 60 * 60_000 } = params;
  const boundedTimeoutMs = Math.max(0, timeoutMs);
  const target = now + boundedTimeoutMs + graceMs;
  const min = now + minMs;
  const max = now + maxMs;
  return Math.min(max, Math.max(min, target));
}

export type ChatAbortOps = {
  chatAbortControllers: Map<string, ChatAbortControllerEntry>;
  chatRunBuffers: Map<string, string>;
  chatDeltaSentAt: Map<string, number>;
  chatAbortedRuns: Map<string, number>;
  removeChatRun: (
    sessionId: string,
    clientRunId: string,
    sessionKey?: string,
  ) => { sessionKey: string; clientRunId: string } | undefined;
  agentRunSeq: Map<string, number>;
  /**
   * Authorized chat fan-out only. Must not fall back to install-wide
   * `broadcast("chat")` (daibai isolation conditional approval 2026-08-12).
   */
  broadcastChat: (
    sessionKey: string,
    payload: unknown,
    opts?: { dropIfSlow?: boolean; tenantId?: string | null; runId?: string | null },
  ) => void;
  nodeSendToSession: (sessionKey: string, event: string, payload: unknown) => void;
};

export type ChatAbortMode = "stop" | "undo";

function broadcastChatAborted(
  ops: ChatAbortOps,
  params: {
    runId: string;
    sessionKey: string;
    stopReason?: string;
    partialText?: string;
    mode?: ChatAbortMode;
    userMessageId?: string;
  },
) {
  const { runId, sessionKey, stopReason, partialText, mode = "stop", userMessageId } = params;
  const payload = {
    runId,
    sessionKey,
    seq: (ops.agentRunSeq.get(runId) ?? 0) + 1,
    state: "aborted" as const,
    stopReason,
    mode,
    ...(userMessageId ? { userMessageId } : {}),
    message: partialText
      ? {
          role: "assistant",
          content: [{ type: "text", text: partialText }],
          timestamp: Date.now(),
        }
      : undefined,
  };
  ops.broadcastChat(sessionKey, payload);
  ops.nodeSendToSession(sessionKey, "chat", payload);
}

export function abortChatRunById(
  ops: ChatAbortOps,
  params: {
    runId: string;
    sessionKey: string;
    stopReason?: string;
    mode?: ChatAbortMode;
  },
): { aborted: boolean; undone?: boolean } {
  const { runId, sessionKey, stopReason, mode = "stop" } = params;
  const active = ops.chatAbortControllers.get(runId);
  if (!active) {
    return { aborted: false };
  }
  if (active.sessionKey !== sessionKey) {
    return { aborted: false };
  }

  const canUndo = mode === "undo" && active.undoable !== false;
  const bufferedText = ops.chatRunBuffers.get(runId);
  const partialText = canUndo || !(bufferedText && bufferedText.trim()) ? undefined : bufferedText;
  ops.chatAbortedRuns.set(runId, Date.now());
  active.controller.abort();
  ops.chatAbortControllers.delete(runId);
  ops.chatRunBuffers.delete(runId);
  ops.chatDeltaSentAt.delete(runId);
  const removed = ops.removeChatRun(runId, runId, sessionKey);
  broadcastChatAborted(ops, {
    runId,
    sessionKey,
    stopReason,
    partialText,
    mode: canUndo ? "undo" : "stop",
    userMessageId: active.userMessageId,
  });
  ops.agentRunSeq.delete(runId);
  if (removed?.clientRunId) {
    ops.agentRunSeq.delete(removed.clientRunId);
  }
  return { aborted: true, undone: canUndo };
}

export function abortChatRunsForSessionKey(
  ops: ChatAbortOps,
  params: {
    sessionKey: string;
    stopReason?: string;
    mode?: ChatAbortMode;
  },
): { aborted: boolean; runIds: string[] } {
  const { sessionKey, stopReason, mode = "stop" } = params;
  const runIds: string[] = [];
  for (const [runId, active] of ops.chatAbortControllers) {
    if (active.sessionKey !== sessionKey) {
      continue;
    }
    const res = abortChatRunById(ops, { runId, sessionKey, stopReason, mode });
    if (res.aborted) {
      runIds.push(runId);
    }
  }
  return { aborted: runIds.length > 0, runIds };
}

export function markChatRunNotUndoable(
  chatAbortControllers: Map<string, ChatAbortControllerEntry>,
  runId: string,
): void {
  const active = chatAbortControllers.get(runId);
  if (!active || active.undoable === false) {
    return;
  }
  chatAbortControllers.set(runId, { ...active, undoable: false });
}
