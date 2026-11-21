import { expect, it, vi } from "vitest";
import { enqueueOperationalGrowth } from "./growth-event-producer.js";
const metrics = {
  tasksTotal: 1,
  tasksSucceeded: 1,
  toolsTotal: 1,
  toolsSucceeded: 1,
  humanTakeovers: 0,
  takeoverObservations: 0,
  satisfactionPositive: 0,
  satisfactionNegative: 0,
  updatedAtMs: 10,
};
it("writes a complete immutable growth snapshot and deduplicates identical event", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [{ event_id: "event" }], rowCount: 1 });
  const db = { query };
  const input = {
    tenantId: "tenant",
    executionId: "execution",
    eventId: "event",
    agentId: "agent",
    metrics,
    observedAtMs: 10,
    installedSkillKeys: ["z", "a"],
  };
  await enqueueOperationalGrowth(db, input);
  await enqueueOperationalGrowth(db, input);
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls[0][1][3]).toContain('"installedSkillKeys":["a","z"]');
});
it("rejects absent execution authority and conflicting insert", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  await expect(
    enqueueOperationalGrowth(
      { query },
      {
        tenantId: "tenant",
        executionId: "missing",
        eventId: "event",
        agentId: "agent",
        metrics,
        observedAtMs: 10,
        installedSkillKeys: [],
      },
    ),
  ).rejects.toThrow("missing");
});
