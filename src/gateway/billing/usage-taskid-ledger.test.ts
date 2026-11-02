import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { upsertCreditUsageStage } from "./credit-usage-stage-store.js";
import { __resetCreditUsageStagesForTest } from "./credit-usage-stage-store.js";
import {
  USAGE_COST_FACT_LIMIT,
  loadUsageCostFacts,
  loadUsageCostFactsForTaskId,
} from "./usage-cost-facts.js";
import {
  aggregateTaskIdUsageLedger,
  presentUsageCostLayer,
  type UsageCostActor,
} from "./usage-cost-layer.js";
import { __resetUsageLedgerForTest, appendUsageLedgerEntry } from "./usage-ledger-store.js";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function tempPaths() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ft-taskid-usage-"));
  dirs.push(dir);
  return {
    ledger: path.join(dir, "ledger.json"),
    stage: path.join(dir, "stages.json"),
  };
}

const platform: UsageCostActor = {
  surface: "platform",
  userId: "ops",
  enterpriseId: null,
  enterpriseWide: true,
};

describe("FT-TASKID-USAGE-LEDGER", () => {
  it("B1/B5: authoritative taskId query returns model structure, counts, tokens; ledgerBasis ≠ tip spend", async () => {
    const paths = await tempPaths();
    await __resetUsageLedgerForTest(paths.ledger);
    await __resetCreditUsageStagesForTest(paths.stage);

    await appendUsageLedgerEntry(
      {
        enterpriseId: "ent-a",
        taskId: "task-ledger-1",
        modelId: "gpt-test",
        tier: "standard",
        policyId: "pol-1",
        creditsCharged: 3,
        providerCostCents: 40,
        tenantRevenueCents: 90,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 5,
        userId: "user-a",
        source: "platform",
        billingOwner: "platform",
        providerPriceState: "known",
      },
      paths.ledger,
    );

    const loaded = await loadUsageCostFactsForTaskId({
      taskId: "task-ledger-1",
      enterpriseId: "ent-a",
      ledgerStorePath: paths.ledger,
      stageStorePath: paths.stage,
    });
    expect(loaded.truncated).toBe(false);
    expect(loaded.ledgerBasis).toBe("usage_ledger_not_tip_spend");
    expect(loaded.emptyReason).toBe("none");
    expect(loaded.facts).toHaveLength(1);

    const agg = aggregateTaskIdUsageLedger(loaded.facts);
    expect(agg.taskId).toBe("task-ledger-1");
    expect(agg.models).toEqual([
      expect.objectContaining({
        modelId: "gpt-test",
        callCount: 1,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 5,
      }),
    ]);

    const presented = presentUsageCostLayer(platform, loaded.facts, {
      taskId: "task-ledger-1",
      truncated: loaded.truncated,
      emptyReason: loaded.emptyReason,
      ledgerBasis: loaded.ledgerBasis,
    });
    expect(presented.ok).toBe(true);
    if (!presented.ok) {
      return;
    }
    expect(presented.view.ledgerBasis).toBe("usage_ledger_not_tip_spend");
    expect(presented.view.taskModelLedger?.[0]?.modelId).toBe("gpt-test");
    expect(presented.view.empty).toBe(false);
    expect(presented.view.callCount).toBe(1);
  });

  it("B2: taskId outside global last-200 window still loads via authoritative path", async () => {
    const paths = await tempPaths();
    await __resetUsageLedgerForTest(paths.ledger);
    await __resetCreditUsageStagesForTest(paths.stage);

    const base = Date.parse("2026-01-01T00:00:00.000Z");
    // Seed > USAGE_COST_FACT_LIMIT newer rows so a naive global top-200 misses the old task.
    for (let i = 0; i < USAGE_COST_FACT_LIMIT + 5; i += 1) {
      await appendUsageLedgerEntry(
        {
          enterpriseId: "ent-a",
          taskId: `task-new-${i}`,
          modelId: "gpt-new",
          tier: "standard",
          policyId: "pol-1",
          creditsCharged: 1,
          providerCostCents: 1,
          tenantRevenueCents: 1,
          inputTokens: 1,
          outputTokens: 1,
          occurredAt: new Date(base + (i + 10) * 60_000).toISOString(),
          userId: "user-a",
          providerPriceState: "known",
        },
        paths.ledger,
      );
    }
    await appendUsageLedgerEntry(
      {
        enterpriseId: "ent-a",
        taskId: "task-old-target",
        modelId: "gpt-old",
        tier: "standard",
        policyId: "pol-1",
        creditsCharged: 9,
        providerCostCents: 9,
        tenantRevenueCents: 9,
        inputTokens: 77,
        outputTokens: 11,
        occurredAt: new Date(base).toISOString(),
        userId: "user-a",
        providerPriceState: "known",
      },
      paths.ledger,
    );

    const windowed = await loadUsageCostFacts({
      enterpriseId: "ent-a",
      ledgerStorePath: paths.ledger,
      stageStorePath: paths.stage,
    });
    expect(windowed.truncated).toBe(true);
    expect(windowed.facts.some((f) => f.taskId === "task-old-target")).toBe(false);

    const authoritative = await loadUsageCostFacts({
      enterpriseId: "ent-a",
      taskId: "task-old-target",
      ledgerStorePath: paths.ledger,
      stageStorePath: paths.stage,
    });
    expect(authoritative.truncated).toBe(false);
    expect(authoritative.facts).toHaveLength(1);
    expect(authoritative.facts[0]?.model).toBe("gpt-old");
    expect(authoritative.facts[0]?.inputTokens).toBe(77);
  });

  it("B3: skipped_consumption is distinct from no_ledger_entry", async () => {
    const paths = await tempPaths();
    await __resetUsageLedgerForTest(paths.ledger);
    await __resetCreditUsageStagesForTest(paths.stage);

    await upsertCreditUsageStage(
      {
        enterpriseId: "ent-a",
        taskId: "task-skipped",
        stage: "done",
        creditsCharged: 0,
        skippedConsumption: true,
      },
      paths.stage,
    );

    const skipped = await loadUsageCostFactsForTaskId({
      taskId: "task-skipped",
      enterpriseId: "ent-a",
      ledgerStorePath: paths.ledger,
      stageStorePath: paths.stage,
    });
    expect(skipped.facts).toHaveLength(0);
    expect(skipped.emptyReason).toBe("skipped_consumption");

    const missing = await loadUsageCostFactsForTaskId({
      taskId: "task-never-seen",
      enterpriseId: "ent-a",
      ledgerStorePath: paths.ledger,
      stageStorePath: paths.stage,
    });
    expect(missing.emptyReason).toBe("no_ledger_entry");

    const presented = presentUsageCostLayer(platform, skipped.facts, {
      taskId: "task-skipped",
      emptyReason: skipped.emptyReason,
      ledgerBasis: skipped.ledgerBasis,
    });
    expect(presented.ok).toBe(true);
    if (!presented.ok) {
      return;
    }
    expect(presented.view.empty).toBe(true);
    expect(presented.view.emptyReason).toBe("skipped_consumption");
    expect(presented.view.headline).toContain("跳过");
  });

  it("B4: BYOK still returns structure + tokens (byok_estimate settlement)", async () => {
    const paths = await tempPaths();
    await __resetUsageLedgerForTest(paths.ledger);
    await __resetCreditUsageStagesForTest(paths.stage);

    await appendUsageLedgerEntry(
      {
        enterpriseId: "ent-byok",
        taskId: "task-byok-1",
        modelId: " ent-own-model ",
        tier: "standard",
        policyId: "pol-1",
        creditsCharged: 0,
        providerCostCents: 55,
        tenantRevenueCents: 0,
        inputTokens: 40,
        outputTokens: 8,
        source: "enterprise",
        billingOwner: "enterprise",
        providerPriceState: "known",
        userId: "user-b",
      },
      paths.ledger,
    );

    const loaded = await loadUsageCostFactsForTaskId({
      taskId: "task-byok-1",
      enterpriseId: "ent-byok",
      ledgerStorePath: paths.ledger,
      stageStorePath: paths.stage,
    });
    expect(loaded.facts[0]?.settlement.kind).toBe("byok_estimate");
    expect(loaded.facts[0]?.inputTokens).toBe(40);
    expect(loaded.facts[0]?.model).toBe("ent-own-model");

    const presented = presentUsageCostLayer(platform, loaded.facts, {
      taskId: "task-byok-1",
      emptyReason: loaded.emptyReason,
      ledgerBasis: loaded.ledgerBasis,
    });
    expect(presented.ok).toBe(true);
    if (!presented.ok) {
      return;
    }
    expect(presented.view.empty).toBe(false);
    expect(presented.view.taskModelLedger?.[0]).toMatchObject({
      modelId: "ent-own-model",
      callCount: 1,
      inputTokens: 40,
      outputTokens: 8,
      settlementKind: "byok_estimate",
    });
  });
});
