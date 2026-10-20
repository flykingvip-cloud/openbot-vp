#!/usr/bin/env node
/**
 * Backfills canonical AgentAssets for enterprise agents that predate the Registry.
 *
 * Dry run by default: it prints the plan and writes nothing. Pass `--apply` to persist
 * the registry. The operation is idempotent, so re-running after `--apply` reports
 * `already-present` rather than creating duplicates.
 *
 * Usage:
 *   node --import tsx scripts/agent-registry-backfill.ts [--apply] [--tenant <id>] [--json]
 *
 * Task: shared-agent-identity-access-control-plane
 */

import { loadConfig } from "../src/config/config.js";
import {
  applyAgentRegistryBackfill,
  selectBackfillCandidates,
} from "../src/gateway/agent-registry/backfill.js";
import {
  loadAgentRegistryStore,
  saveAgentRegistryStore,
} from "../src/gateway/agent-registry/store.js";
import { listOwnershipRecords } from "../src/gateway/ownership-store.js";

function readFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function displayNameLookup(): (agentId: string) => string | undefined {
  const entries = loadConfig().agents?.list ?? [];
  const byId = new Map<string, string>();
  for (const entry of entries) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    if (id && name) {
      byId.set(id, name);
    }
  }
  return (agentId) => byId.get(agentId);
}

async function main(): Promise<void> {
  const apply = readFlag("--apply");
  const tenantFilter = readOption("--tenant")?.trim();
  const asJson = readFlag("--json");

  let candidates = selectBackfillCandidates(listOwnershipRecords(), displayNameLookup());
  if (tenantFilter) {
    candidates = candidates.filter((entry) => entry.tenantId === tenantFilter);
  }

  const store = await loadAgentRegistryStore();
  const report = applyAgentRegistryBackfill({
    store,
    agents: candidates,
    nowIso: new Date().toISOString(),
  });

  if (apply) {
    await saveAgentRegistryStore(store);
  }

  if (asJson) {
    console.log(JSON.stringify({ apply, candidates: candidates.length, ...report }, null, 2));
    return;
  }

  console.log(`${apply ? "Applied" : "Dry run"}: ${candidates.length} candidate(s)`);
  for (const [action, count] of Object.entries(report.counts)) {
    if (count > 0) {
      console.log(`  ${action}: ${count}`);
    }
  }
  // Only the outcomes that need a human decision are listed individually.
  for (const entry of report.actions) {
    if (entry.action === "quarantined" || entry.action === "slug-conflict") {
      console.log(`  ! ${entry.action} ${entry.tenantId}/${entry.legacyAgentId}`);
    }
  }
  if (!apply) {
    console.log("Nothing was written. Re-run with --apply to persist.");
  }
}

await main();
