// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compareTierProjectionWithModelIds, resolveModelsFromTiers } from "./resolve.js";
import type { ResourceModelCatalogEntry } from "./types.js";

const catalog: ResourceModelCatalogEntry[] = [
  {
    modelId: "p/a",
    provider: "p",
    displayName: "A",
    tier: "tier_a",
    enabled: true,
    inputCostPer1MCents: 10,
    outputCostPer1MCents: 20,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    modelId: "p/b",
    provider: "p",
    displayName: "B",
    tier: "tier_b",
    enabled: true,
    inputCostPer1MCents: 100,
    outputCostPer1MCents: 200,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    modelId: "p/c-disabled",
    provider: "p",
    displayName: "C",
    tier: "tier_c",
    enabled: false,
    inputCostPer1MCents: 0,
    outputCostPer1MCents: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("resolveModelsFromTiers", () => {
  it("returns enabled models for allowed tiers only", () => {
    const pool = resolveModelsFromTiers({
      allowedTierIds: ["tier_a", "tier_b", "tier_c"],
      catalog,
    });
    expect(pool.modelIds).toEqual(["p/a", "p/b"]);
    expect(pool.byTier.tier_a).toEqual(["p/a"]);
    expect(pool.byTier.tier_b).toEqual(["p/b"]);
  });

  it("compareTierProjection detects mismatch", () => {
    const cmp = compareTierProjectionWithModelIds({
      allowedTierIds: ["tier_a"],
      allowedModelIds: ["p/a", "p/b"],
      catalog,
    });
    expect(cmp.aligned).toBe(false);
    expect(cmp.missingFromProjection).toEqual(["p/b"]);
    expect(cmp.extraInProjection).toEqual([]);
  });
});
