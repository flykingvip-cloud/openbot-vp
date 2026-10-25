import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ORCH_KILL_FIXTURE_IDS,
  createOrchLeaseStore,
  isOrchKillFixtureId,
  safeFileToken,
} from "./lease-store.js";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-lease-"));
  tempDirs.push(dir);
  return dir;
}

describe("WP-06 orch lease-store", () => {
  it("keeps LIVE invoke false and documents kill fixture ids", () => {
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
    expect(ORCH_KILL_FIXTURE_IDS).toContain("orch.kill.before-schedule");
    expect(ORCH_KILL_FIXTURE_IDS).toContain("orch.kill.after-result-persist");
    expect(isOrchKillFixtureId("orch.kill.after-schedule")).toBe(true);
    expect(isOrchKillFixtureId("not.a.fixture")).toBe(false);
  });

  it("acquires a lease and bumps fencing token from zero", () => {
    const store = createOrchLeaseStore();
    const acquired = store.tryAcquireLease({
      jobStepId: "job-1/step-a",
      holder: "worker-a",
      nowMs: 1_000,
      leaseTtlMs: 5_000,
    });
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) {
      return;
    }
    expect(acquired.record.leaseHolder).toBe("worker-a");
    expect(acquired.record.fencingToken).toBe(1);
    expect(acquired.record.deadlineAt).toBe(6_000);
    expect(acquired.record.heartbeatAt).toBe(1_000);
  });

  it("blocks a second holder while the lease is valid", () => {
    const store = createOrchLeaseStore();
    const first = store.tryAcquireLease({
      jobStepId: "job-1/step-b",
      holder: "worker-a",
      nowMs: 1_000,
      leaseTtlMs: 10_000,
    });
    expect(first.ok).toBe(true);
    const second = store.tryAcquireLease({
      jobStepId: "job-1/step-b",
      holder: "worker-b",
      nowMs: 2_000,
      leaseTtlMs: 10_000,
    });
    expect(second.ok).toBe(false);
    if (second.ok) {
      return;
    }
    expect(second.reason).toBe("lease_held");
    expect(second.record.leaseHolder).toBe("worker-a");
    expect(second.record.fencingToken).toBe(1);
  });

  it("allows reacquire after expiry with incremented fence", () => {
    const store = createOrchLeaseStore();
    const first = store.tryAcquireLease({
      jobStepId: "job-1/step-c",
      holder: "worker-a",
      nowMs: 1_000,
      deadlineAt: 2_000,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.record.fencingToken).toBe(1);

    const staleSubmit = store.submitResult({
      jobStepId: "job-1/step-c",
      holder: "worker-a",
      fencingToken: 1,
      nowMs: 2_500,
      resultRef: "late",
    });
    expect(staleSubmit.ok).toBe(false);
    if (!staleSubmit.ok) {
      expect(staleSubmit.reason).toBe("lease_expired");
    }

    const second = store.tryAcquireLease({
      jobStepId: "job-1/step-c",
      holder: "worker-b",
      nowMs: 3_000,
      leaseTtlMs: 5_000,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.record.leaseHolder).toBe("worker-b");
    expect(second.record.fencingToken).toBe(2);

    const oldFenceSubmit = store.submitResult({
      jobStepId: "job-1/step-c",
      holder: "worker-a",
      fencingToken: 1,
      nowMs: 3_100,
      resultRef: "stale",
    });
    expect(oldFenceSubmit.ok).toBe(false);
    if (!oldFenceSubmit.ok) {
      expect(oldFenceSubmit.reason).toBe("stale_fencing_token");
    }
  });

  it("rejects stale fencing token on assertFence and submitResult", () => {
    const store = createOrchLeaseStore();
    const acquired = store.tryAcquireLease({
      jobStepId: "job-1/step-d",
      holder: "worker-a",
      nowMs: 1_000,
      leaseTtlMs: 10_000,
    });
    expect(acquired.ok).toBe(true);
    const bad = store.assertFence({
      jobStepId: "job-1/step-d",
      holder: "worker-a",
      fencingToken: 99,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.reason).toBe("stale_fencing_token");
    }
  });

  it("caps heartbeat at deadline and never extends deadline", () => {
    const store = createOrchLeaseStore();
    const acquired = store.tryAcquireLease({
      jobStepId: "job-1/step-e",
      holder: "worker-a",
      nowMs: 1_000,
      deadlineAt: 5_000,
    });
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) {
      return;
    }
    const hb = store.heartbeat({
      jobStepId: "job-1/step-e",
      holder: "worker-a",
      fencingToken: acquired.record.fencingToken,
      nowMs: 4_500,
    });
    expect(hb.ok).toBe(true);
    if (!hb.ok) {
      return;
    }
    expect(hb.record.deadlineAt).toBe(5_000);
    expect(hb.record.heartbeatAt).toBe(4_500);

    const hbPast = store.heartbeat({
      jobStepId: "job-1/step-e",
      holder: "worker-a",
      fencingToken: acquired.record.fencingToken,
      // now still before deadline so lease active, but heartbeat capped
      nowMs: 4_999,
    });
    expect(hbPast.ok).toBe(true);
    if (!hbPast.ok) {
      return;
    }
    expect(hbPast.record.deadlineAt).toBe(5_000);
    expect(hbPast.record.heartbeatAt).toBe(4_999);
    expect(hbPast.record.heartbeatAt).toBeLessThanOrEqual(hbPast.record.deadlineAt!);
  });

  it("refuses new lease when cancelRequested", () => {
    const store = createOrchLeaseStore();
    store.requestCancel("job-1/step-f");
    const acquired = store.tryAcquireLease({
      jobStepId: "job-1/step-f",
      holder: "worker-a",
      nowMs: 1_000,
      leaseTtlMs: 5_000,
    });
    expect(acquired.ok).toBe(false);
    if (!acquired.ok) {
      expect(acquired.reason).toBe("cancel_requested");
    }
  });

  it("persists lease state under injectable rootDir", () => {
    const root = tempRoot();
    const store = createOrchLeaseStore({ rootDir: root });
    const acquired = store.tryAcquireLease({
      jobStepId: "job-persist/step-1",
      holder: "worker-a",
      nowMs: 10,
      leaseTtlMs: 1000,
      attempt: 2,
      budgetRemaining: 42,
    });
    expect(acquired.ok).toBe(true);

    const reloaded = createOrchLeaseStore({ rootDir: root });
    const got = reloaded.get("job-persist/step-1");
    expect(got?.leaseHolder).toBe("worker-a");
    expect(got?.fencingToken).toBe(1);
    expect(got?.attempt).toBe(2);
    expect(got?.budgetRemaining).toBe(42);

    const files = fs.readdirSync(path.join(root, "leases"));
    expect(files.length).toBe(1);
  });

  it("release clears holder so another worker can acquire with new fence", () => {
    const store = createOrchLeaseStore();
    const first = store.tryAcquireLease({
      jobStepId: "job-1/step-g",
      holder: "worker-a",
      nowMs: 1_000,
      leaseTtlMs: 10_000,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const released = store.release({
      jobStepId: "job-1/step-g",
      holder: "worker-a",
      fencingToken: first.record.fencingToken,
    });
    expect(released.ok).toBe(true);
    const second = store.tryAcquireLease({
      jobStepId: "job-1/step-g",
      holder: "worker-b",
      nowMs: 1_500,
      leaseTtlMs: 10_000,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.record.fencingToken).toBe(2);
    expect(second.record.leaseHolder).toBe("worker-b");
  });

  it("safeFileToken keeps slash and colon ids on distinct files", () => {
    expect(safeFileToken("a/b")).not.toBe(safeFileToken("a:b"));
    expect(safeFileToken("a/b")).toBe(Buffer.from("a/b", "utf8").toString("base64url"));
    const root = tempRoot();
    const store = createOrchLeaseStore({ rootDir: root });
    const first = store.tryAcquireLease({
      jobStepId: "a/b",
      holder: "worker-a",
      nowMs: 1_000,
      leaseTtlMs: 10_000,
    });
    expect(first.ok).toBe(true);
    // Querying the colliding-under-old-scheme id must not see the first lease.
    expect(store.get("a:b")).toBeNull();
    const second = store.tryAcquireLease({
      jobStepId: "a:b",
      holder: "worker-b",
      nowMs: 1_100,
      leaseTtlMs: 10_000,
    });
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(first.record.leaseHolder).toBe("worker-a");
    expect(second.record.leaseHolder).toBe("worker-b");
    expect(store.get("a/b")?.leaseHolder).toBe("worker-a");
    expect(store.get("a:b")?.leaseHolder).toBe("worker-b");
    const leasesDir = path.join(root, "leases");
    const files = fs.readdirSync(leasesDir).filter((f) => f.endsWith(".json"));
    expect(files).toContain(`${safeFileToken("a/b")}.json`);
    expect(files).toContain(`${safeFileToken("a:b")}.json`);
    expect(files).toHaveLength(2);
  });

  it("rejects file content whose jobStepId does not match the request key", () => {
    const root = tempRoot();
    const store = createOrchLeaseStore({ rootDir: root });
    const acquired = store.tryAcquireLease({
      jobStepId: "real-id",
      holder: "worker-a",
      nowMs: 1_000,
      leaseTtlMs: 10_000,
    });
    expect(acquired.ok).toBe(true);
    const fp = path.join(root, "leases", `${safeFileToken("real-id")}.json`);
    const raw = JSON.parse(fs.readFileSync(fp, "utf8")) as Record<string, unknown>;
    raw.jobStepId = "spoofed-other-id";
    fs.writeFileSync(fp, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    const reloaded = createOrchLeaseStore({ rootDir: root });
    expect(reloaded.get("real-id")).toBeNull();
  });
});
