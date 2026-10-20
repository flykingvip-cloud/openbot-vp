#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";
import { createFileDataGovernanceCatalogStore } from "../../../src/gateway/data-governance/catalog-store.ts";
import {
  persistClassifiedAuthorityRows,
  CONFLICT_UNKNOWN_CATALOG_WRITE_BLOCKED,
} from "../../../src/gateway/data-governance/phase1b-classified-persist.ts";
import { measureProductionInventoryCoverage } from "./memory-workspace-phase1b-item2-production-inventory.mjs";

const DIR = path.dirname(import.meta.filename);
const PHASE0 = path.join(DIR, "memory-workspace-phase0-20260814.catalog-candidate.json");
const CANDIDATE = path.join(DIR, "memory-workspace-phase1b-authority-candidate.json");
const CATALOG = path.join(DIR, "memory-workspace-phase1b-item2-stage-b-catalog.json");
const QUARANTINE = path.join(DIR, "memory-workspace-phase1b-item2-stage-b-quarantine.json");
const MEASUREMENT = path.join(DIR, "memory-workspace-phase1b-item2-stage-b.json");

function loadJson(file: string) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function measureStageB(params: {
  catalog: {
    records?: Record<string, { envelope?: { resourceId?: string; resourceType?: string } }>;
  };
  candidate: {
    candidates?: Array<{ resourceId?: string; workspaceKind?: string; classification?: string }>;
    rejected?: Array<{ reason?: string }>;
  };
  persist: {
    persisted: string[];
    quarantined: Array<{ reason: string }>;
    compareAndPutConfirmed: string[];
  };
}) {
  const records = Object.values(params.catalog.records ?? {}).filter(
    (row) => row?.envelope?.resourceType === "workspace",
  );
  const catalogIds = new Set(records.map((row) => row.envelope?.resourceId).filter(Boolean));
  const classified = (params.candidate.candidates ?? []).filter(
    (row) => row.classification === "classified",
  );
  const byKind = (kind: string) => classified.filter((row) => row.workspaceKind === kind);
  const allInCatalog = (rows: Array<{ resourceId?: string }>) =>
    rows.length > 0 && rows.every((row) => row.resourceId && catalogIds.has(row.resourceId));
  const employee = byKind("employee_private");
  const agent = byKind("agent_primary");
  const group = byKind("group_shared");
  const quarantined = params.persist.quarantined;
  const conflictBlockedInProduction = CONFLICT_UNKNOWN_CATALOG_WRITE_BLOCKED;
  const stewardContractDefined =
    employee.length > 0 &&
    employee.every((row) => String(row.resourceId ?? "").endsWith(":steward"));
  const conflictInCatalog = quarantined.filter(
    (row) =>
      "resourceId" in row && catalogIds.has(String((row as { resourceId?: string }).resourceId)),
  ).length;
  const gates = {
    employee_private: {
      required: "100% Catalog records",
      classifiedAuthority: employee.length,
      persistentCatalog: employee.filter((row) => row.resourceId && catalogIds.has(row.resourceId))
        .length,
      stewardContractDefined,
      gate: stewardContractDefined && allInCatalog(employee) ? "pass" : "fail",
    },
    agent_primary: {
      required: "100% exact agentAssetId",
      classifiedAuthority: agent.length,
      persistentCatalog: agent.filter((row) => row.resourceId && catalogIds.has(row.resourceId))
        .length,
      gate: allInCatalog(agent) ? "pass" : "fail",
    },
    group_shared: {
      required: "100% tenant-scoped group binding",
      classifiedAuthority: group.length,
      persistentCatalog: group.filter((row) => row.resourceId && catalogIds.has(row.resourceId))
        .length,
      gate: allInCatalog(group) ? "pass" : "fail",
    },
    conflict_or_unknown: {
      required: "100% write-blocked and listed",
      listed: quarantined.length,
      inCatalog: conflictInCatalog,
      blockedInProduction: conflictBlockedInProduction,
      gate:
        quarantined.length > 0 && conflictBlockedInProduction && conflictInCatalog === 0
          ? "pass"
          : "fail",
    },
  };
  const authorityCatalogGatesPass = Object.values(gates).every((gate) => gate.gate === "pass");
  // Authority fixture gates can pass without covering production inventory.
  // Coverage is measured separately and refuses Phase 0 / the Stage A fixture dump.
  const productionInventory = measureProductionInventoryCoverage();
  const productionInventoryCovered = productionInventory.covered;
  return {
    schema: "memory-workspace-phase1b-item2-stage-b/v1",
    item: 2,
    stage: "B",
    unlock: "not-issued",
    phase1bExecutionBlocked: true,
    deployAuthorized: false,
    live: false,
    productionCatalogWrite: "classified-only",
    productionStateDirWrite: false,
    catalogPath: "docs/design/evidence/memory-workspace-phase1b-item2-stage-b-catalog.json",
    persisted: params.persist.persisted,
    compareAndPutConfirmed: params.persist.compareAndPutConfirmed,
    persistentCatalog: {
      exists: true,
      recordCount: records.length,
      workspaceRecordCount: records.length,
      resourceIds: [...catalogIds],
    },
    gates,
    authorityCatalogGatesPass,
    productionInventoryCovered,
    productionInventory,
    item2: authorityCatalogGatesPass && productionInventoryCovered ? "met" : "not-met",
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

if (path.resolve(CANDIDATE) === path.resolve(PHASE0)) {
  throw new Error("phase0_inventory_is_not_authority");
}

const candidate = loadJson(CANDIDATE);
if (candidate.source === "rejected-inventory" || candidate.live === true) {
  throw new Error("authority_candidate_not_writable");
}

if (fs.existsSync(CATALOG)) {
  fs.unlinkSync(CATALOG);
}

const store = createFileDataGovernanceCatalogStore({ storePath: CATALOG });
const persist = await persistClassifiedAuthorityRows({
  store,
  candidates: candidate.candidates ?? [],
  rejected: candidate.rejected ?? [],
});

const catalog = loadJson(CATALOG);
const measurement = measureStageB({ catalog, candidate, persist });
fs.writeFileSync(
  QUARANTINE,
  `${JSON.stringify(
    {
      schema: "memory-workspace-phase1b-item2-stage-b-quarantine/v1",
      live: false,
      catalogWrite: false,
      count: persist.quarantined.length,
      rows: persist.quarantined,
    },
    null,
    2,
  )}\n`,
);
fs.writeFileSync(MEASUREMENT, `${JSON.stringify(measurement, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(measurement, null, 2)}\n`);
