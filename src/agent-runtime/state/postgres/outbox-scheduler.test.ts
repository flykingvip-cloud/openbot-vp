import { afterEach, expect, it, vi } from "vitest";
import { startRuntimeOutboxScheduler } from "./outbox-scheduler.js";
afterEach(() => vi.useRealTimers());
it("does not overlap drains and awaits outstanding query during shutdown", async () => {
  vi.useFakeTimers();
  let resolve!: (value: null) => void;
  const claim = vi.fn(
    () =>
      new Promise<null>((done) => {
        resolve = done;
      }),
  );
  const effect = vi.fn(async () => {});
  const scheduler = startRuntimeOutboxScheduler({
    tenantId: "tenant",
    store: { claim, acknowledge: vi.fn(), fail: vi.fn() },
    ports: { growth: effect, statistics: effect, aor: effect, recovery: effect },
    intervalMs: 10,
    onError: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(100);
  expect(claim).toHaveBeenCalledTimes(1);
  let stopped = false;
  const stop = scheduler.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  resolve(null);
  await stop;
  await vi.advanceTimersByTimeAsync(100);
  expect(claim).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("dispatches a durable recovery event before acknowledgement", async () => {
  vi.useFakeTimers();
  const acknowledge = vi.fn(async () => true);
  const recovery = vi.fn(async () => {
    expect(acknowledge).not.toHaveBeenCalled();
  });
  const other = vi.fn(async () => {});
  const claim = vi
    .fn()
    .mockResolvedValueOnce({
      event_id: "event",
      execution_id: "execution",
      claim_token: "token",
      payload: { state: "waiting", reason: "delivery_pending" },
    })
    .mockResolvedValue(null);
  const scheduler = startRuntimeOutboxScheduler({
    tenantId: "tenant",
    store: { claim, acknowledge, fail: vi.fn() },
    ports: { growth: other, statistics: other, aor: other, recovery },
    intervalMs: 10,
    onError: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(recovery).toHaveBeenCalledWith("event", "execution", "delivery_pending");
  expect(acknowledge).toHaveBeenCalledWith("tenant", "event", "token");
  await scheduler.stop();
});
