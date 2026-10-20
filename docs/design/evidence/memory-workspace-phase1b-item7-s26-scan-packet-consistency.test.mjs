import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Evidence-only consistency gate for the S26 Semantic Gate.
// The retirement scan ledger and the S26 Semantic Gate CR packet describe the
// same change (a zero-retirement change request). This test fails closed if
// they ever disagree on retiredThisChange / remaining / liveWriteWatchIndex,
// which is exactly the stale-snapshot drift this fix corrected (scan snapshot
// said retiredThisChange=1 while the real-code scan and the CR packet said 0).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-batch23-s26-semantic-gate.json",
);

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const scan = readJson(scanPath);
const packet = readJson(packetPath);

void test("scan and S26 CR packet agree on retiredThisChange (0)", () => {
  assert.equal(scan.retiredThisChange, 0);
  assert.equal(packet.retiredThisChange, 0);
  assert.equal(scan.retiredThisChange, packet.retiredThisChange);
});

void test("scan and S26 CR packet agree on remaining (12)", () => {
  assert.equal(scan.remaining, 12);
  assert.equal(packet.remaining, 12);
  assert.equal(scan.remaining, packet.remaining);
});

void test("scan and S26 CR packet agree on liveWriteWatchIndex (12)", () => {
  assert.equal(scan.liveWriteWatchIndex, 12);
  assert.equal(packet.liveWriteWatchIndex, 12);
  assert.equal(scan.liveWriteWatchIndex, packet.liveWriteWatchIndex);
});

void test("scan internal invariants stay consistent (no retirement, not-met)", () => {
  // The live scan inventory must still list every remaining call-site.
  assert.equal(Array.isArray(scan.sites), true);
  assert.equal(scan.sites.length, scan.remaining);
  assert.equal(scan.sites.length, scan.liveWriteWatchIndex);
  // Frozen baseline and gate posture are untouched by this evidence-only fix.
  assert.equal(scan.frozenWriteWatchIndex, 38);
  assert.equal(scan.item7, "not-met");
  assert.equal(scan.phase1bExecutionBlocked, true);
  assert.equal(scan.deployAuthorized, false);
  assert.equal(scan.i3Executed, false);
  assert.equal(scan.live, false);
});
