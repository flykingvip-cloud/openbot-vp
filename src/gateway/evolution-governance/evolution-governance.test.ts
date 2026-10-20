import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-evolution-gov-${Date.now()}`);
vi.mock("../../utils.js", () => ({ CONFIG_DIR: tmpDir }));

const {
  isGovernanceKillSwitchActive,
  readGovernancePersistedState,
  setGovernanceKillSwitch,
  updateGovernanceJobCursor,
  runEvolutionGovernanceTick,
  startEvolutionGovernanceScheduler,
  stopEvolutionGovernanceScheduler,
  configureEvolutionGovernanceScheduler,
} = await import("./index.js");

describe("evolution-governance persistence + scheduler", () => {
  beforeEach(() => {
    stopEvolutionGovernanceScheduler();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    setGovernanceKillSwitch(false);
  });
  afterEach(() => {
    stopEvolutionGovernanceScheduler();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists job cursor across reads (restart-safe)", () => {
    updateGovernanceJobCursor({ lastAutoGovAt: "2026-07-19T00:00:00.000Z", lastRunId: "r1" });
    const state = readGovernancePersistedState();
    expect(state.jobCursor.lastRunId).toBe("r1");
    expect(state.jobCursor.lastAutoGovAt).toBe("2026-07-19T00:00:00.000Z");
    expect(fs.existsSync(path.join(tmpDir, "evolution-governance", "state.json"))).toBe(true);
  });

  it("honours kill switch on ticks", async () => {
    setGovernanceKillSwitch(true);
    expect(isGovernanceKillSwitchActive()).toBe(true);
    let called = 0;
    startEvolutionGovernanceScheduler(async () => {
      called += 1;
    });
    const result = await runEvolutionGovernanceTick();
    expect(result.ran).toBe(false);
    expect(result.reason).toBe("kill-switch");
    expect(called).toBe(0);
  });

  it("runs tick when enabled and records cursor", async () => {
    setGovernanceKillSwitch(false);
    configureEvolutionGovernanceScheduler({ enabled: true, intervalMs: 60_000 });
    let called = 0;
    startEvolutionGovernanceScheduler(async () => {
      called += 1;
    });
    const result = await runEvolutionGovernanceTick();
    expect(result.ran).toBe(true);
    expect(called).toBe(1);
    expect(readGovernancePersistedState().jobCursor.lastRunId).toBeTruthy();
  });
});
