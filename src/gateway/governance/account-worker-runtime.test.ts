/**
 * The worker surface cannot see billing ledgers (v4.1 §9 gate 2).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateAccountWorkerHeartbeat,
  isNonDurableAccountWorkerStop,
  type AccountWorkerBillingHold,
} from "./account-worker-runtime.js";

const hold: AccountWorkerBillingHold = {
  allow: true,
  limits: { creditsRemaining: 5, maxConcurrentRuns: 1 },
  decisionId: "gd-test-decision",
  lease: {
    runtimeLeaseId: "lease-1",
    expiresAt: "2026-10-06T00:30:00.000Z",
    revoked: false,
    snapshotVersion: 2,
  },
};

describe("account worker runtime", () => {
  it("does not import billing stores or process spawning", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "account-worker-runtime.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /agent-run-registry|credit-reservation|openbot-agent-run-registry|openbot-credit-reservations|tryHoldCreditReservation|tryAcquireAgentRunSlot|readJsonFile|node:fs|node:child_process|worker_threads/,
    );
    expect(Object.keys(hold).toSorted()).toEqual(["allow", "decisionId", "lease", "limits"]);
  });

  it("stops when the control-plane answer is revoked or behind", () => {
    const nowMs = Date.parse("2026-10-06T00:05:00.000Z");
    const answer = {
      decisionValid: true,
      currentSnapshotVersion: 2,
      leaseRevoked: false,
      leaseExpiresAt: hold.lease.expiresAt,
      quotaAllowed: true,
      concurrencyAllowed: true,
      checkedAt: new Date(nowMs).toISOString(),
      runtimeLeaseId: hold.lease.runtimeLeaseId,
    };
    expect(
      evaluateAccountWorkerHeartbeat({
        hold: { ...hold, lease: { ...hold.lease, snapshotVersion: 1 } },
        answer,
        nowMs,
      }),
    ).toEqual({ continueBilling: false, reason: "stale-snapshot" });
    expect(
      evaluateAccountWorkerHeartbeat({
        hold,
        answer: { ...answer, leaseRevoked: true },
        nowMs,
      }),
    ).toEqual({ continueBilling: false, reason: "revoked" });
    expect(evaluateAccountWorkerHeartbeat({ hold, answer, nowMs }).continueBilling).toBe(true);
  });

  it("treats stale-snapshot stops as non-durable (no openable chip for never-written files)", () => {
    expect(isNonDurableAccountWorkerStop("stale-snapshot")).toBe(true);
    expect(isNonDurableAccountWorkerStop("ok")).toBe(false);
    expect(isNonDurableAccountWorkerStop("revoked")).toBe(true);
  });
});
