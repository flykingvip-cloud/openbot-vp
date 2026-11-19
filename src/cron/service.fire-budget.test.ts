import { expect, it, vi } from "vitest";
import { createIsolatedRegressionJob } from "./service.issue-regressions.test-helpers.js";
import { createCronServiceState } from "./service/state.js";
import { applyJobResult } from "./service/timer.js";
it.each(["cron", "every"] as const)("resets failed recurring %s fire budget identity", (kind) => {
  const startedAt = Date.parse("2026-11-19T10:00:00Z");
  const state = createCronServiceState({
    cronEnabled: true,
    storePath: "/tmp/fire-budget.json",
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    nowMs: () => startedAt + 1000,
    enqueueSystemEvent: vi.fn(),
    requestHeartbeatNow: vi.fn(),
    runIsolatedAgentJob: vi.fn(),
  });
  const job = createIsolatedRegressionJob({
    id: "budget-fire",
    name: "budget-fire",
    scheduledAt: startedAt,
    schedule:
      kind === "cron"
        ? { kind: "cron", expr: "0 10 * * *", tz: "UTC" }
        : { kind: "every", everyMs: 86400000, anchorMs: startedAt },
    payload: { kind: "agentTurn", message: "read only" },
    state: { currentFireId: "budget-fire:old", nextRunAtMs: startedAt },
  });
  applyJobResult(state, job, {
    status: "error",
    error: "TaskBudgetExceededError: duration",
    startedAt,
    endedAt: startedAt + 1000,
  });
  expect(job.enabled).toBe(true);
  expect(job.state.nextRunAtMs).toBeGreaterThan(startedAt);
  expect(job.state.currentFireId).toBeUndefined();
});
