// @vitest-environment node
/**
 * Phase 2 验收：PAYG 真实出账 + 阶段幂等 + 故障注入恢复。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.ts";
import { upsertCreditWeight } from "../resource-catalog/credit-weights-store.ts";
import { upsertResourceModelCatalogEntry } from "../resource-catalog/models-catalog-store.ts";
import {
  __resetCreditBucketsForTest,
  summarizeCreditBucketsForCycle,
} from "./credit-buckets-store.ts";
import {
  __resetCreditUsageStagesForTest,
  getCreditUsageStage,
  upsertCreditUsageStage,
} from "./credit-usage-stage-store.ts";
import { __resetLedgerForTest } from "./ledger-store.ts";
import { createPlan, __resetPlansForTest } from "./plans-store.ts";
import { PaygConfigError, recordCreditUsage, splitPaygCredits } from "./record-credit-usage.ts";
import { settleEnterpriseCycle } from "./settlement-service.ts";
import { materializeSubscriptionRuntimeSnapshot } from "./subscription-transition-engine.ts";
import {
  createSubscription,
  setSubscriptionCommercialContract,
  __resetSubscriptionsForTest,
} from "./subscriptions-store.ts";
import { getTenantCreditsBalance, __resetTenantCreditsForTest } from "./tenant-credits-store.ts";
import { listUsageLedgerEntries, __resetUsageLedgerForTest } from "./usage-ledger-store.ts";
import { listUsageRecords } from "./usage-records-store.ts";

let tmp: string;
let paths: {
  plans: string;
  subscriptions: string;
  entitlementSnapshot: string;
  usage: string;
  usageLedger: string;
  creditBuckets: string;
  tenantCredits: string;
  creditUsageStages: string;
  ledger: string;
  seats: string;
  resources: string;
  modelCatalog: string;
  creditWeights: string;
  runtimeSnapshots: string;
};

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ob-p2-payg-"));
  paths = {
    plans: path.join(tmp, "plans.json"),
    subscriptions: path.join(tmp, "subs.json"),
    entitlementSnapshot: path.join(tmp, "ent.json"),
    usage: path.join(tmp, "usage.json"),
    usageLedger: path.join(tmp, "usage-ledger.json"),
    creditBuckets: path.join(tmp, "buckets.json"),
    tenantCredits: path.join(tmp, "tenant-credits.json"),
    creditUsageStages: path.join(tmp, "stages.json"),
    ledger: path.join(tmp, "billing-ledger.json"),
    seats: path.join(tmp, "seats.json"),
    resources: path.join(tmp, "res.json"),
    modelCatalog: path.join(tmp, "catalog.json"),
    creditWeights: path.join(tmp, "weights.json"),
    runtimeSnapshots: path.join(tmp, "runtime.json"),
  };
  await __resetPlansForTest(paths.plans);
  await __resetSubscriptionsForTest(paths.subscriptions);
  await __resetLedgerForTest(paths.ledger);
  await __resetCreditBucketsForTest(paths.creditBuckets);
  await __resetCreditUsageStagesForTest(paths.creditUsageStages);
  if (typeof __resetTenantCreditsForTest === "function") {
    await __resetTenantCreditsForTest(paths.tenantCredits);
  }
  if (typeof __resetUsageLedgerForTest === "function") {
    await __resetUsageLedgerForTest(paths.usageLedger);
  }
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function seedPaygEnterprise(enterpriseId: string, monthlyCredits = 10) {
  const plan = await createPlan(
    {
      name: "PAYG",
      billingCycle: "monthly",
      basePriceCents: 0,
      seatQuota: {},
      botQuota: 5,
      pricing: [
        { type: "usage", key: "ai_credits", priceCents: 1 },
        { type: "extra", key: "ai_credits", priceCents: 5 },
      ],
      meters: [
        {
          key: "ai_credits",
          unit: "credit",
          includedQuota: monthlyCredits,
          chargeIncludedAtUsagePrice: false,
          allowOverage: true,
        },
      ],
      createdByUserId: "admin",
    },
    paths.plans,
  );
  await upsertPlanEntitlementSnapshot(
    {
      planVersionId: plan.currentVersionId,
      monthlyPriceCents: 0,
      monthlyCredits,
      maxBots: 5,
      maxConcurrentRuns: 4,
      overagePolicy: { type: "pay_as_you_go", allowBurstConcurrency: false },
    },
    paths.entitlementSnapshot,
    { plans: paths.plans, subscriptions: paths.subscriptions },
  );
  await upsertResourceModelCatalogEntry(
    { modelId: "openai/gpt-4o", tier: "tier_b", displayName: "GPT-4o" },
    paths.modelCatalog,
  );
  await upsertCreditWeight({ tier: "tier_b", creditCost: 5 }, paths.creditWeights);
  const sub = await createSubscription(
    {
      enterpriseId,
      planId: plan.id,
      planVersionId: plan.currentVersionId,
      startTime: "2026-01-01T00:00:00.000Z",
    },
    paths.subscriptions,
  );
  await setSubscriptionCommercialContract(
    enterpriseId,
    sub.id,
    {
      billingCycle: "monthly",
      contractStart: "2026-01-01T00:00:00.000Z",
      contractEnd: "2026-02-01T00:00:00.000Z",
    },
    paths.subscriptions,
  );
  await materializeSubscriptionRuntimeSnapshot({
    enterpriseId,
    subscription: sub,
    storePaths: {
      plans: paths.plans,
      entitlementSnapshot: paths.entitlementSnapshot,
      runtimeSnapshots: paths.runtimeSnapshots,
    },
  });
  return { plan, sub, monthlyCredits };
}

const creditStorePaths = () => ({
  subscriptions: paths.subscriptions,
  plans: paths.plans,
  entitlementSnapshot: paths.entitlementSnapshot,
  modelCatalog: paths.modelCatalog,
  creditWeights: paths.creditWeights,
  tenantCredits: paths.tenantCredits,
  usageLedger: paths.usageLedger,
  usage: paths.usage,
  creditBuckets: paths.creditBuckets,
  creditUsageStages: paths.creditUsageStages,
  runtimeSnapshots: paths.runtimeSnapshots,
});

describe("splitPaygCredits", () => {
  it("splits included and overage for pay_as_you_go", () => {
    expect(
      splitPaygCredits({
        creditsCharged: 12,
        creditsRemaining: 5,
        overageUnitPriceCents: 5,
        overagePolicyType: "pay_as_you_go",
      }),
    ).toEqual({
      includedCredits: 5,
      overageCredits: 7,
      overageAmountCents: 35,
    });
  });

  it("block policy does not form overage split", () => {
    expect(
      splitPaygCredits({
        creditsCharged: 12,
        creditsRemaining: 0,
        overageUnitPriceCents: 5,
        overagePolicyType: "block",
      }).overageCredits,
    ).toBe(0);
  });
});

describe("PAYG ledger → final Bill", () => {
  it("forms includedCredits + overageCredits + overageAmountCents and bill extra", async () => {
    const { monthlyCredits } = await seedPaygEnterprise("ent-payg", 10);
    // creditCost 5 → one run = 5 credits; 3 runs = 15 → overage 5
    for (let i = 0; i < 3; i++) {
      const r = await recordCreditUsage({
        enterpriseId: "ent-payg",
        taskId: `task-payg-${i}`,
        modelId: "openai/gpt-4o",
        policyId: "balanced",
        occurredAt: "2026-01-10T12:00:00.000Z",
        storePaths: creditStorePaths(),
      });
      expect(r.stage).toBe("done");
      expect(r.includedCredits! + r.overageCredits!).toBe(r.creditsCharged);
    }

    const entries = await listUsageLedgerEntries(
      "ent-payg",
      { startTime: "2026-01-01T00:00:00.000Z", endTime: "2026-02-01T00:00:00.000Z" },
      paths.usageLedger,
    );
    expect(entries).toHaveLength(3);
    const totalIncluded = entries.reduce((s, e) => s + (e.includedCredits ?? 0), 0);
    const totalOverage = entries.reduce((s, e) => s + (e.overageCredits ?? 0), 0);
    const totalOverageCents = entries.reduce((s, e) => s + (e.overageAmountCents ?? 0), 0);
    expect(totalIncluded).toBe(monthlyCredits);
    expect(totalOverage).toBe(5);
    expect(totalOverageCents).toBe(5 * 5);

    const buckets = await summarizeCreditBucketsForCycle(
      "ent-payg",
      "2026-01-01T00:00:00.000Z",
      paths.creditBuckets,
    );
    expect(buckets.creditsConsumed).toBe(monthlyCredits);
    expect(buckets.creditsRemaining).toBe(0);

    const settled = await settleEnterpriseCycle({
      enterpriseId: "ent-payg",
      mode: "final",
      now: new Date("2026-02-01T00:00:00.000Z"),
      storePaths: {
        ...paths,
        ledger: paths.ledger,
        usageLedger: paths.usageLedger,
      },
    });
    expect(settled!.bill.extraCostCents).toBeGreaterThanOrEqual(totalOverageCents);
    expect(
      settled!.bill.items.some(
        (i) => i.type === "extra" && (i.key === "ai_credits" || i.detail.includes("overage")),
      ),
    ).toBe(true);
  });
});

describe("stage side-effects taskId idempotent + fault inject", () => {
  it("concurrent same taskId only debits once", async () => {
    await seedPaygEnterprise("ent-conc", 100);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        recordCreditUsage({
          enterpriseId: "ent-conc",
          taskId: "same-task",
          modelId: "openai/gpt-4o",
          policyId: "balanced",
          occurredAt: "2026-01-05T00:00:00.000Z",
          storePaths: creditStorePaths(),
        }),
      ),
    );
    const done = results.filter((r) => r.stage === "done");
    expect(done.length).toBe(8);
    const charged = results[0].creditsCharged;
    const buckets = await summarizeCreditBucketsForCycle(
      "ent-conc",
      "2026-01-01T00:00:00.000Z",
      paths.creditBuckets,
    );
    expect(buckets.creditsConsumed).toBe(charged);
    const ledger = await listUsageLedgerEntries("ent-conc", undefined, paths.usageLedger);
    expect(ledger).toHaveLength(1);
  });

  async function seedAndWriteThroughStage(
    enterpriseId: string,
    taskId: string,
    stopAfter:
      | "ledger_written"
      | "bucket_debited"
      | "tenant_projected"
      | "usage_record"
      | "event_published",
  ) {
    await seedPaygEnterprise(enterpriseId, 50);
    const first = await recordCreditUsage({
      enterpriseId,
      taskId,
      modelId: "openai/gpt-4o",
      policyId: "balanced",
      occurredAt: "2026-01-08T00:00:00.000Z",
      storePaths: creditStorePaths(),
    });
    // rewind stage to stopAfter to simulate crash after that stage completed
    await __resetCreditUsageStagesForTest(paths.creditUsageStages);
    await upsertCreditUsageStage(
      {
        enterpriseId,
        taskId,
        stage: stopAfter,
        creditsCharged: first.creditsCharged,
        cycleStart: "2026-01-01T00:00:00.000Z",
      },
      paths.creditUsageStages,
    );
    const beforeBuckets = await summarizeCreditBucketsForCycle(
      enterpriseId,
      "2026-01-01T00:00:00.000Z",
      paths.creditBuckets,
    );
    const beforeTenant = await getTenantCreditsBalance(
      enterpriseId,
      "2026-01-01T00:00:00.000Z",
      paths.tenantCredits,
    );
    const beforeUsage = await listUsageRecords(enterpriseId, {}, paths.usage);
    const beforeLedger = await listUsageLedgerEntries(enterpriseId, undefined, paths.usageLedger);

    const resumed = await recordCreditUsage({
      enterpriseId,
      taskId,
      modelId: "openai/gpt-4o",
      policyId: "balanced",
      occurredAt: "2026-01-08T00:00:00.000Z",
      storePaths: creditStorePaths(),
    });
    expect(resumed.resumed).toBe(true);
    expect(resumed.stage).toBe("done");

    const afterBuckets = await summarizeCreditBucketsForCycle(
      enterpriseId,
      "2026-01-01T00:00:00.000Z",
      paths.creditBuckets,
    );
    const afterTenant = await getTenantCreditsBalance(
      enterpriseId,
      "2026-01-01T00:00:00.000Z",
      paths.tenantCredits,
    );
    const afterUsage = await listUsageRecords(enterpriseId, {}, paths.usage);
    const afterLedger = await listUsageLedgerEntries(enterpriseId, undefined, paths.usageLedger);

    expect(afterBuckets.creditsConsumed).toBe(beforeBuckets.creditsConsumed);
    expect(afterTenant?.creditsConsumed).toBe(beforeTenant?.creditsConsumed);
    expect(afterUsage.length).toBe(beforeUsage.length);
    expect(afterLedger).toHaveLength(beforeLedger.length);
    expect(afterLedger[0].creditsCharged).toBe(first.creditsCharged);

    const stage = await getCreditUsageStage(enterpriseId, taskId, paths.creditUsageStages);
    expect(stage?.stage).toBe("done");
  }

  it("fault after ledger_written: resume does not double-debit", async () => {
    await seedAndWriteThroughStage("ent-f-ledger", "t-ledger", "ledger_written");
  });

  it("fault after bucket_debited: resume does not double-debit", async () => {
    await seedAndWriteThroughStage("ent-f-bucket", "t-bucket", "bucket_debited");
  });

  it("fault after tenant_projected: resume does not double-write", async () => {
    await seedAndWriteThroughStage("ent-f-tenant", "t-tenant", "tenant_projected");
  });

  it("fault after usage_record: resume does not double-write usage", async () => {
    await seedAndWriteThroughStage("ent-f-usage", "t-usage", "usage_record");
  });

  it("fault after event_published: resume only marks done", async () => {
    await seedAndWriteThroughStage("ent-f-event", "t-event", "event_published");
  });
});

describe("P0: concurrent different taskIds race on scarce credits", () => {
  it("included sum never exceeds balance; remainder is overage", async () => {
    // monthlyCredits=10; each task charges 8 → total request 16
    await seedPaygEnterprise("ent-race", 10);
    // creditCost=5 → need higher charge. Use two tasks with creditsCharged via weight
    // Override: call reserve path with custom by using multiple 5-credit tasks
    // 3 concurrent tasks × 5 credits = 15 requested against 10 remaining
    const results = await Promise.all(
      ["t-a", "t-b", "t-c"].map((taskId) =>
        recordCreditUsage({
          enterpriseId: "ent-race",
          taskId,
          modelId: "openai/gpt-4o",
          policyId: "balanced",
          occurredAt: "2026-01-12T00:00:00.000Z",
          storePaths: creditStorePaths(),
        }),
      ),
    );
    for (const r of results) {
      expect(r.stage).toBe("done");
      expect((r.includedCredits ?? 0) + (r.overageCredits ?? 0)).toBe(r.creditsCharged);
    }
    const totalIncluded = results.reduce((s, r) => s + (r.includedCredits ?? 0), 0);
    const totalOverage = results.reduce((s, r) => s + (r.overageCredits ?? 0), 0);
    expect(totalIncluded).toBeLessThanOrEqual(10);
    expect(totalIncluded).toBe(10);
    expect(totalOverage).toBe(results.reduce((s, r) => s + r.creditsCharged, 0) - 10);

    const buckets = await summarizeCreditBucketsForCycle(
      "ent-race",
      "2026-01-01T00:00:00.000Z",
      paths.creditBuckets,
    );
    expect(buckets.creditsConsumed).toBe(10);
    expect(buckets.creditsRemaining).toBe(0);
  });
});

describe("P0: annual contract 12 months exact monthlyCredits → zero overage", () => {
  it("each month uses monthlyCredits only; year final overage is 0", async () => {
    const monthlyCredits = 10;
    const enterpriseId = "ent-annual-12";
    const plan = await createPlan(
      {
        name: "Annual",
        billingCycle: "annual",
        basePriceCents: 0,
        seatQuota: {},
        botQuota: 5,
        pricing: [
          { type: "usage", key: "ai_credits", priceCents: 1 },
          { type: "extra", key: "ai_credits", priceCents: 5 },
        ],
        meters: [
          {
            key: "ai_credits",
            unit: "credit",
            includedQuota: monthlyCredits,
            chargeIncludedAtUsagePrice: false,
            allowOverage: true,
          },
        ],
        createdByUserId: "admin",
      },
      paths.plans,
    );
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: plan.currentVersionId,
        monthlyPriceCents: 0,
        monthlyCredits,
        maxBots: 5,
        overagePolicy: { type: "pay_as_you_go", allowBurstConcurrency: false },
      },
      paths.entitlementSnapshot,
      { plans: paths.plans, subscriptions: paths.subscriptions },
    );
    await upsertResourceModelCatalogEntry(
      { modelId: "openai/gpt-4o", tier: "tier_b", displayName: "GPT-4o" },
      paths.modelCatalog,
    );
    // 2 runs × 5 credits = 10 = monthlyCredits exactly per month
    await upsertCreditWeight({ tier: "tier_b", creditCost: 5 }, paths.creditWeights);
    const sub = await createSubscription(
      {
        enterpriseId,
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        startTime: "2026-01-15T00:00:00.000Z",
      },
      paths.subscriptions,
    );
    await setSubscriptionCommercialContract(
      enterpriseId,
      sub.id,
      {
        billingCycle: "annual",
        contractStart: "2026-01-15T00:00:00.000Z",
        contractEnd: "2027-01-15T00:00:00.000Z",
      },
      paths.subscriptions,
    );
    await materializeSubscriptionRuntimeSnapshot({
      enterpriseId,
      subscription: {
        ...sub,
        commercialContract: {
          billingCycle: "annual",
          contractStart: "2026-01-15T00:00:00.000Z",
          contractEnd: "2027-01-15T00:00:00.000Z",
        },
      },
      storePaths: {
        plans: paths.plans,
        entitlementSnapshot: paths.entitlementSnapshot,
        runtimeSnapshots: paths.runtimeSnapshots,
      },
    });

    let yearOverageCents = 0;
    for (let m = 0; m < 12; m++) {
      const occurredAt = new Date(Date.UTC(2026, m, 20, 12, 0, 0)).toISOString();
      // two tasks × 5 = 10 credits this month
      for (const half of [0, 1]) {
        const r = await recordCreditUsage({
          enterpriseId,
          taskId: `y2026-m${m}-h${half}`,
          modelId: "openai/gpt-4o",
          policyId: "balanced",
          occurredAt,
          storePaths: creditStorePaths(),
        });
        expect(r.overageCredits ?? 0).toBe(0);
        expect(r.overageAmountCents ?? 0).toBe(0);
        yearOverageCents += r.overageAmountCents ?? 0;
      }
    }
    expect(yearOverageCents).toBe(0);

    const settled = await settleEnterpriseCycle({
      enterpriseId,
      mode: "final",
      now: new Date("2027-01-15T00:00:00.000Z"),
      storePaths: {
        ...paths,
        ledger: paths.ledger,
        usageLedger: paths.usageLedger,
      },
    });
    // 年窗 includedQuota = 10×12=120；用量 120 → extra 0
    expect(settled!.bill.extraCostCents).toBe(0);
    const ledgerAll = await listUsageLedgerEntries(enterpriseId, undefined, paths.usageLedger);
    const sumOverage = ledgerAll.reduce((s, e) => s + (e.overageAmountCents ?? 0), 0);
    expect(sumOverage).toBe(0);
  });
});

describe("P1: PAYG config must reject incomplete overage setup", () => {
  it("rejects when meter allowOverage=false under pay_as_you_go", async () => {
    const enterpriseId = "ent-payg-no-over";
    const plan = await createPlan(
      {
        name: "PAYG-no-over",
        billingCycle: "monthly",
        basePriceCents: 0,
        seatQuota: {},
        botQuota: 5,
        pricing: [
          { type: "usage", key: "ai_credits", priceCents: 1 },
          // extra 存在但 meter 禁止超额
          { type: "extra", key: "ai_credits", priceCents: 5 },
        ],
        meters: [
          {
            key: "ai_credits",
            unit: "credit",
            includedQuota: 10,
            chargeIncludedAtUsagePrice: false,
            allowOverage: false,
          },
        ],
        createdByUserId: "admin",
      },
      paths.plans,
    );
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: plan.currentVersionId,
        monthlyPriceCents: 0,
        monthlyCredits: 10,
        maxBots: 5,
        overagePolicy: { type: "pay_as_you_go", allowBurstConcurrency: false },
      },
      paths.entitlementSnapshot,
      { plans: paths.plans, subscriptions: paths.subscriptions },
    );
    await upsertResourceModelCatalogEntry(
      { modelId: "openai/gpt-4o", tier: "tier_b", displayName: "GPT-4o" },
      paths.modelCatalog,
    );
    await upsertCreditWeight({ tier: "tier_b", creditCost: 5 }, paths.creditWeights);
    const sub = await createSubscription(
      {
        enterpriseId,
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        startTime: "2026-01-01T00:00:00.000Z",
      },
      paths.subscriptions,
    );
    await setSubscriptionCommercialContract(
      enterpriseId,
      sub.id,
      {
        billingCycle: "monthly",
        contractStart: "2026-01-01T00:00:00.000Z",
        contractEnd: "2026-02-01T00:00:00.000Z",
      },
      paths.subscriptions,
    );
    await materializeSubscriptionRuntimeSnapshot({
      enterpriseId,
      subscription: sub,
      storePaths: {
        plans: paths.plans,
        entitlementSnapshot: paths.entitlementSnapshot,
        runtimeSnapshots: paths.runtimeSnapshots,
      },
    });

    await expect(
      recordCreditUsage({
        enterpriseId,
        taskId: "task-forbid-overage",
        modelId: "openai/gpt-4o",
        policyId: "balanced",
        occurredAt: "2026-01-10T00:00:00.000Z",
        storePaths: creditStorePaths(),
      }),
    ).rejects.toBeInstanceOf(PaygConfigError);
  });

  it("rejects when extra/ai_credits price is missing under pay_as_you_go", async () => {
    const enterpriseId = "ent-payg-no-extra";
    // 先合法建档（allowOverage=false 无 extra），再破坏 pricing 模拟配置漂移
    const plan = await createPlan(
      {
        name: "PAYG-no-extra",
        billingCycle: "monthly",
        basePriceCents: 0,
        seatQuota: {},
        botQuota: 5,
        pricing: [
          { type: "usage", key: "ai_credits", priceCents: 1 },
          { type: "extra", key: "ai_credits", priceCents: 5 },
        ],
        meters: [
          {
            key: "ai_credits",
            unit: "credit",
            includedQuota: 10,
            chargeIncludedAtUsagePrice: false,
            allowOverage: true,
          },
        ],
        createdByUserId: "admin",
      },
      paths.plans,
    );
    // 运行时防御：从 pricing 去掉 extra，保留 allowOverage=true
    const raw = JSON.parse(await fs.readFile(paths.plans, "utf8")) as {
      planVersions: Array<{
        id: string;
        snapshot: {
          pricing: Array<{ type: string; key: string; priceCents: number }>;
          meters: Array<{ key: string; allowOverage?: boolean }>;
        };
      }>;
    };
    for (const v of raw.planVersions) {
      if (v.id === plan.currentVersionId) {
        v.snapshot.pricing = v.snapshot.pricing.filter(
          (p) => !(p.type === "extra" && p.key === "ai_credits"),
        );
      }
    }
    await fs.writeFile(paths.plans, JSON.stringify(raw));

    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: plan.currentVersionId,
        monthlyPriceCents: 0,
        monthlyCredits: 10,
        maxBots: 5,
        overagePolicy: { type: "pay_as_you_go", allowBurstConcurrency: false },
      },
      paths.entitlementSnapshot,
      { plans: paths.plans, subscriptions: paths.subscriptions },
    );
    await upsertResourceModelCatalogEntry(
      { modelId: "openai/gpt-4o", tier: "tier_b", displayName: "GPT-4o" },
      paths.modelCatalog,
    );
    await upsertCreditWeight({ tier: "tier_b", creditCost: 5 }, paths.creditWeights);
    const sub = await createSubscription(
      {
        enterpriseId,
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        startTime: "2026-01-01T00:00:00.000Z",
      },
      paths.subscriptions,
    );
    await setSubscriptionCommercialContract(
      enterpriseId,
      sub.id,
      {
        billingCycle: "monthly",
        contractStart: "2026-01-01T00:00:00.000Z",
        contractEnd: "2026-02-01T00:00:00.000Z",
      },
      paths.subscriptions,
    );
    await materializeSubscriptionRuntimeSnapshot({
      enterpriseId,
      subscription: sub,
      storePaths: {
        plans: paths.plans,
        entitlementSnapshot: paths.entitlementSnapshot,
        runtimeSnapshots: paths.runtimeSnapshots,
      },
    });

    await expect(
      recordCreditUsage({
        enterpriseId,
        taskId: "task-no-extra",
        modelId: "openai/gpt-4o",
        policyId: "balanced",
        occurredAt: "2026-01-10T00:00:00.000Z",
        storePaths: creditStorePaths(),
      }),
    ).rejects.toBeInstanceOf(PaygConfigError);
  });
});
