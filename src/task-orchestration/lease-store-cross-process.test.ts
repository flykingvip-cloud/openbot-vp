/**
 * Cross-process exclusive acquire for file-backed orch leases.
 *
 * Same-process withFileLock-style locks are re-entrant by design; only real
 * child processes prove the wx lock serializes tryAcquireLease.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { ORCHESTRATION_LIVE_INVOKE } from "./types.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const WORKER = path.join(REPO_ROOT, "src/task-orchestration/__fixtures__/lease-acquire-worker.mjs");

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-lease-xproc-"));

afterAll(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe("orch lease-store cross-process exclusivity", () => {
  it("keeps LIVE false", () => {
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
  });

  it("exactly one of two competing processes acquires an active lease", async () => {
    const rootDir = path.join(stateDir, "lease-root");
    fs.mkdirSync(rootDir, { recursive: true });
    const jobStepId = "xproc/shared-step";
    const nowMs = String(Date.now());
    const leaseTtlMs = "60000";

    const run = (holder: string) =>
      execFileAsync(process.execPath, ["--import", "tsx", WORKER], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          OPENBOT_LEASE_ROOT: rootDir,
          OPENBOT_LEASE_JOB_STEP_ID: jobStepId,
          OPENBOT_LEASE_HOLDER: holder,
          OPENBOT_LEASE_NOW_MS: nowMs,
          OPENBOT_LEASE_TTL_MS: leaseTtlMs,
        },
        timeout: 60_000,
      });

    const [a, b] = await Promise.all([run("worker-a"), run("worker-b")]);
    const lines = `${a.stdout}\n${b.stdout}`
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const oks = lines.filter((l) => l.startsWith("acquire-ok:"));
    const held = lines.filter((l) => l.startsWith("acquire-fail:lease_held"));
    expect(oks).toHaveLength(1);
    expect(held.length + oks.length).toBe(2);

    // Durable file must show the winning holder only.
    const { createOrchLeaseStore } = await import("./lease-store.ts");
    const store = createOrchLeaseStore({ rootDir });
    const got = store.get(jobStepId);
    expect(got?.leaseHolder).toBe(oks[0].slice("acquire-ok:".length));
    expect(got?.fencingToken).toBe(1);
  }, 90_000);
});
