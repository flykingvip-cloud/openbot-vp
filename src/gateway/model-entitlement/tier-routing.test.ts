// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ResourceModelCatalogEntry } from "../resource-catalog/types.js";
import { resolveBindingAllowlist } from "./tier-routing.js";

const catalog: ResourceModelCatalogEntry[] = [
  {
    modelId: "p/a",
    provider: "p",
    displayName: "A",
    tier: "tier_a",
    enabled: true,
    inputCostPer1MCents: 0,
    outputCostPer1MCents: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    modelId: "p/b",
    provider: "p",
    displayName: "B",
    tier: "tier_b",
    enabled: true,
    inputCostPer1MCents: 0,
    outputCostPer1MCents: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("resolveBindingAllowlist", () => {
  it("uses allowedModelIds in legacy mode", () => {
    const res = resolveBindingAllowlist({
      routingMode: "legacy",
      allowedTiers: ["tier_a"],
      allowedModelIds: ["p/b"],
      catalog,
    });
    expect(res.source).toBe("models");
    expect(res.modelIds).toEqual(["p/b"]);
  });

  it("projects tiers in tier mode", () => {
    const res = resolveBindingAllowlist({
      routingMode: "tier",
      allowedTiers: ["tier_a"],
      allowedModelIds: ["p/b"],
      catalog,
    });
    expect(res.source).toBe("tier");
    expect(res.modelIds).toEqual(["p/a"]);
  });
});
