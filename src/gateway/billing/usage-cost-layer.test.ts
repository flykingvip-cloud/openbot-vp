import { describe, expect, it } from "vitest";
import {
  presentUsageCostLayer,
  responseHasCommercialCost,
  selectCountedFacts,
  type UsageCostActor,
  type UsageRequestFact,
} from "./usage-cost-layer.js";

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
    expect(views[2]?.ranking?.map((row) => row.model)).toEqual(["gpt-test", "claude-test"]);
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
