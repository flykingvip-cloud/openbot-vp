import { expect, it } from "vitest";
import type { ModelCompletion, ModelUsage } from "../../contracts/rule-adaptation-shadow.js";
import { invokeLimitedCompletion } from "./completion-limits.js";

const usage = (overrides: Partial<ModelUsage> = {}): ModelUsage => ({
  inputTokens: 4,
  outputTokens: 2,
  cost: 0.01,
  ...overrides,
});

const baseInput = {
  system: "s",
  messages: [] as const,
  tools: [] as const,
};

it("cancels a never-returning completion when the duration timeout elapses", async () => {
  const started = Date.now();
  const ledger: ModelUsage[] = [];
  const result = await invokeLimitedCompletion({
    complete: () => new Promise<ModelCompletion>(() => {}),
    input: { ...baseInput, maxTokens: 100, timeoutMs: 40 },
    usageRecorder: {
      recordUsage: ({ usage: recorded }) => {
        ledger.push(recorded);
      },
    },
  });
  const elapsed = Date.now() - started;
  expect(result.kind).toBe("cancelled");
  if (result.kind === "cancelled") {
    expect(result.reason).toBe("timeout");
  }
  expect(result.usageKnown).toBe(false);
  expect(result.underlyingRequestStopped).toBe(false);
  // Placeholder zeros are not a successful post-hoc tally.
  expect(ledger).toHaveLength(0);
  expect(elapsed).toBeGreaterThanOrEqual(30);
  expect(elapsed).toBeLessThan(2000);
  expect(result.deadlineCleanupFailed).toBe(false);
});

it("times out a slow completion and preserves usage already produced", async () => {
  const produced = usage({ inputTokens: 11, outputTokens: 7, cost: 0.2 });
  const result = await invokeLimitedCompletion({
    complete: (input) =>
      new Promise<ModelCompletion>((resolve) => {
        const timer = setTimeout(() => {
          resolve({ kind: "message", text: "late", usage: produced });
        }, 400);
        input.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve({ kind: "cancelled", usage: produced, reason: "signal_aborted" });
          },
          { once: true },
        );
      }),
    input: { ...baseInput, maxTokens: 100, timeoutMs: 30 },
  });
  expect(result.kind).toBe("cancelled");
  if (result.kind === "cancelled") {
    expect(result.reason).toBe("timeout");
  }
  expect(result.usage).toEqual(produced);
});

it("retains usage when cancelled after the completion already returned it", async () => {
  const produced = usage({ inputTokens: 9, outputTokens: 3, cost: 0.2 });
  const controller = new AbortController();
  const ledger: Array<{ reason: string; usage: ModelUsage }> = [];
  const result = await invokeLimitedCompletion({
    complete: async () => {
      controller.abort("owner_cancel");
      return { kind: "message", text: "partial", usage: produced };
    },
    input: { ...baseInput, signal: controller.signal, maxTokens: 100, timeoutMs: 1_000 },
    usageRecorder: {
      recordUsage: (entry) => {
        ledger.push({ reason: entry.reason, usage: entry.usage });
      },
    },
  });
  expect(result.kind).toBe("cancelled");
  expect(result.usage).toEqual(produced);
  expect(ledger[0]?.usage).toEqual(produced);
  expect(ledger[0]?.reason).toBe("cancelled");
});

it("retains usage attached to an abort error", async () => {
  const produced = usage({ inputTokens: 5, outputTokens: 1, cost: 0.05 });
  const result = await invokeLimitedCompletion({
    complete: async () => {
      const error = new Error("aborted after tokens");
      error.name = "AbortError";
      (error as Error & { usage: ModelUsage }).usage = produced;
      throw error;
    },
    input: { ...baseInput, maxTokens: 100, timeoutMs: 1_000 },
  });
  expect(result.kind).toBe("cancelled");
  expect(result.usage).toEqual(produced);
});

