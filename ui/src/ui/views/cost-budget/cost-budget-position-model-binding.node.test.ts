import { describe, expect, it } from "vitest";
import type { AllocationOverviewResponse } from "../../capability/cost-budget-billing/index.ts";
import {
  findOrgSeatModelGrant,
  parseAllocationSeatModelGrants,
  positionModelBindingIsDirty,
  resolveEntitledModelIds,
  resolveSavedPositionModelIds,
  togglePositionModelDraft,
} from "./cost-budget-position-model-binding.ts";

function sampleAllocation(): AllocationOverviewResponse {
  return {
    subscribed: true,
    strategy: "ceiling_plan_role_grant",
    ceiling: {
      planName: "Basic",
      planVersionId: "pv-1",
      allowedTiers: ["tier_a"],
      entitledModelCount: 2,
      monthlyCredits: 1000,
    },
    roleProfiles: [
      {
        role: "viewer",
        label: "Viewer",
        description: "",
        tierIds: ["tier_a"],
        modelIds: ["openai/gpt-4o-mini"],
        modelCount: 1,
      },
      {
        role: "admin",
        label: "Admin",
        description: "",
        tierIds: ["tier_a"],
        modelIds: ["openai/gpt-4o", "anthropic/claude-sonnet"],
        modelCount: 2,
      },
    ],
    seats: [],
    grants: [
      {
        tenantId: "ent-1",
        subjectType: "seat",
        subjectId: "org-seat-sales",
        seatId: "org-seat-sales",
        grantedModelIds: ["openai/gpt-4o-mini"],
        status: "active",
        updatedAt: "2026-06-19T00:00:00.000Z",
      },
    ],
    guide: { summary: "", steps: [] },
  };
}

describe("cost-budget-position-model-binding", () => {
  it("resolves entitled model ids from role profiles and grants", () => {
    const ids = resolveEntitledModelIds(sampleAllocation());
    expect(ids).toEqual(["anthropic/claude-sonnet", "openai/gpt-4o", "openai/gpt-4o-mini"]);
  });

  it("finds org seat grant and detects dirty draft", () => {
    const grants = parseAllocationSeatModelGrants(sampleAllocation().grants);
    const saved = resolveSavedPositionModelIds(grants, "org-seat-sales");
    expect(saved).toEqual(["openai/gpt-4o-mini"]);
    expect(findOrgSeatModelGrant(grants, "org-seat-sales")?.grantedModelIds).toEqual([
      "openai/gpt-4o-mini",
    ]);

    const draft = togglePositionModelDraft(new Set(saved), "openai/gpt-4o", true);
    expect(positionModelBindingIsDirty(saved, [...draft])).toBe(true);
    expect(positionModelBindingIsDirty(saved, saved)).toBe(false);
  });
});
