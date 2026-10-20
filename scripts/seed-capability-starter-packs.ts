#!/usr/bin/env node
/**
 * Seed official capability packs into the governance registry and grant
 * default pack entitlements to tenants.
 *
 * Usage:
 *   pnpm exec tsx scripts/seed-capability-starter-packs.ts
 *   pnpm exec tsx scripts/seed-capability-starter-packs.ts --demote-non-pack
 *   pnpm exec tsx scripts/seed-capability-starter-packs.ts --packs=starter,cn-office
 *   pnpm exec tsx scripts/seed-capability-starter-packs.ts --grant-tenants=001,acme-trial
 *   pnpm exec tsx scripts/seed-capability-starter-packs.ts --grant-all-enterprises
 *   pnpm exec tsx scripts/seed-capability-starter-packs.ts --dry-run
 */

import fs from "node:fs";
import path from "node:path";
import {
  seedOfficialCapabilityPacks,
  seedTenantPackEntitlements,
} from "../src/gateway/capability-packs/seed-registry.js";
import {
  ALL_CAPABILITY_PACKS,
  resolveAutoEntitlePackIds,
} from "../src/gateway/capability-packs/starter-packs.js";
import { CONFIG_DIR } from "../src/utils.js";

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() || null : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function loadEnterpriseIdsFromPlatformAuth(): Array<{ id: string; plan?: string }> {
  const candidates = [
    path.join(CONFIG_DIR, "openbot-platform-auth.json"),
    path.join(CONFIG_DIR, "platform-auth.json"),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) {
        continue;
      }
      const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as {
        enterprises?: Record<string, { id?: string; plan?: string }>;
      };
      const enterprises = raw.enterprises ?? {};
      return Object.entries(enterprises).map(([fallbackId, entry]) => ({
        id: (typeof entry.id === "string" && entry.id.trim() ? entry.id : fallbackId).trim(),
        plan: typeof entry.plan === "string" ? entry.plan : undefined,
      }));
    } catch {
      /* try next */
    }
  }
  return [];
}

const dryRun = hasFlag("dry-run");
const demoteNonPack = hasFlag("demote-non-pack");
const grantAll = hasFlag("grant-all-enterprises");
const packsArg = argValue("packs");
const grantTenantsArg = argValue("grant-tenants");
const planArg = argValue("plan");
const skillsRootArg = argValue("skills-root");

const packIds = packsArg
  ? packsArg
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : ["starter", "cn-office"];

console.log(`[capability-packs] CONFIG_DIR=${CONFIG_DIR}`);
console.log(`[capability-packs] packs=${packIds.join(",")}`);
console.log(`[capability-packs] demoteNonPack=${demoteNonPack} dryRun=${dryRun}`);

if (dryRun) {
  for (const id of packIds) {
    const pack = ALL_CAPABILITY_PACKS.find((p) => p.id === id);
    if (!pack) {
      console.log(`  unknown pack: ${id}`);
      continue;
    }
    console.log(`  pack ${pack.id} (${pack.titleZh}): ${pack.skills.length} skills`);
    for (const skill of pack.skills) {
      console.log(`    - ${skill.skillKey}`);
    }
  }
  const auto = resolveAutoEntitlePackIds(planArg ?? "trial");
  console.log(`[dry-run] auto-entitle for plan=${planArg ?? "trial"}: ${auto.join(",")}`);
  process.exit(0);
}

const result = seedOfficialCapabilityPacks({
  packIds,
  demoteNonPack,
  skillsRoot: skillsRootArg ?? path.resolve(process.cwd(), "skills"),
  updatedBy: "seed-capability-starter-packs",
});

console.log(
  `[capability-packs] registry: registered=${result.registered} updated=${result.updated} demoted=${result.demoted}`,
);
console.log(`[capability-packs] skillKeys=${result.skillKeys.length}`);

const tenantIds: string[] = [];
if (grantTenantsArg) {
  tenantIds.push(
    ...grantTenantsArg
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
if (grantAll) {
  for (const enterprise of loadEnterpriseIdsFromPlatformAuth()) {
    if (enterprise.id && !tenantIds.includes(enterprise.id)) {
      tenantIds.push(enterprise.id);
    }
  }
}
// Always ensure demo tenant 001 if present in auth or explicitly requested via grant-all
if (grantAll || tenantIds.length > 0) {
  const enterprises = loadEnterpriseIdsFromPlatformAuth();
  for (const tenantId of tenantIds.length > 0 ? tenantIds : enterprises.map((e) => e.id)) {
    const enterprise = enterprises.find((e) => e.id === tenantId);
    const plan = planArg ?? enterprise?.plan ?? "trial";
    const grant = seedTenantPackEntitlements({
      tenantIds: [tenantId],
      plan,
      packIds,
    });
    console.log(
      `[capability-packs] entitled tenant=${tenantId} plan=${plan} packs=${packIds.join(",")}`,
    );
    void grant;
  }
} else {
  console.log(
    "[capability-packs] no tenant grants (pass --grant-tenants=ID or --grant-all-enterprises)",
  );
}

console.log("[capability-packs] done");
