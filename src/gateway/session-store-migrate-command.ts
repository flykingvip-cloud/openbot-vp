import { resolveStateDir } from "../config/paths.js";
import type { RuntimeEnv } from "../runtime.js";
import { migrateLegacyTenantSessionStores } from "./session-store-migrate.js";
import { resolveTenantsRoot } from "./tenant-store-paths.js";

export type SessionsMigrateLegacyStoresOptions = {
  stateDir?: string;
  tenantsRoot?: string;
  dryRun?: boolean;
  json?: boolean;
};

function formatReport(
  report: Awaited<ReturnType<typeof migrateLegacyTenantSessionStores>>,
): string {
  const lines = [
    `Session store migration (${report.dryRun ? "dry-run" : "applied"})`,
    `state dir: ${report.stateDir}`,
    `tenants root: ${report.tenantsRoot}`,
    `legacy stores: ${report.legacyStoreCount}`,
    `sessions seen: ${report.sessionCount}`,
    `merged from legacy: ${report.mergedFromLegacy}`,
    `ownership stamped: ${report.ownershipStamped}`,
    `unchanged: ${report.unchanged}`,
    `skipped group-public: ${report.skippedGroupPublic}`,
    `legacy stores retained: ${report.legacyStoresRetained}`,
    `legacy transcripts retained: ${report.legacyTranscriptsRetained}`,
    "legacy files deleted: no (left readable)",
    "legacy session writes: stopped (bot path is the only write target)",
  ];
  if (report.errors.length > 0) {
    lines.push(`errors: ${report.errors.length}`);
    for (const error of report.errors) {
      lines.push(`- ${error}`);
    }
  }
  return lines.join("\n");
}

/**
 * Merge tenants/<tid>/users/<uid>/state/agents/<bot>/sessions into
 * <stateDir>/agents/<bot>/sessions. Does not delete legacy files and does not push.
 */
export async function sessionsMigrateLegacyStoresCommand(
  opts: SessionsMigrateLegacyStoresOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const report = await migrateLegacyTenantSessionStores({
    stateDir: opts.stateDir?.trim() || resolveStateDir(),
    tenantsRoot: opts.tenantsRoot?.trim() || resolveTenantsRoot(),
    dryRun: opts.dryRun,
  });
  if (opts.json) {
    runtime.log(JSON.stringify(report, null, 2));
  } else {
    runtime.log(formatReport(report));
  }
  if (report.errors.length > 0) {
    runtime.exit(1);
  }
}
