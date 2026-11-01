import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeProviderPrice,
  ledgerEntryToUsageFact,
  ledgerPriceKind,
} from "./usage-cost-facts.js";
import {
  presentUsageCostLayer,
  responseHasCommercialCost,
  selectCountedFacts,
  type UsageCostActor,
  type UsageRequestFact,
} from "./usage-cost-layer.js";
import { appendUsageLedgerEntry } from "./usage-ledger-store.js";

function fact(overrides: Partial<UsageRequestFact> = {}): UsageRequestFact {
  return {
    requestId: "req-1",
    taskId: "task-1",
    parentTaskId: null,
    role: "request",
    revision: 1,
    occurredAt: "2026-11-01T00:00:00.000Z",
    enterpriseId: "ent-a",
    userId: "user-a",
    assistantId: "bot-a",
    provider: "openai",
    model: "gpt-test",
    purpose: "hidden purpose",
    taskType: "draft",
    status: "succeeded",
    attempt: "primary",
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 5,
    cacheWriteTokens: 1,
    latencyMs: 80,
    acceptance: "passed",
    anomaly: false,
    settlement: { kind: "credits", credits: 12, final: true },
    procurementCents: 40,
    procurementCurrency: "CNY",
    revenueCents: 90,
    ...overrides,
  };
}

const user: UsageCostActor = {
  surface: "user",
  userId: "user-a",
  enterpriseId: "ent-a",
  enterpriseWide: false,
};

const member: UsageCostActor = {
  surface: "enterprise",
  userId: "user-a",
  enterpriseId: "ent-a",
  enterpriseWide: false,
};

const admin: UsageCostActor = {
  surface: "enterprise",
  userId: "admin-a",
  enterpriseId: "ent-a",
  enterpriseWide: true,
};

const platform: UsageCostActor = {
  surface: "platform",
  userId: "ops",
  enterpriseId: null,
  enterpriseWide: true,
};

