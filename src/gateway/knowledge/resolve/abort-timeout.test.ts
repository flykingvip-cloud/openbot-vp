import { describe, expect, it } from "vitest";
import { runWithAbortTimeout } from "./abort-timeout.js";

describe("runWithAbortTimeout", () => {
  it("returns the value when work finishes before timeout", async () => {
    const result = await runWithAbortTimeout({
      timeoutMs: 200,
      run: async () => 7,
    });
    expect(result).toEqual({ status: "ok", value: 7 });
  });

  it("times out without waiting for uncancellable work and discards late values", async () => {
    let lateValueWritten = false;
    const started = Date.now();
    const result = await runWithAbortTimeout({
      timeoutMs: 40,
      run: async (signal) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (!signal.aborted) {
          lateValueWritten = true;
        }
        return "late";
      },
    });
    expect(result.status).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(150);
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(lateValueWritten).toBe(false);
  });

  it("aborts from a parent signal and does not write the result", async () => {
    const parent = new AbortController();
    const pending = runWithAbortTimeout({
      timeoutMs: 1_000,
      abortSignal: parent.signal,
      run: async (signal) => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 1_000);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        });
        return "should-not-write";
      },
    });
    parent.abort("stop");
    await expect(pending).resolves.toEqual({ status: "aborted" });
  });
});
