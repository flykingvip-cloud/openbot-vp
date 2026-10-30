// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ResourceModelCatalogEntry } from "../resource-catalog/types.js";
import {
  resourceCatalogEntryToAorProfile,
  resourceCatalogToAorProfiles,
} from "./aor-catalog-adapter.js";
import { selectModelOrderWithinEffectiveSet } from "./aor-selection.js";

function entry(
  partial: Partial<ResourceModelCatalogEntry> & Pick<ResourceModelCatalogEntry, "modelId" | "tier">,
): ResourceModelCatalogEntry {
  return {
    provider: partial.modelId.split("/")[0] ?? "x",
    displayName: partial.modelId,
    enabled: true,
    inputCostPer1MCents: 100,
    outputCostPer1MCents: 200,
    updatedAt: "2026-07-19T00:00:00.000Z",
    ...partial,
  };
}

describe("aor catalog adapter", () => {
  it("maps platform cost into profiles and conserves set under ranking", () => {
    const entries = [
      entry({
        modelId: "openai/cheap",
        tier: "tier_a",
        inputCostPer1MCents: 10,
        outputCostPer1MCents: 20,
      }),
      entry({
        modelId: "openai/expensive",
        tier: "tier_c",
        inputCostPer1MCents: 1000,
        outputCostPer1MCents: 2000,
      }),
    ];
    const { profiles, missingCostModelIds } = resourceCatalogToAorProfiles(entries);
    expect(profiles).toHaveLength(2);
    expect(missingCostModelIds).toHaveLength(0);

    const result = selectModelOrderWithinEffectiveSet({
      mode: "aor_enhanced",
      effectiveModelIds: ["openai/expensive", "openai/cheap"],
      aorExecution: {
        taskTypeId: "default",
        selectorStrategy: "cheapest",
        evaluatorMode: "content",
      },
      catalog: profiles,
    });
    expect(new Set(result.orderedModelIds)).toEqual(new Set(["openai/expensive", "openai/cheap"]));
    expect(result.orderedModelIds[0]).toBe("openai/cheap");
  });

  it("omits missing-cost entries from profiles (synthetic path; no seed prices)", () => {
    const profile = resourceCatalogEntryToAorProfile(
      entry({
        modelId: "openai/unknown-cost",
        tier: "tier_b",
        inputCostPer1MCents: 0,
        outputCostPer1MCents: 0,
      }),
    );
    expect(profile).toBeTruthy();
    const { profiles, missingCostModelIds } = resourceCatalogToAorProfiles([
      entry({
        modelId: "openai/unknown-cost",
        tier: "tier_b",
        inputCostPer1MCents: 0,
        outputCostPer1MCents: 0,
      }),
    ]);
    expect(missingCostModelIds).toContain("openai/unknown-cost");
    expect(profiles).toHaveLength(0);
  });

  it("does not invent models outside the effective set", () => {
    const { profiles } = resourceCatalogToAorProfiles([
      entry({ modelId: "openai/a", tier: "tier_a" }),
      entry({ modelId: "openai/b", tier: "tier_a" }),
      entry({ modelId: "openai/c", tier: "tier_a" }),
    ]);
    const result = selectModelOrderWithinEffectiveSet({
      mode: "aor_enhanced",
      effectiveModelIds: ["openai/a", "openai/b"],
      aorExecution: {
        taskTypeId: "default",
        selectorStrategy: "balanced",
        evaluatorMode: "content",
      },
      catalog: profiles,
    });
    expect(result.orderedModelIds).not.toContain("openai/c");
    expect(new Set(result.orderedModelIds)).toEqual(new Set(["openai/a", "openai/b"]));
  });
});
