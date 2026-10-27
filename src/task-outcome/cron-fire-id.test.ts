import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createIsolatedRegressionJob,
  noopLogger,
  writeCronJobs,
} from "../cron/service.issue-regressions.test-helpers.js";
import { createCronServiceState } from "../cron/service/state.js";
import { onTimer } from "../cron/service/timer.js";
import { resolveOrAllocateCronFireId } from "./cron-fire-id.js";

describe("askOutcome W1 cron fireId (scheduler-owned)", () => {
  it("allocates once and reuses on same state object", () => {
    const state: { currentFireId?: string } = {};
    const a = resolveOrAllocateCronFireId(state, { jobId: "job-a", startedAtMs: 1000 });
    const b = resolveOrAllocateCronFireId(state, { jobId: "job-a", startedAtMs: 2000 });
    expect(a).toBe("job-a:1000");
    expect(b).toBe(a);
    expect(state.currentFireId).toBe(a);
  });

  it("new schedule after clear allocates a new fireId", () => {
    const state: { currentFireId?: string } = { currentFireId: "job-a:1000" };
    state.currentFireId = undefined;
    const next = resolveOrAllocateCronFireId(state, { jobId: "job-a", startedAtMs: 3000 });
    expect(next).toBe("job-a:3000");
  });
});

describe("askOutcome W1 cron fireId through timer path", () => {
  let storePath = "";
  let tmpRoot = "";

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "w1-cron-fire-"));
    storePath = path.join(tmpRoot, "cron-jobs.json");
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("error retry reuses the same fireId passed to runIsolatedAgentJob; success clears it", async () => {
    const scheduledAt = Date.parse("2026-02-06T10:00:00.000Z");
    const jobId = "w1-fire-retry";
    const cronJob = createIsolatedRegressionJob({
      id: jobId,
      name: "w1 fire",
      scheduledAt,
      schedule: { kind: "at", at: new Date(scheduledAt).toISOString() },
      payload: { kind: "agentTurn", message: "remind" },
      state: { nextRunAtMs: scheduledAt },
    });
    await writeCronJobs(storePath, [cronJob]);

    let now = scheduledAt;
    const runIsolatedAgentJob = vi
      .fn()
      .mockResolvedValueOnce({ status: "error", error: "429 rate limit exceeded" })
      .mockResolvedValueOnce({ status: "ok", summary: "done" });

    const state = createCronServiceState({
      cronEnabled: true,
      storePath,
      log: noopLogger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob,
    });

    await onTimer(state);
    expect(runIsolatedAgentJob).toHaveBeenCalledTimes(1);
    const firstFireId = runIsolatedAgentJob.mock.calls[0]?.[0]?.fireId as string;
    expect(typeof firstFireId).toBe("string");
    expect(firstFireId.length).toBeGreaterThan(0);

    const afterError = state.store?.jobs.find((j) => j.id === jobId);
    expect(afterError?.state.currentFireId).toBe(firstFireId);
    expect(afterError?.state.lastStatus).toBe("error");
    expect(afterError?.state.nextRunAtMs).toBeGreaterThan(scheduledAt);

    now = (afterError!.state.nextRunAtMs ?? 0) + 1;
    await onTimer(state);
    expect(runIsolatedAgentJob).toHaveBeenCalledTimes(2);
    const secondFireId = runIsolatedAgentJob.mock.calls[1]?.[0]?.fireId as string;
    expect(secondFireId).toBe(firstFireId);

    const afterOk = state.store?.jobs.find((j) => j.id === jobId);
    expect(afterOk?.state.lastStatus).toBe("ok");
    expect(afterOk?.state.currentFireId).toBeUndefined();
  });

  it("restart recovery reuses persisted currentFireId without Date.now mint", async () => {
    const scheduledAt = Date.parse("2026-02-06T11:00:00.000Z");
    const jobId = "w1-fire-recover";
    const persistedFire = `${jobId}:persisted-fire`;
    const cronJob = createIsolatedRegressionJob({
      id: jobId,
      name: "w1 recover",
      scheduledAt,
      schedule: { kind: "at", at: new Date(scheduledAt).toISOString() },
      payload: { kind: "agentTurn", message: "recover" },
      state: {
        nextRunAtMs: scheduledAt,
        currentFireId: persistedFire,
        lastStatus: "error",
        lastError: "crashed mid-fire",
      },
    });
    await writeCronJobs(storePath, [cronJob]);

    const runIsolatedAgentJob = vi.fn().mockResolvedValue({ status: "ok", summary: "recovered" });
    const state = createCronServiceState({
      cronEnabled: true,
      storePath,
      log: noopLogger,
      nowMs: () => scheduledAt + 5_000,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob,
    });

    await onTimer(state);
    expect(runIsolatedAgentJob).toHaveBeenCalledTimes(1);
    expect(runIsolatedAgentJob.mock.calls[0]?.[0]?.fireId).toBe(persistedFire);
  });
});
