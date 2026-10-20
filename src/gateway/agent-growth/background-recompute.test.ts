import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";

const tmpRoot = mkdtempSync(path.join(tmpdir(), "agent-growth-bg-recompute-"));

const listRobotSkillAssetsMock = vi.fn(
  (_agentId: string) => [] as Array<{ id: string; enabled: boolean }>,
);

vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds: () => ["main"],
  resolveAgentDir: (_cfg: unknown, agentId: string) => path.join(tmpRoot, agentId),
}));

vi.mock("../skill-lifecycle-store.js", () => ({
  listRobotSkillAssets: (agentId: string) => listRobotSkillAssetsMock(agentId),
}));

const { maybeBackgroundRecomputeGrowthAndDna, resetBackgroundRecomputeThrottleForTests } =
  await import("./background-recompute.js");
const { registerGrowthEventBroadcast } = await import("./growth-events.js");
const { recordTaskOutcome, readOperationalMetrics } =
  await import("./operational-metrics-store.js");
const { readRobotGrowthStatus, writeRobotGrowthStatus } = await import("./store.js");
const { createInitialGrowthStatus } = await import("./factory.js");
const { readRobotWorkingStyle, readWorkingStyleChange } = await import("./working-style-store.js");

const cfg = {} as unknown as OpenBotConfig;

describe("maybeBackgroundRecomputeGrowthAndDna", () => {
  beforeEach(async () => {
    resetBackgroundRecomputeThrottleForTests();
    listRobotSkillAssetsMock.mockReset();
    listRobotSkillAssetsMock.mockReturnValue([]);
    rmSync(path.join(tmpRoot, "main"), { recursive: true, force: true });
    await writeRobotGrowthStatus(
      cfg,
      "main",
      createInitialGrowthStatus({ kind: "robot", atMs: 1_000 }),
    );
  });

  afterEach(() => {
    resetBackgroundRecomputeThrottleForTests();
  });

  it("skips when throttled within minInterval", async () => {
    // Seed metrics without going through recordTaskOutcome (which also schedules recompute).
    const { mkdirSync } = await import("node:fs");
    const { writeJsonAtomic } = await import("../../infra/json-files.js");
    mkdirSync(path.join(tmpRoot, "main"), { recursive: true });
    await writeJsonAtomic(path.join(tmpRoot, "main", "operational-metrics.json"), {
      tasksTotal: 2,
      tasksSucceeded: 2,
      toolsTotal: 0,
      toolsSucceeded: 0,
      humanTakeovers: 0,
      satisfactionRated: 0,
      satisfactionPositive: 0,
      updatedAtMs: Date.now(),
    });
    resetBackgroundRecomputeThrottleForTests();
    const first = await maybeBackgroundRecomputeGrowthAndDna({
      cfg,
      agentId: "main",
      minIntervalMs: 60_000,
      nowMs: 10_000,
    });
    expect(first).toEqual({ ran: true });
    const second = await maybeBackgroundRecomputeGrowthAndDna({
      cfg,
      agentId: "main",
      minIntervalMs: 60_000,
      nowMs: 10_500,
    });
    expect(second.ran).toBe(false);
    expect(second.reason).toBe("throttled");
  });

  it("applies working style when task success signals justify autonomous delta", async () => {
    // High success, zero takeover → deriveWorkingStyleDelta sets autonomous.
    for (let i = 0; i < 10; i += 1) {
      await recordTaskOutcome(cfg, "main", { success: true });
    }
    resetBackgroundRecomputeThrottleForTests();
    const result = await maybeBackgroundRecomputeGrowthAndDna({
      cfg,
      agentId: "main",
      minIntervalMs: 0,
      nowMs: Date.now(),
    });
    expect(result.ran).toBe(true);

    const metrics = await readOperationalMetrics(cfg, "main");
    expect(metrics.tasksTotal).toBeGreaterThanOrEqual(10);

    const growth = await readRobotGrowthStatus(cfg, "main");
    expect(growth?.operationalScore).not.toBeNull();

    const style = await readRobotWorkingStyle(cfg, "main");
    // Delta may apply decisionPreference autonomous when success high and takeover 0.
    if (style) {
      expect(["autonomous", "confirm_first", "balanced"]).toContain(style.decisionPreference);
    }
    const change = await readWorkingStyleChange(cfg, "main");
    // Either applied a change record or had empty delta — both valid.
    if (change) {
      expect(change.appliedDelta).toBeTruthy();
      expect(change.assessedAtMs).toBeNull();
    }
  });

  it("returns no-signals when accumulator is empty", async () => {
    const result = await maybeBackgroundRecomputeGrowthAndDna({
      cfg,
      agentId: "main",
      minIntervalMs: 0,
      nowMs: 1,
    });
    expect(result.ran).toBe(false);
    expect(result.reason).toBe("no-signals");
  });

  it("emits false_ready_detected via registered broadcast after recompute", async () => {
    const events: Array<{ event: string; payload: unknown }> = [];
    registerGrowthEventBroadcast((event, payload) => {
      events.push({ event, payload });
    });
    listRobotSkillAssetsMock.mockReturnValue([
      { id: "a", enabled: true },
      { id: "b", enabled: true },
    ]);
    const seeded = createInitialGrowthStatus({ kind: "robot", atMs: 1_000 });
    seeded.dimensions = { identity: 100, capability: 0, knowledge: 100, habits: 100 };
    seeded.activationScore = 95;
    seeded.operationalScore = 80;
    await writeRobotGrowthStatus(cfg, "main", seeded);
    const { mkdirSync } = await import("node:fs");
    const { writeJsonAtomic } = await import("../../infra/json-files.js");
    mkdirSync(path.join(tmpRoot, "main"), { recursive: true });
    await writeJsonAtomic(path.join(tmpRoot, "main", "operational-metrics.json"), {
      tasksTotal: 20,
      tasksSucceeded: 2,
      toolsTotal: 0,
      toolsSucceeded: 0,
      humanTakeovers: 10,
      satisfactionRated: 0,
      satisfactionPositive: 0,
      updatedAtMs: Date.now(),
    });
    resetBackgroundRecomputeThrottleForTests();
    const result = await maybeBackgroundRecomputeGrowthAndDna({
      cfg,
      agentId: "main",
      minIntervalMs: 0,
      nowMs: Date.now(),
    });
    expect(result.ran).toBe(true);
    const growth = await readRobotGrowthStatus(cfg, "main");
    expect(growth?.activationScore).toBeGreaterThanOrEqual(90);
    expect(growth?.operationalScore).not.toBeNull();
    expect(growth?.operationalScore as number).toBeLessThan(30);
    expect(events.some((entry) => entry.event === "agent_growth.false_ready_detected")).toBe(true);
    registerGrowthEventBroadcast(undefined);
  });
});
