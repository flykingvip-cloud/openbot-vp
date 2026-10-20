/**
 * A/B/C starter-pack delivery smoke:
 * seed → registry visibility → tenant entitlement → platform-direct filter → bundled load.
 *
 * This is the automated gate for "全员直接可用 = starter pack skills" before cloud cutover.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-starter-pack-smoke-${Date.now()}`);
vi.mock("../../utils.js", () => ({ CONFIG_DIR: tmpDir }));

const { seedOfficialCapabilityPacks, seedTenantPackEntitlements } =
  await import("./seed-registry.js");
const { listRegistry, findRegistryEntryBySkillKey } =
  await import("../capability-governance-store.js");
const { PACK_STARTER, PACK_CN_OFFICE, buildOfficialManifestId } =
  await import("./starter-packs.js");
const { resolveEntitledSkillKeys } = await import("./tenant-pack-entitlements.js");
const { parseFrontmatter } = await import("../../agents/skills/frontmatter.js");

/** Mirrors listPlatformDirectCapabilityEntries filter without seat/auth wiring. */
function listPlatformDirectSkillKeys(tenantId: string): string[] {
  return listRegistry()
    .filter((entry) => {
      if (entry.lifecycleState !== "active") {
        return false;
      }
      if (entry.distribution.employeeVisibilityMode !== "direct_employee_visible") {
        return false;
      }
      const tenantIds = entry.distribution.scope.tenantIds;
      return !tenantIds || tenantIds.length === 0
        ? entry.distribution.defaultEnabled
        : tenantIds.includes(tenantId);
    })
    .map((entry) => entry.manifest.skillKey)
    .filter((key): key is string => Boolean(key?.trim()));
}

describe("starter pack delivery smoke (seed → registry → employee direct)", () => {
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

  it("seeds A/B packs with correct visibility and tenant entitlement", () => {
    const skillsRoot = path.resolve(process.cwd(), "skills");
    const seed = seedOfficialCapabilityPacks({
      packIds: ["starter", "cn-office"],
      skillsRoot,
      demoteNonPack: false,
      updatedBy: "starter-pack-smoke",
    });

    expect(seed.packs).toEqual(["starter", "cn-office"]);
    expect(seed.skillKeys).toHaveLength(PACK_STARTER.skills.length + PACK_CN_OFFICE.skills.length);

    for (const skill of PACK_STARTER.skills) {
      const entry = findRegistryEntryBySkillKey(skill.skillKey);
      expect(entry, `missing registry entry for starter ${skill.skillKey}`).toBeTruthy();
      expect(entry!.lifecycleState).toBe("active");
      expect(entry!.distribution.defaultEnabled).toBe(true);
      expect(entry!.distribution.employeeVisibilityMode).toBe("direct_employee_visible");
      expect(entry!.manifest.id).toBe(buildOfficialManifestId(skill.skillKey));
      expect(fs.existsSync(path.join(skillsRoot, skill.skillKey, "SKILL.md"))).toBe(true);
    }

    for (const skill of PACK_CN_OFFICE.skills) {
      const entry = findRegistryEntryBySkillKey(skill.skillKey);
      expect(entry, `missing registry entry for cn-office ${skill.skillKey}`).toBeTruthy();
      expect(entry!.distribution.employeeVisibilityMode).toBe("enterprise_review_required");
      expect(entry!.distribution.defaultEnabled).toBe(true);
    }

    const entitle = seedTenantPackEntitlements({
      tenantIds: ["smoke-tenant"],
      plan: "trial",
    });
    expect(entitle.granted).toBe(1);

    const entitled = resolveEntitledSkillKeys("smoke-tenant");
    for (const skill of PACK_STARTER.skills) {
      expect(entitled.has(skill.skillKey), `not entitled: ${skill.skillKey}`).toBe(true);
    }
    expect(entitled.has("feishu-integration")).toBe(true);
    expect(entitled.has("apple-notes")).toBe(false);
    expect(entitled.has("trial-sales-conversion")).toBe(false);
  });

  it("exposes only starter skills as platform-direct for employees", () => {
    seedOfficialCapabilityPacks({
      packIds: ["starter", "cn-office"],
      skillsRoot: path.resolve(process.cwd(), "skills"),
      updatedBy: "starter-pack-smoke",
    });
    seedTenantPackEntitlements({ tenantIds: ["smoke-tenant"], plan: "trial" });

    const direct = new Set(listPlatformDirectSkillKeys("smoke-tenant"));
    expect(direct.size).toBe(PACK_STARTER.skills.length);

    for (const skill of PACK_STARTER.skills) {
      expect(direct.has(skill.skillKey), `not platform-direct: ${skill.skillKey}`).toBe(true);
    }
    for (const skill of PACK_CN_OFFICE.skills) {
      expect(
        direct.has(skill.skillKey),
        `cn-office leaked to platform-direct: ${skill.skillKey}`,
      ).toBe(false);
    }
  });

  it("keeps every starter SKILL.md parseable (no BOM / name mismatch)", () => {
    const skillsRoot = path.resolve(process.cwd(), "skills");
    for (const skill of PACK_STARTER.skills) {
      const skillMd = path.join(skillsRoot, skill.skillKey, "SKILL.md");
      expect(fs.existsSync(skillMd), `missing ${skill.skillKey}/SKILL.md`).toBe(true);
      const raw = fs.readFileSync(skillMd, "utf-8");
      expect(raw.charCodeAt(0) === 0xfeff, `${skill.skillKey} has UTF-8 BOM`).toBe(false);
      const fm = parseFrontmatter(raw);
      expect(fm.name, `${skill.skillKey} missing frontmatter name`).toBe(skill.skillKey);
      expect(
        (fm.description ?? "").trim().length,
        `${skill.skillKey} empty description`,
      ).toBeGreaterThan(0);
    }
  });
});
