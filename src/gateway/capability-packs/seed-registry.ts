/**
 * Seed official capability packs into the governance registry and optionally
 * demote non-pack registry entries so SaaS tenants are not flooded with Mac CLIs.
 */

import fs from "node:fs";
import path from "node:path";
import {
  findRegistryEntryBySkillKey,
  listRegistry,
  registerCapability,
  updateRegistryDistribution,
  type GovernanceManifest,
} from "../capability-governance-store.js";
import {
  ALL_CAPABILITY_PACKS,
  buildPackManifest,
  legacyManifestId,
  type CapabilityPackDef,
  type PackSkillDef,
} from "./starter-packs.js";
import { entitleTenantForPlan, grantTenantPacks } from "./tenant-pack-entitlements.js";

export type SeedPacksResult = {
  registered: number;
  updated: number;
  demoted: number;
  packs: string[];
  skillKeys: string[];
};

function parseFrontmatter(text: string): { name?: string; description?: string } {
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!normalized.startsWith("---")) {
    return {};
  }
  const parts = normalized.split("---", 3);
  if (parts.length < 3) {
    return {};
  }
  const meta: Record<string, string> = {};
  for (const line of parts[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line
      .slice(idx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key && value) {
      meta[key] = value;
    }
  }
  return {
    ...(meta.name ? { name: meta.name } : {}),
    ...(meta.description ? { description: meta.description } : {}),
  };
}

function enrichSkillFromDisk(skill: PackSkillDef, skillsRoot: string | null): PackSkillDef {
  if (!skillsRoot) {
    return skill;
  }
  const skillMd = path.join(skillsRoot, skill.skillKey, "SKILL.md");
  try {
    if (!fs.existsSync(skillMd)) {
      return skill;
    }
    const meta = parseFrontmatter(fs.readFileSync(skillMd, "utf-8").slice(0, 4000));
    return {
      ...skill,
      name: skill.name || meta.name || skill.skillKey,
      description: skill.description || meta.description,
    };
  } catch {
    return skill;
  }
}

function toGovernanceManifest(skill: PackSkillDef, pack: CapabilityPackDef): GovernanceManifest {
  const built = buildPackManifest({ skill, pack });
  return {
    id: built.id,
    kind: built.kind,
    version: built.version,
    skillKey: built.skillKey,
    name: built.name,
    description: built.description,
    ...(built.categoryId ? { categoryId: built.categoryId } : {}),
    packId: built.packId,
    source: built.source,
    risk: built.risk,
  };
}

/**
 * Register all (or selected) official packs into the governance registry.
 */
export function seedOfficialCapabilityPacks(opts?: {
  packIds?: string[];
  skillsRoot?: string | null;
  /** When true, set non-pack active entries to defaultEnabled=false + enterprise_only. */
  demoteNonPack?: boolean;
  /** Also retire deprecated local-dev noise (skill-creator etc.) when demoting. */
  retireDeprecatedLocal?: boolean;
  updatedBy?: string;
}): SeedPacksResult {
  const packFilter = opts?.packIds?.length ? new Set(opts.packIds) : null;
  const packs = ALL_CAPABILITY_PACKS.filter((pack) =>
    packFilter ? packFilter.has(pack.id) : pack.id === "starter" || pack.id === "cn-office",
  );
  // Default seed: starter + cn-office only (channels/local-dev/platform-ops on demand)
  const effectivePacks =
    packs.length > 0
      ? packs
      : ALL_CAPABILITY_PACKS.filter((p) => p.id === "starter" || p.id === "cn-office");

  const skillsRoot =
    opts?.skillsRoot === undefined ? path.resolve(process.cwd(), "skills") : opts.skillsRoot;

  let registered = 0;
  let updated = 0;
  const skillKeys: string[] = [];
  const updatedBy = opts?.updatedBy ?? "seed-capability-starter-packs";

  for (const pack of effectivePacks) {
    for (const rawSkill of pack.skills) {
      const skill = enrichSkillFromDisk(rawSkill, skillsRoot);
      const baseManifest = toGovernanceManifest(skill, pack);
      skillKeys.push(skill.skillKey);

      const existingByKey = findRegistryEntryBySkillKey(skill.skillKey);
      const registry = listRegistry();
      const legacyId = legacyManifestId(skill.skillKey);
      const legacy =
        existingByKey ??
        registry.find((e) => e.manifest.id === legacyId || e.manifest.id === baseManifest.id) ??
        null;

      // Preserve existing manifest id when skillKey already registered (legacy openclaw URNs).
      const manifest: GovernanceManifest = legacy
        ? {
            ...baseManifest,
            id: legacy.manifest.id,
            version: legacy.manifest.version || baseManifest.version,
          }
        : baseManifest;

      registerCapability(manifest, legacy?.proposalId, {
        defaultEnabled: pack.defaultEnabled,
        employeeVisibilityMode: pack.employeeVisibilityMode,
        updatedBy,
        distributionScope: legacy?.distribution.scope ?? {},
      });
      if (legacy) {
        updated += 1;
      } else {
        registered += 1;
      }
    }
  }

  let demoted = 0;
  if (opts?.demoteNonPack) {
    const packSkillKeys = new Set(skillKeys);
    // Include all pack skills even if not in this seed run
    for (const pack of ALL_CAPABILITY_PACKS) {
      for (const skill of pack.skills) {
        packSkillKeys.add(skill.skillKey);
      }
    }
    for (const entry of listRegistry()) {
      const key = entry.manifest.skillKey?.trim();
      if (!key || packSkillKeys.has(key)) {
        continue;
      }
      if (entry.lifecycleState === "retired") {
        continue;
      }
      // Demote host-local / uncategorized noise
      if (
        !entry.distribution.defaultEnabled &&
        entry.distribution.employeeVisibilityMode === "enterprise_only"
      ) {
        continue;
      }
      updateRegistryDistribution(
        entry.manifest.id,
        entry.distribution.scope ?? {},
        false,
        "enterprise_only",
        updatedBy,
      );
      demoted += 1;
    }
  }

  return {
    registered,
    updated,
    demoted,
    packs: effectivePacks.map((p) => p.id),
    skillKeys: [...new Set(skillKeys)],
  };
}

export function seedTenantPackEntitlements(params: {
  tenantIds: string[];
  plan?: string;
  packIds?: string[];
}): { granted: number; tenantIds: string[] } {
  let granted = 0;
  for (const tenantId of params.tenantIds) {
    if (!tenantId.trim()) {
      continue;
    }
    if (params.packIds?.length) {
      grantTenantPacks({
        tenantId,
        packIds: params.packIds,
        plan: params.plan,
        source: "seed",
        merge: true,
      });
    } else {
      entitleTenantForPlan({
        tenantId,
        plan: params.plan ?? "trial",
        source: "seed",
      });
    }
    granted += 1;
  }
  return { granted, tenantIds: params.tenantIds.filter(Boolean) };
}