it("passes remaining output tokens as maxTokens and accounts an excess after the fact", async () => {
  let seenMaxTokens: number | undefined;
  const result = await invokeLimitedCompletion({
    complete: async (input) => {
      seenMaxTokens = input.maxTokens;
      return {
        kind: "message",
        text: "overflow",
        usage: usage({ inputTokens: 1, outputTokens: 50, cost: 0.01 }),
      };
    },
    input: { ...baseInput, maxTokens: 10, timeoutMs: 1_000 },
  });
  expect(seenMaxTokens).toBe(10);
  expect(result.outputExceededMaxTokens).toBe(true);
  expect(result.usage.outputTokens).toBe(50);
  expect(result.kind).toBe("message");
});

it("does not throw when cleanup fails and still retains usage", async () => {
  let innerCleanupRan = false;
  const result = await invokeLimitedCompletion({
    complete: async () => ({
      kind: "message",
      text: "ok",
      usage: usage({ inputTokens: 4, outputTokens: 2, cost: 0.1 }),
    }),
    input: { ...baseInput, maxTokens: 100, timeoutMs: 1_000 },
    wrapCleanup: (cleanup) => () => {
      cleanup();
      innerCleanupRan = true;
      throw new Error("cleanup boom");
    },
  });
  expect(innerCleanupRan).toBe(true);
  expect(result.deadlineCleanupFailed).toBe(true);
  expect(result.kind).toBe("message");
  expect(result.usage).toEqual(usage({ inputTokens: 4, outputTokens: 2, cost: 0.1 }));
});

it("removes abort listeners and timers on the success path", async () => {
  const controller = new AbortController();
  let added = 0;
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === "abort") {
      added += 1;
    }
    return add(type, listener, options);
  };
  controller.signal.removeEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ) => {
    if (type === "abort") {
      added -= 1;
    }
    return remove(type, listener, options);
  };
  const result = await invokeLimitedCompletion({
    complete: async () => ({ kind: "message", text: "ok", usage: usage() }),
    input: { ...baseInput, signal: controller.signal, maxTokens: 100, timeoutMs: 1_000 },
  });
  expect(result.kind).toBe("message");
  expect(result.deadlineCleanupFailed).toBe(false);
  expect(added).toBe(0);
  expect(() => controller.abort("after")).not.toThrow();
});

it("ends the wait promptly when an ignoring completion is cancelled well before timeout", async () => {
  const started = Date.now();
  const controller = new AbortController();
  const ledger: Array<{ reason: string; usage: ModelUsage }> = [];
  const timer = setTimeout(() => controller.abort("owner_cancel"), 40);
  const result = await invokeLimitedCompletion({
    complete: (input) => {
      void input.signal;
      return new Promise<ModelCompletion>(() => {});
    },
    input: { ...baseInput, signal: controller.signal, maxTokens: 100, timeoutMs: 8_000 },
    usageRecorder: {
      recordUsage: (entry) => {
        ledger.push({ reason: entry.reason, usage: entry.usage });
      },
    },
  });
  clearTimeout(timer);
  const elapsed = Date.now() - started;
  expect(result.kind).toBe("cancelled");
  if (result.kind === "cancelled") {
    expect(result.reason).toBe("signal_aborted");
  }
  expect(result.usageKnown).toBe(false);
  expect(result.underlyingRequestStopped).toBe(false);
  expect(ledger).toHaveLength(0);
  expect(elapsed).toBeGreaterThanOrEqual(20);
  expect(elapsed).toBeLessThan(1_500);
});

it("records late usage once after a timeout without changing the returned verdict", async () => {
  let release!: (completion: ModelCompletion) => void;
  const pending = new Promise<ModelCompletion>((resolve) => {
    release = resolve;
  });
  const ledger: Array<{ reason: string; usage: ModelUsage }> = [];
  const lateUsage = usage({ inputTokens: 15, outputTokens: 6, cost: 0.3 });
  const result = await invokeLimitedCompletion({
    complete: () => pending,
    input: { ...baseInput, maxTokens: 100, timeoutMs: 40 },
    usageRecorder: {
      recordUsage: (entry) => {
        ledger.push({ reason: entry.reason, usage: entry.usage });
      },
    },
  });
  expect(result.kind).toBe("cancelled");
  if (result.kind === "cancelled") {
    expect(result.reason).toBe("timeout");
  }
  expect(result.usageKnown).toBe(false);
  expect(result.underlyingRequestStopped).toBe(false);
  expect(ledger).toHaveLength(0);
  release({ kind: "message", text: "late payload must not become the verdict", usage: lateUsage });
  await result.whenUnderlyingSettled;
  expect(result.kind).toBe("cancelled");
  if (result.kind === "cancelled") {
    expect(result.reason).toBe("timeout");
  }
  expect(ledger).toHaveLength(1);
  expect(ledger[0]?.reason).toBe("late_usage");
  expect(ledger[0]?.usage).toEqual(lateUsage);
  await result.whenUnderlyingSettled;
  expect(ledger).toHaveLength(1);
});

