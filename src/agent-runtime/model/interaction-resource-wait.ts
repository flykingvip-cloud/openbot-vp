/**
 * Explicit interaction resource budget. The default covers the whole
 * interaction chain (queue wait, candidate fallback, inference, persist).
 * It never grants extra concurrency or skips authorization, and it does not
 * change execution-A's business deadline.
 */
export const INTERACTION_RESOURCE_WAIT_ENV = "OPENBOT_INTERACTION_RESOURCE_WAIT_MS";
/** Default wall-clock budget for one interaction to answer or clearly degrade. */
export const DEFAULT_INTERACTION_RESOURCE_WAIT_MS = 15_000;
/**
 * When the commercial slot is already held (e.g. execution A is hanging),
 * interaction B must still return a deterministic blocked/degraded receipt
 * quickly. This caps only the slot wait, not the total interaction deadline
 * and not execution-A's timeout.
 */
export const INTERACTION_BLOCKED_RECEIPT_MS = 2_000;
/**
 * Time reserved from the 2s blocked-receipt cap so polling, persist I/O, and
 * the visible consumer can still settle within the original 2-second threshold.
 * This does not change the user-visible deadline and does not rewrite the queue.
 */
export const INTERACTION_BLOCKED_RECEIPT_MARGIN_MS = 120;

export type InteractionResourceBudget = {
  budgetMs: number;
  startedMs: number;
  remainingMs(nowMs?: number): number;
  isExhausted(nowMs?: number): boolean;
  /** Remaining time that may be spent waiting for a commercial slot. */
  remainingQueueWaitMs(nowMs?: number): number;
};

export function resolveInteractionResourceWaitMs(opts?: {
  overrideMs?: number;
  /** Do not exceed this ceiling (typically the host agent timeout). */
  capMs?: number;
  nowMs?: number;
}): number {
  const override = finitePositive(opts?.overrideMs);
  const fromEnv = finitePositive(
    Number.parseInt(process.env[INTERACTION_RESOURCE_WAIT_ENV] ?? "", 10),
  );
  const resolved = override ?? fromEnv ?? DEFAULT_INTERACTION_RESOURCE_WAIT_MS;
  const cap = finitePositive(opts?.capMs);
  return Math.max(1, cap === undefined ? resolved : Math.min(resolved, cap));
}

export function createInteractionResourceBudget(opts?: {
  overrideMs?: number;
  capMs?: number;
  nowMs?: number;
}): InteractionResourceBudget {
  const budgetMs = resolveInteractionResourceWaitMs(opts);
  const startedMs = opts?.nowMs ?? Date.now();
  const remainingMs = (nowMs = Date.now()): number =>
    Math.max(0, budgetMs - Math.max(0, nowMs - startedMs));
  return {
    budgetMs,
    startedMs,
    remainingMs,
    isExhausted(nowMs = Date.now()): boolean {
      return remainingMs(nowMs) <= 0;
    },
    remainingQueueWaitMs(nowMs = Date.now()): number {
      const cap = Math.max(
        0,
        INTERACTION_BLOCKED_RECEIPT_MS - INTERACTION_BLOCKED_RECEIPT_MARGIN_MS,
      );
      return Math.min(remainingMs(nowMs), cap);
    },
  };
}

export function isInteractionBudgetExhausted(
  budget: InteractionResourceBudget | undefined,
  nowMs = Date.now(),
): boolean {
  return budget?.isExhausted(nowMs) === true;
}

export const INTERACTION_TIMEOUT_TEXT =
  "本轮交互在时限内没有得到有效输出，没有启动或修改任务。本轮请求已结束，不会自动补做。";
export const INTERACTION_MODEL_FAILURE_TEXT =
  "本轮交互未能完成（模型或服务失败），没有启动或修改任务。本轮请求已结束，不会自动补做。";
export const INTERACTION_QUEUE_TIMEOUT_TEXT =
  "交互资源等待已达上限，本轮没有启动或修改任务。请稍后重试。";
