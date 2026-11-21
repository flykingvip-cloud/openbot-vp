import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startPostgresStatisticsConsumer } from "./postgres-statistics-consumer.js";
import { startRuntimeLeaseAdmission, stopRuntimeLeases } from "./runtime-lease-registry.js";
beforeEach(() => startRuntimeLeaseAdmission());
afterEach(async () => {
  await stopRuntimeLeases();
  startRuntimeLeaseAdmission();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
function enable() {
  vi.stubEnv("OPENBOT_RUNTIME_STATISTICS_CONSUMER", "1");
  vi.stubEnv("OPENBOT_RUNTIME_DATABASE_URL", "postgresql://test");
  vi.stubEnv("OPENBOT_RUNTIME_CONSUMER_TENANT_ID", "tenant");
}
it("disabled mode never opens a pool and incomplete scope fails before opening", () => {
  const pool = vi.fn();
  vi.stubEnv("OPENBOT_RUNTIME_STATISTICS_CONSUMER", "");
  startPostgresStatisticsConsumer(vi.fn(), pool);
  expect(pool).not.toHaveBeenCalled();
  enable();
  vi.stubEnv("OPENBOT_RUNTIME_CONSUMER_TENANT_ID", "");
  expect(() => startPostgresStatisticsConsumer(vi.fn(), pool)).toThrow("trusted tenant");
  expect(pool).not.toHaveBeenCalled();
});
it("projects statistics then acknowledges, and gateway stop closes its pool", async () => {
  vi.useFakeTimers();
  enable();
  const end = vi.fn(async () => {});
  const onError = vi.fn();
  const query = vi
    .fn()
    .mockResolvedValueOnce({
      rows: [
        {
          event_id: "event",
          execution_id: "execution",
          claim_token: "token",
          payload: { type: "statistics.outcome", agentId: "agent", success: true },
        },
      ],
      rowCount: 1,
    })
    .mockResolvedValueOnce({ rows: [{ applied: true, duplicate: false }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ event_id: "event" }], rowCount: 1 })
    .mockResolvedValue({ rows: [], rowCount: 0 });
  startPostgresStatisticsConsumer(onError, () => ({ query, end }));
  await vi.advanceTimersByTimeAsync(1);
  expect(query.mock.calls[0][1]).toEqual([
    "tenant",
    expect.any(String),
    30000,
    ["statistics.outcome"],
  ]);
  expect(query.mock.calls[1][0]).toContain("runtime_statistics_projection");
  expect(query.mock.calls[2][0]).toContain("delivered_at=clock_timestamp()");
  await stopRuntimeLeases();
  expect(end).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(onError).not.toHaveBeenCalled();
});
it("reports database failure without acknowledging and still closes on shutdown", async () => {
  vi.useFakeTimers();
  enable();
  const end = vi.fn(async () => {});
  const onError = vi.fn();
  const query = vi.fn().mockRejectedValue(new Error("db offline"));
  startPostgresStatisticsConsumer(onError, () => ({ query, end }));
  await vi.advanceTimersByTimeAsync(1);
  expect(onError).toHaveBeenCalledTimes(1);
  await stopRuntimeLeases();
  expect(end).toHaveBeenCalledTimes(1);
});