describe("usage cost layer", () => {
  it("keeps measured cache and treats an unpriced zero as missing, not free", async () => {
    expect(
      describeProviderPrice({ source: "none", inputCostPer1MCents: 0, outputCostPer1MCents: 0 }),
    ).toEqual({ providerPriceState: "missing", providerPriceFree: false });
    expect(
      describeProviderPrice({ source: "catalog", inputCostPer1MCents: 0, outputCostPer1MCents: 0 }),
    ).toEqual({ providerPriceState: "missing", providerPriceFree: false });
    expect(
      describeProviderPrice({
        source: "cost_version",
        inputCostPer1MCents: 0,
        outputCostPer1MCents: 0,
      }),
    ).toEqual({ providerPriceState: "known", providerPriceFree: true });
    expect(
      describeProviderPrice({
        source: "cost_version",
        inputCostPer1MCents: 0,
        outputCostPer1MCents: 0,
        usage: { cacheReadTokens: 9 },
      }),
    ).toEqual({ providerPriceState: "missing", providerPriceFree: false });
    expect(
      describeProviderPrice({
        source: "cost_version",
        inputCostPer1MCents: 0,
        outputCostPer1MCents: 0,
        cacheReadCostPer1MCents: 0,
        cacheWriteCostPer1MCents: 0,
        usage: { cacheReadTokens: 9, cacheWriteTokens: 0 },
      }),
    ).toEqual({ providerPriceState: "known", providerPriceFree: true });
    expect(
      describeProviderPrice({
        source: "catalog",
        inputCostPer1MCents: 12,
        outputCostPer1MCents: 0,
      }),
    ).toEqual({ providerPriceState: "known", providerPriceFree: false });

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "usage-cost-cache-"));
    const ledgerPath = path.join(dir, "ledger.json");
    const historical = await appendUsageLedgerEntry(
      {
        enterpriseId: "ent-a",
        taskId: "old-zero",
        modelId: "openai/unpriced",
        tier: "standard",
        policyId: "included",
        creditsCharged: 1,
        providerCostCents: 0,
        tenantRevenueCents: 0,
        inputTokens: 4,
        outputTokens: 1,
      },
      ledgerPath,
    );
    // 有缓存用量但写入时缺缓存单价 → missing，不得进零成本排名。
    const cached = await appendUsageLedgerEntry(
      {
        enterpriseId: "ent-a",
        taskId: "cached",
        modelId: "openai/cached",
        tier: "standard",
        policyId: "included",
        creditsCharged: 0,
        providerCostCents: 0,
        tenantRevenueCents: 0,
        inputTokens: 3,
        outputTokens: 1,
        cacheReadTokens: 9,
        cacheWriteTokens: 0,
        providerPriceState: "missing",
      },
      ledgerPath,
    );
    // 确认过的免费模型且无缓存用量，仍可进零成本排名；与 Credits 结算分开。
    const free = await appendUsageLedgerEntry(
      {
        enterpriseId: "ent-a",
        taskId: "free",
        modelId: "openai/free",
        tier: "standard",
        policyId: "included",
        creditsCharged: 0,
        providerCostCents: 0,
        tenantRevenueCents: 0,
        inputTokens: 2,
        outputTokens: 1,
        providerPriceState: "known",
        providerPriceFree: true,
      },
      ledgerPath,
    );
    const historicalFact = ledgerEntryToUsageFact(historical.entry, undefined);
    const cachedFact = ledgerEntryToUsageFact(cached.entry, {
      enterpriseId: "ent-a",
      taskId: "cached",
      stage: "done",
      creditsCharged: 0,
      updatedAt: "2026-11-01T00:00:00.000Z",
    });
    const freeFact = ledgerEntryToUsageFact(free.entry, {
      enterpriseId: "ent-a",
      taskId: "free",
      stage: "done",
      creditsCharged: 0,
      updatedAt: "2026-11-01T00:00:00.000Z",
    });
    expect(ledgerPriceKind(historical.entry)).toBe("missing");
    expect(historicalFact.cacheReadTokens).toBeNull();
    expect(historicalFact.procurementCents).toBeNull();
    expect(cachedFact.cacheReadTokens).toBe(9);
    expect(cachedFact.cacheWriteTokens).toBe(0);
    expect(cachedFact.procurementPrice).toBe("missing");
    expect(cachedFact.procurementCents).toBeNull();
    expect(freeFact.procurementPrice).toBe("free");
    const presented = presentUsageCostLayer(platform, [historicalFact, cachedFact, freeFact]);
    expect(presented.ok).toBe(true);
    if (!presented.ok) {
      return;
    }
    expect(presented.view.cacheRead.known).toBe(9);
    expect(presented.view.cacheRead.unknownCount).toBe(1);
    expect(presented.view.cacheNote).toContain("不会显示成 0");
    expect(presented.view.ranking?.map((row) => row.model)).toEqual(["openai/free"]);
    expect(presented.view.ranking?.[0]?.priceKind).toBe("free");
    expect(presented.view.ranking?.[0]?.procurementCents).toBe(0);
    expect(
      presented.view.excludedFromRanking?.map((row) => row.model).toSorted(),
    ).toEqual(["openai/cached", "openai/unpriced"]);
    expect(presented.view.procurementCents).toBeNull();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("keeps one total across user, enterprise, and platform without parent double counting", () => {
    const rows = [
      fact({
        requestId: "parent-rollup",
        taskId: "parent",
        role: "task_rollup",
        inputTokens: 9_999,
        outputTokens: 9_999,
        procurementCents: 9_999,
      }),
      fact({
        requestId: "primary",
        taskId: "child-a",
        parentTaskId: "parent",
        model: "gpt-test",
        inputTokens: 40,
        outputTokens: 10,
        attempt: "primary",
        procurementCents: 20,
        revenueCents: 30,
        settlement: { kind: "credits", credits: 4, final: true },
      }),
      fact({
        requestId: "fallback",
        taskId: "child-b",
        parentTaskId: "parent",
        provider: "anthropic",
        model: "claude-test",
        inputTokens: 60,
        outputTokens: 15,
        attempt: "fallback",
        procurementCents: 30,
        revenueCents: 50,
        settlement: { kind: "credits", credits: 6, final: true },
      }),
      fact({
        requestId: "retry",
        taskId: "child-a",
        parentTaskId: "parent",
        model: "gpt-test",
        inputTokens: 5,
        outputTokens: 2,
        attempt: "retry",
        status: "failed",
        procurementCents: 8,
        revenueCents: 0,
        settlement: { kind: "credits", credits: 1, final: true },
      }),
    ];
    expect(
      selectCountedFacts(rows)
        .map((row) => row.requestId)
        .toSorted(),
    ).toEqual(["fallback", "primary", "retry"]);
    const surfaces = [user, admin, platform] as const;
    const views = surfaces.map((actor) => {
      const presented = presentUsageCostLayer(actor, rows, { taskId: "parent" });
      expect(presented.ok).toBe(true);
      if (!presented.ok) {
        throw new Error(presented.message);
      }
      return presented.view;
    });
    for (const view of views) {
      expect(view.input.known).toBe(105);
      expect(view.output.known).toBe(27);
      expect(view.callCount).toBe(3);
      expect(view.reconciliation.aligned).toBe(true);
      expect(view.reconciliation.modelInputKnown).toBe(105);
      expect(view.reconciliation.taskInputKnown).toBe(105);
      expect(view.tasks[0]?.rolledUpFromChildren).toBe(true);
      expect(view.models.find((row) => row.model === "gpt-test")?.retryCount).toBe(1);
      expect(view.models.find((row) => row.model === "claude-test")?.fallbackCount).toBe(1);
    }
    expect(responseHasCommercialCost(views[0])).toBe(false);
    expect(responseHasCommercialCost(views[1])).toBe(false);
    expect(views[2]?.procurementCents).toBe(58);
    expect(views[2]?.commercialMarginCents).toBe(22);
    // gpt-test 含一次失败重试，成功率更低；综合质量／成功率后 claude 优先于纯低价。
    expect(views[2]?.ranking?.map((row) => row.model)).toEqual(["claude-test", "gpt-test"]);
  });

  it("ranks by quality, success, and latency rather than procurement alone", () => {
    const presented = presentUsageCostLayer(platform, [
      fact({
        requestId: "cheap-flaky",
        model: "cheap-flaky",
        status: "failed",
        acceptance: "failed",
        latencyMs: 900,
        procurementCents: 1,
        revenueCents: 0,
      }),
      fact({
        requestId: "solid",
        model: "solid-paid",
        status: "succeeded",
        acceptance: "passed",
        latencyMs: 100,
        procurementCents: 40,
        revenueCents: 50,
      }),
    ]);
    expect(presented.ok).toBe(true);
    if (!presented.ok) {
      return;
    }
    expect(presented.view.ranking?.map((row) => row.model)).toEqual(["solid-paid", "cheap-flaky"]);
  });

    it("does not show unknown usage or missing price as zero and keeps them out of the cheap ranking", () => {
    const presented = presentUsageCostLayer(platform, [
      fact({
        requestId: "unknown-usage",
        model: "mystery-usage",
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        procurementCents: 10,
        settlement: { kind: "unknown" },
        status: "unknown",
      }),
      fact({
        requestId: "missing-price",
        model: "mystery-price",
        inputTokens: 4,
        outputTokens: 1,
        procurementCents: null,
        procurementCurrency: null,
        settlement: { kind: "unknown" },
      }),
      fact({
        requestId: "free",
        model: "free-model",
        inputTokens: 0,
        outputTokens: 0,
        procurementCents: 0,
        revenueCents: 0,
        settlement: { kind: "credits", credits: 0, final: true },
      }),
    ]);
    expect(presented.ok).toBe(true);
    if (!presented.ok) {
      return;
    }
    expect(presented.view.input.complete).toBe(false);
    expect(presented.view.input.known).toBe(4);
    expect(presented.view.input.unknownCount).toBe(1);
    expect(presented.view.ranking?.map((row) => row.model)).toEqual(["free-model"]);
    expect(presented.view.excludedFromRanking?.map((row) => row.reason).toSorted()).toEqual([
      "missing_price",
      "unknown_usage",
    ]);
    expect(presented.view.procurementCents).toBeNull();
  });

  it("labels pending settlement, BYOK estimates, and separate currencies", () => {
    const presented = presentUsageCostLayer(user, [
      fact({
        requestId: "pending",
        settlement: { kind: "pending", credits: 7 },
        status: "running",
        procurementCents: null,
        procurementCurrency: null,
      }),
      fact({
        requestId: "byok",
        taskId: "task-byok",
        settlement: {
          kind: "byok_estimate",
          currency: "USD",
          amountCents: 250,
          basis: "已配置价格口径，不是结算扣费",
        },
        recordedCredits: null,
      }),
      fact({
        requestId: "cny",
        taskId: "task-cny",
        settlement: { kind: "invoice", currency: "CNY", amountCents: 500, final: true },
        recordedCredits: 3,
      }),
    ]);
    expect(presented.ok).toBe(true);
    if (!presented.ok) {
      return;
    }
    const labels = presented.view.charges.map((line) => line.label);
    expect(labels.some((label) => label.includes("待结算"))).toBe(true);
    expect(
      labels.some(
        (label) =>
          label.includes("估算") && label.includes("US$") && label.includes("不是结算扣费"),
      ),
    ).toBe(true);
    expect(labels.some((label) => label.includes("¥5.00"))).toBe(true);
    expect(presented.view.mixedCurrency).toBe(true);
    expect(presented.view.lifecycle).toBe("running");
    expect(responseHasCommercialCost(presented.view)).toBe(false);
    expect(JSON.stringify(presented.view)).not.toContain("hidden purpose");
  });

  it("keeps failed and cancelled consumption and replaces corrected rows", () => {
    const presented = presentUsageCostLayer(user, [
      fact({ requestId: "same", revision: 1, inputTokens: 10, status: "failed" }),
      fact({
        requestId: "same",
        revision: 3,
        inputTokens: 15,
        status: "cancelled",
        occurredAt: "2026-11-01T00:00:01.000Z",
      }),
      fact({
        requestId: "same",
        revision: 2,
        inputTokens: 99,
        occurredAt: "2026-11-01T00:00:02.000Z",
      }),
    ]);
    expect(presented.ok).toBe(true);
    if (!presented.ok) {
      return;
    }
    expect(presented.view.callCount).toBe(1);
    expect(presented.view.input.known).toBe(15);
    expect(presented.view.tasks[0]?.status).toBe("cancelled");
  });

  it("blocks another user's task and another enterprise", () => {
    const rows = [
      fact({ requestId: "mine", taskId: "mine", userId: "user-a" }),
      fact({ requestId: "other", taskId: "other", userId: "user-b", model: "secret-model" }),
      fact({
        requestId: "foreign",
        taskId: "foreign",
        enterpriseId: "ent-b",
        userId: "user-a",
        model: "other-enterprise-model",
      }),
    ];
    const own = presentUsageCostLayer(user, rows);
    const denied = presentUsageCostLayer(user, rows, { taskId: "other" });
    const memberView = presentUsageCostLayer(member, rows);
    const adminView = presentUsageCostLayer(admin, rows);
    expect(own.ok && own.view.models.map((row) => row.model)).toEqual(["gpt-test"]);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.message).toBe("无权查看该任务");
    }
    expect(memberView.ok && memberView.view.callCount).toBe(1);
    expect(adminView.ok && adminView.view.byMember.map((row) => row.id).toSorted()).toEqual([
      "user-a",
      "user-b",
    ]);
    expect(JSON.stringify(adminView.ok ? adminView.view : {})).not.toContain(
      "other-enterprise-model",
    );
    expect(JSON.stringify(adminView.ok ? adminView.view : {})).not.toContain("hidden purpose");
  });

  it("reuses the existing budget signal and an empty read has no sample fee", () => {
    const warned = presentUsageCostLayer(user, [fact()], { budgetLevel: "alert" });
    const empty = presentUsageCostLayer(user, []);
    expect(warned.ok && warned.view.attention.message).toBe("已达到预算提醒阈值");
    expect(empty.ok && empty.view.empty).toBe(true);
    expect(empty.ok && empty.view.headline).toBe("暂无用量");
    expect(empty.ok && empty.view.charges).toEqual([]);
  });
});
