import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountRuntimeSnapshotStore } from "../../gateway/governance/account-runtime-snapshot.js";
import {
  ACCOUNT_WORKER_RUNTIME_LEASE_TTL_MS,
  createAccountWorkerControlPlane,
} from "./account-worker-gateway.js";

describe("createAccountWorkerControlPlane soft-renew", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("renews an expired runtime lease when the tenant is still entitled", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ob-aw-soft-renew-"));
    const store = new AccountRuntimeSnapshotStore(path.join(dir, "snapshots.json"));
    const nowMs = Date.parse("2026-10-14T12:00:00.000Z");
    const issued = await store.issue({
      tenantId: "tenant-a",
      userId: "user-a",
      agentId: "agent-a",
      executionId: "exec-1",
      decisionId: "gd-test-decision",
      authorizationVersion: "v1",
      dataSpaceRef: "ds",
      browserNamespaceRef: "bn",
      modelEntitlement: { allowlist: ["openai/gpt"] },
      capabilityDecision: { effect: "allow" },
      commercialLimits: { creditsRemaining: 3 },
      concurrencyLimits: { maxConcurrentRuns: 2, activeCount: 0 },
      policyVersion: "p1",
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 1_000).toISOString(),
    });
    const plane = createAccountWorkerControlPlane(store);
    const pastExpiry = nowMs + 2_000;
    const verdict = await plane.heartbeat({
      tenantId: "tenant-a",
      userId: "user-a",
      executionId: "exec-1",
      decisionId: issued.snapshot.decisionId,
      snapshotVersion: issued.snapshot.snapshotVersion,
      runtimeLeaseId: issued.lease.runtimeLeaseId,
      nowMs: pastExpiry,
    });
    expect(verdict).toEqual({ continueBilling: true, reason: "ok" });
    const head = await store.findByLease(issued.lease.runtimeLeaseId);
    expect(Date.parse(head!.lease.expiresAt)).toBe(
      pastExpiry + ACCOUNT_WORKER_RUNTIME_LEASE_TTL_MS,
    );
  });
});
