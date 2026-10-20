/**
 * Floor Runtime v2.1 P0.0a — offline migration of collaboration runtime facts
 * (rounds + ledger) into the tenant runtime namespace `<groupLocator>/runtime`.
 *
 * Usage (dry-run is the default; nothing is written):
 *   node --import tsx scripts/migrate-collab-runtime-namespace.ts [options]
 *
 * Options:
 *   --source-root <dir>         legacy groups root (default: live collaboration groups root
 *                               from config, e.g. ~/.openbot/collaboration/groups)
 *   --profile <p>               managed_enterprise (default) | personal_local
 *   --tenants-root <dir>        managed_enterprise target (default: OPENBOT_TENANTS_ROOT or
 *                               <CONFIG_DIR>/tenants)
 *   --target-groups-root <dir>  personal_local target (default: live collaboration groups root)
 *   --tenant-map <file.json>    {"<groupId>": "<tenantId>"} operator decisions (win over inference)
 *   --group <groupId>           restrict to a group (repeatable)
 *   --reverse                   sync <ns> back to the legacy root (rollback; incremental)
 *   --apply                     perform the copy (requires --confirm-write-freeze)
 *   --confirm-write-freeze      operator confirms collaboration.runtimeWriteFreeze=true and
 *                               the gateway is quiesced for the maintenance window
 *   --allow-quarantine          apply even though some groups are quarantined (N2: each
 *                               quarantine entry needs a signed disposition first)
 *   --report <file>             write the JSON report there (default: stdout)
 *   --run-id <id>               stable run id (default: ns-migrate-<epochMs>)
 *
 * Groups with no inferable tenant are assigned tenant "001" (Owner decision 2026-10-05,
 * audit reason `owner-default-tenant-001`). Exit codes: 0 ok, 2 conflict / verify
 * failure / failed group, 3 refused (quarantine or missing freeze confirmation).
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config/config.js";
import {
  MIGRATION_APPLY_REFUSED_EXIT,
  runRuntimeNamespaceMigration,
  runtimeNamespaceMigrationApplyRefusal,
} from "../src/gateway/collaboration-dispatch/runtime-namespace-migration.js";
import type { MigrationTarget } from "../src/gateway/collaboration-dispatch/runtime-namespace-migration.js";
import { createWorkspaceCollaborationStores } from "../src/gateway/collaboration-learning/shared.js";
import { resolveTenantsRoot } from "../src/gateway/tenant-store-paths.js";
import { resolveTrustedCollaborationGroupsRoot } from "../src/gateway/workspace/group-locator.js";
import { resolveUserPath } from "../src/utils.js";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1]?.trim() || null;
}

function readArgs(name: string): string[] {
  return process.argv.flatMap((arg, i) =>
    arg === name && process.argv[i + 1] ? [process.argv[i + 1]] : [],
  );
}

const hasFlag = (name: string) => process.argv.includes(name);

async function main(): Promise<number> {
  const cfg = loadConfig();
  const profile = (readArg("--profile") ?? "managed_enterprise") as MigrationTarget["profile"];
  if (profile !== "managed_enterprise" && profile !== "personal_local") {
    throw new Error("--profile must be managed_enterprise or personal_local");
  }
  const sourceGroupsRoot = path.resolve(
    resolveUserPath(
      readArg("--source-root") ?? createWorkspaceCollaborationStores(cfg).groupRootDir,
    ),
  );
  const target: MigrationTarget =
    profile === "managed_enterprise"
      ? {
          profile,
          tenantsRoot: path.resolve(
            resolveUserPath(readArg("--tenants-root") ?? resolveTenantsRoot()),
          ),
        }
      : {
          profile,
          groupsRoot: path.resolve(
            resolveUserPath(
              readArg("--target-groups-root") ??
                resolveTrustedCollaborationGroupsRoot({ profile: "personal_local", cfg }),
            ),
          ),
        };
  const tenantMapPath = readArg("--tenant-map");
  const tenantMap = tenantMapPath
    ? (JSON.parse(fs.readFileSync(resolveUserPath(tenantMapPath), "utf8")) as Record<
        string,
        string
      >)
    : undefined;
  const apply = hasFlag("--apply");
  const base = {
    sourceGroupsRoot,
    target,
    direction: hasFlag("--reverse") ? ("reverse" as const) : ("forward" as const),
    tenantMap,
    groupIds: readArgs("--group"),
    runId: readArg("--run-id") ?? undefined,
  };
  const emit = (value: unknown) => {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    const reportPath = readArg("--report");
    if (reportPath) {
      fs.writeFileSync(resolveUserPath(reportPath), text);
      process.stderr.write(`report written to ${reportPath}\n`);
    } else {
      process.stdout.write(text);
    }
  };

  if (apply) {
    const refusal = runtimeNamespaceMigrationApplyRefusal(hasFlag("--confirm-write-freeze"));
    if (refusal) {
      process.stderr.write(`${refusal}\n`);
      return MIGRATION_APPLY_REFUSED_EXIT;
    }
    if (cfg.collaboration?.runtimeWriteFreeze !== true) {
      process.stderr.write(
        "warning: collaboration.runtimeWriteFreeze is not true in the loaded config; make sure the live gateway is frozen\n",
      );
    }
    const preview = await runRuntimeNamespaceMigration({ ...base, apply: false });
    if (preview.totals.quarantined > 0 && !hasFlag("--allow-quarantine")) {
      emit(preview);
      process.stderr.write(
        `refused: ${preview.totals.quarantined} quarantined group(s); record a signed disposition (tenant-map) or pass --allow-quarantine\n`,
      );
      return 3;
    }
  }
  const report = await runRuntimeNamespaceMigration({ ...base, apply });
  emit(report);
  const t = report.totals;
  process.stderr.write(
    `${report.mode} ${report.direction}: groups=${t.groups} planned=${t.planned} migrated=${t.migrated} unchanged=${t.unchanged} quarantined=${t.quarantined} failed=${t.failed} files=${t.files} verified=${t.verified} conflicts=${t.conflicts} nonTerminalRounds=${t.nonTerminalRounds} ownerDefaultTenant001=${t.ownerDefaultTenant001}\n`,
  );
  return t.failed > 0 || t.conflicts > 0 || t.verifyFailures > 0 ? 2 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`migrate-collab-runtime-namespace failed: ${String(error)}\n`);
    process.exitCode = 1;
  },
);
