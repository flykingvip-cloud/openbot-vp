import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RUNNER_CONFIG,
  getSupervisorRunnerStatus,
  pruneExpiredSupervisorLeases,
  releaseSupervisorLease,
  resetSupervisorRunnerStateForTests,
  runSupervisorQueueSweep,
  tryAcquireSupervisorLease,
} from "./runner.js";

vi.mock("./driver.js", () => ({
  tickSupervisedTask: vi.fn(async () => null),
}));

vi.mock("./store.js", () => ({
  listActiveTasks: vi.fn(async () => [
    { taskId: "t1", state: "planned", updatedAt: "2026-01-01T00:00:00.000Z" },
    { taskId: "t2", state: "fixing", updatedAt: "2026-01-02T00:00:00.000Z" },
    { taskId: "t3", state: "planned", updatedAt: "2026-01-03T00:00:00.000Z" },
  ]),
}));

vi.mock("./run-registry.js", () => ({
  hasSupervisorRun: vi.fn(() => false),
}));

vi.mock("./feature.js", () => ({
  isSupervisorEnabled: vi.fn(() => true),
}));

import { tickSupervisedTask } from "./driver.js";

describe("supervisor runner", () => {
  beforeEach(() => {
    resetSupervisorRunnerStateForTests();
    vi.mocked(tickSupervisedTask).mockClear();
    process.env.OPENBOT_SUPERVISOR_ENABLED = "1";
  });

  afterEach(() => {
    delete process.env.OPENBOT_SUPERVISOR_ENABLED;
  });

  it("tryAcquireSupervisorLease blocks competing owners until expiry", () => {
    expect(tryAcquireSupervisorLease("t1", "owner-a", 60_000, 1_000)).toBe(true);
    expect(tryAcquireSupervisorLease("t1", "owner-b", 60_000, 2_000)).toBe(false);
    expect(pruneExpiredSupervisorLeases(70_001)).toBe(1);
    expect(tryAcquireSupervisorLease("t1", "owner-b", 60_000, 70_002)).toBe(true);
    releaseSupervisorLease("t1", "owner-b");
  });

  it("runSupervisorQueueSweep respects maxConcurrency", async () => {
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    vi.mocked(tickSupervisedTask).mockImplementation(async (taskId) => {
      if (taskId === "t1") {
        await first;
      }
      return null;
    });

    const ports = { worker: {}, validator: {}, workspace: {} } as never;
    const driven = await runSupervisorQueueSweep(ports, {
      config: { ...DEFAULT_RUNNER_CONFIG, maxConcurrency: 1 },
      ownerId: "owner-a",
    });
    expect(driven).toBe(1);
    expect(tickSupervisedTask).toHaveBeenCalledTimes(1);

    const drivenSecond = await runSupervisorQueueSweep(ports, {
      config: { ...DEFAULT_RUNNER_CONFIG, maxConcurrency: 2 },
      ownerId: "owner-a",
    });
    expect(drivenSecond).toBe(1);
    expect(tickSupervisedTask).toHaveBeenCalledTimes(2);

    releaseFirst();
    await new Promise((r) => setTimeout(r, 0));
    const status = getSupervisorRunnerStatus({ ...DEFAULT_RUNNER_CONFIG, maxConcurrency: 2 });
    expect(status.activeTicks).toBe(0);
  });
});