it("records late usage attached to a rejection after timeout, once", async () => {
  let rejectLate!: (error: unknown) => void;
  const pending = new Promise<ModelCompletion>((_resolve, reject) => {
    rejectLate = reject;
  });
  const ledger: Array<{ reason: string; usage: ModelUsage }> = [];
  const lateUsage = usage({ inputTokens: 8, outputTokens: 1, cost: 0.07 });
  const result = await invokeLimitedCompletion({
    complete: () => pending,
    input: { ...baseInput, maxTokens: 100, timeoutMs: 40 },
    usageRecorder: {
      recordUsage: (entry) => {
        ledger.push({ reason: entry.reason, usage: entry.usage });
      },
    },
  });
  expect(result.kind).toBe("cancelled");
  expect(result.usageKnown).toBe(false);
  expect(ledger).toHaveLength(0);
  const error = new Error("late failure");
  (error as Error & { usage: ModelUsage }).usage = lateUsage;
  rejectLate(error);
  await result.whenUnderlyingSettled;
  expect(result.kind).toBe("cancelled");
  expect(ledger).toEqual([{ reason: "late_usage", usage: lateUsage }]);
});

it("treats usage as known zero when cancelled before the completion starts", async () => {
  const ledger: Array<{ reason: string; usage: ModelUsage }> = [];
  const result = await invokeLimitedCompletion({
    complete: async () => ({ kind: "message", text: "should not run", usage: usage() }),
    input: {
      ...baseInput,
      signal: AbortSignal.abort("already"),
      maxTokens: 100,
      timeoutMs: 8_000,
    },
    usageRecorder: {
      recordUsage: (entry) => {
        ledger.push({ reason: entry.reason, usage: entry.usage });
      },
    },
  });
  expect(result.kind).toBe("cancelled");
  if (result.kind === "cancelled") {
    expect(result.reason).toBe("signal_aborted_before_completion");
  }
  expect(result.usageKnown).toBe(true);
  expect(result.underlyingRequestStopped).toBe(true);
  expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0, cost: 0 });
  expect(ledger).toEqual([
    { reason: "cancelled", usage: { inputTokens: 0, outputTokens: 0, cost: 0 } },
  ]);
});

it("retries a failed post once with the same payload and does not change the verdict", async () => {
  const produced = usage({ inputTokens: 6, outputTokens: 2, cost: 0.04 });
  const ledger: Array<{ reason: string; usage: ModelUsage }> = [];
  let failuresRemaining = 1;
  const result = await invokeLimitedCompletion({
    complete: async () => ({ kind: "message", text: "ok", usage: produced }),
    input: { ...baseInput, maxTokens: 100, timeoutMs: 1_000 },
    usageRecorder: {
      recordUsage: (entry) => {
        if (failuresRemaining > 0) {
          failuresRemaining -= 1;
          throw new Error("ledger write failed");
        }
        ledger.push({ reason: entry.reason, usage: entry.usage });
      },
    },
  });
  expect(result.kind).toBe("message");
  expect(result.usage).toEqual(produced);
  expect(result.usageKnown).toBe(true);
  expect(result.usageAccountingAttempted).toBe(true);
  expect(result.usageAccountingStatus).toBe("succeeded");
  expect(ledger).toEqual([{ reason: "complete", usage: produced }]);
  expect(Object.isFrozen(result)).toBe(true);
});

