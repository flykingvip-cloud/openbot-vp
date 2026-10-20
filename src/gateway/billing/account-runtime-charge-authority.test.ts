/**
 * Gate 2 admission stays on the single control-plane process.
 * Two readers of the billing ledgers are not a passing result.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { admitSingleProcessRun } from "./account-runtime-charge-authority.js";
import { countActiveAgentRuns } from "./agent-run-registry.js";
import { getCreditReservation } from "./credit-reservation-store.js";

describe("account runtime charge authority", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) {
      await fsp.rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("does not spawn a second process to read billing ledgers", () => {
    const source = fs.readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "account-runtime-charge-authority.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/child_process|worker_threads|cluster/);
    expect(source).toMatch(/tryAcquireAgentRunSlot/);
    expect(source).toMatch(/tryHoldCreditReservation/);
  });

  it("does not double-spend credits or oversell concurrency", async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "ob-account-charge-"));
    const registryPath = path.join(dir, "registry.json");
    const reservationPath = path.join(dir, "reservations.json");
    const shared = {
      enterpriseId: "ent-p2",
      maxConcurrentRuns: 1,
      reservedCredits: 5,
      availableCredits: 5,
      authorizationDecisionId: "gd-charge",
      registryPath,
      reservationPath,
    };
    const runIds = ["run-a", "run-b", "run-c", "run-d"];
    const parallel = await Promise.all(
      runIds.map(async (runId) => ({
        runId,
        ...(await admitSingleProcessRun({ ...shared, runId })),
      })),
    );
    const winners = parallel.filter((result) => result.admitted);
    expect(winners).toHaveLength(1);
    expect(await countActiveAgentRuns("ent-p2", registryPath)).toBe(1);
    let heldCredits = 0;
    for (const runId of runIds) {
      const row = await getCreditReservation(runId, reservationPath);
      if (row?.status === "held") {
        heldCredits += row.reservedCredits;
      }
    }
    expect(heldCredits).toBe(5);

    const winnerId = winners[0]?.runId ?? "";
    const replay = await Promise.all(
      Array.from({ length: 8 }, () => admitSingleProcessRun({ ...shared, runId: winnerId })),
    );
    expect(replay.every((result) => result.admitted && result.idempotent)).toBe(true);
    const replayed = await getCreditReservation(winnerId, reservationPath);
    expect(replayed?.status).toBe("held");
    expect(replayed?.reservedCredits).toBe(5);
    expect(await countActiveAgentRuns("ent-p2", registryPath)).toBe(1);
  });
});
