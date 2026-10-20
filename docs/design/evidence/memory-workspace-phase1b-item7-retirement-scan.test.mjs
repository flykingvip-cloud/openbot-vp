import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { measureItem7Retirement } from "./memory-workspace-phase1b-item7-retirement-scan.mjs";

const DIR = path.dirname(import.meta.filename);
const PHASE0 = path.join(DIR, "memory-workspace-phase0-20260814.call-sites.json");

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("item 7 live scan stays not-met and does not rewrite Phase 0 or execute I3", () => {
  const measured = measureItem7Retirement();
  const snapshot = load("memory-workspace-phase1b-item7-retirement-scan.json");
  const ledger = load("memory-workspace-phase1b-item7-retirement-ledger.json");
  const phase0 = JSON.parse(fs.readFileSync(PHASE0, "utf8"));

  assert.equal(measured.item7, "not-met");
  assert.equal(measured.status, "not-met");
  assert.equal(measured.retirementOwner, "cursor-data-governance");
  assert.equal(measured.freezeOwner, "cursor-fable");
  assert.equal(measured.ownersDistinct, true);
  assert.equal(measured.i3Executed, false);
  assert.equal(measured.phase0Rewritten, false);
  assert.equal(measured.retiredThisChange, 0);
  assert.equal(measured.unlock, "not-issued");
  assert.equal(measured.phase1bExecutionBlocked, true);
  assert.equal(measured.deployAuthorized, false);
  assert.equal(measured.frozenWriteWatchIndex, 38);
  assert.equal(phase0.productionWriteWatchIndex, 38);
  assert.ok(measured.liveWriteWatchIndex > 0);
  assert.ok(measured.liveWriteWatchIndex <= 38);
  assert.equal(measured.sites.length, measured.liveWriteWatchIndex);
  assert.ok(measured.explicitlyForbidden.includes("rewrite Phase 0 freeze baseline to fake zero"));
  assert.ok(
    measured.explicitlyForbidden.includes("delete production write call-sites before unlock"),
  );
  assert.ok(
    measured.explicitlyForbidden.includes(
      "I3 retirement or delete old branches before watch index is 0",
    ),
  );
  assert.deepEqual(snapshot.item7, measured.item7);
  assert.equal(ledger.retirementOwner, "cursor-data-governance");
  assert.equal(ledger.i3Executed, false);
  assert.equal(ledger.phase0Rewritten, false);
});
