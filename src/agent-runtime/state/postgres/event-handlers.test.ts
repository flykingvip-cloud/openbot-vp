import { expect, it, vi } from "vitest";
import { resolveRuntimeEventHandler } from "./event-handlers.js";
const base = { event_id: "event", execution_id: "execution", claim_token: "token" };
it("routes supported events with durable event and execution identities", async () => {
  const ports = {
    growth: vi.fn(async () => {}),
    statistics: vi.fn(async () => {}),
    aor: vi.fn(async () => {}),
    recovery: vi.fn(async () => {}),
  };
  for (const type of ["growth.refresh", "statistics.refresh"]) {
    await resolveRuntimeEventHandler(ports, { ...base, payload: { type, agentId: "agent" } })?.();
  }
  await resolveRuntimeEventHandler(ports, {
    ...base,
    payload: { type: "aor.feedback", feedback: { score: 1 } },
  })?.();
  await resolveRuntimeEventHandler(ports, {
    ...base,
    payload: { state: "waiting", reason: "delivery_pending" },
  })?.();
  expect(ports.growth).toHaveBeenCalledWith("event", "execution", "agent");
  expect(ports.statistics).toHaveBeenCalledTimes(1);
  expect(ports.aor).toHaveBeenCalledTimes(1);
  expect(ports.recovery).toHaveBeenCalledWith("event", "execution", "delivery_pending");
  expect(
    resolveRuntimeEventHandler(ports, { ...base, payload: { type: "unknown" } }),
  ).toBeUndefined();
});
it("propagates projection failures so the drainer cannot acknowledge them", async () => {
  const failure = vi.fn(async () => {
    throw new Error("persist failed");
  });
  const ports = { growth: failure, statistics: failure, aor: failure, recovery: failure };
  await expect(
    resolveRuntimeEventHandler(ports, {
      ...base,
      payload: { type: "growth.refresh", agentId: "agent" },
    })?.(),
  ).rejects.toThrow("persist failed");
});

it("requires explicit boolean result and registered outcome handler for statistics", async () => {
  const noOp = vi.fn(async () => {});
  const statisticsOutcome = vi.fn(async () => {});
  const ports = { growth: noOp, statistics: noOp, aor: noOp, recovery: noOp, statisticsOutcome };
  const event = {
    ...base,
    payload: { type: "statistics.outcome", agentId: "agent", success: false },
  };
  await resolveRuntimeEventHandler(ports, event)?.();
  expect(statisticsOutcome).toHaveBeenCalledWith("event", "execution", "agent", false);
  expect(
    resolveRuntimeEventHandler(ports, {
      ...event,
      payload: { ...event.payload, success: "false" },
    }),
  ).toBeUndefined();
  expect(
    resolveRuntimeEventHandler({ ...ports, statisticsOutcome: undefined }, event),
  ).toBeUndefined();
});
