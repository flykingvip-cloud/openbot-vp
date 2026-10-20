import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Read-only validation for the wire-pilot design contract (design-only task).
// It asserts (a) the design doc declares the mandated decisions, and (b) the
// live state is unchanged: S26/S27 are NOT retired, the retirement scan stays
// at 12, and no production/LIVE posture moved. This task ships NO code.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function readJson(rel) {
  return JSON.parse(read(rel));
}

const designDoc = read("docs/design/evidence/memory-workspace-phase1b-item7-wire-pilot-design.md");
const scan = readJson("docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json");
const stewardWrite = read("src/gateway/workspace-resolver/steward-write.ts");

void test("design contract declares design-only scope and the not-retireable conclusion", () => {
  assert.match(designDoc, /design-only/i);
  // Honest conclusion: S26/S27 cannot be retired yet.
  assert.match(designDoc, /不能诚实退休/);
  // The persistent Catalog SoT prerequisite is called out.
  assert.match(designDoc, /持久 Catalog SoT/);
  // Placement-provenance is identified as the crux.
  assert.match(designDoc, /placement/);
  // Staged gates G1..G6 with retirement gated last.
  for (const g of ["G1", "G2", "G3", "G4", "G5", "G6"]) {
    assert.ok(designDoc.includes(g), `design doc must define gate ${g}`);
  }
});

void test("retirement scan is unchanged by this design-only task (remaining 12)", () => {
  assert.equal(scan.remaining, 12);
  assert.equal(scan.liveWriteWatchIndex, 12);
  assert.equal(Array.isArray(scan.sites), true);
  assert.equal(scan.sites.length, 12);
  assert.equal(scan.retiredThisChange, 0);
  assert.equal(scan.frozenWriteWatchIndex, 38);
});

void test("locked governance posture holds (item7 not-met, no deploy, no LIVE)", () => {
  assert.equal(scan.item7, "not-met");
  assert.equal(scan.phase1bExecutionBlocked, true);
  assert.equal(scan.deployAuthorized, false);
  assert.equal(scan.i3Executed, false);
  assert.equal(scan.live, false);
});

void test("S26/S27 pilot call sites remain present (not retired)", () => {
  // S26: source host-path resolver call inside runEmployeeStewardCutoverPilot.
  assert.match(stewardWrite, /resolveEmployeeStewardSourceWorkspaceDir\(userId/);
  // S27: target host-path resolver call.
  assert.match(stewardWrite, /resolveEmployeeStewardTargetWorkspaceDir\(\{/);
});

void test("the provision command being wired exists (sanity, not modified here)", () => {
  const provision = read("src/gateway/workspace-resolver/provision-steward-cutover.ts");
  assert.match(provision, /provisionEmployeeStewardCutoverWorkspace/);
});
