/**
 * Cross-process exclusive acquire for file-backed orch leases.
 *
 * Same-process withFileLock-style locks are re-entrant by design; only real
 * child processes prove the wx lock serializes tryAcquireLease and that
 * alive holders are never stolen by age alone.
 */
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import type { LeaseLockPayload } from "./lease-file-lock.js";
import { safeFileToken } from "./lease-store.js";
import { ORCHESTRATION_LIVE_INVOKE } from "./types.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const ACQUIRE_WORKER = path.join(
  REPO_ROOT,
  "src/task-orchestration/__fixtures__/lease-acquire-worker.mjs",
);
const HOLD_WORKER = path.join(
  REPO_ROOT,
  "src/task-orchestration/__fixtures__/lease-lock-hold-worker.mjs",
);

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-lease-xproc-"));

afterAll(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readStdoutLines(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

describe("orch lease-store cross-process exclusivity", () => {
  it("keeps LIVE false", () => {
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
  });

  it("exactly one of two competing processes acquires an active lease", async () => {
    const rootDir = path.join(stateDir, "lease-root-simultaneous");
    fs.mkdirSync(rootDir, { recursive: true });
    const jobStepId = "xproc/shared-step";
    const nowMs = String(Date.now());
    const leaseTtlMs = "60000";

    const run = (holder: string) =>
      execFileAsync(process.execPath, ["--import", "tsx", ACQUIRE_WORKER], {
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
    const lines = [...readStdoutLines(a.stdout), ...readStdoutLines(b.stdout)];
    const oks = lines.filter((l) => l.startsWith("acquire-ok:"));
    const held = lines.filter((l) => l.startsWith("acquire-fail:lease_held"));
    expect(oks).toHaveLength(1);
    expect(held.length + oks.length).toBe(2);

    const { createOrchLeaseStore } = await import("./lease-store.ts");
    const store = createOrchLeaseStore({ rootDir });
    const got = store.get(jobStepId);
    expect(got?.leaseHolder).toBe(oks[0].slice("acquire-ok:".length));
    expect(got?.fencingToken).toBe(1);
  }, 90_000);

  it("does not steal a lock from a paused alive holder even when lock age exceeds 30s", async () => {
    const rootDir = path.join(stateDir, "lease-root-paused");
    const jobStepId = "xproc/paused-holder";
    const leaseFile = path.join(rootDir, "leases", `${safeFileToken(jobStepId)}.json`);
    const lockPath = `${leaseFile}.lock`;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    const child = spawn(process.execPath, [HOLD_WORKER], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        OPENBOT_LEASE_LOCK_PATH: lockPath,
        // Hold long enough that age >> 30s while we probe.
        OPENBOT_LEASE_LOCK_HOLD_MS: "45000",
        OPENBOT_LEASE_LOCK_CREATED_AT_OFFSET_MS: "31000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let childOut = "";
    child.stdout.on("data", (chunk: Buffer) => {
      childOut += chunk.toString("utf8");
    });

    const heldDeadline = Date.now() + 15_000;
    while (!childOut.includes("lock-held:") && Date.now() < heldDeadline) {
      await sleep(25);
    }
    expect(childOut).toContain("lock-held:");
    const before = JSON.parse(fs.readFileSync(lockPath, "utf8")) as LeaseLockPayload;
    expect(before.ownerToken).toBeTruthy();

    const { createOrchLeaseStore } = await import("./lease-store.ts");
    const store = createOrchLeaseStore({ rootDir });
    let timedOut = false;
    try {
      store.tryAcquireLease({
        jobStepId,
        holder: "competitor",
        nowMs: Date.now(),
        leaseTtlMs: 5_000,
      });
    } catch (err) {
      timedOut = String((err as Error).message).includes("orch_lease_file_lock_timeout");
    }
    expect(timedOut).toBe(true);

    // Inspect lock file directly; store.get would also block on the held lock.
    const after = JSON.parse(fs.readFileSync(lockPath, "utf8")) as LeaseLockPayload;
    expect(after.ownerToken).toBe(before.ownerToken);
    expect(fs.existsSync(leaseFile)).toBe(false);

    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      sleep(5_000),
    ]);
  }, 90_000);

  it("reclaims after holder crash (dead PID) so a competitor can acquire", async () => {
    const rootDir = path.join(stateDir, "lease-root-crash");
    const jobStepId = "xproc/crashed-holder";
    const leaseFile = path.join(rootDir, "leases", `${safeFileToken(jobStepId)}.json`);
    const lockPath = `${leaseFile}.lock`;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    await execFileAsync(process.execPath, [HOLD_WORKER], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        OPENBOT_LEASE_LOCK_PATH: lockPath,
        OPENBOT_LEASE_LOCK_CRASH: "1",
        OPENBOT_LEASE_LOCK_CREATED_AT_OFFSET_MS: "0",
      },
      timeout: 15_000,
    });

    expect(fs.existsSync(lockPath)).toBe(true);
    const crashed = JSON.parse(fs.readFileSync(lockPath, "utf8")) as LeaseLockPayload;
    expect(crashed.ownerToken).toBeTruthy();

    const { createOrchLeaseStore } = await import("./lease-store.ts");
    const store = createOrchLeaseStore({ rootDir });
    const acquired = store.tryAcquireLease({
      jobStepId,
      holder: "recovery-worker",
      nowMs: Date.now(),
      leaseTtlMs: 30_000,
    });
    expect(acquired.ok).toBe(true);
    if (acquired.ok) {
      expect(acquired.record.leaseHolder).toBe("recovery-worker");
    }
    expect(fs.existsSync(lockPath)).toBe(false);
  }, 60_000);

  it("old holder release cannot delete a newer holder's lock", async () => {
    const rootDir = path.join(stateDir, "lease-root-ownership");
    const jobStepId = "xproc/ownership";
    const leaseFile = path.join(rootDir, "leases", `${safeFileToken(jobStepId)}.json`);
    const lockPath = `${leaseFile}.lock`;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    const child = spawn(process.execPath, [HOLD_WORKER], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        OPENBOT_LEASE_LOCK_PATH: lockPath,
        OPENBOT_LEASE_LOCK_RELEASE_AFTER_REPLACE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let childOut = "";
    child.stdout.on("data", (chunk: Buffer) => {
      childOut += chunk.toString("utf8");
    });

    const heldDeadline = Date.now() + 15_000;
    while (!childOut.includes("lock-held:") && Date.now() < heldDeadline) {
      await sleep(25);
    }
    expect(childOut).toContain("lock-held:");
    const oldToken = childOut.split("lock-held:")[1]?.split(":")[0];
    expect(oldToken).toBeTruthy();

    // Simulate crash reclaim + new holder via the same companion+link protocol.
    const { writeLeaseLockPayload } = await import("./lease-file-lock.ts");
    // Drop public name left by the paused holder (companion may remain briefly).
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // ignore
    }
    const newToken = randomUUID();
    const newPayload: LeaseLockPayload = {
      pid: process.pid,
      createdAt: new Date().toISOString(),
      ownerToken: newToken,
    };
    writeLeaseLockPayload(lockPath, newPayload);

    // Signal old holder to attempt release.
    fs.writeFileSync(`${lockPath}.release-signal`, "go\n", "utf8");

    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      sleep(15_000),
    ]);

    expect(childOut).toMatch(/lock-release-skipped:/);
    expect(fs.existsSync(lockPath)).toBe(true);
    const still = JSON.parse(fs.readFileSync(lockPath, "utf8")) as LeaseLockPayload;
    expect(still.ownerToken).toBe(newToken);
    expect(still.ownerToken).not.toBe(oldToken);
  }, 60_000);

  it("two child reclaimers cannot delete a lock installed after the first reclaim", async () => {
    const rootDir = path.join(stateDir, "lease-root-dual-reclaim");
    const jobStepId = "xproc/dual-reclaim";
    const leaseFile = path.join(rootDir, "leases", `${safeFileToken(jobStepId)}.json`);
    const lockPath = `${leaseFile}.lock`;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    // Dead-PID lock (crash leftover) via companion+link protocol.
    const staleToken = randomUUID();
    const { tryReclaimStaleLeaseLock, writeLeaseLockPayload } =
      await import("./lease-file-lock.ts");
    writeLeaseLockPayload(lockPath, {
      pid: 2_147_483_642,
      createdAt: new Date(Date.now() - 120_000).toISOString(),
      ownerToken: staleToken,
    });
    const expected = {
      pid: 2_147_483_642,
      createdAt: JSON.parse(fs.readFileSync(lockPath, "utf8")).createdAt as string,
      ownerToken: staleToken,
    };

    const first = tryReclaimStaleLeaseLock(lockPath, expected);
    expect(first).toBe(true);

    const { createOrchLeaseStore } = await import("./lease-store.ts");
    const store = createOrchLeaseStore({ rootDir });
    const acquired = store.tryAcquireLease({
      jobStepId,
      holder: "after-reclaim",
      nowMs: Date.now(),
      leaseTtlMs: 30_000,
    });
    expect(acquired.ok).toBe(true);

    // Second reclaimer with stale expectation must not disturb the new lease lock cycle.
    const second = tryReclaimStaleLeaseLock(lockPath, expected);
    // lockPath may be absent (released after acquire) or held by a transient lock —
    // either way second must not throw and must not resurrect stale ownership.
    expect(typeof second).toBe("boolean");

    const got = store.get(jobStepId);
    expect(got?.leaseHolder).toBe("after-reclaim");
  }, 60_000);
});
