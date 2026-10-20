import { describe, expect, it } from "vitest";
import {
  buildAorExecutionForSave,
  buildDraftAorEditor,
  buildDraftModelBudgets,
  buildDraftModelQuota,
  buildEntitlementEditorFromMeta,
  buildEntitlementPayloadForSave,
  buildModelBudgetsForSave,
  buildModelQuotaForSave,
  marketingFeaturesFromForm,
  marketingFeaturesToForm,
} from "./plan-form-helpers.ts";

describe("plan-form-helpers", () => {
  it("builds entitlement editor from meta with a default policy fallback", () => {
    const editor = buildEntitlementEditorFromMeta(
      {
        versionId: "pv-1",
        version: 1,
        status: "active",
        snapshot: {
          basePriceCents: 0,
          seatQuota: {},
          botQuota: 10,
          pricing: [],
        },
        entitlementSnapshot: {
          planVersionId: "pv-1",
          monthlyPriceCents: 0,
          monthlyCredits: 1000,
          maxSeats: {},
          maxBots: 10,
          maxConcurrentRuns: 4,
          maxWorkflows: 8,
          maxKnowledgeBases: 3,
          allowedPolicies: [],
          allowedTiers: ["tier_a"],
          overagePolicy: { type: "block", allowBurstConcurrency: false },
          features: { auditLog: true, mfa: true },
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        bindingState: "valid",
        activationReady: true,
        activationBlockers: [],
      },
      "balanced",
    );

    expect(editor.policyId).toBe("balanced");
    expect(editor.maxWorkflows).toBe("8");
    expect(editor.maxKnowledgeBases).toBe("3");
    expect(editor.auditLog).toBe(true);
    expect(editor.mfa).toBe(true);
  });

  it("serializes expanded entitlement payload fields", () => {
    const payload = buildEntitlementPayloadForSave({
      monthlyCredits: "30000",
      aiBasic: "",
      aiPro: "",
      aiElite: "",
      maxConcurrentRuns: "20",
      maxWorkflows: "50",
      maxKnowledgeBases: "50",
      overagePolicyType: "credits_only",
      allowBurstConcurrency: true,
      allowedTiers: ["tier_b"],
      allowedPolicies: ["balanced", "quality"],
      policyId: "balanced",
      auditLog: true,
      mfa: true,
      sso: false,
      vpcIsolation: true,
      allowPrivateModels: true,
      allowCustomPolicy: false,
    });

    expect(payload).toMatchObject({
      monthlyCredits: 30000,
      maxConcurrentRuns: 20,
      maxWorkflows: 50,
      maxKnowledgeBases: 50,
      allowPrivateModels: true,
      allowCustomPolicy: false,
      features: {
        auditLog: true,
        mfa: true,
        sso: false,
        vpcIsolation: true,
      },
    });
  });

  it("keeps only allowed model quotas and valid aor fields", () => {
    expect(
      buildModelQuotaForSave(["m1", "m2"], {
        m1: { maxRequests: "100", maxTokens: "2000000" },
        m2: { maxRequests: "", maxTokens: "" },
        m3: { maxRequests: "50", maxTokens: "" },
      }),
    ).toEqual({ m1: { maxRequests: 100, maxTokens: 2_000_000 } });

    // request-cap-only and token-cap-only entries are each retained.
    expect(
      buildModelQuotaForSave(["m1", "m2"], {
        m1: { maxRequests: "10", maxTokens: "" },
        m2: { maxRequests: "", maxTokens: "999" },
      }),
    ).toEqual({ m1: { maxRequests: 10 }, m2: { maxTokens: 999 } });

    expect(
      buildAorExecutionForSave({
        enabled: true,
        taskTypeId: "coding.review",
        selectorStrategy: "bandit",
        evaluatorMode: "content",
      }),
    ).toEqual({
      taskTypeId: "coding.review",
      selectorStrategy: "bandit",
      evaluatorMode: "content",
    });
  });

  it("maps model quota and aor values from version meta", () => {
    const meta = {
      versionId: "pv-1",
      version: 1,
      status: "active",
      snapshot: {
        basePriceCents: 0,
        seatQuota: {},
        botQuota: 10,
        pricing: [],
      },
      binding: {
        planVersionId: "pv-1",
        allowedModelIds: ["m1"],
        modelQuota: { m1: { maxRequests: 12 } },
        aorExecution: {
          taskTypeId: "coding.review",
          selectorStrategy: "balanced" as const,
          evaluatorMode: "workspace",
        },
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      bindingState: "valid" as const,
      activationReady: true,
      activationBlockers: [],
    };

    expect(buildDraftModelQuota(meta as never)).toEqual({
      m1: { maxRequests: "12", maxTokens: "" },
    });
    expect(buildDraftAorEditor(meta as never)).toEqual({
      enabled: true,
      taskTypeId: "coding.review",
      selectorStrategy: "balanced",
      evaluatorMode: "workspace",
    });
  });

  it("maps model budgets from version meta (Phase 4, independent of modelQuota)", () => {
    const meta = {
      versionId: "pv-1",
      version: 1,
      status: "active",
      snapshot: { basePriceCents: 0, seatQuota: {}, botQuota: 10, pricing: [] },
      binding: {
        planVersionId: "pv-1",
        allowedModelIds: ["m1"],
        modelBudgets: { m1: { monthlyCreditsCap: 5000, spendCapCents: 20000 } },
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      bindingState: "valid" as const,
      activationReady: true,
      activationBlockers: [],
    };
    expect(buildDraftModelBudgets(meta as never)).toEqual({
      m1: { monthlyCreditsCap: "5000", spendCapCents: "20000" },
    });
  });

  it("keeps only allowed model budgets with at least one cap on save", () => {
    expect(
      buildModelBudgetsForSave(["m1", "m2"], {
        m1: { monthlyCreditsCap: "5000", spendCapCents: "20000" },
        m2: { monthlyCreditsCap: "", spendCapCents: "" },
        m3: { monthlyCreditsCap: "1", spendCapCents: "" },
      }),
    ).toEqual({ m1: { monthlyCreditsCap: 5000, spendCapCents: 20000 } });

    // credits-only and spend-only entries are each retained.
    expect(
      buildModelBudgetsForSave(["m1", "m2"], {
        m1: { monthlyCreditsCap: "10", spendCapCents: "" },
        m2: { monthlyCreditsCap: "", spendCapCents: "99" },
      }),
    ).toEqual({ m1: { monthlyCreditsCap: 10 }, m2: { spendCapCents: 99 } });
  });

  it("round-trips marketing feature text", () => {
    const text = "能力一\n\n能力二\n";
    expect(marketingFeaturesFromForm(text)).toEqual(["能力一", "能力二"]);
    expect(marketingFeaturesToForm(["能力一", "能力二"])).toBe("能力一\n能力二");
  });
});
