#!/usr/bin/env node
/**
 * Phase 1B item 2: measure production-inventory coverage without treating
 * the Stage A fixture dump or Phase 0 inventory as Catalog SoT.
 */
import fs from "node:fs";
import path from "node:path";
import { extractAuthorityCandidate } from "./memory-workspace-phase1b-authority-extract.mjs";
import { measureAuthorityCatalogGates } from "./memory-workspace-phase1b-item2-catalog-gates.mjs";
import { measureSeatOccupancy } from "./memory-workspace-phase1b-item2-seat-occupancy.mjs";

const DIR = path.dirname(import.meta.filename);
const PHASE0 = path.join(DIR, "memory-workspace-phase0-20260814.catalog-candidate.json");
const FIXTURE_DUMP = path.join(DIR, "memory-workspace-phase1b-authority-dump.json");
const FIXTURE_CATALOG = path.join(DIR, "memory-workspace-phase1b-item2-stage-b-catalog.json");
const PRODUCTION_DUMP = path.join(DIR, "memory-workspace-phase1b-production-authority-dump.json");
const PRODUCTION_CATALOG = path.join(DIR, "memory-workspace-phase1b-item2-production-catalog.json");
const PRODUCTION_QUARANTINE = path.join(
  DIR,
  "memory-workspace-phase1b-item2-production-quarantine.json",
);
const RUNTIME_CATALOG = path.join(
  DIR,
  "memory-workspace-phase1b-item2-runtime-state",
  "data-governance",
  "catalog.json",
);
const HOST_PERSIST = path.join(DIR, "memory-workspace-phase1b-item2-host-catalog-persist.json");
const SNAPSHOT = path.join(DIR, "memory-workspace-phase1b-item2-production-inventory.json");
const FORBIDDEN = [
  "Catalog SoT write from Phase 0 inventory",
  "treat the Stage A fixture dump as production inventory",
  "invent resourceId from membership alone",
  "treat evidence catalog persist as runtime Catalog SoT",
  "treat evidence catalog persist as item 2 met",
  "treat runtime-layout persist as item 2 met",
  "treat host Catalog merge as item 2 met",
  "treat occupancy mint as item 2 met",
  "phase1bExecutionBlocked=false",
];

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function isInventoryShaped(dump) {
  return (
    dump &&
    typeof dump === "object" &&
    (dump.schema === "memory-workspace-phase0-catalog-candidate/v2" ||
      (Array.isArray(dump.candidates) &&
        dump.candidates.some((row) => row && (row.pathPattern || row.candidateId))))
  );
}

function baseResult(extra) {
  return {
    schema: "memory-workspace-phase1b-item2-production-inventory/v1",
    item: 2,
    covered: false,
    live: false,
    catalogWrite: false,
    unlock: "not-issued",
    phase1bExecutionBlocked: true,
    deployAuthorized: false,
    item2: "not-met",
    refusedPhase0: true,
    explicitlyForbidden: FORBIDDEN,
    ...extra,
  };
}

