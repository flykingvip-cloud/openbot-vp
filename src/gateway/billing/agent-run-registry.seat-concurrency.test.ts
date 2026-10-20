// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { __resetAgentRunRegistryForTest, tryAcquireAgentRunSlot } from "./agent-run-registry.js";
import { upsertSeatEntitlementAssignment } from "./seat-entitlement-assignments-store.js";
import { assignSeat, __resetSeatsForTest } from "./seats-store.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "openbot-seat-conc-"));
}

describe("seat-level concurrency in agent-run-registry", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks second active run for the same billing seat", async () => {
    dir = await tempDir();
    const registryPath = path.join(dir, "registry.json");
    const seatsPath = path.join(dir, "seats.json");
    const assignmentsPath = path.join(dir, "assignments.json");

    await __resetAgentRunRegistryForTest(registryPath);
    await __resetSeatsForTest(seatsPath);

    const seat = await assignSeat(
      { enterpriseId: "ent-seat", userId: "u1", role: "viewer", botQuota: 0 },
      seatsPath,
    );
    await upsertSeatEntitlementAssignment(
      { enterpriseId: "ent-seat", seatId: seat.id, profileId: "basic_ai" },
      assignmentsPath,
    );

    const first = await tryAcquireAgentRunSlot(
      {
        runId: "run-1",
        enterpriseId: "ent-seat",
        maxConcurrentRuns: 10,
        allowBurstConcurrency: false,
        billingSeatId: seat.id,
        seatMaxConcurrentRuns: 1,
      },
      registryPath,
    );
    expect(first.ok).toBe(true);

    const second = await tryAcquireAgentRunSlot(
      {
        runId: "run-2",
        enterpriseId: "ent-seat",
        maxConcurrentRuns: 10,
        allowBurstConcurrency: false,
        billingSeatId: seat.id,
        seatMaxConcurrentRuns: 1,
      },
      registryPath,
    );
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("SEAT_CONCURRENCY_LIMIT_EXCEEDED");
    }
  });
});
