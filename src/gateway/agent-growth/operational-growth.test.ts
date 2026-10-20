import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { createInitialGrowthStatus } from "./factory.js";
import {
  projectOperationalGrowth,
  syncRobotGrowthFromOperationalMetrics,
} from "./operational-growth.js";
import type { OperationalMetrics } from "./operational-metrics-store.js";
import { readRobotGrowthStatus, writeRobotGrowthStatus } from "./store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

function metrics(tasksTotal: number, tasksSucceeded: number): OperationalMetrics {
  return {
    tasksTotal,
    tasksSucceeded,
    toolsTotal: 0,
    toolsSucceeded: 0,
    humanTakeovers: 0,
    takeoverObservations: 0,
    satisfactionPositive: 0,
    satisfactionNegative: 0,
    updatedAtMs: 1,
  };
}

describe("operational growth projection", () => {
  it("uses sample confidence instead of granting full growth after one success", () => {
    const initial = createInitialGrowthStatus({ kind: "robot", atMs: 1 });
    const next = projectOperationalGrowth(initial, metrics(1, 1), 2, []);

    expect(next.dimensions.capability).toBe(5);
    expect(next.dimensions.habits).toBe(5);
    expect(next.dimensions.identity).toBe(0);
    expect(next.dimensions.knowledge).toBe(0);
  });

  it("turns sustained successful work into capability and habit growth", () => {
    const initial = createInitialGrowthStatus({ kind: "robot", atMs: 1 });
    const next = projectOperationalGrowth(initial, metrics(20, 19), 2, []);

    expect(next.dimensions.capability).toBe(95);
    expect(next.dimensions.habits).toBe(95);
    expect(next.operationalScore).toBe(95);
    expect(next.isActivated).toBe(true);
    expect(next.milestones.firstMissionSentAtMs).toBe(2);
    expect(next.milestones.firstMissionSuccessAtMs).toBe(2);
    expect(next.growthReport?.tasksCompleted).toBe(19);
    expect(next.growthReport?.taskSuccessRate).toBeCloseTo(0.95);
    expect(next.lifecycleState).toBe("evolution");
  });

  it("does not regress dimensions already earned from explicit signals", () => {
    const initial = createInitialGrowthStatus({ kind: "robot", atMs: 1 });
    initial.dimensions.capability = 100;
    initial.dimensions.habits = 80;

    const next = projectOperationalGrowth(initial, metrics(20, 10), 2, []);
    expect(next.dimensions.capability).toBe(100);
    expect(next.dimensions.habits).toBe(80);
    expect(next.operationalScore).toBe(50);
  });

  it("backfills persisted historical metrics into growth status", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-op-growth-"));
    temporaryDirectories.push(agentDir);
    const cfg = {
      agents: { list: [{ id: "historical-bot", agentDir }] },
    } as unknown as OpenBotConfig;
    await writeRobotGrowthStatus(
      cfg,
      "historical-bot",
      createInitialGrowthStatus({ kind: "robot", atMs: 1 }),
    );
    await fs.writeFile(
      path.join(agentDir, "operational-metrics.json"),
      JSON.stringify(metrics(212, 206)),
      "utf8",
    );

    await syncRobotGrowthFromOperationalMetrics(cfg, "historical-bot");
    const persisted = await readRobotGrowthStatus(cfg, "historical-bot");
    expect(persisted?.dimensions.capability).toBe(97);
    expect(persisted?.dimensions.habits).toBe(97);
    expect(persisted?.operationalScore).toBe(97);
  });
});