export function measureProductionInventoryCoverage() {
  const phase0Path = path.relative(path.resolve(DIR, "../../.."), PHASE0);
  const fixturePath = path.relative(path.resolve(DIR, "../../.."), FIXTURE_DUMP);
  const dumpPath = path.relative(path.resolve(DIR, "../../.."), PRODUCTION_DUMP);
  const catalogPath = path.relative(path.resolve(DIR, "../../.."), PRODUCTION_CATALOG);
  const runtimeCatalogPath = path.relative(path.resolve(DIR, "../../.."), RUNTIME_CATALOG);

  if (path.resolve(PRODUCTION_DUMP) === path.resolve(PHASE0)) {
    throw new Error("phase0_inventory_is_not_production_authority");
  }
  if (path.resolve(PRODUCTION_CATALOG) === path.resolve(FIXTURE_CATALOG)) {
    throw new Error("fixture_catalog_is_not_production");
  }

  const fixture = fs.existsSync(FIXTURE_DUMP) ? loadJson(FIXTURE_DUMP) : null;
  const fixtureIsNotProduction =
    !fixture ||
    fixture.source === "local-non-live-fixture" ||
    fixture.live === true ||
    fixture.writable === false;

  if (!fs.existsSync(PRODUCTION_DUMP)) {
    return baseResult({
      reason: "missing_production_authority_dump",
      dumpPath,
      dumpPresent: false,
      phase0Path,
      fixtureDumpPath: fixturePath,
      fixtureDumpIsNotProduction: fixtureIsNotProduction,
      evidenceCatalogPath: catalogPath,
      evidenceCatalogPersisted: false,
    });
  }

  const dump = loadJson(PRODUCTION_DUMP);
  if (isInventoryShaped(dump) || dump.source === "rejected-inventory") {
    throw new Error("phase0_inventory_is_not_production_authority");
  }
  if (dump.live === true) {
    throw new Error("production_authority_dump_must_not_be_live");
  }
  if (dump.source === "local-non-live-fixture") {
    return baseResult({
      reason: "fixture_dump_is_not_production",
      dumpPath,
      dumpPresent: true,
      phase0Path,
      fixtureDumpPath: fixturePath,
      fixtureDumpIsNotProduction: true,
      evidenceCatalogPath: catalogPath,
      evidenceCatalogPersisted: false,
    });
  }

  if (!fs.existsSync(PRODUCTION_CATALOG)) {
    return baseResult({
      reason: "production_dump_present_not_persisted",
      dumpPath,
      dumpPresent: true,
      phase0Path,
      fixtureDumpPath: fixturePath,
      fixtureDumpIsNotProduction: true,
      evidenceCatalogPath: catalogPath,
      evidenceCatalogPersisted: false,
    });
  }

  const extracted = extractAuthorityCandidate(dump, { forbidAgentIdIdentity: true });
  const occupancyMintedCount = (extracted.candidates ?? []).filter(
    (row) =>
      row.ownerType === "occupancy" && /:user:[^:]+:asset:/.test(String(row.resourceId ?? "")),
  ).length;
  const catalog = loadJson(PRODUCTION_CATALOG);
  const quarantine = fs.existsSync(PRODUCTION_QUARANTINE)
    ? loadJson(PRODUCTION_QUARANTINE)
    : { rows: [] };
  const gates = measureAuthorityCatalogGates({
    catalog,
    candidate: extracted,
    persist: { quarantined: quarantine.rows ?? [] },
  });
  const classifiedIds = (extracted.candidates ?? [])
    .filter((row) => row.classification === "classified" && row.resourceId)
    .map((row) => row.resourceId);
  const catalogIds = new Set(Object.keys(catalog.records ?? {}));
  const allClassifiedPersisted =
    classifiedIds.length > 0 && classifiedIds.every((id) => catalogIds.has(id));
  const gatesPass = allClassifiedPersisted && gates.authorityCatalogGatesPass;

  let runtimeCatalogLayoutPersisted = false;
  let runtimeAuthorityCatalogGatesPass = false;
  if (fs.existsSync(RUNTIME_CATALOG)) {
    const runtimeCatalog = loadJson(RUNTIME_CATALOG);
    const runtimeGates = measureAuthorityCatalogGates({
      catalog: runtimeCatalog,
      candidate: extracted,
      persist: { quarantined: quarantine.rows ?? [] },
    });
    const runtimeIds = new Set(Object.keys(runtimeCatalog.records ?? {}));
    runtimeCatalogLayoutPersisted =
      classifiedIds.length > 0 && classifiedIds.every((id) => runtimeIds.has(id));
    runtimeAuthorityCatalogGatesPass =
      runtimeCatalogLayoutPersisted && runtimeGates.authorityCatalogGatesPass;
  }

  let reason = "production_dump_persist_incomplete";
  const hostPersist = fs.existsSync(HOST_PERSIST) ? loadJson(HOST_PERSIST) : null;
  const hostCatalogWrite = hostPersist?.hostCatalogWrite === true;
  if (hostCatalogWrite && runtimeAuthorityCatalogGatesPass) {
    reason = "production_classified_merged_to_host_catalog_item2_not_met";
  } else if (runtimeAuthorityCatalogGatesPass) {
    reason = "production_dump_persisted_to_runtime_catalog_layout_not_host";
  } else if (gatesPass) {
    reason = "production_dump_persisted_to_evidence_catalog_not_runtime";
  }

  const occupancy = measureSeatOccupancy(dump);

  return baseResult({
    reason,
    dumpPath,
    dumpPresent: true,
    phase0Path,
    fixtureDumpPath: fixturePath,
    fixtureDumpIsNotProduction: true,
    evidenceCatalogPath: catalogPath,
    evidenceCatalogPersisted: true,
    runtimeCatalogPath,
    runtimeCatalogLayoutPersisted,
    productionAuthorityCatalogGatesPass: gates.authorityCatalogGatesPass,
    runtimeAuthorityCatalogGatesPass,
    seatOccupancyPresent: occupancy.occupancyPresent,
    seatOccupancyCount: occupancy.occupancyCount,
    uniqueUserToSeat: occupancy.uniqueUserToSeat,
    uniqueSeatToAsset: occupancy.uniqueSeatToAsset,
    uniqueUserOwnedEquivalent: occupancy.uniqueUserOwnedEquivalent,
    occupancyMintableAssetCount: occupancy.occupancyMintableAssetCount,
    mintedUserOwnedAgentAsset: occupancyMintedCount > 0,
    occupancyMintedCount,
    hostCatalogWrite,
    occupancyReason: occupancy.reason,
  });
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const measured = measureProductionInventoryCoverage();
  fs.writeFileSync(SNAPSHOT, `${JSON.stringify(measured, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(measured, null, 2)}\n`);
}
