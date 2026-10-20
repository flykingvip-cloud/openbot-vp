// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { UsageLedgerEntry } from "../package-entitlement/types.js";
import { aggregatePerModelSpend, computeModelBudgetStatuses } from "./model-budget-status.js";

function entry(partial: Partial<UsageLedgerEntry> & { modelId: string }): UsageLedgerEntry {
  return {
    id: `id-${Math.random()}`,
    enterpriseId: "ent-1",
    taskId: `task-${Math.random()}`,
    tier: "tier_a",
    policyId: "balanced",
    creditsCharged: partial.creditsCharged ?? 0,
    providerCostCents: partial.providerCostCents ?? 0,
    tenantRevenueCents: 0,
    occurredAt: "2026-06-15T00:00:00.000Z",
    ...partial,
  };
}

describe("aggregatePerModelSpend", () => {
  it("sums credits and provider spend per model", () => {
    const agg = aggregatePerModelSpend([
      entry({ modelId: "p/a", creditsCharged: 10, providerCostCents: 100 }),
      entry({ modelId: "p/a", creditsCharged: 5, providerCostCents: 50 }),
      entry({ modelId: "p/b", creditsCharged: 3, providerCostCents: 30 }),
    ]);
    expect(agg.get("p/a")).toEqual({ creditsConsumed: 15, spendCents: 150 });
    expect(agg.get("p/b")).toEqual({ creditsConsumed: 3, spendCents: 30 });
  });
});

describe("computeModelBudgetStatuses", () => {
  it("reports within-budget with remaining headroom", () => {
    const statuses = computeModelBudgetStatuses({
      entries: [entry({ modelId: "p/a", creditsCharged: 40, providerCostCents: 200 })],
      modelBudgets: { "p/a": { monthlyCreditsCap: 100, spendCapCents: 1000 } },
    });
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({
      modelId: "p/a",
      creditsConsumed: 40,
      monthlyCreditsCap: 100,
      creditsRemaining: 60,
      spendCents: 200,
      spendCapCents: 1000,
      spendRemainingCents: 800,
      exceeded: false,
    });
  });

  it("flags exceeded when the credits cap is breached", () => {
    const [status] = computeModelBudgetStatuses({
      entries: [entry({ modelId: "p/a", creditsCharged: 120 })],
      modelBudgets: { "p/a": { monthlyCreditsCap: 100 } },
    });
    expect(status?.exceeded).toBe(true);
    expect(status?.creditsRemaining).toBe(0);
  });

  it("flags exceeded when only the spend cap is breached", () => {
    const [status] = computeModelBudgetStatuses({
      entries: [entry({ modelId: "p/a", providerCostCents: 5000 })],
      modelBudgets: { "p/a": { spendCapCents: 1000 } },
    });
    expect(status?.exceeded).toBe(true);
    expect(status?.spendRemainingCents).toBe(0);
  });

  it("treats a model with no usage as within budget", () => {
    const [status] = computeModelBudgetStatuses({
      entries: [],
      modelBudgets: { "p/a": { monthlyCreditsCap: 100 } },
    });
    expect(status).toMatchObject({ modelId: "p/a", creditsConsumed: 0, exceeded: false });
  });
});
