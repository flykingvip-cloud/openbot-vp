import { afterEach, expect, it, vi } from "vitest";
import { startGrowthOutboxConsumer } from "./growth-outbox-consumer.js";
import { startRuntimeLeaseAdmission, stopRuntimeLeases } from "./runtime-lease-registry.js";
afterEach(async () => {
  await stopRuntimeLeases();
  startRuntimeLeaseAdmission();
  vi.useRealTimers();
});
it("rejects startup tenant mismatch before claiming events", async () => {
  const query = vi.fn();
  await expect(
    startGrowthOutboxConsumer({
      cfg: {},
      tenantId: "tenant",
      db: { query },
      authorize: async () => ({
        principalId: "service",
        context: { tenantId: "other", userId: "user", domain: "enterprise" },
        agentIds: [],
      }),
      onError: vi.fn(),
    }),
  ).rejects.toThrow("authority mismatch");
  expect(query).not.toHaveBeenCalled();
});
it("registers only growth events and gateway shutdown stops scanning", async () => {
  vi.useFakeTimers();
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  await startGrowthOutboxConsumer({
    cfg: {},
    tenantId: "tenant",
    db: { query },
    authorize: async () => ({
      principalId: "service",
      context: { tenantId: "tenant", userId: "user", domain: "enterprise" },
      agentIds: ["agent"],
    }),
    onError: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(query.mock.calls).toHaveLength(1);
  await stopRuntimeLeases();
  await vi.advanceTimersByTimeAsync(10000);
  expect(query.mock.calls).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});
