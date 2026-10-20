// @vitest-environment node
import { describe, expect, it } from "vitest";
import { summarizeActivateDiffChanges } from "./plan-activate-confirm-panel.ts";
import { resolvePlanVersionHealth } from "./plan-health-summary.ts";

describe("summarizeActivateDiffChanges", () => {
  it("counts entitlement, pricing, and model changes", () => {
    const summary = summarizeActivateDiffChanges({
      entitlementDiff: [{ label: "Credits", from: "1000", to: "2000" }],
      pricingDiff: {
        fromVersionId: "a",
        toVersionId: "b",
        entries: [
          {
            type: "seat",
            key: "viewer",
            oldPriceCents: 1000,
            newPriceCents: 1200,
            change: "changed",
          },
          {
            type: "seat",
            key: "creator",
            oldPriceCents: 0,
            newPriceCents: 500,
            change: "added",
          },
        ],
      },
      bindingDiff: {
        addedModelIds: ["m1"],
        removedModelIds: [],
        quotaChangedModelIds: [],
        aorChanged: false,
      },
    });
    expect(summary).toEqual({ entitlement: 1, pricing: 2, models: 1, total: 4 });
  });
});

describe("resolvePlanVersionHealth", () => {
  it("flags missing binding when blockers include missing_binding", () => {
    const health = resolvePlanVersionHealth({
      versionId: "pv-1",
      version: 1,
      status: "active",
      bindingState: "missing",
      activationReady: false,
      activationBlockers: ["missing_binding"],
      snapshot: { basePriceCents: 0, seatQuota: {}, botQuota: 0, pricing: [] },
      binding: {
        planVersionId: "pv-1",
        allowedModelIds: [],
        allowedTiers: ["tier_a"],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(health.needsModels).toBe(true);
    expect(health.modelsBound).toBe(false);
    expect(health.tierCount).toBe(1);
  });

  it("marks healthy when models and binding state are valid", () => {
    const health = resolvePlanVersionHealth({
      versionId: "pv-1",
      version: 1,
      status: "active",
      bindingState: "valid",
      activationReady: true,
      activationBlockers: [],
      snapshot: { basePriceCents: 0, seatQuota: {}, botQuota: 0, pricing: [] },
      binding: {
        planVersionId: "pv-1",
        allowedModelIds: ["ollama/llama3.2"],
        allowedTiers: ["tier_a", "tier_b"],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(health.needsModels).toBe(false);
    expect(health.modelsBound).toBe(true);
    expect(health.modelCount).toBe(1);
    expect(health.tierCount).toBe(2);
  });
});
