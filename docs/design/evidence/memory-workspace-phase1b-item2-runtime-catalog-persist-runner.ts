#!/usr/bin/env bun
/**
 * Phase 1B item 2: admit the production authority candidate into the runtime
 * Catalog layout under an isolated evidence stateDir. Does not write host
 * ~/.openbot, does not flip item 5, and does not make item 2 met.
 */
import fs from "node:fs";
import path from "node:path";
import { persistClassifiedAuthorityRowsToRuntimeCatalog } from "../../../src/gateway/data-governance/phase1b-runtime-catalog-persist.ts";
import { resetSharedDataGovernanceCatalogForTests } from "../../../src/gateway/data-governance/runtime-catalog.ts";
import { loadExistingGovernedWorkspaceIdentity } from "../../../src/gateway/data-governance/workspace-catalog-projection.ts";
import { measureProductionInventoryCoverage } from "./memory-workspace-phase1b-item2-production-inventory.mjs";

const DIR = path.dirname(import.meta.filename);
const CANDIDATE = path.join(DIR, "memory-workspace-phase1b-production-authority-candidate.json");
const STATE_DIR = path.join(DIR, "memory-workspace-phase1b-item2-runtime-state");
const MEASUREMENT = path.join(DIR, "memory-workspace-phase1b-item2-runtime-catalog-persist.json");

function loadJson(file: string) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const candidate = loadJson(CANDIDATE);
if (candidate.live === true || candidate.source === "rejected-inventory") {
  throw new Error("authority_candidate_not_writable");
}

resetSharedDataGovernanceCatalogForTests();
fs.rmSync(STATE_DIR, { recursive: true, force: true });

const persist = await persistClassifiedAuthorityRowsToRuntimeCatalog({
  stateDir: STATE_DIR,
  candidates: candidate.candidates ?? [],
  rejected: candidate.rejected ?? [],
  now: "2026-08-18T00:00:00.000Z",
});

const loaded = await loadExistingGovernedWorkspaceIdentity({
  tenantId: "ent-1",
  userId: "user-1",
  agentId: "main",
  stateDir: STATE_DIR,
});
const productionInventory = measureProductionInventoryCoverage();
const measurement = {
  schema: "memory-workspace-phase1b-item2-runtime-catalog-persist/v1",
  item: 2,
  stage: "runtime-catalog-layout",
  unlock: "not-issued",
  phase1bExecutionBlocked: true,
  deployAuthorized: false,
  live: false,
  hostCatalogWrite: false,
  productionCatalogWrite: "none",
  runtimeCatalogLayoutWrite: "classified-only",
  catalogPath: path.relative(path.resolve(DIR, "../../.."), persist.catalogPath),
  persisted: persist.persisted,
  compareAndPutConfirmed: persist.compareAndPutConfirmed,
  quarantined: persist.quarantined,
  liveLoaderMatchedUserOwnedAsset: Boolean(loaded.agentAssetId),
  liveLoaderResult: loaded.agentAssetId ? "matched" : "empty",
  productionInventoryCovered: productionInventory.covered,
  productionInventory,
  item2: "not-met",
  item5: "not-met",
  wiredToProductionResolver: false,
  explicitlyForbidden: [
    "host ~/.openbot Catalog write",
    "runtime Catalog SoT on the default stateDir",
    "resolver write switch",
    "Catalog miss=deny",
    "LIVE migration",
    "treat runtime-layout persist as item 2 met",
    "treat empty live loader as item 5 met",
    "phase1bExecutionBlocked=false",
  ],
};
fs.writeFileSync(MEASUREMENT, `${JSON.stringify(measurement, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(measurement, null, 2)}\n`);
resetSharedDataGovernanceCatalogForTests();
