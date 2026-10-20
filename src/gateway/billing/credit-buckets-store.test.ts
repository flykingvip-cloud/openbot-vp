// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendCreditBucket,
  consumeCreditBuckets,
  ensurePlanCycleCreditBucket,
  listCreditBucketsForCycle,
  __resetCreditBucketsForTest,
} from "./credit-buckets-store.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "openbot-cb-"));
}

describe("credit-buckets-store", () => {
  let dir: string;
  let storePath: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("consumes plan_cycle before recharge", async () => {
    dir = await tempDir();
    storePath = path.join(dir, "buckets.json");
    await __resetCreditBucketsForTest(storePath);
    const cycleStart = "2026-06-01T00:00:00.000Z";
    await ensurePlanCycleCreditBucket(
      {
        enterpriseId: "ent-bucket",
        cycleStart,
        monthlyCredits: 100,
      },
      storePath,
    );
    await appendCreditBucket(
      {
        enterpriseId: "ent-bucket",
        cycleStart,
        bucketType: "recharge",
        creditsGranted: 50,
      },
      storePath,
    );

    const balance = await consumeCreditBuckets(
      { enterpriseId: "ent-bucket", cycleStart, credits: 120 },
      storePath,
    );
    expect(balance.creditsConsumed).toBe(120);
    expect(balance.creditsRemaining).toBe(30);

    const buckets = await listCreditBucketsForCycle("ent-bucket", cycleStart, storePath);
    const plan = buckets.find((b) => b.bucketType === "plan_cycle");
    const recharge = buckets.find((b) => b.bucketType === "recharge");
    expect(plan?.creditsConsumed).toBe(100);
    expect(recharge?.creditsConsumed).toBe(20);
  });
});
