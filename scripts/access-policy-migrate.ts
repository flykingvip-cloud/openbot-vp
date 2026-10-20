#!/usr/bin/env node
/**
 * Migrates v1 enterprise access policies to EnterpriseAccessPolicyV2.
 *
 * Dry run by default: it prints what would carry over and, more importantly, the rows
 * that need a human decision. Pass `--apply` to persist. Policy ids are derived from
 * the source policy id, so re-applying updates in place instead of duplicating grants.
 *
 * A tenant is only ready for `OPENBOT_ACCESS_CONTROL_MODE=enforce` once its backfill
 * has been applied and this report has no rows left under "needs decision".
 *
 * Usage:
 *   node --import tsx scripts/access-policy-migrate.ts [--apply] [--tenant <id>] [--json]
 *
 * Task: shared-agent-identity-access-control-plane
 */

import { loadConfig } from "../src/config/config.js";
import { migrateTenantPolicies } from "../src/gateway/access-control/migration-runner.js";
import {
  loadAccessPolicyStore,
  saveAccessPolicyStore,
  upsertAccessPolicies,
} from "../src/gateway/access-control/policy-store.js";
import type { LegacyAccessPolicyV1 } from "../src/gateway/access-control/policy-v1-adapter.js";
import { loadAgentRegistryStore } from "../src/gateway/agent-registry/store.js";
import { loadEnterpriseSeatAssetsStore } from "../src/gateway/enterprise-seat-assets-store.js";
import { loadPlatformAuthStore, resolvePlatformAuthConfig } from "../src/gateway/platform-auth.js";

function readFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const apply = readFlag("--apply");
  const tenantFilter = readOption("--tenant")?.trim();
  const asJson = readFlag("--json");
  const nowIso = new Date().toISOString();

  const authConfig = resolvePlatformAuthConfig(loadConfig().gateway?.auth?.trustedProxy);
  if (!authConfig?.enabled && apply) {
    // Without the platform store, every v1 `employee` row would be skipped as
    // membership-unresolved, so applying would silently drop half the grants.
    console.error(
      "Platform auth is not configured; refusing --apply because v1 employee subjects cannot be bound to memberships.",
    );
    process.exitCode = 1;
    return;
  }
  // A dry run still works without platform auth: it inventories the v1 set and reports
  // employee rows as needing a decision, which is exactly what an operator must see.
  const platformStore = authConfig?.enabled
    ? await loadPlatformAuthStore(authConfig)
    : { memberships: {} };
  const seatStore = await loadEnterpriseSeatAssetsStore();
  const registry = await loadAgentRegistryStore();
  const policyStore = await loadAccessPolicyStore();

  const legacyPolicies = Object.values(seatStore.accessPolicies ?? {}) as LegacyAccessPolicyV1[];
  const tenantIds = [
    ...new Set(
      legacyPolicies
        .map((policy) => policy.tenantId)
        .filter((tenantId): tenantId is string => Boolean(tenantId))
        .filter((tenantId) => !tenantFilter || tenantId === tenantFilter),
    ),
  ].toSorted();

  const reports = tenantIds.map((enterpriseId) =>
    migrateTenantPolicies({
      enterpriseId,
      policies: legacyPolicies,
      registry,
      platformStore,
      nowIso,
    }),
  );

  if (apply) {
    for (const report of reports) {
      upsertAccessPolicies(policyStore, report.result.migrated);
    }
    await saveAccessPolicyStore(policyStore);
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          apply,
          tenants: reports.map((report) => ({
            enterpriseId: report.enterpriseId,
            migrated: report.migrated,
            skipped: report.skipped,
            needsDecision: report.needsDecision,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    `${apply ? "Applied" : "Dry run"}: ${tenantIds.length} tenant(s), ${legacyPolicies.length} v1 policy row(s)` +
      (authConfig?.enabled ? "" : " (platform auth not configured: employee rows cannot bind)"),
  );
  for (const report of reports) {
    console.log(`\n${report.enterpriseId}: migrated=${report.migrated}`);
    for (const reason of Object.keys(report.skipped) as (keyof typeof report.skipped)[]) {
      const count = report.skipped[reason];
      if (count > 0) {
        console.log(`  skipped ${String(reason)}: ${count}`);
      }
    }
    for (const entry of report.needsDecision) {
      const detail: string = typeof entry.detail === "string" ? entry.detail : "-";
      console.log(`  ! needs decision ${entry.reason} policy=${entry.policyId} ${detail}`);
    }
    if (report.needsDecision.length === 0) {
      console.log("  no rows need a decision; this tenant can be considered for enforce");
    }
  }
  if (!apply) {
    console.log("\nNothing was written. Re-run with --apply to persist.");
  }
}

await main();
