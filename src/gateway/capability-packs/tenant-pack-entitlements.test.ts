import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-pack-ent-${Date.now()}`);
vi.mock("../../utils.js", () => ({ CONFIG_DIR: tmpDir }));

const {
  entitleTenantForPlan,
  getTenantPackEntitlement,
  grantTenantPacks,
  isSkillKeyEntitledForTenant,
  resolveEntitledSkillKeys,
} = await import("./tenant-pack-entitlements.js");

describe("tenant pack entitlements", () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const gov = path.join(tmpDir, "governance");
    if (fs.existsSync(gov)) {
      fs.rmSync(gov, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("entitles trial tenants with starter + cn-office", () => {
    const record = entitleTenantForPlan({ tenantId: "001", plan: "trial" });
    expect(record.packIds).toEqual(["starter", "cn-office"]);
    expect(getTenantPackEntitlement("001")?.packIds).toEqual(["starter", "cn-office"]);
  });

  it("resolveEntitledSkillKeys includes summarize and feishu", () => {
    entitleTenantForPlan({ tenantId: "t1", plan: "trial" });
    const keys = resolveEntitledSkillKeys("t1");
    expect(keys.has("summarize")).toBe(true);
    expect(keys.has("feishu-integration")).toBe(true);
    expect(keys.has("apple-notes")).toBe(false);
  });

  it("falls back to default packs when tenant has no row", () => {
    const keys = resolveEntitledSkillKeys("missing-tenant");
    expect(keys.has("summarize")).toBe(true);
    expect(keys.has("meeting-notes-specialist")).toBe(true);
  });

  it("allows non-pack contribution skills", () => {
    entitleTenantForPlan({ tenantId: "t2", plan: "trial" });
    expect(
      isSkillKeyEntitledForTenant({
        tenantId: "t2",
        skillKey: "my-custom-enterprise-skill",
        allowNonPackSkills: true,
      }),
    ).toBe(true);
    expect(
      isSkillKeyEntitledForTenant({
        tenantId: "t2",
        skillKey: "apple-notes",
        allowNonPackSkills: true,
      }),
    ).toBe(false);
  });

  it("merges pack grants", () => {
    grantTenantPacks({ tenantId: "t3", packIds: ["starter"], source: "manual" });
    grantTenantPacks({
      tenantId: "t3",
      packIds: ["channels"],
      source: "manual",
      merge: true,
    });
    expect(getTenantPackEntitlement("t3")?.packIds).toEqual(["starter", "channels"]);
  });
});
