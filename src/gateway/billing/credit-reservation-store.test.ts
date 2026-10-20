// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getCreditReservation,
  holdCreditReservation,
  releaseCreditReservation,
  settleCreditReservation,
  sumHeldReservationsForEnterprise,
} from "./credit-reservation-store.js";

describe("credit reservation store", () => {
  let storePath = "";
  afterEach(() => {
    if (storePath) {
      fs.rmSync(path.dirname(storePath), { recursive: true, force: true });
    }
  });

  it("holds, settles, and is idempotent on re-hold", async () => {
    storePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cresv-")), "r.json");
    const first = await holdCreditReservation({
      runId: "run-1",
      enterpriseId: "ent-a",
      authorizationDecisionId: "auth-1",
      subscriptionId: "sub-1",
      subscriptionSnapshotId: "snap-1",
      planId: "plan-1",
      planVersionId: "pv-1",
      reservedCredits: 3,
      storePath,
    });
    expect(first.status).toBe("held");
    expect(await sumHeldReservationsForEnterprise("ent-a", storePath)).toBe(3);

    const again = await holdCreditReservation({
      runId: "run-1",
      enterpriseId: "ent-a",
      authorizationDecisionId: "auth-2",
      subscriptionId: "sub-1",
      subscriptionSnapshotId: "snap-1",
      planId: "plan-1",
      planVersionId: "pv-1",
      reservedCredits: 9,
      storePath,
    });
    expect(again.reservedCredits).toBe(3);
    expect(again.authorizationDecisionId).toBe("auth-1");

    const settled = await settleCreditReservation({
      runId: "run-1",
      actualCredits: 5,
      storePath,
    });
    expect(settled?.status).toBe("settled");
    expect(await sumHeldReservationsForEnterprise("ent-a", storePath)).toBe(0);
  });

  it("releases held reservation without double-settling", async () => {
    storePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cresv-")), "r.json");
    await holdCreditReservation({
      runId: "run-2",
      enterpriseId: "ent-b",
      authorizationDecisionId: "auth-1",
      subscriptionId: "sub-1",
      subscriptionSnapshotId: "snap-1",
      planId: "plan-1",
      planVersionId: "pv-1",
      reservedCredits: 2,
      storePath,
    });
    await releaseCreditReservation({ runId: "run-2", storePath });
    const got = await getCreditReservation("run-2", storePath);
    expect(got?.status).toBe("released");
    const settled = await settleCreditReservation({
      runId: "run-2",
      actualCredits: 1,
      storePath,
    });
    expect(settled?.status).toBe("released");
  });
});