export const INTERACTION_RECORD_UNAVAILABLE_TEXT =
  "记录暂不可用，不能视为已耐久保存；恢复后将按原请求身份对账。";
export const CHAT_TURN_ERROR_UNCONFIRMED_TEXT =
  "本轮出现错误，是否已发生业务动作需要按原请求身份核对，不能视为已完成。";

export type InteractionFailureKind = "timeout" | "empty" | "model" | "queue_timeout" | "other";

export function interactionTimeoutError(): Error {
  return Object.assign(new Error("timeout"), {
    interactionPhase: "interpretation" as const,
    reason: "timeout",
  });
}

export function isInteractionUserAbort(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = "name" in error ? String(error.name) : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "TimeoutError" || /timeout/i.test(message)) {
    return false;
  }
  return (
    name === "AbortError" &&
    !("interactionPhase" in error && (error as { interactionPhase?: string }).interactionPhase)
  );
}

/**
 * Bound the *visible* wait against the original deadline. The raced work
 * is not cancelled; callers keep cleanup / usage responsibility.
 */

function deadlineAfter<T = never>(remainingMs: number): Promise<T> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      // Yield one macrotask so a cooperative waiter due on the same tick
      // (for example a queue wait equal to this deadline) can settle first.
      setImmediate(() => reject(interactionTimeoutError()));
    }, remainingMs);
  });
}

export async function raceVisibleInteraction<T>(
  work: Promise<T>,
  opts: { signal?: AbortSignal; remainingMs?: number },
): Promise<T> {
  const remaining = opts.remainingMs;
  if (opts.signal?.aborted) {
    throw visibleDeadlineError(opts.signal);
  }
  if (remaining !== undefined && remaining <= 0) {
    throw interactionTimeoutError();
  }
  const racers: Promise<T>[] = [work];
  if (opts.signal) {
    racers.push(whenAborted(opts.signal));
  }
  if (remaining !== undefined) {
    racers.push(deadlineAfter(remaining));
  }
  return await Promise.race(racers);
}

function whenAborted<T = never>(signal: AbortSignal): Promise<T> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(visibleDeadlineError(signal));
      return;
    }
    signal.addEventListener("abort", () => reject(visibleDeadlineError(signal)), { once: true });
  });
}

function visibleDeadlineError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (isInteractionUserAbort(reason)) {
    return reason instanceof Error
      ? reason
      : new Error("The operation was aborted.", { cause: reason });
  }
  return interactionTimeoutError();
}

export function classifyInteractionFailure(error: unknown): InteractionFailureKind {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const name = readErrorStringField(error, "name");
  const reason = readErrorStringField(error, "reason");
  if (
    reason === "CONCURRENCY_QUEUE_TIMEOUT" ||
    message.includes("并发排队超时") ||
    message.includes("交互资源等待已达上限")
  ) {
    return "queue_timeout";
  }
  if (
    reason === "timeout" ||
    message === "timeout" ||
    name === "TimeoutError" ||
    /timed? ?out/i.test(message) ||
    message.includes("本轮交互在时限内没有得到有效输出") ||
    message.includes("本轮未取得有效的交互决定")
  ) {
    return message.includes("本轮未取得有效的交互决定") ? "empty" : "timeout";
  }
  if (
    /^(?:Invalid interaction|Interaction did not return a final decision|Interaction requires finite|Interaction target is not bound)/.test(
      message,
    )
  ) {
    return "other";
  }
  return "model";
}

export function formatInteractionFailureReply(error: unknown): string {
  const kind = classifyInteractionFailure(error);
  if (kind === "queue_timeout") {
    const message = error instanceof Error ? error.message.trim() : "";
    return message || INTERACTION_QUEUE_TIMEOUT_TEXT;
  }
  if (kind === "timeout" || kind === "empty") {
    return INTERACTION_TIMEOUT_TEXT;
  }
  return INTERACTION_MODEL_FAILURE_TEXT;
}

function readErrorStringField(error: unknown, field: "name" | "reason"): string {
  if (!error || typeof error !== "object" || !(field in error)) {
    return "";
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}
