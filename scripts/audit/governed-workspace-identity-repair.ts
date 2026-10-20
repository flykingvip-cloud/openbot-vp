#!/usr/bin/env node
/**
 * Diagnose and repair Managed Enterprise workspace identity for seat-granted agents.
 *
 * Typical failure: UI lists the bot (seat assets + growth status) but chat fails with
 * workspace_authorization_failed because Registry/Catalog were never minted for the
 * legacy agent slug (e.g. "fengshui" / 风水文化顾问).
 *
 * Usage:
 *   node --import tsx scripts/audit/governed-workspace-identity-repair.ts \
 *     --tenant <tenantId> [--agent <legacyAgentId>] [--apply] [--json] [--state-dir <path>]
 *
 * Environment (production):
 *   OPENBOT_PRODUCTION_STATE_DIR  — tenant data root when --state-dir omitted on gateway host
 *
 * Examples:
 *   # Dry-run all seat agents for tenant 001
 *   node --import tsx scripts/audit/governed-workspace-identity-repair.ts --tenant 001
 *
 *   # Diagnose one bot
 *   node --import tsx scripts/audit/governed-workspace-identity-repair.ts --tenant 001 --agent fengshui
 *
 *   # Apply registry + catalog repair
 *   node --import tsx scripts/audit/governed-workspace-identity-repair.ts --tenant 001 --agent fengshui --apply
 */

import { loadConfig } from "../../src/config/config.js";
import { resolveStateDir } from "../../src/config/paths.js";
import { resolveRegistryStorePathForStateDir } from "../../src/gateway/data-governance/phase1b-item5-deploy-production-target.js";
import {
  diagnoseAgentWorkspaceIdentity,
  runWorkspaceIdentityRepairPlan,
  type WorkspaceIdentityDiagnosis,
} from "../../src/gateway/data-governance/workspace-identity-repair.js";

function readFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function printDiagnosis(row: WorkspaceIdentityDiagnosis): void {
  const name = row.displayName ? ` (${row.displayName})` : "";
  console.log(`- ${row.legacyAgentId}${name}: ${row.issue}`);
  console.log(`    ${row.detail}`);
  if (row.agentAssetId) {
    console.log(`    agentAssetId: ${row.agentAssetId}`);
  }
  if (row.seatId) {
    console.log(`    seatId: ${row.seatId}`);
  }
  if (row.userId) {
    console.log(`    userId: ${row.userId}`);
  }
  if (row.legacyWorkspacePath) {
    console.log(`    legacyWorkspacePath: ${row.legacyWorkspacePath}`);
  }
}

async function main(): Promise<void> {
  const tenantId = readOption("--tenant")?.trim();
  const agentFilter = readOption("--agent")?.trim();
  const apply = readFlag("--apply");
  const asJson = readFlag("--json");
  const stateDir =
    readOption("--state-dir")?.trim() ||
    process.env.OPENBOT_PRODUCTION_STATE_DIR?.trim() ||
    resolveStateDir(process.env);
  const registryStorePath = resolveRegistryStorePathForStateDir(stateDir);
  const cfg = loadConfig();

  if (!tenantId) {
    console.error("Missing required --tenant <tenantId>");
    process.exit(1);
  }

  if (agentFilter && !apply) {
    const diagnosis = await diagnoseAgentWorkspaceIdentity({
      tenantId,
      legacyAgentId: agentFilter,
      cfg,
      stateDir,
      registryStorePath,
    });
    if (asJson) {
      console.log(JSON.stringify({ apply: false, diagnosis }, null, 2));
      process.exit(diagnosis.issue === "catalog_ready" ? 0 : 1);
    }
    console.log(`Tenant: ${tenantId}`);
    console.log(`State dir: ${stateDir}`);
    printDiagnosis(diagnosis);
    console.log(
      diagnosis.issue === "catalog_ready"
        ? "\nOK — workspace identity is ready."
        : "\nAction required — re-run with --apply to repair (after reviewing dry-run output).",
    );
    process.exit(diagnosis.issue === "catalog_ready" ? 0 : 1);
  }

  const report = await runWorkspaceIdentityRepairPlan({
    tenantId,
    cfg,
    apply,
    agentFilter,
    stateDir,
    registryStorePath,
  });

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `${apply ? "Applied" : "Dry run"} workspace identity repair for tenant ${tenantId}`,
    );
    console.log(`State dir: ${stateDir}`);
    console.log(`Registry: ${registryStorePath}`);
    console.log(`Agents scanned: ${report.diagnoses.length}`);
    for (const row of report.diagnoses) {
      printDiagnosis(row);
    }
    if (report.actions.length > 0) {
      console.log("\nActions:");
      for (const action of report.actions) {
        console.log(`  ${action.action} ${action.legacyAgentId}`);
      }
    }
    if (!apply) {
      console.log("\nNothing was written. Re-run with --apply to persist repairs.");
    }
  }

  const allReady = report.diagnoses.every(
    (row) => row.issue === "catalog_ready" || row.issue === "builtin_universal",
  );
  process.exit(allReady ? 0 : 1);
}

await main();
