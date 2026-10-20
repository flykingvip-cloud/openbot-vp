import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { measureItems37 } from "./memory-workspace-phase1b-items-3-7.mjs";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

function readRepo(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

void test("Phase 1B admission keeps items 2-6 met and item 7 not-met without issuing unlock", () => {
  const rollup = load("memory-workspace-phase1b-admission-2026-08-20.json");
  const item2 = load("memory-workspace-phase1b-item2-admission-2026-08-20.json");
  const item3 = load("memory-workspace-phase1b-item3-admission-2026-08-20.json");
  const item4 = load("memory-workspace-phase1b-item4-admission-2026-08-20.json");
  const item5 = load("memory-workspace-phase1b-item5-admission-2026-08-20.json");
  const item6 = load("memory-workspace-phase1b-item6-admission-2026-08-20.json");
  const item7 = load("memory-workspace-phase1b-item7-admission-2026-08-20.json");
  const unlock = load("openbot-cogniweave-u1-unlock-decision.json");
  const phase1b = load("memory-workspace-phase1b-unlock-decision.json");
  const closeout = load("openbot-cogniweave-u1-dark-integration-closeout-2026-08-20.json");
  const scorecard = load("memory-workspace-phase1b-items-2-7-scorecard.json");
  const schema = readRepo("src/memory/schema-v2.ts");
  const failClosed = readRepo("src/gateway/data-governance/workspace-identity-fail-closed.ts");
  const producer = readRepo("src/gateway/workspace-resolver/memory-workspace-resolve.ts");
  const harness = measureItems37();

  assert.equal(rollup.kind, "phase1b-admission-rollup");
  assert.equal(rollup.preparedBy, "cursor-data-governance");
  assert.equal(rollup.productionWrites, 0);
  assert.equal(rollup.usedRealProductionData, false);
  assert.equal(rollup.issuedPhase1bUnlock, false);
  assert.equal(rollup.unlockReviewSubmitted, false);
  assert.equal(rollup.modifiedU1UnlockDecision, false);
  assert.equal(rollup.u1DarkDoesNotAuthorizePhase1b, true);
  assert.equal(rollup.phase1bUnlock, "not-issued");
  assert.equal(rollup.phase1bExecutionBlocked, true);
  assert.equal(rollup.productionCatalogWrite, "none");
  assert.equal(rollup.schemaV2Write, "disabled");
  assert.equal(rollup.deployAuthorized, false);
  assert.equal(rollup.live, "forbidden");
  assert.equal(rollup.productionWriteWatchIndex, 38);
  assert.deepEqual(rollup.items, {
    2: "met",
    3: "met",
    4: "met",
    5: "met",
    6: "met",
    7: "not-met",
  });

  assert.equal(item2.status, "met");
  assert.equal(item2.catalogIsUniqueSot, true);
  assert.equal(item2.occupancyProbeIsNotProductionSot, true);
  assert.equal(item2.candidateIsNotProductionSot, true);
  assert.equal(item2.uniqueUserOwnedEquivalent, 7);
  assert.equal(item2.occupancyUniqueUserOwnedEquivalent, 0);
  assert.equal(item2.residualOpaqueRecords, 9);
  assert.equal(item2.quarantineNormalWrites, 0);

  assert.equal(item3.status, "met");
  assert.equal(item3.writeSwitchEnabled, false);
  assert.equal(item3.enablesProduction, false);

  assert.equal(item4.status, "met");
  assert.equal(item4.schemaV2Enabled, false);
  assert.equal(item4.realDeletesExecuted, false);
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);

  assert.equal(item5.status, "met");
  assert.equal(item5.writePathMissDenyAttached, false);
  assert.match(failClosed, /empty_catalog_synthesis_forbidden/);
  assert.match(producer, /tenant_mismatch/);
  assert.match(producer, /missing_workspace_resource/);
  assert.match(producer, /ambiguous_agent_asset/);

  assert.equal(item6.status, "met");
  assert.equal(item6.touchedRealProductionSqlite, false);
  assert.equal(item6.items37HarnessAcceptsItem6, false);
  assert.equal(harness.items.find((row) => row.id === 6).status, "not-met");
  assert.equal(scorecard.items.find((row) => row.id === 6).status, "met");

  assert.equal(item7.status, "not-met");
  assert.equal(item7.productionWriteWatchIndex, 38);
  assert.equal(item7.liveWriteWatchIndex, 37);
  assert.equal(item7.frozenWriteWatchIndex, 38);
  assert.equal(item7.retiredThisChange, 0);
  assert.equal(item7.retirementReceipt, "not-issued");
  assert.equal(item7.drain.status, "not-started");
  assert.equal(item7.dualRead.status, "not-cutover");
  assert.equal(item7.u1DarkCloseoutDoesNotRetire, true);
  assert.equal(item7.inventory.remaining, 37);

  assert.equal(unlock.implementationStarted, false);
  assert.equal(unlock.signedBy, "cursor-sot-reviewer");
  assert.equal(phase1b.unlock, "not-issued");
  assert.equal(phase1b.signedBy, null);
  assert.equal(closeout.status, "closed-dark-only");
  assert.equal(closeout.authorizes, "none");
  assert.ok(closeout.doesNotAuthorize.includes("issue Phase 1B unlock"));
});
