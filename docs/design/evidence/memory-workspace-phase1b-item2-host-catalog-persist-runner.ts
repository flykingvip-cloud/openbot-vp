#!/usr/bin/env bun
/**
 * Phase 1B item 2/5: merge classified authority rows into the host runtime
 * Catalog (`~/.openbot/data-governance/catalog.json`) using an in-memory
 * unredacted dump. Requires OPENBOT_PHASE1B_RUNTIME_CATALOG_HOST_WRITE=1.
 * Does not write unredacted identifiers into git.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isUniversalBuiltinAgentId } from "../../../src/gateway/agent-registry/legacy-resolver.ts";
import { loadAgentRegistryStore } from "../../../src/gateway/agent-registry/store.ts";
import { persistClassifiedAuthorityRowsToRuntimeCatalog } from "../../../src/gateway/data-governance/phase1b-runtime-catalog-persist.ts";
import { resetSharedDataGovernanceCatalogForTests } from "../../../src/gateway/data-governance/runtime-catalog.ts";
import { loadExistingGovernedWorkspaceIdentity } from "../../../src/gateway/data-governance/workspace-catalog-projection.ts";
import { extractAuthorityCandidate } from "./memory-workspace-phase1b-authority-extract.mjs";
import {
  buildProductionAuthorityDump,
  collectLocalAuthorityStores,
} from "./memory-workspace-phase1b-production-authority-dump.mjs";

const DIR = path.dirname(import.meta.filename);
const MEASUREMENT = path.join(DIR, "memory-workspace-phase1b-item2-host-catalog-persist.json");
const HOST_STATE_DIR = path.join(os.homedir(), ".openbot");

if (process.env.OPENBOT_PHASE1B_RUNTIME_CATALOG_HOST_WRITE !== "1") {
  throw new Error("host_catalog_write_requires_OPENBOT_PHASE1B_RUNTIME_CATALOG_HOST_WRITE=1");
}

const dump = buildProductionAuthorityDump(collectLocalAuthorityStores(), { opaque: false });
if (dump.identifierPolicy !== "in-memory-unredacted" || dump.live) {
  throw new Error("unredacted_dump_required_for_host_merge");
}

const candidate = extractAuthorityCandidate(dump, { forbidAgentIdIdentity: true });
if (candidate.source === "rejected-inventory" || candidate.live) {
  throw new Error("authority_candidate_not_writable");
}

const occupancyMintedCount = (candidate.candidates ?? []).filter(
  (row) => row.ownerType === "occupancy",
).length;

resetSharedDataGovernanceCatalogForTests();
const persist = await persistClassifiedAuthorityRowsToRuntimeCatalog({
  stateDir: HOST_STATE_DIR,
  candidates: candidate.candidates ?? [],
  rejected: candidate.rejected ?? [],
  now: new Date().toISOString(),
  env: { ...process.env, OPENBOT_PHASE1B_RUNTIME_CATALOG_HOST_WRITE: "1" },
  skipExisting: true,
});

let liveLoaderHit = false;
const registry = await loadAgentRegistryStore();
for (const row of dump.seatOccupancies ?? []) {
  if (!row?.enterpriseId || !row?.userId) {
    continue;
  }
  const legacyIds = [
    ...new Set(
      Object.values(registry.assets ?? {})
        .filter(
          (asset) =>
            asset &&
            asset.enterpriseId === row.enterpriseId &&
            typeof asset.legacyAgentId === "string" &&
            asset.legacyAgentId.trim() &&
            !isUniversalBuiltinAgentId(asset.legacyAgentId),
        )
        .map((asset) => String(asset.legacyAgentId).trim()),
    ),
  ];
  for (const agentId of legacyIds) {
    const loaded = await loadExistingGovernedWorkspaceIdentity({
      tenantId: row.enterpriseId,
      userId: row.userId,
      agentId,
      stateDir: HOST_STATE_DIR,
    });
    if (loaded.agentAssetId) {
      liveLoaderHit = true;
      break;
    }
  }
  if (liveLoaderHit) {
    break;
  }
}

const measurement = {
  schema: "memory-workspace-phase1b-item2-host-catalog-persist/v1",
  item: 2,
  stage: "host-catalog-merge",
  unlock: "not-issued",
  phase1bExecutionBlocked: true,
  deployAuthorized: false,
  live: false,
  identifierPolicy: "opaque-redacted-evidence",
  hostCatalogWrite: true,
  productionCatalogWrite: "host-merge-authorized",
  mintedUserOwnedFromOccupancy: occupancyMintedCount > 0,
  occupancyMintedCount,
  persistedCount: persist.persisted.length,
  skippedExistingCount: persist.skippedExisting.length,
  quarantinedCount: persist.quarantined.length,
  liveLoaderHit,
  liveLoaderResult: liveLoaderHit ? "matched" : "empty",
  item2: "not-met",
  item5: "not-met",
  wiredToProductionResolver: false,
  explicitlyForbidden: [
    "write unredacted dump to docs/",
    "treat host Catalog merge as item 2 met",
    "treat occupancy mint as item 5 met",
    "resolver write switch",
    "Catalog miss=deny",
    "LIVE migration",
    "wiredToProductionResolver=true",
    "phase1bExecutionBlocked=false",
  ],
};

const raw = JSON.stringify(measurement);
if (raw.includes("@") || raw.includes(os.homedir()) || raw.includes("/Users/")) {
  throw new Error("host_persist_evidence_contains_pii_or_home_path");
}

fs.writeFileSync(MEASUREMENT, `${JSON.stringify(measurement, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(measurement, null, 2)}\n`);
resetSharedDataGovernanceCatalogForTests();
