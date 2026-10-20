// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reconcileEnterpriseCredits } from "./billing-reconciliation.js";
import {
  consumeCreditBuckets,
  ensurePlanCycleCreditBucket,
  __resetCreditBucketsForTest,
} from "./credit-buckets-store.js";
import {
  consumeTenantCredits,
  ensureTenantCreditsAllocation,
  __resetTenantCreditsForTest,
} from "./tenant-credits-store.js";
import { appendUsageLedgerEntry, __resetUsageLedgerForTest } from "./usage-ledger-store.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "openbot-reconcile-"));
}

describe("billing-reconciliation", () => {
  let dir: string;
  let bucketPath: string;
  let ledgerPath: string;
  const enterpriseId = "ent-reconcile";
  const cycleStart = "2026-06-01T00:00:00.000Z";
  const now = new Date("2026-06-15T12:00:00.000Z");

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("splits ledger credits by pricing engine when buckets align", async () => {
    dir = await tempDir();
    bucketPath = path.join(dir, "buckets.json");
    ledgerPath = path.join(dir, "ledger.json");
    await __resetCreditBucketsForTest(bucketPath);
    await __resetUsageLedgerForTest(ledgerPath);

    await ensurePlanCycleCreditBucket(
      { enterpriseId, cycleStart, monthlyCredits: 100 },
      bucketPath,
    );
    await consumeCreditBuckets({ enterpriseId, cycleStart, credits: 15 }, bucketPath);

    await appendUsageLedgerEntry(
      {
        enterpriseId,
        taskId: "task-v1-a",
        modelId: "openai/gpt-4o",
        tier: "tier_b",
        policyId: "balanced",
        creditsCharged: 5,
        providerCostCents: 10,
        tenantRevenueCents: 20,
        pricingEngine: "v1",
        occurredAt: "2026-06-10T00:00:00.000Z",
      },
      ledgerPath,
    );
    await appendUsageLedgerEntry(
      {
        enterpriseId,
        taskId: "task-v2-a",
        modelId: "openai/gpt-4o",
        tier: "tier_b",
        policyId: "balanced",
        creditsCharged: 7,
        providerCostCents: 14,
        tenantRevenueCents: 28,
        pricingEngine: "v2",
        occurredAt: "2026-06-11T00:00:00.000Z",
      },
      ledgerPath,
    );
    await appendUsageLedgerEntry(
      {
        enterpriseId,
        taskId: "task-legacy",
        modelId: "openai/gpt-4o",
        tier: "tier_b",
        policyId: "balanced",
        creditsCharged: 3,
        providerCostCents: 6,
        tenantRevenueCents: 12,
        occurredAt: "2026-06-12T00:00:00.000Z",
      },
      ledgerPath,
    );

    const result = await reconcileEnterpriseCredits(enterpriseId, {
      now,
      storePaths: {
        creditBuckets: bucketPath,
        usageLedger: ledgerPath,
        tenantCredits: path.join(dir, "missing.json"),
      },
    });

    expect(result.ledgerCreditsV1).toBe(8);
    expect(result.ledgerCreditsV2).toBe(7);
    expect(result.ledgerCreditsCharged).toBe(15);
    expect(result.bucketConsumed).toBe(15);
    expect(result.aligned).toBe(true);
    expect(result.driftCredits).toBe(0);
  });

  it("repairs legacy-only consumption drift before reconciling", async () => {
    dir = await tempDir();
    bucketPath = path.join(dir, "buckets.json");
    ledgerPath = path.join(dir, "ledger.json");
    const tenantCreditsPath = path.join(dir, "tenant-credits.json");
    await __resetCreditBucketsForTest(bucketPath);
    await __resetUsageLedgerForTest(ledgerPath);
    await __resetTenantCreditsForTest(tenantCreditsPath);

    await ensureTenantCreditsAllocation(
      { enterpriseId, cycleStart, monthlyCredits: 1_000_000 },
      tenantCreditsPath,
    );
    await consumeTenantCredits({ enterpriseId, cycleStart, credits: 112 }, tenantCreditsPath);

    await appendUsageLedgerEntry(
      {
        enterpriseId,
        taskId: "task-legacy-drift",
        modelId: "openai/gpt-4o",
        tier: "tier_b",
        policyId: "balanced",
        creditsCharged: 112,
        providerCostCents: 20,
        tenantRevenueCents: 40,
        occurredAt: "2026-06-10T00:00:00.000Z",
      },
      ledgerPath,
    );

    const result = await reconcileEnterpriseCredits(enterpriseId, {
      now,
      storePaths: {
        creditBuckets: bucketPath,
        usageLedger: ledgerPath,
        tenantCredits: tenantCreditsPath,
      },
    });

    expect(result.bucketGranted).toBe(1_000_000);
    expect(result.bucketConsumed).toBe(112);
    expect(result.ledgerCreditsCharged).toBe(112);
    expect(result.aligned).toBe(true);
    expect(result.driftCredits).toBe(0);
    expect(result.details).toEqual([]);
  });
});
