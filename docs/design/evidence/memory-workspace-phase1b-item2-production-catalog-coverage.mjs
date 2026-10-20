#!/usr/bin/env node
/**
 * Phase 1B item 2: read-only coverage of the production Catalog.
 *
 * Does not write Catalog, Phase 0 inventory, host ~/.openbot, or miss=deny.
 * Evidence and host catalogs are not production SoT.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractAuthorityCandidate } from "./memory-workspace-phase1b-authority-extract.mjs";
import { measureAuthorityCatalogGates } from "./memory-workspace-phase1b-item2-catalog-gates.mjs";
import { measureSeatOccupancy } from "./memory-workspace-phase1b-item2-seat-occupancy.mjs";

const DIR = path.dirname(import.meta.filename);
const PRODUCTION_DUMP = path.join(DIR, "memory-workspace-phase1b-production-authority-dump.json");
const PRODUCTION_QUARANTINE = path.join(
  DIR,
  "memory-workspace-phase1b-item2-production-quarantine.json",
);
const EVIDENCE_CATALOG = path.join(DIR, "memory-workspace-phase1b-item2-production-catalog.json");
const SNAPSHOT = path.join(DIR, "memory-workspace-phase1b-item2-production-catalog-coverage.json");

const FORBIDDEN = [
  "Catalog SoT write from Phase 0 inventory",
  "treat fixture or evidence Catalog as production SoT",
  "treat host ~/.openbot Catalog as production SoT",
  "write Phase 0 inventory",
  "enable Catalog miss=deny before four gates 100%",
  "treat this packet as item 2 met",
  "phase1bExecutionBlocked=false",
  "LIVE migration",
];

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function isEvidenceOrDocsPath(resolved) {
  return resolved.includes(`${path.sep}docs${path.sep}design${path.sep}evidence`);
}

function measureCatalogUserOwned(catalog) {
  const records = Object.values(catalog?.records ?? {});
  const byUser = new Map();
  let userOwnedRecordCount = 0;
  for (const row of records) {
    const id = typeof row?.envelope?.resourceId === "string" ? row.envelope.resourceId : "";
    const match = /^ws:([^:]+):user:([^:]+):asset:([^:]+)$/.exec(id);
    if (!match) {
      continue;
    }
    const lifecycle = row.envelope?.lifecycleState;
    if (lifecycle && lifecycle !== "active") {
      continue;
    }
    userOwnedRecordCount += 1;
    const key = `${match[1]}:${match[2]}`;
    const assets = byUser.get(key) ?? new Set();
    assets.add(match[3]);
    byUser.set(key, assets);
  }
  return {
    userOwnedRecordCount,
    catalogUserCount: byUser.size,
    uniqueUserOwnedInCatalog: [...byUser.values()].filter((assets) => assets.size === 1).length,
  };
}

export function classifyProductionCatalogTarget(env = process.env) {
  const explicit =
    typeof env.OPENBOT_PRODUCTION_STATE_DIR === "string"
      ? env.OPENBOT_PRODUCTION_STATE_DIR.trim()
      : "";
  if (!explicit) {
    return { status: "unconfigured", stateDir: null, catalogPath: null };
  }
  const stateDir = path.resolve(explicit);
  const catalogPath = path.join(stateDir, "data-governance", "catalog.json");
  if (isEvidenceOrDocsPath(stateDir)) {
    return { status: "rejected-evidence-path", stateDir, catalogPath };
  }
  const host = path.resolve(os.homedir(), ".openbot");
  if (stateDir === host || stateDir.startsWith(`${host}${path.sep}`)) {
    return { status: "host-not-production-sot", stateDir, catalogPath };
  }
  return { status: "production-candidate", stateDir, catalogPath };
}

export function measureProductionCatalogCoverage(env = process.env) {
  const target = classifyProductionCatalogTarget(env);
  const dump = fs.existsSync(PRODUCTION_DUMP) ? loadJson(PRODUCTION_DUMP) : null;
  const occupancy = dump ? measureSeatOccupancy(dump) : null;
  const extracted = dump ? extractAuthorityCandidate(dump, { forbidAgentIdIdentity: true }) : null;
  const quarantine = fs.existsSync(PRODUCTION_QUARANTINE)
    ? loadJson(PRODUCTION_QUARANTINE)
    : { rows: [] };

  let productionCatalogPresent = false;
  let productionCatalogWrite = "none";
  let gates = null;
  let catalogUserOwned = {
    userOwnedRecordCount: 0,
    catalogUserCount: 0,
    uniqueUserOwnedInCatalog: 0,
  };
  let authorityCatalogGatesPass = false;
  let reason = "production_state_dir_unconfigured";

  if (target.status === "rejected-evidence-path") {
    reason = "evidence_catalog_is_not_production_sot";
  } else if (target.status === "host-not-production-sot") {
    reason = "host_catalog_is_not_production_sot";
  } else if (target.status === "production-candidate") {
    if (!target.catalogPath || !fs.existsSync(target.catalogPath)) {
      reason = "production_catalog_missing";
    } else {
      productionCatalogPresent = true;
      const catalog = loadJson(target.catalogPath);
      catalogUserOwned = measureCatalogUserOwned(catalog);
      if (extracted) {
        gates = measureAuthorityCatalogGates({
          catalog,
          candidate: extracted,
          persist: { quarantined: quarantine.rows ?? [] },
        });
        authorityCatalogGatesPass = gates.authorityCatalogGatesPass;
      }
      if (!authorityCatalogGatesPass) {
        reason = "production_catalog_four_gates_not_100";
      } else if ((occupancy?.uniqueUserOwnedEquivalent ?? 0) === 0) {
        reason = "production_catalog_unique_user_owned_equivalent_zero";
      } else {
        reason = "production_catalog_measured_item2_not_scored_met";
      }
    }
  }

  const fourGates100 = authorityCatalogGatesPass;
  const missDenyEnabled = false;

  return {
    schema: "memory-workspace-phase1b-item2-production-catalog-coverage/v1",
    item: 2,
    status: "not-production-met",
    item2: "not-met",
    covered: false,
    live: false,
    catalogWrite: false,
    productionCatalogWrite,
    unlock: "not-issued",
    phase1bExecutionBlocked: true,
    deployAuthorized: false,
    missDenyEnabled,
    fourGates100,
    refusedPhase0: true,
    target: {
      status: target.status,
      catalogPresent: productionCatalogPresent,
    },
    dumpPresent: Boolean(dump),
    evidenceCatalogIsNotProductionSot: path.resolve(EVIDENCE_CATALOG) !== target.catalogPath,
    uniqueUserOwnedEquivalent: occupancy?.uniqueUserOwnedEquivalent ?? 0,
    occupancyReason: occupancy?.reason ?? "seat_occupancy_missing",
    catalogUserOwned,
    authorityCatalogGatesPass,
    gates: gates?.gates ?? null,
    reason,
    explicitlyForbidden: FORBIDDEN,
    note: "Read-only production Catalog coverage. Fixture/evidence/host catalogs are not production SoT. miss=deny stays off while four gates are not 100% on the production Catalog.",
  };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const measured = measureProductionCatalogCoverage();
  fs.writeFileSync(SNAPSHOT, `${JSON.stringify(measured, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(measured, null, 2)}\n`);
}
