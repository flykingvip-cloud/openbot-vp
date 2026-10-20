import { describe, expect, it, vi } from "vitest";
import { retryMemoryEmbedding } from "./embedding-retry.js";

describe("retryMemoryEmbedding", () => {
  it("retries rate_limit then succeeds", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await retryMemoryEmbedding(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new Error("429 Too Many Requests");
        }
        return "ok";
      },
      {
        maxAttempts: 4,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        jitter: 0,
        deps: {
          sleep: async (ms) => {
            sleeps.push(ms);
          },
          random: () => 0,
        },
      },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it("does not retry billing errors", async () => {
    let calls = 0;
    await expect(
      retryMemoryEmbedding(
        async () => {
          calls += 1;
          throw new Error("429 insufficient_quota");
        },
        {
          maxAttempts: 4,
          baseDelayMs: 10,
          deps: { sleep: async () => undefined, random: () => 0 },
        },
      ),
    ).rejects.toThrow(/insufficient_quota/);
    expect(calls).toBe(1);
  });

  it("does not retry auth errors", async () => {
    let calls = 0;
    await expect(
      retryMemoryEmbedding(
        async () => {
          calls += 1;
          throw new Error("401 Unauthorized");
        },
        {
          maxAttempts: 4,
          baseDelayMs: 10,
          deps: { sleep: async () => undefined, random: () => 0 },
        },
      ),
    ).rejects.toThrow(/401/);
    expect(calls).toBe(1);
  });

  it("prefers Retry-After over exponential base delay", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await retryMemoryEmbedding(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw Object.assign(new Error("429 Too Many Requests"), {
            headers: { "retry-after": "3" },
          });
        }
        return "ok";
      },
      {
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 10_000,
        jitter: 0,
        deps: {
          sleep: async (ms) => {
            sleeps.push(ms);
          },
          random: () => 0,
        },
      },
    );
    expect(sleeps[0]).toBe(3000);
  });

  it("invokes onRetry with classified reason", async () => {
    const onRetry = vi.fn();
    let calls = 0;
    await retryMemoryEmbedding(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("502 Bad Gateway");
        }
        return true;
      },
      {
        maxAttempts: 3,
        baseDelayMs: 50,
        jitter: 0,
        onRetry,
        deps: { sleep: async () => undefined, random: () => 0 },
      },
    );
    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "timeout", attempt: 1 }),
    );
  });
});
