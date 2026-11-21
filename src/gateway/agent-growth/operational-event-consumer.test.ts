import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { createInitialGrowthStatus } from "./factory.js";
import { createOperationalGrowthConsumer } from "./operational-event-consumer.js";
import { readRobotGrowthStatus, writeRobotGrowthStatus } from "./store.js";
it("replays operational input into the same full aggregate and preserves product state", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "full-growth-consumer-"));
  try {
    const initial = {
      ...createInitialGrowthStatus({ kind: "robot", atMs: 1 }),
      preludeDismissedAtMs: 10,
    };
    await writeRobotGrowthStatus({}, "agent", initial, { agentDir: dir });
    const resolveAgentDir = vi.fn(async () => dir);
    const consume = createOperationalGrowthConsumer({ cfg: {}, resolveAgentDir });
    const payload = {
      observedAtMs: 100,
      installedSkillKeys: [],
      metrics: {
        tasksTotal: 1,
        tasksSucceeded: 1,
        toolsTotal: 1,
        toolsSucceeded: 1,
        humanTakeovers: 0,
        takeoverObservations: 0,
        satisfactionPositive: 0,
        satisfactionNegative: 0,
        updatedAtMs: 100,
      },
    };
    await consume("event", "agent", payload);
    const first = await readRobotGrowthStatus({}, "agent", { agentDir: dir });
    await consume("event", "agent", payload);
    expect(await readRobotGrowthStatus({}, "agent", { agentDir: dir })).toEqual(first);
    await consume("older-event", "agent", {
      ...payload,
      observedAtMs: 50,
      metrics: { ...payload.metrics, tasksTotal: 0, tasksSucceeded: 0 },
    });
    const afterOlder = await readRobotGrowthStatus({}, "agent", { agentDir: dir });
    expect(afterOlder?.operationalScore).toBe(first?.operationalScore);
    expect(afterOlder?.operationalObservationAtMs).toBe(100);
    expect(first?.preludeDismissedAtMs).toBe(10);
    expect(first?.milestones.createdAtMs).toBe(initial.milestones.createdAtMs);
    await expect(
      consume("invalid", "agent", {
        ...payload,
        metrics: { ...payload.metrics, tasksSucceeded: 2 },
      }),
    ).rejects.toThrow("metrics");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
