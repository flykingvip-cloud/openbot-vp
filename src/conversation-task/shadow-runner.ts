/**
 * ConversationTask Runtime — P2.5 async shadow runner (admission §5 AC5; design §4).
 *
 * A fire-and-forget worker that decouples shadow computation/persistence from the
 * chat reply path. Contract (all frozen by AC5):
 *  - **Bounded queue** (fixed capacity) — never an unbounded backlog.
 *  - **Max concurrency** (fixed) — bounded in-flight work.
 *  - **Single overload policy: drop-new** — when the queue is full, the newest job
 *    is dropped and a `dropped` event is emitted (never drop-old, never grow).
 *  - **Per-item timeout** — a slow/stuck handler is abandoned after `itemTimeoutMs`
 *    and counted as `timeout`; it can never wedge the worker.
 *  - **Unified rejection capture** — every handler run is wrapped in try/catch, so a
 *    throwing/rejecting handler produces a `failure` event and never an unhandled
 *    rejection.
 *  - **Bounded shutdown drain** — `shutdown(capMs)` stops intake, drains in-flight +
 *    queued up to `capMs`, then safely discards the remainder (never waits forever).
 *  - **`submit()` is synchronous and non-blocking** — it enqueues (or drops) and
 *    returns immediately, so the reply path is never slowed by a slow handler.
 *
 * The runner is generic over the job type; the caller injects a `handler`. The
 * handler is responsible for reusing a per-tenant connection (never opening a DB
 * per message). This module performs no side effects of its own.
 */

export const SHADOW_RUNNER_DEFAULT_MAX_QUEUE = 1_000;
export const SHADOW_RUNNER_DEFAULT_MAX_CONCURRENCY = 4;
export const SHADOW_RUNNER_DEFAULT_ITEM_TIMEOUT_MS = 2_000;
export const SHADOW_RUNNER_DEFAULT_DRAIN_CAP_MS = 5_000;

export type ShadowRunnerEvent =
  | { type: "queued"; depth: number }
  | { type: "dropped"; reason: "queue_full" | "closed" }
  | { type: "success" }
  | { type: "failure"; error: unknown }
  | { type: "timeout" };

export type ShadowRunnerOptions<TJob> = {
  /** The actual work (e.g. write to a per-tenant ShadowLogBook). May be sync or async. */
  handler: (job: TJob) => void | Promise<void>;
  maxQueue?: number;
  maxConcurrency?: number;
  itemTimeoutMs?: number;
  onEvent?: (event: ShadowRunnerEvent) => void;
};

export type ShadowRunnerShutdownResult = {
  /** Jobs that completed (success/failure/timeout) during the drain window. */
  drained: number;
  /** Jobs still queued when the drain cap elapsed and were discarded. */
  discarded: number;
};

/** Race a possibly-async handler against a per-item timeout; never leaves a dangling reject. */
function runWithTimeout(
  run: () => void | Promise<void>,
  timeoutMs: number,
): Promise<"ok" | "timeout"> {
  let settled = false;
  return new Promise<"ok" | "timeout">((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve("timeout");
        }
      }, timeoutMs);
    }
    Promise.resolve()
      .then(run)
      .then(
        () => {
          if (!settled) {
            settled = true;
            if (timer) {
              clearTimeout(timer);
            }
            resolve("ok");
          }
        },
        (err: unknown) => {
          if (!settled) {
            settled = true;
            if (timer) {
              clearTimeout(timer);
            }
            reject(err);
          }
        },
      );
  });
}

export class ShadowRunner<TJob> {
  private readonly handler: (job: TJob) => void | Promise<void>;
  private readonly maxQueue: number;
  private readonly maxConcurrency: number;
  private readonly itemTimeoutMs: number;
  private readonly onEvent?: (event: ShadowRunnerEvent) => void;
  private readonly queue: TJob[] = [];
  private inFlight = 0;
  private closed = false;
  private drained = 0;

  constructor(options: ShadowRunnerOptions<TJob>) {
    this.handler = options.handler;
    this.maxQueue = Math.max(1, options.maxQueue ?? SHADOW_RUNNER_DEFAULT_MAX_QUEUE);
    this.maxConcurrency = Math.max(
      1,
      options.maxConcurrency ?? SHADOW_RUNNER_DEFAULT_MAX_CONCURRENCY,
    );
    this.itemTimeoutMs = options.itemTimeoutMs ?? SHADOW_RUNNER_DEFAULT_ITEM_TIMEOUT_MS;
    this.onEvent = options.onEvent;
  }

  get depth(): number {
    return this.queue.length;
  }

  get inFlightCount(): number {
    return this.inFlight;
  }

  private emit(event: ShadowRunnerEvent): void {
    try {
      this.onEvent?.(event);
    } catch {
      // metrics must never break the runner
    }
  }

  /**
   * Enqueue a job. Synchronous, non-blocking. Returns "dropped" when the runner is
   * closed or the bounded queue is full (drop-new). Never throws.
   */
  submit(job: TJob): "queued" | "dropped" {
    if (this.closed) {
      this.emit({ type: "dropped", reason: "closed" });
      return "dropped";
    }
    if (this.queue.length >= this.maxQueue) {
      this.emit({ type: "dropped", reason: "queue_full" });
      return "dropped";
    }
    this.queue.push(job);
    this.emit({ type: "queued", depth: this.queue.length });
    this.pump();
    return "queued";
  }

  private pump(): void {
    while (this.inFlight < this.maxConcurrency && this.queue.length > 0) {
      const job = this.queue.shift() as TJob;
      this.inFlight += 1;
      // Fire-and-forget; runItem never rejects (all outcomes handled internally).
      void this.runItem(job);
    }
  }

  private async runItem(job: TJob): Promise<void> {
    try {
      const outcome = await runWithTimeout(() => this.handler(job), this.itemTimeoutMs);
      this.emit(outcome === "timeout" ? { type: "timeout" } : { type: "success" });
    } catch (error) {
      this.emit({ type: "failure", error });
    } finally {
      this.inFlight -= 1;
      this.drained += 1;
      this.pump();
    }
  }

  /**
   * Stop intake and drain in-flight + queued work up to `capMs`, then discard the
   * remainder. Always resolves within ~capMs; never waits forever.
   */
  async shutdown(capMs = SHADOW_RUNNER_DEFAULT_DRAIN_CAP_MS): Promise<ShadowRunnerShutdownResult> {
    this.closed = true;
    const startDrained = this.drained;
    const deadline = Date.now() + Math.max(0, capMs);
    while ((this.inFlight > 0 || this.queue.length > 0) && Date.now() < deadline) {
      this.pump();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const discarded = this.queue.length;
    this.queue.length = 0; // safe discard of anything not drained within the cap
    return { drained: this.drained - startDrained, discarded };
  }
}
