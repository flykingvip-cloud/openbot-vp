import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ORCH_KILL_FIXTURE_IDS,
  runAllOrchKillFixtures,
  runOrchKillFixture,
} from "./lease-kill-fixtures.js";
import { ORCHESTRATION_LIVE_INVOKE } from "./types.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function tempRoot(prefix = "orch-kill-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("WP-06 orch kill/restart fixture harness", () => {
  it("keeps LIVE invoke false and enumerates all design §5 fixture ids", () => {
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
    expect(ORCH_KILL_FIXTURE_IDS).toEqual([
      "orch.kill.before-schedule",
      "orch.kill.after-schedule",
      "orch.kill.before-exec",
      "orch.kill.after-exec",
      "orch.kill.before-result-persist",
      "orch.kill.after-result-persist",
    ]);
  });

  it("orch.kill.before-schedule: after restart a new holder acquires; no dual holders", () => {
    const root = tempRoot();
    const result = runOrchKillFixture({
      fixtureId: "orch.kill.before-schedule",
      rootDir: root,
    });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("ok");
    expect(result.postRestart?.leaseHolder).toBe("worker-new");
    expect(fs.existsSync(path.join(root, "leases"))).toBe(true);
  });

  it("orch.kill.after-schedule: after expiry fence bumps; old holder submit rejected", () => {
    const root = tempRoot();
    const result = runOrchKillFixture({
      fixtureId: "orch.kill.after-schedule",
      rootDir: root,
    });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("ok");
    expect(result.preKill?.fencingToken).toBe(1);
    expect(result.postRestart?.fencingToken).toBeGreaterThan(1);
    expect(result.postRestart?.leaseHolder).toBe("worker-new");
  });

  it("orch.kill.before-exec: same lease key does not allow dual active holders", () => {
    const root = tempRoot();
    const result = runOrchKillFixture({
      fixtureId: "orch.kill.before-exec",
      rootDir: root,
    });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("ok");
    expect(result.postRestart?.leaseHolder).toBe("worker-a");
  });

  it("orch.kill.after-exec: missing persist → unknown_outcome; old fence rejected", () => {
    const root = tempRoot();
    const result = runOrchKillFixture({
      fixtureId: "orch.kill.after-exec",
      rootDir: root,
    });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("unknown_outcome");
    expect(result.postRestart?.leaseHolder).toBe("worker-new");
    expect(result.preKill?.resultRef ?? null).toBeNull();
  });

  it("orch.kill.before-result-persist: restart converges; no permanent hanging lease", () => {
    const root = tempRoot();
    const result = runOrchKillFixture({
      fixtureId: "orch.kill.before-result-persist",
      rootDir: root,
    });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("ok");
    expect(result.postRestart?.resultRef).toBe("converged-terminal");
    expect(result.postRestart?.leaseHolder).toBe("worker-recover");
  });

  it("orch.kill.after-result-persist: recover/assertFence idempotent; no second effect", () => {
    const root = tempRoot();
    const result = runOrchKillFixture({
      fixtureId: "orch.kill.after-result-persist",
      rootDir: root,
    });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("ok");
    expect(result.postRestart?.resultRef).toBe("persisted-result-v1");
    const projections = fs.readdirSync(path.join(root, "projections"));
    expect(projections).toHaveLength(1);
  });

  it("runAllOrchKillFixtures covers every id on real temp dirs (file-backed)", () => {
    const root = tempRoot("orch-kill-all-");
    const results = runAllOrchKillFixtures({ rootDir: root });
    expect(results).toHaveLength(ORCH_KILL_FIXTURE_IDS.length);
    for (const r of results) {
      expect(r.ok, `${r.fixtureId}: ${r.notes.join("; ")}`).toBe(true);
      expect(ORCH_KILL_FIXTURE_IDS).toContain(r.fixtureId);
    }
    // Each fixture used an isolated subdirectory with a leases/ tree.
    const children = fs.readdirSync(root);
    expect(children.length).toBe(ORCH_KILL_FIXTURE_IDS.length);
    for (const child of children) {
      expect(fs.existsSync(path.join(root, child, "leases"))).toBe(true);
    }
  });
});
