// @vitest-environment node
/**
 * P0: concurrent tryHold against last credit — only one succeeds.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  sumHeldReservationsForEnterprise,
  tryHoldCreditReservation,
} from "./credit-reservation-store.js";

describe("atomic credit reservation under concurrency", () => {
  let storePath = "";

  afterEach(() => {
    if (storePath) {
      fs.rmSync(path.dirname(storePath), { recursive: true, force: true });
    }
  });

  it("only one of two concurrent holds succeeds when one credit remains", async () => {
    storePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "atomic-hold-")), "r.json");
    const base = {
      enterpriseId: "ent-race",
      authorizationDecisionId: "auth",
      subscriptionId: "sub",
      subscriptionSnapshotId: "snap",
      planId: "plan",
      planVersionId: "pv",
      reservedCredits: 1,
      availableCredits: 1,
      allowOverage: false,
      storePath,
    };

    const [a, b] = await Promise.all([
      tryHoldCreditReservation({ ...base, runId: "run-a" }),
      tryHoldCreditReservation({ ...base, runId: "run-b" }),
    ]);

    const wins = [a, b].filter((r) => r.ok);
    const losses = [a, b].filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    if (!losses[0].ok) {
      expect(losses[0].reason).toBe("INSUFFICIENT_CREDITS");
    }
    expect(await sumHeldReservationsForEnterprise("ent-race", storePath)).toBe(1);
  });
});