it("marks accounting failed when every post throws and does not claim a successful post", async () => {
  const produced = usage({ inputTokens: 3, outputTokens: 1, cost: 0.02 });
  const attempts: string[] = [];
  const result = await invokeLimitedCompletion({
    complete: async () => ({ kind: "message", text: "ok", usage: produced }),
    input: { ...baseInput, maxTokens: 100, timeoutMs: 1_000 },
    usageRecorder: {
      recordUsage: ({ reason }) => {
        attempts.push(reason);
        throw new Error("ledger write failed");
      },
    },
  });
  expect(result.kind).toBe("message");
  expect(result.usage).toEqual(produced);
  expect(result.usageAccountingAttempted).toBe(true);
  expect(result.usageAccountingStatus).toBe("failed");
  expect(attempts.length).toBeGreaterThanOrEqual(1);
  expect(attempts.every((reason) => reason === "complete")).toBe(true);
});

it("does not attempt a post when usage is unknown, and late retry can succeed after a failed late attempt", async () => {
  let release!: (completion: ModelCompletion) => void;
  const pending = new Promise<ModelCompletion>((resolve) => {
    release = resolve;
  });
  const lateUsage = usage({ inputTokens: 15, outputTokens: 6, cost: 0.3 });
  const ledger: Array<{ reason: string; usage: ModelUsage }> = [];
  const diagnostics: Array<{ kind: string; usageAccountingStatus?: string }> = [];
  let failuresRemaining = 1;
  const result = await invokeLimitedCompletion({
    complete: () => pending,
    input: { ...baseInput, maxTokens: 100, timeoutMs: 40 },
    diagnosticSink: {
      report: (event) => {
        diagnostics.push(event);
      },
    },
    usageRecorder: {
      recordUsage: (entry) => {
        if (failuresRemaining > 0) {
          failuresRemaining -= 1;
          throw new Error("late ledger write failed");
        }
        ledger.push({ reason: entry.reason, usage: entry.usage });
      },
    },
  });
  expect(result.kind).toBe("cancelled");
  expect(result.usageKnown).toBe(false);
  expect(result.usageAccountingAttempted).toBe(false);
  expect(result.usageAccountingStatus).toBe("not_attempted");
  expect(ledger).toHaveLength(0);
  const snapshotStatus = result.usageAccountingStatus;
  release({ kind: "message", text: "late payload must not become the verdict", usage: lateUsage });
  await result.whenUnderlyingSettled;
  expect(result.kind).toBe("cancelled");
  expect(result.usageAccountingStatus).toBe(snapshotStatus);
  expect(result.usageAccountingAttempted).toBe(false);
  expect(ledger).toEqual([{ reason: "late_usage", usage: lateUsage }]);
  expect(diagnostics.some((event) => event.usageAccountingStatus === "succeeded")).toBe(true);
});

it("reports a late posting failure on the diagnostic sink without mutating the returned snapshot", async () => {
  let release!: (completion: ModelCompletion) => void;
  const pending = new Promise<ModelCompletion>((resolve) => {
    release = resolve;
  });
  const lateUsage = usage({ inputTokens: 8, outputTokens: 1, cost: 0.07 });
  const diagnostics: Array<{ kind: string; usageAccountingStatus?: string }> = [];
  const result = await invokeLimitedCompletion({
    complete: () => pending,
    input: { ...baseInput, maxTokens: 100, timeoutMs: 40 },
    diagnosticSink: {
      report: (event) => {
        diagnostics.push(event);
      },
    },
    usageRecorder: {
      recordUsage: () => {
        throw new Error("late ledger write failed");
      },
    },
  });
  expect(result.usageKnown).toBe(false);
  expect(result.usageAccountingStatus).toBe("not_attempted");
  expect(Object.isFrozen(result)).toBe(true);
  release({ kind: "message", text: "late", usage: lateUsage });
  await result.whenUnderlyingSettled;
  expect(result.usageAccountingStatus).toBe("not_attempted");
  expect(result.usageAccountingAttempted).toBe(false);
  expect(diagnostics.some((event) => event.usageAccountingStatus === "failed")).toBe(true);
  expect(() => {
    (result as unknown as { usageAccountingStatus: string }).usageAccountingStatus = "succeeded";
  }).toThrow();
});
