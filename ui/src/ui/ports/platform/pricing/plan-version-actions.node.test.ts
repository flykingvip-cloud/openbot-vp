import { describe, expect, it, vi } from "vitest";
import type { PlatformPlanBundleGateway } from "../../../capability/platform-plan-bundle/index.ts";
import {
  buildActivateConfirmState,
  buildDeleteConfirmState,
  buildDraftEditorState,
  buildVersionPricingRows,
  requestActivateVersion,
  requestCreateDraftVersion,
  requestDeleteVersion,
  requestDeprecateVersion,
  requestSaveDraftVersion,
} from "./plan-version-actions.ts";

const version = {
  id: "pv-1",
  planId: "plan-1",
  version: 1,
  status: "draft",
  snapshot: {
    basePriceCents: 99_900,
    seatQuota: {},
    botQuota: 10,
    pricing: [
      {
        id: "p1",
        planId: "plan-1",
        planVersionId: "pv-1",
        type: "seat",
        key: "viewer",
        priceCents: 1000,
      },
    ],
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  createdByUserId: "admin",
} as const;

const versionMeta = {
  versionId: "pv-1",
  version: 1,
  status: "draft",
  snapshot: version.snapshot,
  binding: {
    planVersionId: "pv-1",
    allowedModelIds: ["m1"],
    allowedTiers: ["tier_a"],
    allowedPolicies: ["balanced"],
    policyId: "balanced",
    modelQuota: { m1: { maxRequests: 8 } },
    aorExecution: {
      taskTypeId: "coding.review",
      selectorStrategy: "balanced" as const,
      evaluatorMode: "workspace",
    },
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  entitlementSnapshot: {
    planVersionId: "pv-1",
    monthlyPriceCents: 99_900,
    monthlyCredits: 1000,
    maxSeats: {},
    maxBots: 10,
    maxConcurrentRuns: 4,
    maxWorkflows: 8,
    maxKnowledgeBases: 3,
    allowedPolicies: ["balanced"],
    allowedTiers: ["tier_a"],
    overagePolicy: { type: "block" as const, allowBurstConcurrency: false },
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  bindingState: "valid",
  activationReady: true,
  activationBlockers: [],
} as const;

describe("plan-version-actions", () => {
  it("builds draft editor state from version and meta", () => {
    const draft = buildDraftEditorState({
      planId: "plan-1",
      version: version as never,
      versionMeta: versionMeta as never,
      bundleCatalog: ["m2"],
      defaultPolicyId: "balanced",
      centsToYuan: (cents) => String(cents / 100),
    });
    expect(draft.rows).toEqual([{ type: "seat", key: "viewer", priceYuan: "10" }]);
    expect(draft.catalog).toEqual(["m1", "m2"]);
    expect(draft.modelQuota).toEqual({ m1: { maxRequests: "8", maxTokens: "" } });
    expect(draft.aor.taskTypeId).toBe("coding.review");
  });

  it("builds activate and delete confirm state", () => {
    const activate = buildActivateConfirmState({
      planId: "plan-1",
      version: version as never,
      activeVersion: version as never,
      catalogTiers: [],
      catalogPolicies: [],
      getVersionMeta: () => versionMeta as never,
      computeModelBindingDiff: () => ({
        addedModelIds: [],
        removedModelIds: [],
        quotaChangedModelIds: [],
        aorChanged: false,
      }),
      computeEntitlementDiff: () => [{ label: "Credits", from: "100", to: "200" }],
    });
    expect(activate.versionNumber).toBe(1);
    expect(activate.entitlementDiff).toHaveLength(1);

    const del = buildDeleteConfirmState("plan-1", version);
    expect(del).toEqual({ planId: "plan-1", versionId: "pv-1", versionNumber: 1 });
  });

  it("wraps gateway draft/save/activate/deprecate/delete requests", async () => {
    const gateway = {
      createVersion: vi.fn(async (payload) => payload),
      activate: vi.fn(async (payload) => payload),
      deprecate: vi.fn(async (payload) => payload),
      deleteVersion: vi.fn(async (payload) => payload),
    };
    const gatewayDep = gateway as unknown as PlatformPlanBundleGateway;

    await requestCreateDraftVersion({
      gateway: gatewayDep,
      planId: "plan-1",
      pricing: [{ type: "seat", key: "viewer", priceCents: 1000 }],
      versionMeta: versionMeta as never,
      resolvedModelIds: ["tier-model-x"],
      defaultPolicyId: "balanced",
    });
    // allowedModelIds comes from the Tier-resolved pool, not the version's manual binding (["m1"]).
    expect(gateway.createVersion).toHaveBeenCalledWith(
      expect.objectContaining({ planId: "plan-1", allowedModelIds: ["tier-model-x"] }),
    );

    await requestSaveDraftVersion({
      gateway: gatewayDep,
      editor: buildDraftEditorState({
        planId: "plan-1",
        version: version as never,
        versionMeta: versionMeta as never,
        bundleCatalog: [],
        defaultPolicyId: "balanced",
        centsToYuan: (cents) => String(cents / 100),
      }),
      resolvedModelIds: ["tier-model-x"],
      yuanToCents: (value) => Math.round(Number(value) * 100),
    });
    expect(gateway.createVersion).toHaveBeenCalledTimes(2);
    // Saving a draft submits the Tier-resolved pool, overriding the editor's historical allowedModelIds.
    expect(gateway.createVersion).toHaveBeenLastCalledWith(
      expect.objectContaining({ planId: "plan-1", allowedModelIds: ["tier-model-x"] }),
    );

    await requestActivateVersion({ gateway: gatewayDep, planId: "plan-1", versionId: "pv-1" });
    expect(gateway.activate).toHaveBeenCalledWith({
      planId: "plan-1",
      versionId: "pv-1",
      requestId: "activate-pv-1",
    });

    await requestDeprecateVersion({ gateway: gatewayDep, planId: "plan-1", versionId: "pv-1" });
    expect(gateway.deprecate).toHaveBeenCalledWith({
      planId: "plan-1",
      versionId: "pv-1",
    });

    await requestDeleteVersion({ gateway: gatewayDep, planId: "plan-1", versionId: "pv-1" });
    expect(gateway.deleteVersion).toHaveBeenCalledWith({
      planId: "plan-1",
      versionId: "pv-1",
    });
  });

  it("builds pricing rows from cents", () => {
    expect(buildVersionPricingRows(version as never, (cents) => String(cents / 100))).toEqual([
      { type: "seat", key: "viewer", priceYuan: "10" },
    ]);
  });
});
