/**
 * Account Computer v4.1 §9 gate 1 and the billing stop that follows a bad heartbeat.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chargeOnControlPlane } from "../billing/account-runtime-charge-authority.js";
import {
  AccountRuntimeSnapshotStore,
  type IssueAccountRuntimeSnapshotInput,
} from "./account-runtime-snapshot.js";
import {
  ACCOUNT_RUNTIME_HEARTBEAT_MAX_SILENCE_MS,
  ACCOUNT_WORKER_SNAPSHOT_FIELDS,
  AccountWorkerChargeGate,
  toWorkerRuntimeSnapshot,
} from "./account-worker-runtime.js";

const issuedAt = "2026-10-06T00:00:00.000Z";
const expiresAt = "2026-10-06T00:30:00.000Z";
const nowMs = Date.parse("2026-10-06T00:05:00.000Z");

function baseInput(authorizationVersion = "authz-v1"): IssueAccountRuntimeSnapshotInput {
  return {
    tenantId: "tenant-a",
    userId: "user-a",
    agentId: "bot",
    executionId: "exec-1",
    decisionId: "gd-test-decision",
    authorizationVersion,
    dataSpaceRef: "tenants/tenant-a/users/user-a/OpenBot",
    browserNamespaceRef: "tenants/tenant-a/users/user-a/state/browser",
    modelEntitlement: { allowlist: ["openai/gpt"] },
    capabilityDecision: { effect: "allow" },
    commercialLimits: { creditsRemaining: 5 },
    concurrencyLimits: { maxConcurrentRuns: 1, activeCount: 0 },
    policyVersion: "policy-1",
    issuedAt,
    expiresAt,
  };
}

describe("account runtime snapshot", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("issues monotonic versions and drops a late older snapshot", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ob-account-snap-"));
    const store = new AccountRuntimeSnapshotStore(path.join(dir, "snapshots.json"));
    const [first, second] = await Promise.all([
      store.issue(baseInput("authz-a")),
      store.issue(baseInput("authz-b")),
    ]);
    expect(new Set([first.snapshot.snapshotVersion, second.snapshot.snapshotVersion])).toEqual(
      new Set([1, 2]),
    );
    expect(first.snapshot.decisionId).toBe("gd-test-decision");
    expect(second.snapshot.decisionId).toBe("gd-test-decision");
    expect(first.lease.runtimeLeaseId).not.toBe(second.lease.runtimeLeaseId);
    expect(first.lease.runtimeLeaseId.startsWith("lease-")).toBe(true);

    const head = await store.current({
      tenantId: "tenant-a",
      userId: "user-a",
      executionId: "exec-1",
    });
    expect(head?.snapshot.snapshotVersion).toBe(2);
    expect(head?.snapshot.authorizationVersion).not.toBe(head?.snapshot.decisionId);
    expect(head?.snapshot.revoked).toBe(false);

    const older = first.snapshot.snapshotVersion === 1 ? first.snapshot : second.snapshot;
    expect(await store.observeLate(older)).toBe("stale");
    expect(await store.observeLate({ ...head!.snapshot, snapshotVersion: 99 })).toBe("rejected");
    expect(await store.observeLate({ ...head!.snapshot, authorizationVersion: "forged" })).toBe(
      "rejected",
    );
    const after = await store.current({
      tenantId: "tenant-a",
      userId: "user-a",
      executionId: "exec-1",
    });
    expect(after?.snapshot).toEqual(head?.snapshot);
    expect(after?.lease.runtimeLeaseId).toBe(head?.lease.runtimeLeaseId);
  });

  it("stops billing when the heartbeat sees an older version or a revocation", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ob-account-snap-hb-"));
    const store = new AccountRuntimeSnapshotStore(path.join(dir, "snapshots.json"));
    const first = await store.issue(baseInput("authz-v1"));
    const second = await store.issue(baseInput("authz-v2"));
    expect(second.snapshot.snapshotVersion).toBe(2);
    expect(second.snapshot.authorizationVersion).toBe("authz-v2");
    expect(Object.keys(second.hold).toSorted()).toEqual(["allow", "decisionId", "lease", "limits"]);
    expect(Object.keys(second.workerSnapshot).toSorted()).toEqual(
      [...ACCOUNT_WORKER_SNAPSHOT_FIELDS].toSorted(),
    );
    const leaked = toWorkerRuntimeSnapshot({
      ...second.workerSnapshot,
      billingJsonPath: "/tmp/openbot-agent-run-registry.json",
    } as typeof second.workerSnapshot);
    expect("billingJsonPath" in leaked).toBe(false);

    const stale = await store.heartbeat({
      tenantId: "tenant-a",
      userId: "user-a",
      executionId: "exec-1",
      decisionId: first.snapshot.decisionId,
      snapshotVersion: first.snapshot.snapshotVersion,
      runtimeLeaseId: first.lease.runtimeLeaseId,
      nowMs,
      quotaAllowed: true,
      concurrencyAllowed: true,
    });
    expect(stale).toEqual({ continueBilling: false, reason: "stale-snapshot" });

    const gate = new AccountWorkerChargeGate(second.hold);
    let charges = 0;
    const stopped = await chargeOnControlPlane({
      gate,
      verdict: stale,
      charge: async () => {
        charges += 1;
      },
    });
    expect(stopped.charged).toBe(false);
    const ignored = await chargeOnControlPlane({
      gate,
      verdict: { continueBilling: true, reason: "ok" },
      charge: async () => {
        charges += 1;
      },
    });
    expect(ignored.charged).toBe(false);
    expect(charges).toBe(0);

    const revoked = await store.revoke({
      tenantId: "tenant-a",
      userId: "user-a",
      executionId: "exec-1",
      nowIso: "2026-10-06T00:06:00.000Z",
    });
    expect(revoked.snapshot.snapshotVersion).toBe(3);
    expect(revoked.snapshot.revoked).toBe(true);
    expect(revoked.snapshot.decisionId).toBe(second.snapshot.decisionId);
    expect(revoked.snapshot.authorizationVersion).toBe("authz-v2");
    expect(revoked.lease.runtimeLeaseId).toBe(second.lease.runtimeLeaseId);
    const revokedBeat = await store.heartbeat({
      tenantId: "tenant-a",
      userId: "user-a",
      executionId: "exec-1",
      decisionId: revoked.snapshot.decisionId,
      snapshotVersion: revoked.snapshot.snapshotVersion,
      runtimeLeaseId: revoked.lease.runtimeLeaseId,
      nowMs,
      quotaAllowed: true,
      concurrencyAllowed: true,
    });
    expect(revokedBeat).toEqual({ continueBilling: false, reason: "revoked" });
  });

  it("requires a fresh heartbeat before another charge", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ob-account-snap-fresh-"));
    const store = new AccountRuntimeSnapshotStore(path.join(dir, "snapshots.json"));
    const issued = await store.issue(baseInput());
    const scope = {
      tenantId: "tenant-a",
      userId: "user-a",
      executionId: "exec-1",
      decisionId: issued.snapshot.decisionId,
      snapshotVersion: issued.snapshot.snapshotVersion,
      runtimeLeaseId: issued.lease.runtimeLeaseId,
      nowMs,
      quotaAllowed: true,
      concurrencyAllowed: true,
    };
    expect(await store.heartbeat(scope)).toEqual({ continueBilling: true, reason: "ok" });
    expect(
      await store.heartbeat({
        ...scope,
        checkedAt: new Date(nowMs - ACCOUNT_RUNTIME_HEARTBEAT_MAX_SILENCE_MS - 1).toISOString(),
      }),
    ).toEqual({ continueBilling: false, reason: "heartbeat-stale" });
    expect(await store.heartbeat({ ...scope, quotaAllowed: false })).toEqual({
      continueBilling: false,
      reason: "quota",
    });
    expect(await store.heartbeat({ ...scope, concurrencyAllowed: false })).toEqual({
      continueBilling: false,
      reason: "concurrency",
    });
    expect(await store.heartbeat({ ...scope, decisionId: "gd-other" })).toEqual({
      continueBilling: false,
      reason: "decision-invalid",
    });
    expect(await store.heartbeat({ ...scope, runtimeLeaseId: "lease-other" })).toEqual({
      continueBilling: false,
      reason: "lease-mismatch",
    });
    expect(await store.heartbeat({ ...scope, nowMs: Date.parse(expiresAt) })).toEqual({
      continueBilling: false,
      reason: "lease-expired",
    });
    expect(
      await store.heartbeat({
        ...scope,
        executionId: "missing",
      }),
    ).toEqual({ continueBilling: false, reason: "missing-snapshot" });
    await expect(
      store.issue({ ...baseInput(), authorizationVersion: "gd-test-decision" }),
    ).rejects.toThrow(/authorizationVersion/);
  });

  it("extends an entitled runtime lease without changing the lease id", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ob-account-snap-extend-"));
    const store = new AccountRuntimeSnapshotStore(path.join(dir, "snapshots.json"));
    const issued = await store.issue(baseInput());
    const expiredNow = Date.parse(expiresAt);
    expect(
      await store.heartbeat({
        tenantId: "tenant-a",
        userId: "user-a",
        executionId: "exec-1",
        decisionId: issued.snapshot.decisionId,
        snapshotVersion: issued.snapshot.snapshotVersion,
        runtimeLeaseId: issued.lease.runtimeLeaseId,
        nowMs: expiredNow,
        quotaAllowed: true,
        concurrencyAllowed: true,
      }),
    ).toEqual({ continueBilling: false, reason: "lease-expired" });

    const extended = await store.extendLeaseIfStillEntitled({
      runtimeLeaseId: issued.lease.runtimeLeaseId,
      nowMs: expiredNow,
      ttlMs: 60_000,
    });
    expect(extended?.runtimeLeaseId).toBe(issued.lease.runtimeLeaseId);
    expect(Date.parse(extended!.expiresAt)).toBeGreaterThan(expiredNow);
    expect(
      await store.heartbeat({
        tenantId: "tenant-a",
        userId: "user-a",
        executionId: "exec-1",
        decisionId: issued.snapshot.decisionId,
        snapshotVersion: issued.snapshot.snapshotVersion,
        runtimeLeaseId: issued.lease.runtimeLeaseId,
        nowMs: expiredNow,
        quotaAllowed: true,
        concurrencyAllowed: true,
      }),
    ).toEqual({ continueBilling: true, reason: "ok" });
  });
});
