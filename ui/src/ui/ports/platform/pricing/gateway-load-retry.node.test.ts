// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGatewayLoadRetry,
  isTransientGatewayError,
  isTransientGatewayErrorMessage,
} from "./gateway-load-retry.ts";

describe("gateway-load-retry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects transient gateway transport errors", () => {
    expect(isTransientGatewayError(new Error("gateway not connected"))).toBe(true);
    expect(isTransientGatewayError(new Error("gateway closed"))).toBe(true);
    expect(
      isTransientGatewayError(new Error("platform-plan-bundle.overview temporarily rate limited")),
    ).toBe(true);
    expect(isTransientGatewayError(new Error("load failed"))).toBe(false);
    expect(isTransientGatewayErrorMessage("gateway not connected")).toBe(true);
    expect(isTransientGatewayErrorMessage("temporarily rate limited")).toBe(true);
  });

  it("invokes runLoad on each backoff tick until cancelled", async () => {
    vi.useFakeTimers();
    let runs = 0;
    const retry = createGatewayLoadRetry(() => {
      runs += 1;
    });

    await vi.advanceTimersByTimeAsync(400);
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(800);
    expect(runs).toBe(2);

    retry.cancel();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runs).toBe(2);
  });

  it("calls onExhausted after max attempts", async () => {
    vi.useFakeTimers();
    let exhausted = false;
    createGatewayLoadRetry(
      () => {
        /* keep failing */
      },
      { onExhausted: () => (exhausted = true) },
    );

    await vi.advanceTimersByTimeAsync(400 + 800 + 1600 + 3200 + 5000);
    expect(exhausted).toBe(true);
  });
});
