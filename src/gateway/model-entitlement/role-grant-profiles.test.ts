import { describe, expect, it } from "vitest";
import type { ResourceModelCatalogEntry } from "../resource-catalog/types.js";
import {
  listRoleGrantProfiles,
  resolveEnterpriseTierCeiling,
  resolveRoleGrantProfile,
  ROLE_TIER_PRESETS,
} from "./role-grant-profiles.js";

const CATALOG: ResourceModelCatalogEntry[] = [
  {
    modelId: "p/a",
    provider: "p",
    displayName: "A",
    tier: "tier_a",
    enabled: true,
    inputCostPer1MCents: 100,
    outputCostPer1MCents: 200,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    modelId: "p/b",
    provider: "p",
    displayName: "B",
    tier: "tier_b",
    enabled: true,
    inputCostPer1MCents: 500,
    outputCostPer1MCents: 800,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    modelId: "p/c",
    provider: "p",
    displayName: "C",
    tier: "tier_c",
    enabled: true,
    inputCostPer1MCents: 2000,
    outputCostPer1MCents: 3000,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

const ENTITLED = ["p/a", "p/b", "p/c"];

describe("role-grant-profiles", () => {
  it("ROLE_TIER_PRESETS maps viewer to tier_a only", () => {
    expect(ROLE_TIER_PRESETS.viewer).toEqual(["tier_a"]);
    expect(ROLE_TIER_PRESETS.creator).toContain("tier_b");
    expect(ROLE_TIER_PRESETS.admin).toContain("tier_c");
  });

  it("resolveEnterpriseTierCeiling prefers explicit allowedTiers", () => {
    expect(
      resolveEnterpriseTierCeiling({
        enterpriseAllowedModelIds: ENTITLED,
        enterpriseAllowedTiers: ["tier_a", "tier_b"],
        catalog: CATALOG,
      }),
    ).toEqual(["tier_a", "tier_b"]);
  });

  it("viewer profile grants only tier_a models within ceiling", () => {
    const profile = resolveRoleGrantProfile({
      role: "viewer",
      enterpriseAllowedModelIds: ENTITLED,
      enterpriseAllowedTiers: ["tier_a", "tier_b", "tier_c"],
      catalog: CATALOG,
    });
    expect(profile.modelIds).toEqual(["p/a"]);
    expect(profile.tierIds).toEqual(["tier_a"]);
  });

  it("creator profile grants tier_a and tier_b", () => {
    const profile = resolveRoleGrantProfile({
      role: "creator",
      enterpriseAllowedModelIds: ENTITLED,
      enterpriseAllowedTiers: ["tier_a", "tier_b", "tier_c"],
      catalog: CATALOG,
    });
    expect(profile.modelIds).toEqual(["p/a", "p/b"]);
  });

  it("admin profile grants all entitled tiers", () => {
    const profile = resolveRoleGrantProfile({
      role: "admin",
      enterpriseAllowedModelIds: ENTITLED,
      enterpriseAllowedTiers: ["tier_a", "tier_b", "tier_c"],
      catalog: CATALOG,
    });
    expect(profile.modelIds).toEqual(["p/a", "p/b", "p/c"]);
  });

  it("caps role preset when enterprise ceiling is lower (Starter-like)", () => {
    const profiles = listRoleGrantProfiles({
      enterpriseAllowedModelIds: ["p/a"],
      enterpriseAllowedTiers: ["tier_a"],
      catalog: CATALOG,
    });
    expect(profiles.find((p) => p.role === "admin")?.modelIds).toEqual(["p/a"]);
    expect(profiles.find((p) => p.role === "viewer")?.modelIds).toEqual(["p/a"]);
  });
});
