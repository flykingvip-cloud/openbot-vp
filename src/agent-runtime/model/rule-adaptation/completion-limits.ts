/**
 * Enforce remaining output-token and duration limits on one completion.
 * Cost is not pre-enforced here; it is estimated and accounted after the fact.
 *
 * The wait itself responds to the combined deadline abort (external cancel or
 * timeout), not only a timer race. Shared `withTimeout` is left unchanged.
 */
import type {
  ModelCompletion,
  ModelUsage,
  RuleAdaptationModelPort,
  ShadowCompletionLimits,
  ShadowDiagnosticSink,
  ShadowUsageAccountingStatus,
  ShadowUsageRecorder,
  ShadowUsageRecordOutcome,
  ShadowUsageRecordReason,
} from "../../contracts/rule-adaptation-shadow.js";
import { asModelUsage, zeroUsage } from "./budget.js";
import {
  createCombinedDeadline,
  type CombinedDeadline,
  type CreateCombinedDeadline,
} from "./deadline.js";

export type LimitedCompletionInput = Parameters<RuleAdaptationModelPort["complete"]>[0];

export type InvokeLimitedCompletionOptions = {
  complete: RuleAdaptationModelPort["complete"];
  input: LimitedCompletionInput;
  createDeadline?: CreateCombinedDeadline;
  /** Optional hook so tests can force cleanup to throw. */
  wrapCleanup?: (cleanup: () => void) => () => void;
  usageRecorder?: ShadowUsageRecorder;
  diagnosticSink?: ShadowDiagnosticSink;
};

export type LimitedCompletion = ModelCompletion & {
  deadlineCleanupFailed: boolean;
  limits: ShadowCompletionLimits;
  outputExceededMaxTokens: boolean;
  /** False when no completion payload supplied usage and none can be assumed. */
  usageKnown: boolean;
  /**
   * False when the wait ended because of cancel/timeout but `complete()` is
   * still pending (it ignored the abort signal). Do not claim the external
   * call was terminated in that case.
   */
  underlyingRequestStopped: boolean;
  /**
   * Settles after the underlying `complete()` finishes and any late usage has
   * been offered to the recorder. Already resolved when the request stopped
   * before return. Never rejects. May never settle if the request is abandoned.
   */
  whenUnderlyingSettled: Promise<void>;
  /** True when a usage post was attempted before this snapshot was returned. */
  usageAccountingAttempted: boolean;
  /**
   * Accounting outcome at return time. Late success or failure is reported
   * through `diagnosticSink`, not by mutating this snapshot.
   */
  usageAccountingStatus: ShadowUsageAccountingStatus;
};

const RECORD_ATTEMPTS_PER_CALL = 2;

function freezeLimitedSnapshot(completion: LimitedCompletion): LimitedCompletion {
  return Object.freeze({
    ...completion,
    usage: Object.freeze({ ...completion.usage }),
    limits: Object.freeze({ ...completion.limits }),
  }) as LimitedCompletion;
}

function interpretRecordOutcome(
  outcome: void | ShadowUsageRecordOutcome,
): ShadowUsageAccountingStatus {
  if (outcome === undefined) {
    // Fixture recorder completed without throwing and without a structured
    // result: the attempt itself succeeded. A no-reporting path should return
    // `{ attempted: false }` explicitly.
    return "succeeded";
  }
  if (outcome.attempted === false) {
    return "not_attempted";
  }
  if (outcome.deduped === true || outcome.recorded === true) {
    return "succeeded";
  }
  if (outcome.recorded === false && outcome.deduped === false) {
    return "unknown";
  }
  return "succeeded";
}

function usageFromUnknown(value: unknown): ModelUsage | undefined {
  if (typeof value !== "object" || value === null || !("usage" in value)) {
    return undefined;
  }
  const raw = (value as { usage: unknown }).usage;
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  return asModelUsage(raw as Partial<ModelUsage>);
}

function isAbortLike(error: unknown): boolean {
  if (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return true;
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return true;
  }
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    ((error as { name: string }).name === "AbortError" ||
      (error as { name: string }).name === "TimeoutError")
  );
}

function isTimeoutLike(error: unknown, signal?: AbortSignal): boolean {
  if (error instanceof Error && (error.message === "timeout" || error.name === "TimeoutError")) {
    return true;
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return true;
  }
  if (
    signal?.aborted &&
    signal.reason instanceof DOMException &&
    signal.reason.name === "TimeoutError"
  ) {
    return true;
  }
  return false;
}

function withUsage(completion: ModelCompletion, usage: ModelUsage): ModelCompletion {
  return { ...completion, usage };
}

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

