import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyProductionCatalogTarget,
  measureProductionCatalogCoverage,
} from "./memory-workspace-phase1b-item2-production-catalog-coverage.mjs";

const DIR = path.dirname(import.meta.filename);

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("unconfigured production state dir stays item 2 not-met and does not enable miss=deny", () => {
  const env = { ...process.env };
  delete env.OPENBOT_PRODUCTION_STATE_DIR;
  const measured = measureProductionCatalogCoverage(env);
  const snapshot = load("memory-workspace-phase1b-item2-production-catalog-coverage.json");

  assert.equal(measured.item2, "not-met");
  assert.equal(measured.status, "not-production-met");
  assert.equal(measured.covered, false);
  assert.equal(measured.catalogWrite, false);
  assert.equal(measured.productionCatalogWrite, "none");
  assert.equal(measured.missDenyEnabled, false);
  assert.equal(measured.fourGates100, false);
  assert.equal(measured.target.status, "unconfigured");
  assert.equal(measured.reason, "production_state_dir_unconfigured");
  assert.equal(measured.uniqueUserOwnedEquivalent, 0);
  assert.equal(measured.unlock, "not-issued");
  assert.equal(measured.phase1bExecutionBlocked, true);
  assert.equal(measured.deployAuthorized, false);
  assert.equal(measured.live, false);
  assert.equal(measured.refusedPhase0, true);
  assert.ok(
    measured.explicitlyForbidden.includes("treat fixture or evidence Catalog as production SoT"),
  );
  assert.ok(
    measured.explicitlyForbidden.includes("enable Catalog miss=deny before four gates 100%"),
  );
  assert.ok(measured.explicitlyForbidden.includes("write Phase 0 inventory"));
  assert.deepEqual(snapshot, measured);
});

void test("evidence and host catalogs are not production SoT", () => {
  const evidenceState = path.join(DIR, "memory-workspace-phase1b-item2-runtime-state");
  const host = path.join(os.homedir(), ".openbot");
  assert.equal(
    classifyProductionCatalogTarget({ OPENBOT_PRODUCTION_STATE_DIR: evidenceState }).status,
    "rejected-evidence-path",
  );
  assert.equal(
    classifyProductionCatalogTarget({ OPENBOT_PRODUCTION_STATE_DIR: host }).status,
    "host-not-production-sot",
  );
  assert.equal(
    measureProductionCatalogCoverage({ OPENBOT_PRODUCTION_STATE_DIR: evidenceState }).reason,
    "evidence_catalog_is_not_production_sot",
  );
  assert.equal(
    measureProductionCatalogCoverage({ OPENBOT_PRODUCTION_STATE_DIR: host }).item2,
    "not-met",
  );
});

void test("a copied evidence catalog in a temp state dir still cannot score item 2 met", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phase1b-item2-prod-catalog-"));
  const catalogDir = path.join(tmp, "data-governance");
  fs.mkdirSync(catalogDir, { recursive: true });
  fs.copyFileSync(
    path.join(DIR, "memory-workspace-phase1b-item2-production-catalog.json"),
    path.join(catalogDir, "catalog.json"),
  );
  const measured = measureProductionCatalogCoverage({ OPENBOT_PRODUCTION_STATE_DIR: tmp });
  fs.rmSync(tmp, { recursive: true, force: true });

  assert.equal(measured.target.status, "production-candidate");
  assert.equal(measured.target.catalogPresent, true);
  assert.equal(measured.authorityCatalogGatesPass, true);
  assert.equal(measured.fourGates100, true);
  assert.equal(measured.uniqueUserOwnedEquivalent, 0);
  assert.equal(measured.reason, "production_catalog_unique_user_owned_equivalent_zero");
  assert.equal(measured.item2, "not-met");
  assert.equal(measured.missDenyEnabled, false);
  assert.equal(measured.catalogWrite, false);
});
