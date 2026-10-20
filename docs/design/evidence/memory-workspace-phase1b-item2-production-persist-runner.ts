#!/usr/bin/env bun
/**
 * Phase 1B item 2: persist the production authority dump into a separate
 * non-LIVE evidence Catalog. Does not overwrite the Stage B fixture catalog,
 * does not write runtime Catalog, and does not make item 2 met.
 */
import fs from "node:fs";
import path from "node:path";
import { createFileDataGovernanceCatalogStore } from "../../../src/gateway/data-governance/catalog-store.ts";
import { persistClassifiedAuthorityRows } from "../../../src/gateway/data-governance/phase1b-classified-persist.ts";
import {
  extractAuthorityCandidate,
  loadAuthorityDump,
} from "./memory-workspace-phase1b-authority-extract.mjs";
import { measureAuthorityCatalogGates } from "./memory-workspace-phase1b-item2-catalog-gates.mjs";
import { measureProductionInventoryCoverage } from "./memory-workspace-phase1b-item2-production-inventory.mjs";

const DIR = path.dirname(import.meta.filename);
const PHASE0 = path.join(DIR, "memory-workspace-phase0-20260814.catalog-candidate.json");
const FIXTURE_DUMP = path.join(DIR, "memory-workspace-phase1b-authority-dump.json");
const FIXTURE_CATALOG = path.join(DIR, "memory-workspace-phase1b-item2-stage-b-catalog.json");
const PRODUCTION_DUMP = path.join(DIR, "memory-workspace-phase1b-production-authority-dump.json");
const CANDIDATE = path.join(DIR, "memory-workspace-phase1b-production-authority-candidate.json");
const CATALOG = path.join(DIR, "memory-workspace-phase1b-item2-production-catalog.json");
const QUARANTINE = path.join(DIR, "memory-workspace-phase1b-item2-production-quarantine.json");
const MEASUREMENT = path.join(DIR, "memory-workspace-phase1b-item2-production-persist.json");

function loadJson(file: string) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

if (path.resolve(PRODUCTION_DUMP) === path.resolve(PHASE0)) {
  throw new Error("phase0_inventory_is_not_authority");
}
if (path.resolve(PRODUCTION_DUMP) === path.resolve(FIXTURE_DUMP)) {
  throw new Error("fixture_dump_is_not_production");
}
if (path.resolve(CATALOG) === path.resolve(FIXTURE_CATALOG)) {
  throw new Error("fixture_catalog_must_not_be_overwritten");
}

const dump = loadAuthorityDump(PRODUCTION_DUMP);
if (!dump || dump.live === true || dump.source === "local-non-live-fixture") {
  throw new Error("production_authority_dump_not_writable");
}

const candidate = extractAuthorityCandidate(dump, { forbidAgentIdIdentity: true });
if (candidate.source === "rejected-inventory" || candidate.live) {
  throw new Error("authority_candidate_not_writable");
}
fs.writeFileSync(CANDIDATE, `${JSON.stringify(candidate, null, 2)}\n`);

if (fs.existsSync(CATALOG)) {
  fs.unlinkSync(CATALOG);
}

const store = createFileDataGovernanceCatalogStore({ storePath: CATALOG });
const persist = await persistClassifiedAuthorityRows({
  store,
  candidates: candidate.candidates ?? [],
  rejected: candidate.rejected ?? [],
  now: "2026-08-18T00:00:00.000Z",
});

fs.writeFileSync(
  QUARANTINE,
  `${JSON.stringify(
    {
      schema: "memory-workspace-phase1b-item2-production-quarantine/v1",
      live: false,
      catalogWrite: false,
      count: persist.quarantined.length,
      rows: persist.quarantined,
    },
    null,
    2,
  )}\n`,
);

const catalog = loadJson(CATALOG);
const gates = measureAuthorityCatalogGates({ catalog, candidate, persist });
const productionInventory = measureProductionInventoryCoverage();
const measurement = {
  schema: "memory-workspace-phase1b-item2-production-persist/v1",
  item: 2,
  stage: "production-evidence-persist",
  unlock: "not-issued",
  phase1bExecutionBlocked: true,
  deployAuthorized: false,
  live: false,
  productionCatalogWrite: "none",
  evidenceCatalogWrite: "classified-only",
  productionStateDirWrite: false,
  catalogPath: "docs/design/evidence/memory-workspace-phase1b-item2-production-catalog.json",
  persisted: persist.persisted,
  compareAndPutConfirmed: persist.compareAndPutConfirmed,
  persistentCatalog: {
    exists: true,
    recordCount: gates.recordCount,
    workspaceRecordCount: gates.recordCount,
    resourceIds: gates.catalogIds,
  },
  gates: gates.gates,
  authorityCatalogGatesPass: gates.authorityCatalogGatesPass,
  productionInventoryCovered: productionInventory.covered,
  productionInventory,
  item2: "not-met",
  item5: "not-met",
  explicitlyForbidden: [
    "Catalog SoT write from Phase 0 inventory",
    "overwrite Stage B fixture catalog",
    "runtime Catalog write",
    "resolver write switch",
    "memory schema v2",
    "Catalog miss=deny",
    "LIVE migration",
    "deployAuthorized=true",
    "phase1bExecutionBlocked=false",
    "treat evidence catalog persist as item 2 met",
  ],
};
fs.writeFileSync(MEASUREMENT, `${JSON.stringify(measurement, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(measurement, null, 2)}\n`);
