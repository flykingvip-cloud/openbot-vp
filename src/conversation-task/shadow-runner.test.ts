import { describe, expect, it } from "vitest";
import { ShadowRunner, type ShadowRunnerEvent } from "./shadow-runner.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("ShadowRunner — bounded concurrency + non-blocking submit (AC5)", () => {
  it("submit is synchronous and never exceeds max concurrency", async () => {
    let running = 0;
    let maxObserved = 0;
    const done: number[] = [];
    const runner = new ShadowRunner<number>({
      maxConcurrency: 2,
      handler: async (n) => {
        running += 1;
        maxObserved = Math.max(maxObserved, running);
        await delay(10);
        running -= 1;
        done.push(n);
      },
    });
    for (let i = 0; i < 6; i++) {
      expect(runner.submit(i)).toBe("queued"); // returns immediately, even though handler is slow
    }
    const res = await runner.shutdown(2_000);
    expect(done.length).toBe(6);
    expect(res.discarded).toBe(0);
    expect(maxObserved).toBeLessThanOrEqual(2);
  });
});

describe("ShadowRunner — drop-new on full queue (AC5)", () => {
  it("drops the newest jobs when the bounded queue is full; never throws", async () => {
    const events: string[] = [];
    const runner = new ShadowRunner<number>({
      maxQueue: 2,
      maxConcurrency: 1,
      handler: async () => {
        await delay(40);
      },
      onEvent: (e) => events.push(e.type),
    });
    // job0 -> in-flight; job1,job2 -> queue (depth 2 = cap); job3,job4 -> dropped
    const results = [1, 2, 3, 4, 5].map((n) => runner.submit(n));
    expect(results.filter((r) => r === "dropped").length).toBe(2);
    expect(events).toContain("dropped");
    await runner.shutdown(2_000);
  });
});

describe("ShadowRunner — unified rejection capture (AC5)", () => {
  it("captures a throwing handler as failure with no unhandled rejection", async () => {
    const events: ShadowRunnerEvent[] = [];
    const runner = new ShadowRunner<number>({
      maxConcurrency: 2,
      handler: async () => {
        throw new Error("boom");
      },
      onEvent: (e) => events.push(e),
    });
    runner.submit(1);
    runner.submit(2);
    await runner.shutdown(2_000);
    expect(events.filter((e) => e.type === "failure").length).toBe(2);
  });
});

describe("ShadowRunner — per-item timeout (AC5)", () => {
  it("abandons a stuck handler after itemTimeoutMs and keeps processing", async () => {
    const events: string[] = [];
    const runner = new ShadowRunner<number>({
      itemTimeoutMs: 20,
      maxConcurrency: 1,
      handler: () => new Promise<void>(() => {}), // never resolves
      onEvent: (e) => events.push(e.type),
    });
    runner.submit(1);
    await delay(80);
    expect(events).toContain("timeout");
    expect(runner.inFlightCount).toBe(0); // freed after timeout
    await runner.shutdown(100);
  });
});

describe("ShadowRunner — bounded shutdown drain (AC5)", () => {
  it("drains within the cap, discards the remainder, then rejects intake", async () => {
    const runner = new ShadowRunner<number>({
      maxQueue: 100,
      maxConcurrency: 1,
      handler: async () => {
        await delay(30);
      },
    });
    for (let i = 0; i < 5; i++) {
      runner.submit(i);
    }
    const res = await runner.shutdown(10); // cap << 5*30ms of work
    expect(res.discarded).toBeGreaterThan(0);
    expect(runner.submit(99)).toBe("dropped"); // closed => intake rejected
  });

  it("shutdown resolves cleanly when everything drains before the cap", async () => {
    const runner = new ShadowRunner<number>({
      maxConcurrency: 4,
      handler: async () => {
        await delay(5);
      },
    });
    for (let i = 0; i < 4; i++) {
      runner.submit(i);
    }
    const res = await runner.shutdown(1_000);
    expect(res.discarded).toBe(0);
    expect(res.drained).toBe(4);
  });
});
