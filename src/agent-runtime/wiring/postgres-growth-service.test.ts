import { afterEach, expect, it, vi } from "vitest";
import { startPostgresGrowthService } from "./postgres-growth-service.js";
import { startRuntimeLeaseAdmission, stopRuntimeLeases } from "./runtime-lease-registry.js";
afterEach(async () => {
  await stopRuntimeLeases();
  startRuntimeLeaseAdmission();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
function enabled() {
  vi.stubEnv("OPENBOT_RUNTIME_GROWTH_CONSUMER", "1");
  vi.stubEnv("OPENBOT_RUNTIME_DATABASE_URL", "postgresql://test");
  vi.stubEnv("OPENBOT_RUNTIME_CONSUMER_TENANT_ID", "tenant");
  vi.stubEnv("OPENBOT_RUNTIME_GROWTH_PRINCIPAL_ID", "principal");
}
it("closes connection and starts no scanner without a valid grant", async () => {
  enabled();
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  const end = vi.fn(async () => {});
  await expect(
    startPostgresGrowthService({ cfg: {}, onError: vi.fn(), createPool: () => ({ query, end }) }),
  ).rejects.toThrow("grant missing");
  expect(query).toHaveBeenCalledTimes(1);
  expect(end).toHaveBeenCalledTimes(1);
});
it("starts only after a live grant and closes resources through gateway registry", async () => {
  vi.useFakeTimers();
  enabled();
  const end = vi.fn(async () => {});
  const query = vi
    .fn()
    .mockResolvedValueOnce({
      rows: [{ user_id: "service-user", domain: "enterprise", agent_ids: ["agent"] }],
      rowCount: 1,
    })
    .mockResolvedValue({ rows: [], rowCount: 0 });
  await startPostgresGrowthService({
    cfg: {},
    onError: vi.fn(),
    createPool: () => ({ query, end }),
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(query.mock.calls[1][1]).toEqual([
    "tenant",
    expect.any(String),
    30000,
    ["growth.operational", "growth.capture"],
  ]);
  await stopRuntimeLeases();
  expect(end).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
