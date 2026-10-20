// @vitest-environment node
/**
 * P0: outbox drain failure keeps reservation held; success settles with real credits.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCreditReservation,
  sumHeldReservationsForEnterprise,
  tryHoldCreditReservation,
} from "./credit-reservation-store.js";
import { drainUsageOutboxRecord } from "./usage-outbox-drain.js";
import { enqueueUsageOutbox } from "./usage-outbox-store.js";

vi.mock("./record-credit-usage.js", () => ({
  recordCreditUsage: vi.fn(),
}));

describe("usage outbox vs credit reservation lifecycle", () => {
  let dir = "";
  let reservationPath = "";
  let outboxPath = "";

  afterEach(() => {
    vi.clearAllMocks();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps reservation held when first drain fails; settles with real credits after retry", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "hold-life-"));
    reservationPath = path.join(dir, "res.json");
    outboxPath = path.join(dir, "out.json");

    const hold = await tryHoldCreditReservation({
      runId: "run-hold-1",
      enterpriseId: "ent-a",
      authorizationDecisionId: "auth-1",
      subscriptionId: "sub-1",
      subscriptionSnapshotId: "snap-1",
      planId: "plan-1",
      planVersionId: "pv-1",
      reservedCredits: 3,
      availableCredits: 10,
      storePath: reservationPath,
    });
    expect(hold.ok).toBe(true);
    expect(await sumHeldReservationsForEnterprise("ent-a", reservationPath)).toBe(3);

    const payload = {
      enterpriseId: "ent-a",
      taskId: "run-hold-1",
      runId: "run-hold-1",
      modelId: "openai/gpt-4o-mini",
      policyId: "pol-1",
      storePaths: { creditReservations: reservationPath },
    };
    const receipt = await enqueueUsageOutbox(payload, outboxPath);

    const { recordCreditUsage } = await import("./record-credit-usage.js");
    const mocked = vi.mocked(recordCreditUsage);
    mocked.mockRejectedValueOnce(new Error("transient disk error"));

    await expect(drainUsageOutboxRecord(receipt, outboxPath)).rejects.toThrow(/transient/);
    // Must NOT settle with 0 — hold remains until real debit.
    expect(await sumHeldReservationsForEnterprise("ent-a", reservationPath)).toBe(3);
    expect((await getCreditReservation("run-hold-1", reservationPath))?.status).toBe("held");

    mocked.mockResolvedValueOnce({
      recorded: true,
      deduped: false,
      creditsCharged: 2,
      tier: "tier_a",
      providerCostCents: 0,
      tenantRevenueCents: 0,
      skippedConsumption: false,
      stage: "done",
    } as never);

    // Re-enqueue not needed: failed record is still drainable after backoff; force by rewriting nextAttemptAt
    const raw = JSON.parse(fs.readFileSync(outboxPath, "utf8")) as {
      byId: Record<string, { nextAttemptAt?: string; status: string }>;
    };
    if (raw.byId["run-hold-1"]) {
      raw.byId["run-hold-1"].nextAttemptAt = undefined;
      raw.byId["run-hold-1"].status = "pending";
      fs.writeFileSync(outboxPath, JSON.stringify(raw));
    }

    const usage = await drainUsageOutboxRecord(
      { ...receipt, status: "pending", attempts: 1 },
      outboxPath,
    );
    expect(usage.creditsCharged).toBe(2);
    const settled = await getCreditReservation("run-hold-1", reservationPath);
    expect(settled?.status).toBe("settled");
    expect(settled?.actualCredits).toBe(2);
    expect(await sumHeldReservationsForEnterprise("ent-a", reservationPath)).toBe(0);
  });
});
