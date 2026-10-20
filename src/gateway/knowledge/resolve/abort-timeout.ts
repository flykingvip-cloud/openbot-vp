export type AbortTimeoutStatus = "ok" | "timeout" | "aborted";

export type AbortTimeoutResult<T> = { status: "ok"; value: T } | { status: "timeout" | "aborted" };

/**
 * Run work against a linked AbortController. Timeout/parent abort settle
 * immediately, abort the signal so cancellable IO (fetch) stops, and discard
 * late results so they cannot be written after abort.
 */
export async function runWithAbortTimeout<T>(params: {
  timeoutMs: number;
  abortSignal?: AbortSignal;
  run: (signal: AbortSignal) => Promise<T>;
}): Promise<AbortTimeoutResult<T>> {
  const controller = new AbortController();
  let settled = false;

  return await new Promise<AbortTimeoutResult<T>>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      params.abortSignal?.removeEventListener("abort", onParentAbort);
    };
    const finish = (result: AbortTimeoutResult<T>) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };

    const onParentAbort = () => {
      controller.abort(params.abortSignal?.reason ?? "aborted");
      finish({ status: "aborted" });
    };

    const timer = setTimeout(() => {
      controller.abort("knowledge-timeout");
      finish({ status: "timeout" });
    }, params.timeoutMs);

    if (params.abortSignal) {
      if (params.abortSignal.aborted) {
        onParentAbort();
        return;
      }
      params.abortSignal.addEventListener("abort", onParentAbort, { once: true });
    }

    void params.run(controller.signal).then(
      (value) => {
        if (controller.signal.aborted) {
          return;
        }
        finish({ status: "ok", value });
      },
      (error) => {
        if (controller.signal.aborted) {
          return;
        }
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = "name" in error ? String(error.name) : "";
  return name === "AbortError" || name === "TimeoutError";
}