/**
 * Race the underlying completion against both the duration timer and the
 * combined deadline abort. This is the local equivalent of `withTimeout`,
 * extended so an external cancel ends the wait immediately. The shared
 * production `withTimeout` helper is not modified.
 */
function waitForCompletionOrDeadline<T>(
  running: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const settle = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      signal.removeEventListener("abort", onAbort);
      action();
    };

    const onAbort = (): void => {
      settle(() => {
        if (isTimeoutLike(signal.reason, signal)) {
          reject(new Error("timeout"));
        } else {
          reject(abortError());
        }
      });
    };

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        settle(() => reject(new Error("timeout")));
      }, timeoutMs);
    }
    running.then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    );
  });
}

export async function invokeLimitedCompletion(
  options: InvokeLimitedCompletionOptions,
): Promise<LimitedCompletion> {
  const maxTokens = Math.max(0, Math.floor(options.input.maxTokens));
  const timeoutMs = Math.max(0, Math.floor(options.input.timeoutMs));
  const limits: ShadowCompletionLimits = { maxTokens, timeoutMs };
  let deadlineCleanupFailed = false;
  let captured = zeroUsage();
  let capturedFromCompletion = false;
  let accountingAttempted = false;
  let accountingStatus: ShadowUsageAccountingStatus = "not_attempted";
  let snapshotReturned = false;
  let underlyingSettled = false;
  let waitFinished = false;
  let releaseUnderlying: () => void = () => {};
  const whenUnderlyingSettled = new Promise<void>((resolve) => {
    releaseUnderlying = resolve;
  });

  const reportLateAccounting = (): void => {
    if (!snapshotReturned) {
      return;
    }
    options.diagnosticSink?.report({
      kind: "usage_accounting",
      usageKnown: capturedFromCompletion,
      usageAccountingAttempted: accountingAttempted,
      usageAccountingStatus: accountingStatus,
    });
  };

  const recordOnce = async (usage: ModelUsage, reason: ShadowUsageRecordReason): Promise<void> => {
    // Successful posts (including idempotent dedupe) must not be retried.
    // Failed or unknown attempts may be retried with the same identity.
    if (accountingStatus === "succeeded") {
      return;
    }
    if (!options.usageRecorder) {
      return;
    }
    for (let attempt = 0; attempt < RECORD_ATTEMPTS_PER_CALL; attempt += 1) {
      accountingAttempted = true;
      try {
        const outcome = await options.usageRecorder.recordUsage({ usage, reason });
        accountingStatus = interpretRecordOutcome(outcome);
      } catch {
        // A posting failure must stay diagnosable and must not become a
        // thrown task failure or a claimed successful post.
        accountingStatus = "failed";
      }
      if (accountingStatus === "succeeded" || accountingStatus === "not_attempted") {
        return;
      }
    }
  };

  const finish = async (
    completion: ModelCompletion,
    reason: ShadowUsageRecordReason,
    flags: { usageKnown: boolean; underlyingRequestStopped: boolean },
  ): Promise<LimitedCompletion> => {
    const usage = flags.usageKnown
      ? capturedFromCompletion
        ? captured
        : asModelUsage(completion.usage)
      : zeroUsage();
    const normalized = withUsage(completion, usage);
    const outputExceededMaxTokens =
      flags.usageKnown && usage.outputTokens > maxTokens && maxTokens > 0;
    if (flags.usageKnown) {
      await recordOnce(usage, reason);
    }
    if (flags.underlyingRequestStopped) {
      releaseUnderlying();
    }
    const snapshot = freezeLimitedSnapshot({
      ...normalized,
      deadlineCleanupFailed,
      limits,
      outputExceededMaxTokens,
      usageKnown: flags.usageKnown,
      underlyingRequestStopped: flags.underlyingRequestStopped,
      whenUnderlyingSettled,
      usageAccountingAttempted: accountingAttempted,
      usageAccountingStatus: accountingStatus,
    });
    snapshotReturned = true;
    return snapshot;
  };

  const followUnderlying = (running: Promise<ModelCompletion>): void => {
    void running.then(
      async (result) => {
        underlyingSettled = true;
        captured = asModelUsage(result.usage);
        capturedFromCompletion = true;
        // Only the late path records here. Same-tick settlement is recorded
        // by finish() with the original reason, avoiding a double count.
        // A prior failed attempt may be retried with the same identity.
        if (waitFinished && accountingStatus !== "succeeded") {
          await recordOnce(captured, "late_usage");
          reportLateAccounting();
        }
        if (waitFinished) {
          releaseUnderlying();
        }
      },
      async (error: unknown) => {
        underlyingSettled = true;
        const extracted = usageFromUnknown(error);
        if (extracted) {
          captured = extracted;
          capturedFromCompletion = true;
          if (waitFinished && accountingStatus !== "succeeded") {
            await recordOnce(extracted, "late_usage");
            reportLateAccounting();
          }
        }
        if (waitFinished) {
          releaseUnderlying();
        }
      },
    );
  };

  if (options.input.signal?.aborted) {
    releaseUnderlying();
    return finish(
      {
        kind: "cancelled",
        usage: zeroUsage(),
        reason: "signal_aborted_before_completion",
      },
      "cancelled",
      { usageKnown: true, underlyingRequestStopped: true },
    );
  }
  if (timeoutMs <= 0) {
    releaseUnderlying();
    return finish({ kind: "cancelled", usage: zeroUsage(), reason: "timeout" }, "timeout", {
      usageKnown: true,
      underlyingRequestStopped: true,
    });
  }

  const createDeadline = options.createDeadline ?? createCombinedDeadline;
  const deadline: CombinedDeadline = createDeadline({
    timeoutMs,
    external: options.input.signal,
  });
  const rawCleanup = (): void => {
    deadline.cleanup();
  };
  const cleanup = options.wrapCleanup ? options.wrapCleanup(rawCleanup) : rawCleanup;

  let completion: LimitedCompletion | undefined;
  try {
    const running = options.complete({
      ...options.input,
      maxTokens,
      timeoutMs: deadline.timeoutMs,
      signal: deadline.signal,
    });
    followUnderlying(running);

    try {
      const result = await waitForCompletionOrDeadline(
        running,
        deadline.timeoutMs,
        deadline.signal,
      );
      waitFinished = true;
      // Allow a well-behaved completion that resolved synchronously in an
      // abort listener to mark usage and stopped-state before we decide.
      await Promise.resolve();
      if (deadline.signal.aborted || options.input.signal?.aborted) {
        const timeout = isTimeoutLike(deadline.signal.reason, deadline.signal);
        completion = await finish(
          {
            kind: "cancelled",
            usage: captured,
            reason: timeout ? "timeout" : "signal_aborted",
          },
          timeout ? "timeout" : "cancelled",
          {
            usageKnown: capturedFromCompletion,
            underlyingRequestStopped: underlyingSettled,
          },
        );
      } else {
        const reason: ShadowUsageRecordReason =
          asModelUsage(result.usage).outputTokens > maxTokens && maxTokens > 0
            ? "output_overflow"
            : result.kind === "cancelled"
              ? "cancelled"
              : result.kind === "protocol_failure"
                ? "protocol_failure"
                : "complete";
        completion = await finish(result, reason, {
          usageKnown: true,
          underlyingRequestStopped: true,
        });
      }
    } catch (error) {
      waitFinished = true;
      await Promise.resolve();
      if (
        isTimeoutLike(error, deadline.signal) ||
        isAbortLike(error) ||
        options.input.signal?.aborted ||
        deadline.signal.aborted
      ) {
        const timeout = isTimeoutLike(error, deadline.signal);
        completion = await finish(
          {
            kind: "cancelled",
            usage: captured,
            reason: timeout ? "timeout" : "signal_aborted",
          },
          timeout ? "timeout" : "cancelled",
          {
            usageKnown: capturedFromCompletion,
            underlyingRequestStopped: underlyingSettled,
          },
        );
      } else {
        completion = await finish(
          {
            kind: "protocol_failure",
            usage: captured,
            detail: error instanceof Error ? error.message : "model_protocol_failure",
          },
          "protocol_failure",
          {
            usageKnown: capturedFromCompletion,
            underlyingRequestStopped: underlyingSettled,
          },
        );
      }
    }
  } finally {
    try {
      cleanup();
    } catch {
      deadlineCleanupFailed = true;
    }
  }
  if (!completion) {
    return freezeLimitedSnapshot({
      kind: "protocol_failure",
      usage: captured,
      detail: "completion_missing",
      deadlineCleanupFailed,
      limits,
      outputExceededMaxTokens: false,
      usageKnown: capturedFromCompletion,
      underlyingRequestStopped: underlyingSettled,
      whenUnderlyingSettled,
      usageAccountingAttempted: accountingAttempted,
      usageAccountingStatus: accountingStatus,
    });
  }
  const snapshot = freezeLimitedSnapshot({ ...completion, deadlineCleanupFailed });
  snapshotReturned = true;
  return snapshot;
}
