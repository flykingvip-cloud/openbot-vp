import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateLeaseLock,
  isPidAlive,
  releaseLeaseLockOwned,
  tryReclaimStaleLeaseLock,
  withLeaseFileLock,
  writeLeaseLockPayload,
  type LeaseLockPayload,
} from "./lease-file-lock.js";
import { createOrchLeaseStore, safeFileToken } from "./lease-store.js";
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

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-lease-lock-"));
  tempDirs.push(dir);
  return dir;
}

describe("orch lease-file-lock ownership / liveness", () => {
  it("keeps LIVE invoke false", () => {
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
  });

  it("does not treat an alive holder as stale solely because the lock is older than 30s", () => {
    const root = tempRoot();
    const lockPath = path.join(root, "leases", "demo.json.lock");
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const payload: LeaseLockPayload = {
      pid: process.pid,
      createdAt: new Date(Date.now() - 31_000).toISOString(),
      ownerToken: "alive-old-token",
    };
    writeLeaseLockPayload(lockPath, payload);
    const evaluation = evaluateLeaseLock(lockPath);
    expect(evaluation.status).toBe("held");
    if (evaluation.status === "held") {
      expect(evaluation.payload.ownerToken).toBe("alive-old-token");
    }
  });

  it("refuses to steal a lease when an alive owner holds a 31s-old lock file", () => {
    const root = tempRoot();
    const jobStepId = "lock/alive-old";
    const leaseFile = path.join(root, "leases", `${safeFileToken(jobStepId)}.json`);
    const lockPath = `${leaseFile}.lock`;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    writeLeaseLockPayload(lockPath, {
      pid: process.pid,
      createdAt: new Date(Date.now() - 31_000).toISOString(),
      ownerToken: "still-alive",
    });

    const store = createOrchLeaseStore({ rootDir: root });
    expect(() =>
      store.tryAcquireLease({
        jobStepId,
        holder: "competitor",
        nowMs: Date.now(),
        leaseTtlMs: 5_000,
      }),
    ).toThrow(/orch_lease_file_lock_timeout/);

    // Do not call store.get while the foreign lock is held — get also needs the lock.
    const still = JSON.parse(fs.readFileSync(lockPath, "utf8")) as LeaseLockPayload;
    expect(still.ownerToken).toBe("still-alive");
    expect(fs.existsSync(leaseFile)).toBe(false);
  }, 20_000);

  it("reclaims a lock only when the holder PID is dead", () => {
    const root = tempRoot();
    const lockPath = path.join(root, "dead.json.lock");
    const payload: LeaseLockPayload = {
      pid: 2_147_483_646, // extremely unlikely to be alive
      createdAt: new Date(Date.now() - 1_000).toISOString(),
      ownerToken: "dead-token",
    };
    writeLeaseLockPayload(lockPath, payload);
    const evaluation = evaluateLeaseLock(lockPath);
    expect(evaluation.status).toBe("stale");
    if (evaluation.status !== "stale") {
      return;
    }
    expect(tryReclaimStaleLeaseLock(lockPath, evaluation.payload)).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("does not delete incomplete lock metadata during reclaim", () => {
    const root = tempRoot();
    const lockPath = path.join(root, "broken.json.lock");
    fs.writeFileSync(lockPath, "not-json\n", "utf8");
    expect(evaluateLeaseLock(lockPath).status).toBe("incomplete");
    expect(
      tryReclaimStaleLeaseLock(lockPath, {
        pid: 1,
        createdAt: new Date().toISOString(),
        ownerToken: "x",
      }),
    ).toBe(false);
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it("release verifies ownership so an old holder cannot delete a newer lock", () => {
    const root = tempRoot();
    const lockPath = path.join(root, "owned.json.lock");
    writeLeaseLockPayload(lockPath, {
      pid: process.pid,
      createdAt: new Date().toISOString(),
      ownerToken: "new-owner",
    });
    releaseLeaseLockOwned(lockPath, "old-owner");
    expect(fs.existsSync(lockPath)).toBe(true);
    const still = JSON.parse(fs.readFileSync(lockPath, "utf8")) as LeaseLockPayload;
    expect(still.ownerToken).toBe("new-owner");

    releaseLeaseLockOwned(lockPath, "new-owner");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("stale reclaim is TOCTOU-safe when the lock was replaced after check", () => {
    const root = tempRoot();
    const lockPath = path.join(root, "race.json.lock");
    const stale: LeaseLockPayload = {
      pid: 2_147_483_645,
      createdAt: new Date().toISOString(),
      ownerToken: "stale-owner",
    };
    writeLeaseLockPayload(lockPath, {
      pid: process.pid,
      createdAt: new Date().toISOString(),
      ownerToken: "replacement-owner",
    });
    expect(tryReclaimStaleLeaseLock(lockPath, stale)).toBe(false);
    const still = JSON.parse(fs.readFileSync(lockPath, "utf8")) as LeaseLockPayload;
    expect(still.ownerToken).toBe("replacement-owner");
  });

  it("withLeaseFileLock serializes and cleans up owned lock", () => {
    const root = tempRoot();
    const leaseFile = path.join(root, "leases", "x.json");
    const seen: number[] = [];
    withLeaseFileLock(leaseFile, () => {
      seen.push(1);
      expect(fs.existsSync(`${leaseFile}.lock`)).toBe(true);
    });
    expect(seen).toEqual([1]);
    expect(fs.existsSync(`${leaseFile}.lock`)).toBe(false);
  });

  it("late reclaim after claim must not delete a replacement lock (acceptance interleave)", () => {
    // Deterministic injection of the acceptance race:
    // reclaimer finishes claim (rename), then replacement appears at lockPath
    // before tomb unlink — replacement must survive; reclaim still succeeds on tomb.
    const root = tempRoot();
    const lockPath = path.join(root, "interleave.json.lock");
    const stale: LeaseLockPayload = {
      pid: 2_147_483_644,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      ownerToken: "stale-to-reclaim",
    };
    writeLeaseLockPayload(lockPath, stale);

    const replacement: LeaseLockPayload = {
      pid: process.pid,
      createdAt: new Date().toISOString(),
      ownerToken: "replacement-holder",
    };

    let injected = false;
    const reclaimResult = tryReclaimStaleLeaseLock(lockPath, stale, {
      afterClaim: () => {
        // lockPath is free after rename claim — new holder installs here.
        writeLeaseLockPayload(lockPath, replacement);
        injected = true;
      },
    });

    expect(injected).toBe(true);
    expect(reclaimResult).toBe(true);

    const still = JSON.parse(fs.readFileSync(lockPath, "utf8")) as LeaseLockPayload;
    expect(still.ownerToken).toBe("replacement-holder");
    expect(still.pid).toBe(process.pid);
    expect(isPidAlive(still.pid)).toBe(true);
    // No unreclaimed tomb should remain for the stale token.
    const leftovers = fs.readdirSync(root).filter((n) => n.includes(".reclaimed."));
    expect(leftovers).toEqual([]);
  });

  it("two reclaimers on the same dead lock: after one completes a new acquire, the other must not delete it", () => {
    const root = tempRoot();
    const lockPath = path.join(root, "dual-reclaim.json.lock");
    const stale: LeaseLockPayload = {
      pid: 2_147_483_643,
      createdAt: new Date(Date.now() - 90_000).toISOString(),
      ownerToken: "dual-stale",
    };
    writeLeaseLockPayload(lockPath, stale);

    const first = tryReclaimStaleLeaseLock(lockPath, stale);
    expect(first).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);

    // New holder installs after first reclaim completes.
    const replacement: LeaseLockPayload = {
      pid: process.pid,
      createdAt: new Date().toISOString(),
      ownerToken: "post-reclaim-holder",
    };
    writeLeaseLockPayload(lockPath, replacement);

    // Late reclaimer still armed with the old expected payload.
    const second = tryReclaimStaleLeaseLock(lockPath, stale);
    expect(second).toBe(false);

    const still = JSON.parse(fs.readFileSync(lockPath, "utf8")) as LeaseLockPayload;
    expect(still.ownerToken).toBe("post-reclaim-holder");
    expect(isPidAlive(still.pid)).toBe(true);
  });
});
