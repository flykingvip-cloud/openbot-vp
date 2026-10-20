import { describe, expect, it } from "vitest";
import { buildBundleUpdatePayload } from "./bundle-update-payload.ts";

describe("buildBundleUpdatePayload", () => {
  it("preserves expanded entitlement fields from version meta", () => {
    const payload = buildBundleUpdatePayload(
      "plan-pro",
      {
        versionId: "pv-pro",
        version: 2,
        status: "active",
        snapshot: {
          basePriceCents: 99_900,
          seatQuota: {},
          botQuota: 120,
          pricing: [],
        },
        binding: {
          planVersionId: "pv-pro",
          allowedModelIds: ["openai/gpt-5"],
          allowedTiers: ["tier_b"],
          allowedPolicies: ["balanced", "quality"],
          policyId: "balanced",
          updatedAt: "2026-06-23T00:00:00.000Z",
        },
        entitlementSnapshot: {
          planVersionId: "pv-pro",
          monthlyPriceCents: 99_900,
          monthlyCredits: 30_000,
          maxSeats: {},
          maxBots: 120,
          maxConcurrentRuns: 20,
          maxWorkflows: 50,
          maxKnowledgeBases: 50,
          allowedPolicies: ["balanced", "quality"],
          allowedTiers: ["tier_b"],
          allowCustomPolicy: false,
          allowPrivateModels: false,
          overagePolicy: { type: "block", allowBurstConcurrency: false },
          features: {
            auditLog: true,
            mfa: true,
            sso: false,
            vpcIsolation: false,
          },
          updatedAt: "2026-06-23T00:00:00.000Z",
        },
        bindingState: "valid",
        activationReady: true,
        activationBlockers: [],
      },
      ["openai/gpt-5"],
    );

    expect(payload.maxWorkflows).toBe(50);
    expect(payload.maxKnowledgeBases).toBe(50);
    expect(payload.features).toEqual({
      auditLog: true,
      mfa: true,
      sso: false,
      vpcIsolation: false,
    });
    expect(payload.allowCustomPolicy).toBe(false);
    expect(payload.allowPrivateModels).toBe(false);
  });
});
