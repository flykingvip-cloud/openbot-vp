#!/usr/bin/env node
/**
 * Phase 1B item 2 Stage A harness (read-only).
 *
 * Measures persistent Catalog coverage, partitions the Phase 0 inventory
 * into quarantine vs classified-inventory-only, and shadow-compares an
 * authority-sourced candidate when one exists.
 *
 * Does not write Catalog, inventory, resolver, or memory files.
 * Completing this measurement does not unlock Phase 1B.
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(import.meta.filename);
const PHASE0_CANDIDATE = path.join(DIR, "memory-workspace-phase0-20260814.catalog-candidate.json");
const CATALOG_CONTRACT = path.join(DIR, "memory-workspace-phase1a-catalog-contract.json");
const AUTHORITY_CANDIDATE = path.join(DIR, "memory-workspace-phase1b-authority-candidate.json");
const MATRIX = path.join(DIR, "memory-workspace-phase0-section141-signoff-matrix.json");

const QUARANTINE_CLASSIFICATIONS = new Set(["unknown", "conflict"]);

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function quarantineReason(row) {
  if (row.resolutionStatus === "pending_authority") {
    return "pending_authority";
  }
  if (row.classification === "conflict") {
    return "conflict";
  }
  if (row.classification === "unknown") {
    return "unknown";
  }
  if (
    String(row.resourceId).includes(":unknown:") ||
    String(row.resourceId).includes(":pending:")
  ) {
    return "unproven_resource_id";
  }
  return "unproven";
}

function isQuarantine(row) {
  return (
    QUARANTINE_CLASSIFICATIONS.has(row.classification) ||
    row.resolutionStatus === "pending_authority" ||
    String(row.resourceId).includes(":unknown:") ||
    String(row.resourceId).includes(":pending:")
  );
}

function hasExactAgentAssetId(row) {
  return (
    row.workspaceKind === "agent_primary" &&
    row.classification === "classified" &&
    /:asset:[^:]+$/.test(String(row.resourceId)) &&
    !String(row.resourceId).includes(":unknown:") &&
    !String(row.resourceId).includes(":pending:")
  );
}

function measurePersistentCatalog(catalogPath) {
  if (!catalogPath || !fs.existsSync(catalogPath)) {
    return {
      exists: false,
      path: catalogPath ?? null,
      recordCount: 0,
      workspaceRecordCount: 0,
      resourceIds: [],
    };
  }
  const raw = loadJson(catalogPath);
  const records = raw.records && typeof raw.records === "object" ? Object.values(raw.records) : [];
  const workspace = records.filter((record) => record?.envelope?.resourceType === "workspace");
  return {
    exists: true,
    path: catalogPath,
    recordCount: records.length,
    workspaceRecordCount: workspace.length,
    resourceIds: workspace.map((record) => record?.envelope?.resourceId).filter(Boolean),
  };
}

function gateStatus(ok) {
  return ok ? "pass" : "fail";
}

export function measureStageA(options = {}) {
  const phase0 = loadJson(options.phase0CandidatePath ?? PHASE0_CANDIDATE);
  const contract = loadJson(options.catalogContractPath ?? CATALOG_CONTRACT);
  const matrix = loadJson(options.matrixPath ?? MATRIX);
  const rows = Array.isArray(phase0.candidates) ? phase0.candidates : [];

  const quarantine = [];
  const classifiedInventoryOnly = [];
  for (const row of rows) {
    const entry = {
      candidateId: row.candidateId,
      resourceId: row.resourceId,
      workspaceKind: row.workspaceKind,
      classification: row.classification,
      reason: isQuarantine(row) ? quarantineReason(row) : "classified_inventory_only",
    };
    if (isQuarantine(row)) {
      quarantine.push(entry);
    } else {
      classifiedInventoryOnly.push(entry);
    }
  }

  const authorityPath = options.authorityCandidatePath ?? AUTHORITY_CANDIDATE;
  const authorityExists = fs.existsSync(authorityPath);
  const authorityRows = authorityExists ? (loadJson(authorityPath).candidates ?? []) : [];
  const authorityIds = new Set(authorityRows.map((row) => row.resourceId).filter(Boolean));
  const inventoryIds = new Set(rows.map((row) => row.resourceId).filter(Boolean));
  const matched = [...inventoryIds].filter((id) => authorityIds.has(id));

  const persistent = measurePersistentCatalog(options.catalogPath);
  const persistentIds = new Set(persistent.resourceIds);

  const employeePrivate = rows.filter((row) => row.workspaceKind === "employee_private");
  const agentPrimary = rows.filter((row) => row.workspaceKind === "agent_primary");
  const groupShared = rows.filter((row) => row.workspaceKind === "group_shared");

  const employeeInCatalog = employeePrivate.filter((row) =>
    persistentIds.has(row.resourceId),
  ).length;
  const agentExactInCatalog = agentPrimary.filter(
    (row) => hasExactAgentAssetId(row) && persistentIds.has(row.resourceId),
  ).length;
  const groupInCatalog = groupShared.filter((row) => persistentIds.has(row.resourceId)).length;
  const conflictUnknown = rows.filter((row) => isQuarantine(row));
  const conflictBlockedInProduction = false;

  const gates = {
    employee_private: {
      required: "100% Catalog records",
      inventoried: employeePrivate.length,
      persistentCatalog: employeeInCatalog,
      gate: gateStatus(employeePrivate.length > 0 && employeeInCatalog === employeePrivate.length),
    },
    agent_primary: {
      required: "100% exact agentAssetId",
      inventoried: agentPrimary.length,
      classifiedExactInventory: agentPrimary.filter(hasExactAgentAssetId).length,
      persistentCatalog: agentExactInCatalog,
      gate: gateStatus(agentPrimary.length > 0 && agentExactInCatalog === agentPrimary.length),
    },
    group_shared: {
      required: "100% tenant-scoped group binding",
      inventoried: groupShared.length,
      persistentCatalog: groupInCatalog,
      gate: gateStatus(groupShared.length > 0 && groupInCatalog === groupShared.length),
    },
    conflict_or_unknown: {
      required: "100% write-blocked and listed",
      listed: conflictUnknown.length,
      blockedInProduction: conflictBlockedInProduction,
      gate: gateStatus(conflictUnknown.length > 0 && conflictBlockedInProduction),
    },
  };

  const item2Met = Object.values(gates).every((gate) => gate.gate === "pass");

  return {
    schema: "memory-workspace-phase1b-item2-stage-a/v1",
    item: 2,
    stage: "A",
    unlock: "not-issued",
    phase1bExecutionBlocked: matrix.phase1bExecutionBlocked === true,
    deployAuthorized: false,
    productionCatalogWrite: "none",
    phase0Candidate: {
      path: "docs/design/evidence/memory-workspace-phase0-20260814.catalog-candidate.json",
      isCatalogSot: false,
      candidateCount: rows.length,
    },
    catalogContract: {
      writable: contract.admissionRules?.writable === true,
      persistentCatalogCoverage: contract.coverageHonesty?.persistentCatalogCoverage,
      persistentGovernanceCatalogExists:
        contract.coverageHonesty?.persistentGovernanceCatalogExists,
    },
    authorityExtract: {
      status: authorityExists ? "present" : "pending",
      path: authorityExists
        ? "docs/design/evidence/memory-workspace-phase1b-authority-candidate.json"
        : null,
      candidateCount: authorityRows.length,
      note: authorityExists
        ? authorityRows.length === 0
          ? "Authority extract ran without a local dump; 0 classified rows; not Catalog SoT"
          : "Authority-sourced candidate is present for shadow-compare only"
        : "No in-repo Registry/seat/user/group extract yet; do not copy Phase 0 inventory",
    },
    shadowCompare: {
      inventoryOnly: rows.length - matched.length,
      authorityOnly: [...authorityIds].filter((id) => !inventoryIds.has(id)).length,
      matched: matched.length,
    },
    quarantineLedger: {
      count: quarantine.length,
      rows: quarantine,
    },
    classifiedInventoryOnly: {
      count: classifiedInventoryOnly.length,
      note: "Inventory classification is not Catalog admission",
      rows: classifiedInventoryOnly,
    },
    persistentCatalog: persistent,
    gates,
    item2: item2Met ? "met" : "not-met",
    explicitlyForbidden: [
      "Catalog SoT write from Phase 0 inventory",
      "resolver write switch",
      "memory schema v2",
      "Catalog miss=deny",
      "LIVE migration",
      "deployAuthorized=true",
      "phase1bExecutionBlocked=false",
    ],
  };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const measured = measureStageA();
  process.stdout.write(`${JSON.stringify(measured, null, 2)}\n`);
}
