import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { measureProductionInventoryCoverage } from "./memory-workspace-phase1b-item2-production-inventory.mjs";

const DIR = path.dirname(import.meta.filename);

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("production inventory coverage stays not-met after runtime-layout persist", () => {
  const measured = measureProductionInventoryCoverage();
  const snapshot = load("memory-workspace-phase1b-item2-production-inventory.json");
  const fixture = load("memory-workspace-phase1b-authority-dump.json");
  const dump = load("memory-workspace-phase1b-production-authority-dump.json");

  assert.equal(measured.covered, false);
  assert.equal(measured.reason, "production_classified_merged_to_host_catalog_item2_not_met");
  assert.equal(measured.dumpPresent, true);
  assert.equal(measured.evidenceCatalogPersisted, true);
  assert.equal(measured.runtimeCatalogLayoutPersisted, true);
  assert.equal(measured.runtimeAuthorityCatalogGatesPass, true);
  assert.equal(measured.productionAuthorityCatalogGatesPass, true);
  assert.equal(measured.seatOccupancyPresent, true);
  assert.equal(measured.mintedUserOwnedAgentAsset, true);
  assert.equal(measured.occupancyMintedCount, 6);
  assert.equal(measured.hostCatalogWrite, true);
  assert.equal(measured.uniqueUserOwnedEquivalent, 0);
  assert.equal(measured.occupancyReason, "seat_occupancy_mintable_without_unique_user_owned_asset");
  assert.equal(measured.refusedPhase0, true);
  assert.equal(measured.fixtureDumpIsNotProduction, true);
  assert.equal(measured.live, false);
  assert.equal(measured.catalogWrite, false);
  assert.equal(measured.item2, "not-met");
  assert.equal(measured.unlock, "not-issued");
  assert.equal(fixture.source, "local-non-live-fixture");
  assert.equal(dump.source, "local-platform-auth-and-agent-registry");
  assert.equal(dump.live, false);
  assert.equal(dump.identifierPolicy, "opaque-redacted");
  assert.equal(
    fs.existsSync(path.join(DIR, "memory-workspace-phase1b-production-authority-dump.json")),
    true,
  );
  assert.deepEqual(snapshot, measured);
  assert.ok(measured.explicitlyForbidden.includes("Catalog SoT write from Phase 0 inventory"));
  assert.ok(
    measured.explicitlyForbidden.includes("treat the Stage A fixture dump as production inventory"),
  );
});
