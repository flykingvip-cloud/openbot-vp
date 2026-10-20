import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const HOST = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("official coverage SoT cites closeout, not occupancy uniqueUserOwnedEquivalent=0", () => {
  const sot = read("memory-workspace-phase1b-item2-production-catalog-coverage-sot.json");
  const closeout = read("memory-workspace-phase1b-item2-production-closeout.json");
  const coverage = read("memory-workspace-phase1b-item2-production-catalog-coverage.json");
  const decision = read("memory-workspace-phase1b-item2-production-sot-decision.json");
  const scorecard = read("memory-workspace-phase1b-items-2-7-scorecard.json");
  const raw = JSON.stringify(sot);

  assert.equal(sot.schema, "memory-workspace-phase1b-item2-production-catalog-coverage-sot/v1");
  assert.equal(sot.occupancyProbeIsNotProductionSot, true);
  assert.equal(sot.occupancyUniqueUserOwnedEquivalent, 0);
  assert.equal(sot.occupancyCatalogPresent, false);
  assert.equal(coverage.item2, "not-met");
  assert.equal(coverage.uniqueUserOwnedEquivalent, 0);
  assert.equal(coverage.target.catalogPresent, false);

  assert.equal(decision.status, "accepted");
  assert.equal(sot.architectureReview, "accepted");
  assert.equal(sot.item2Official, "met");
  assert.equal(sot.productionCatalogPresent, true);
  assert.equal(sot.covered, true);
  assert.equal(sot.fourGates100, true);
  assert.equal(sot.authorityCatalogGatesPass, true);
  assert.equal(sot.uniqueUserOwnedEquivalent, 7);
  assert.equal(
    sot.uniqueUserOwnedMetric,
    "production_catalog_users_with_exactly_one_user_owned_agent_primary",
  );
  assert.equal(sot.uniqueUserOwnedEquivalent, closeout.uniqueUserOwnedEquivalent);
  assert.equal(sot.residualOpaqueRecords, 9);
  assert.equal(sot.quarantineNormalWrites, 0);
  assert.equal(sot.productionCatalogWrite, "none");
  assert.equal(sot.unlock, "not-issued");
  assert.equal(sot.U1, "blocked");
  assert.equal(sot.LIVE, "forbidden");
  assert.equal(sot.deployAuthorized, false);
  assert.equal(sot.missDenyEnabled, false);
  assert.equal(sot.wiredToProductionResolver, false);

  assert.equal(scorecard.items.find((item) => item.id === 2).status, "met");
  assert.equal(scorecard.unlock, "not-issued");
  assert.ok(!UUID.test(raw));
  assert.ok(!HOST.test(raw));
  assert.ok(!raw.includes("@"));
});
