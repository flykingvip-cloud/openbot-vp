import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { measureItems37 } from "./memory-workspace-phase1b-items-3-7.mjs";

const DIR = path.dirname(import.meta.filename);

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("items 3-7 stay independently scored and are not an unlock", () => {
  const measured = measureItems37();
  assert.equal(measured.unlock, "not-issued");
  assert.equal(measured.phase1bExecutionBlocked, true);
  assert.equal(measured.deployAuthorized, false);
  assert.equal(measured.productionCatalogWrite, "none");
  assert.equal(measured.allMet, false);
  assert.deepEqual(
    measured.items.map((item) => item.id),
    [3, 4, 5, 6, 7],
  );
  assert.equal(measured.items.find((item) => item.id === 3).status, "met");
  assert.equal(measured.items.find((item) => item.id === 5).status, "met");
  assert.ok(
    measured.items
      .filter((item) => item.id !== 3 && item.id !== 4 && item.id !== 5)
      .every((item) => item.status === "not-met"),
  );
});

void test("item 3: write-switch acceptance stays dark", () => {
  const measured = measureItems37();
  const item = measured.items.find((row) => row.id === 3);
  const packet = load("memory-workspace-phase1b-item3-write-switch-acceptance.json");
  assert.equal(item.measured.designDispatchStatus, "accepted");
  assert.equal(item.measured.designDispatchIsWriteSwitch, false);
  assert.equal(item.measured.writeSwitchAcceptancePresent, true);
  assert.equal(item.measured.writeSwitchAcceptanceDecision, "accepted");
  assert.equal(item.measured.failClosedListsWriteSwitchNotEnabled, true);
  assert.equal(packet.enablesProduction, false);
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(item.status, "met");
});

void test("item 4: schema v2 DDL is prepared in the write-switch release unit and stays dark", () => {
  const measured = measureItems37();
  const item = measured.items.find((row) => row.id === 4);
  assert.equal(item.measured.filesV2Present, true);
  assert.equal(item.measured.schemaV2Present, true);
  assert.equal(item.measured.schemaV2Enabled, false);
  assert.equal(item.measured.v1RootGuardPresent, true);
  assert.equal(item.measured.sameReleaseUnitAsItem3, true);
  assert.equal(item.status, "met");
});

void test("item 5: named authorization wires fail-closed to the production resolver", () => {
  const measured = measureItems37();
  const item = measured.items.find((row) => row.id === 5);
  const evidence = load("memory-workspace-phase1b-item5-fail-closed-evidence.json");
  assert.equal(item.measured.designMayInferOwnerFromPath, false);
  assert.equal(item.measured.productionSynthesizesEmptyCatalog, false);
  assert.equal(item.measured.productionUsesAgentIdAsAgentAssetId, false);
  assert.equal(item.measured.productionCallerFallsBackOnUnwiredCatalog, false);
  assert.equal(item.measured.managedCwdThrows, false);
  assert.equal(item.measured.wiredToProductionResolver, true);
  assert.equal(evidence.status, "met");
  assert.equal(evidence.productionStillSynthesizesEmptyCatalog, false);
  assert.equal(evidence.wiredToProductionResolver, true);
  assert.equal(evidence.enablesProduction, false);
  assert.equal(item.status, "met");
});

void test("item 6: this package does not accept the cutover drill", () => {
  const measured = measureItems37();
  const item = measured.items.find((row) => row.id === 6);
  assert.equal(item.measured.existingCutover, "src/gateway/workspace/cutover.ts");
  assert.equal(item.measured.secondStateMachineForbidden, true);
  assert.equal(item.status, "not-met");
});

void test("item 7: production old call-sites are not zero; retirement owner stays distinct", () => {
  const measured = measureItems37();
  const item = measured.items.find((row) => row.id === 7);
  assert.equal(item.measured.productionWriteWatchIndex, 38);
  assert.equal(item.measured.freezeOwner, "cursor-fable");
  assert.equal(item.measured.retirementOwner, "cursor-data-governance");
  assert.equal(item.measured.ownersDistinct, true);
  assert.equal(item.status, "not-met");
});

void test("items 3-7 snapshot matches the live harness and unlock stays closed", () => {
  const measured = measureItems37();
  const snapshot = load("memory-workspace-phase1b-items-3-7.json");
  const scorecard = load("memory-workspace-phase1b-items-2-7-scorecard.json");
  assert.deepEqual(
    snapshot.items.map((item) => [item.id, item.status]),
    measured.items.map((item) => [item.id, item.status]),
  );
  assert.equal(snapshot.unlock, "not-issued");
  assert.equal(scorecard.items.find((item) => item.id === 2).status, "met");
  assert.equal(scorecard.items.find((item) => item.id === 3).status, "met");
  assert.equal(scorecard.items.find((item) => item.id === 4).status, "met");
  assert.equal(scorecard.items.find((item) => item.id === 5).status, "met");
  assert.ok(
    scorecard.items
      .filter((item) => item.id === 6 || item.id === 7)
      .every((item) => item.status === "not-met"),
  );
  assert.ok(scorecard.explicitlyForbidden.includes("treat this scorecard as Phase 1B unlock"));
});
