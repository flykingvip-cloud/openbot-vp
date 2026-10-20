/**
 * chat.restore must always settle.
 *
 * Workspace snapshot walks and transcript reads can outlive the Control UI
 * (and typical proxy idle windows) without ever rejecting. The deadline aborts
 * cooperative IO so the handler can return a visible error instead of leaving
 * the 「正在恢复…」 button stuck.
 */

export const DEFAULT_CHAT_RESTORE_DEADLINE_MS = 20_000;

export class ChatRestoreTimeoutError extends Error {
  readonly code = "RESTORE_TIMEOUT";

  constructor(message = "checkpoint restore timed out before the conversation was rolled back") {
    super(message);
    this.name = "ChatRestoreTimeoutError";
  }
}

export function resolveChatRestoreDeadlineMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.OPENBOT_CHAT_RESTORE_DEADLINE_MS?.trim();
  if (!raw) {
    return DEFAULT_CHAT_RESTORE_DEADLINE_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CHAT_RESTORE_DEADLINE_MS;
  }
  return Math.min(Math.floor(parsed), 120_000);
}

export function createChatRestoreDeadline(deadlineMs = resolveChatRestoreDeadlineMs()): {
  signal: AbortSignal;
  clear: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new ChatRestoreTimeoutError());
    }
  }, deadlineMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
    },
  };
}

export function throwIfRestoreAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }
  const reason = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  throw new ChatRestoreTimeoutError();
}

export function isChatRestoreTimeout(err: unknown, signal?: AbortSignal): boolean {
  if (err instanceof ChatRestoreTimeoutError) {
    return true;
  }
  if (signal?.aborted) {
    return true;
  }
  if (!err || typeof err !== "object") {
    return false;
  }
  const named = err as { name?: unknown; code?: unknown };
  return named.name === "AbortError" || named.code === "ABORT_ERR";
}

/**
 * Settle when `work` finishes or when `signal` aborts, whichever is first.
 * A late rejection from `work` after the abort is swallowed so the handler
 * can respond once.
 */
export function raceChatRestoreWork<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let settled = false;
  const raced = new Promise<T>((resolve, reject) => {
    const fail = (err: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(err);
    };
    const onAbort = () => {
      const reason = signal.reason;
      fail(reason instanceof ChatRestoreTimeoutError ? reason : new ChatRestoreTimeoutError());
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => fail(err),
    );
  });
  void work.catch(() => {
    // The race already reported the abort; ignore the late failure.
  });
  return raced;
}
