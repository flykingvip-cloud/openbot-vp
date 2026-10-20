import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { measureStageA } from "./memory-workspace-phase1b-item2-stage-a.mjs";

const DIR = path.dirname(import.meta.filename);

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("item 2 Stage A: persistent coverage stays 0% and item 2 stays not-met", () => {
  const measured = measureStageA();
  assert.equal(measured.item, 2);
  assert.equal(measured.stage, "A");
  assert.equal(measured.item2, "not-met");
  assert.equal(measured.unlock, "not-issued");
  assert.equal(measured.phase1bExecutionBlocked, true);
  assert.equal(measured.deployAuthorized, false);
  assert.equal(measured.productionCatalogWrite, "none");
  assert.equal(measured.phase0Candidate.isCatalogSot, false);
  assert.equal(measured.phase0Candidate.candidateCount, 156);
  assert.equal(measured.catalogContract.writable, false);
  assert.equal(measured.catalogContract.persistentCatalogCoverage, "0%");
  assert.equal(measured.persistentCatalog.exists, false);
  assert.equal(measured.persistentCatalog.workspaceRecordCount, 0);
  assert.equal(measured.authorityExtract.status, "present");
  assert.equal(measured.authorityExtract.candidateCount, 5);
  assert.equal(measured.shadowCompare.matched, 0);
  assert.equal(measured.shadowCompare.authorityOnly, 5);
  assert.equal(measured.shadowCompare.inventoryOnly, 156);
  assert.equal(measured.quarantineLedger.count, 144);
  assert.equal(measured.classifiedInventoryOnly.count, 12);
  assert.equal(measured.gates.employee_private.gate, "fail");
  assert.equal(measured.gates.agent_primary.gate, "fail");
  assert.equal(measured.gates.group_shared.gate, "fail");
  assert.equal(measured.gates.conflict_or_unknown.gate, "fail");
  assert.equal(measured.gates.conflict_or_unknown.blockedInProduction, false);
});

void test("item 2 Stage A snapshot matches the live harness", () => {
  const measured = measureStageA();
  const snapshot = load("memory-workspace-phase1b-item2-stage-a.json");
  assert.equal(snapshot.item2, measured.item2);
  assert.equal(snapshot.unlock, measured.unlock);
  assert.equal(snapshot.quarantineLedger.count, measured.quarantineLedger.count);
  assert.equal(snapshot.classifiedInventoryOnly.count, measured.classifiedInventoryOnly.count);
  assert.deepEqual(snapshot.shadowCompare, measured.shadowCompare);
  assert.deepEqual(
    Object.fromEntries(Object.entries(snapshot.gates).map(([key, value]) => [key, value.gate])),
    Object.fromEntries(Object.entries(measured.gates).map(([key, value]) => [key, value.gate])),
  );
});

void test("item 2 Stage A never treats Phase 0 inventory as a Catalog file", () => {
  const inventory = path.join(DIR, "memory-workspace-phase0-20260814.catalog-candidate.json");
  const measured = measureStageA({ catalogPath: inventory });
  assert.equal(measured.persistentCatalog.exists, true);
  assert.equal(measured.persistentCatalog.workspaceRecordCount, 0);
  assert.equal(measured.item2, "not-met");
  assert.equal(measured.gates.employee_private.gate, "fail");
});

void test("items 2-7 scorecard keeps unlock closed after item 5 met", () => {
  const scorecard = load("memory-workspace-phase1b-items-2-7-scorecard.json");
  const matrix = load("memory-workspace-phase0-section141-signoff-matrix.json");
  assert.equal(scorecard.unlock, "not-issued");
  assert.equal(scorecard.phase1bExecutionBlocked, true);
  assert.equal(scorecard.deployAuthorized, false);
  assert.equal(matrix.phase1bExecutionBlocked, true);
  assert.equal(scorecard.items.length, 6);
  assert.equal(scorecard.items.find((item) => item.id === 2).status, "met");
  assert.equal(scorecard.items.find((item) => item.id === 3).status, "met");
  assert.equal(scorecard.items.find((item) => item.id === 4).status, "met");
  assert.equal(scorecard.items.find((item) => item.id === 5).status, "met");
  assert.ok(
    scorecard.items
      .filter((item) => item.id === 6 || item.id === 7)
      .every((item) => item.status === "not-met"),
  );
  assert.deepEqual(
    scorecard.items.map((item) => item.id),
    [2, 3, 4, 5, 6, 7],
  );
  assert.ok(scorecard.standing.every((item) => item.status === "holding"));
  assert.ok(scorecard.explicitlyForbidden.includes("treat this scorecard as Phase 1B unlock"));
  assert.ok(scorecard.explicitlyForbidden.includes("phase1bExecutionBlocked=false"));
});
