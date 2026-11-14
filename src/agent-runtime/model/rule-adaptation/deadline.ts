/**
 * Combined external-cancel + duration deadline for one completion.
 * Listeners and the timer are always cleared by `cleanup()`, including in a
 * `finally` path. This reuses the same idea as
 * `AbortSignal.any([abortSignal, AbortSignal.timeout(timeoutMs)])` but owns
 * the timer so it can be cleared without leaking.
 */
export type CombinedDeadline = {
  signal: AbortSignal;
  timeoutMs: number;
  cleanup(): void;
};

export type CreateCombinedDeadline = (input: {
  timeoutMs: number;
  external?: AbortSignal;
}) => CombinedDeadline;

export function createCombinedDeadline(input: {
  timeoutMs: number;
  external?: AbortSignal;
}): CombinedDeadline {
  const timeoutMs = Math.max(1, Math.floor(input.timeoutMs));
  const controller = new AbortController();
  let finished = false;

  const abortFromTimeout = (): void => {
    if (finished || controller.signal.aborted) {
      return;
    }
    controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
  };

  const abortFromExternal = (): void => {
    if (finished || controller.signal.aborted) {
      return;
    }
    controller.abort(input.external?.reason ?? "signal_aborted");
  };

  const timer: ReturnType<typeof setTimeout> = setTimeout(abortFromTimeout, timeoutMs);

  if (input.external) {
    if (input.external.aborted) {
      abortFromExternal();
    } else {
      input.external.addEventListener("abort", abortFromExternal, { once: true });
    }
  }

  return {
    signal: controller.signal,
    timeoutMs,
    cleanup() {
      finished = true;
      clearTimeout(timer);
      input.external?.removeEventListener("abort", abortFromExternal);
    },
  };
}
