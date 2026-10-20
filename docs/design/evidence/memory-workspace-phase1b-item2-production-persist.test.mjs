import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { measureProductionInventoryCoverage } from "./memory-workspace-phase1b-item2-production-inventory.mjs";

const DIR = path.dirname(import.meta.filename);

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("production evidence persist covers classified dump rows without making item 2 met", () => {
  const measured = load("memory-workspace-phase1b-item2-production-persist.json");
  const catalog = load("memory-workspace-phase1b-item2-production-catalog.json");
  const fixtureCatalog = load("memory-workspace-phase1b-item2-stage-b-catalog.json");
  const quarantine = load("memory-workspace-phase1b-item2-production-quarantine.json");
  const dump = load("memory-workspace-phase1b-production-authority-dump.json");
  const inventory = measureProductionInventoryCoverage();
  const snapshot = load("memory-workspace-phase1b-item2-production-inventory.json");

  assert.equal(dump.live, false);
  assert.equal(dump.source, "local-platform-auth-and-agent-registry");
  assert.equal(measured.live, false);
  assert.equal(measured.item2, "not-met");
  assert.equal(measured.item5, "not-met");
  assert.equal(measured.unlock, "not-issued");
  assert.equal(measured.productionCatalogWrite, "none");
  assert.equal(measured.evidenceCatalogWrite, "classified-only");
  assert.equal(measured.authorityCatalogGatesPass, true);
  assert.equal(measured.productionInventoryCovered, false);
  assert.equal(measured.gates.employee_private.classifiedAuthority, 3);
  assert.equal(measured.gates.employee_private.gate, "pass");
  assert.equal(measured.gates.agent_primary.classifiedAuthority, 13);
  assert.equal(measured.gates.agent_primary.gate, "pass");
  assert.equal(measured.gates.group_shared.classifiedAuthority, 6);
  assert.equal(measured.gates.group_shared.gate, "pass");
  assert.equal(measured.gates.conflict_or_unknown.listed, 1);
  assert.equal(measured.gates.conflict_or_unknown.inCatalog, 0);
  assert.equal(measured.gates.conflict_or_unknown.gate, "pass");
  assert.equal(measured.persisted.length, 22);
  assert.deepEqual(measured.compareAndPutConfirmed.toSorted(), measured.persisted.toSorted());
  assert.equal(Object.keys(catalog.records).length, 22);
  assert.ok(Object.keys(catalog.records).every((id) => id.startsWith("ws:ent-1:")));
  assert.ok(Object.keys(fixtureCatalog.records).every((id) => id.startsWith("ws:tenant-1:")));
  assert.equal(Object.keys(fixtureCatalog.records).length, 5);
  assert.ok(quarantine.rows.some((row) => row.reason === "incomplete_agent_asset"));
  assert.ok(!quarantine.rows.some((row) => catalog.records[row.resourceId ?? ""]));
  assert.equal(inventory.covered, false);
  assert.equal(inventory.item2, "not-met");
  assert.equal(inventory.evidenceCatalogPersisted, true);
  assert.equal(inventory.productionAuthorityCatalogGatesPass, true);
  assert.equal(inventory.reason, "production_classified_merged_to_host_catalog_item2_not_met");
  assert.deepEqual(snapshot, inventory);
  assert.ok(measured.explicitlyForbidden.includes("runtime Catalog write"));
  assert.ok(measured.explicitlyForbidden.includes("treat evidence catalog persist as item 2 met"));
});
