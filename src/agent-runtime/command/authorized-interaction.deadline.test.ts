import { afterEach, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { INTERACTION_TIMEOUT_TEXT, createInteractionResourceBudget } from "../model/index.js";
import { runAuthorizedInteraction } from "./index.js";

afterEach(() => {
  vi.useRealTimers();
});

const captured = { requestId: "message", expectedFocusRevision: 0, expectedWriteEpoch: 0 };

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function params(timeoutMs: number, abortSignal: AbortSignal) {
  return {
    input: { message: "你好", context: [], abortSignal },
    config: {} as OpenBotConfig,
    provider: "test",
    model: "test",
    timeoutMs,
    resourceBudget: createInteractionResourceBudget({ overrideMs: timeoutMs }),
    maxTokens: 128,
  };
}

function admission(commit = vi.fn()) {
  return {
    captured,
    ports: {
      authorize: vi.fn(async () => true),
      commit,
    },
  };
}

async function visibleWithin<T>(work: Promise<T>, started: number, limitMs = 100): Promise<T> {
  const wait = new Promise<T>((_, reject) => {
    setTimeout(() => {
      reject(
        new Error(
          `visible interaction still waiting after ${Date.now() - started}ms (limit ${limitMs}ms)`,
        ),
      );
    }, limitMs);
  });
  return await Promise.race([work, wait]);
}

/**
 * R1: deadline already due must not leave the visible interaction waiting on
 * non-cooperative authorize / candidate / accounting / cleanup Promises.
 * Timing method: real short deadline (25ms) plus a controllable hanging
 * Promise. Fake timers are not used.
 */
it.each(["authorize", "candidate", "accounting", "cleanup"] as const)(
  "R1: visible return stays bounded when %s is left pending",
  async (stage) => {
    const hanging = deferred<unknown>();
    const commit = vi.fn(() => {
      throw new Error("late proposal must not commit");
    });
    const authorize =
      stage === "authorize"
        ? vi.fn(() => hanging.promise)
        : vi.fn(async () => ({ acquired: true as const, skipped: false as const }));
    const candidate =
      stage === "candidate"
        ? vi.fn(() => hanging.promise)
        : vi.fn(async () => ({
            model: {
              id: "test",
              provider: "test",
              api: "openai-completions",
            },
          }));
    const recordUsage =
      stage === "accounting" ? vi.fn(() => hanging.promise) : vi.fn(async () => undefined);
    const dispose =
      stage === "cleanup"
        ? vi.fn(() => hanging.promise as Promise<void>)
        : vi.fn(async () => undefined);
    const inferResult = {
      provider: "test",
      model: "test",
      attempts: [],
      result: {
        response: { usage: { input: 1, output: 1 } },
        readDecision: () => ({ kind: "reply" as const, text: "你好，我在。" }),
      },
    };
    const infer =
      stage === "candidate"
        ? vi.fn(async (input: { run: (provider: string, model: string) => Promise<unknown> }) => {
            const result = await input.run("test", "test");
            return { provider: "test", model: "test", attempts: [], result };
          })
        : vi.fn(async () => inferResult);
    const abortSignal = AbortSignal.timeout(25);
    const started = Date.now();
    const pending = runAuthorizedInteraction(params(25, abortSignal), {
      session: { authorize, dispose, infer, recordUsage } as never,
      authorization: { agentId: "bot" },
      prepare: vi.fn(),
      candidate: candidate as never,
      admission: admission(commit),
    });
    try {
      const result = await visibleWithin(pending, started, 100);
      const elapsed = Date.now() - started;
      if (stage !== "cleanup") {
        expect(abortSignal.aborted).toBe(true);
      }
      expect(elapsed, `${stage} visible elapsed ${elapsed}ms`).toBeLessThan(100);
      if (stage === "cleanup") {
        expect(result).toMatchObject({ kind: "respond", text: "你好，我在。" });
      } else {
        expect(result).toEqual({
          kind: "respond",
          text: INTERACTION_TIMEOUT_TEXT,
          clarification: false,
        });
      }
      expect(commit).not.toHaveBeenCalled();
      expect(dispose).toHaveBeenCalled();

      if (stage === "authorize") {
        hanging.resolve({ acquired: true, skipped: false });
      } else if (stage === "candidate") {
        hanging.resolve({ model: { id: "test", provider: "test", api: "openai-completions" } });
      } else {
        hanging.resolve(undefined);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(commit).not.toHaveBeenCalled();
      if (stage === "accounting") {
        expect(recordUsage).toHaveBeenCalled();
        await expect(recordUsage.mock.results[0]?.value).resolves.toBeUndefined();
      }
      if (stage === "cleanup") {
        await expect(dispose.mock.results[0]?.value).resolves.toBeUndefined();
      }
    } finally {
      hanging.resolve(undefined);
    }
  },
  3_000,
);

it("R1: cancel-then-success does not admit a late proposal and still records usage", async () => {
  const inferHang = deferred<{
    provider: string;
    model: string;
    attempts: unknown[];
    result: { response: { usage: { input: number; output: number } }; readDecision: () => unknown };
  }>();
  const recordUsage = vi.fn(async () => undefined);
  const dispose = vi.fn(async () => undefined);
  const commit = vi.fn(() => ({ kind: "accepted_turn" as const }));
  const abortSignal = AbortSignal.timeout(25);
  const started = Date.now();
  const pending = runAuthorizedInteraction(params(25, abortSignal), {
    session: {
      authorize: vi.fn(async () => ({ acquired: true as const, skipped: false as const })),
      dispose,
      infer: vi.fn(() => inferHang.promise),
      recordUsage,
    } as never,
    authorization: { agentId: "bot" },
    prepare: vi.fn(),
    candidate: vi.fn(),
    admission: admission(commit),
  });
  try {
    const result = await visibleWithin(pending, started, 100);
    expect(Date.now() - started).toBeLessThan(100);
    expect(result).toEqual({
      kind: "respond",
      text: INTERACTION_TIMEOUT_TEXT,
      clarification: false,
    });
    inferHang.resolve({
      provider: "test",
      model: "test",
      attempts: [],
      result: {
        response: { usage: { input: 3, output: 2 } },
        readDecision: () => ({
          kind: "execution_request",
          request: { goal: "迟到提案", acceptance: ["不应执行"] },
        }),
      },
    });
    await vi.waitFor(() => {
      expect(recordUsage).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(commit).not.toHaveBeenCalled();
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "test",
        model: "test",
        usage: { input: 3, output: 2 },
      }),
    );
    expect(dispose).toHaveBeenCalled();
  } finally {
    inferHang.resolve({
      provider: "test",
      model: "test",
      attempts: [],
      result: {
        response: { usage: { input: 0, output: 0 } },
        readDecision: () => ({ kind: "reply", text: "late" }),
      },
    });
  }
}, 3_000);

it("R1: cancel-then-failure still returns a bounded receipt and later releases the lease once", async () => {
  const authorizeHang = deferred<{ acquired: true; skipped: false }>();
  let released = 0;
  const dispose = vi.fn(async () => {
    released += 1;
  });
  const commit = vi.fn();
  const abortSignal = AbortSignal.timeout(25);
  const started = Date.now();
  const pending = runAuthorizedInteraction(params(25, abortSignal), {
    session: { authorize: vi.fn(() => authorizeHang.promise), dispose } as never,
    authorization: { agentId: "bot" },
    prepare: vi.fn(),
    candidate: vi.fn(),
    admission: admission(commit),
  });
  try {
    const result = await visibleWithin(pending, started, 100);
    expect(Date.now() - started).toBeLessThan(100);
    expect(result).toEqual({
      kind: "respond",
      text: INTERACTION_TIMEOUT_TEXT,
      clarification: false,
    });
    expect(dispose).toHaveBeenCalled();
    authorizeHang.reject(new Error("late authorize failed"));
    await vi.waitFor(() => {
      expect(released).toBeGreaterThanOrEqual(1);
    });
    expect(commit).not.toHaveBeenCalled();
    expect(released).toBe(1);
  } finally {
    authorizeHang.reject(new Error("late authorize failed"));
  }
}, 3_000);
