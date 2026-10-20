import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const PACKET = "memory-workspace-phase1b-item7-stage-d-prod-readiness.json";
const SCAN = "memory-workspace-phase1b-item7-retirement-scan.json";
const UNLOCK = "memory-workspace-phase1b-unlock-decision.json";
const HANDOFF =
  ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-item7-stage-d-prod-readiness.md";

// Files this readiness assessment must NOT modify. It is a pure, read-only
// aggregator delivered as ONE new file (+ its test); it never edits the landed
// Stage D runtime, the three P8 call-sites (cursor-memory-wsc's manager-sync-ops.ts),
// the canonical scan, the unlock decision, the preflight gate, or schema v2.
const MUST_NOT_CHANGE = [
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
  "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
  "src/memory/manager-sync-ops.ts",
  "src/memory/item7-stage-d-memory-sync.ts",
  "src/memory/item7-stage-d-persistent-store.ts",
  "src/memory/item7-stage-d-local-adapter.ts",
  "src/memory/item7-stage-d-shadow-canary.ts",
  "src/gateway/data-governance/item7-retirement-preflight.ts",
  "src/memory/schema-v2.ts",
];

const PHASE_E_GATES = [
  "phase1b_unlock_issued",
  "live_write_watch_index_zero",
  "site_owner_coordination",
  "site_retired_from_scan",
  "operator_cutover_authorization",
];

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

function gitAvailable() {
  try {
    execFileSync("git", ["rev-parse", "origin/main"], {
      cwd: REPO,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function changedVsMain(file) {
  // Compare against the merge-base (this branch's fork point), NOT the moving
  // origin/main tip, so a file the trunk advanced but this branch never touched
  // does not falsely read as "changed" when the branch is behind.
  const base = execFileSync("git", ["merge-base", "origin/main", "HEAD"], {
    cwd: REPO,
    encoding: "utf8",
  }).trim();
  return execFileSync("git", ["diff", "--name-only", base, "--", file], {
    cwd: REPO,
    encoding: "utf8",
  }).trim();
}

void test("Stage D readiness packet records the required fail-closed governance fields", () => {
  const p = load(PACKET);
  assert.equal(p.item, 7);
  assert.equal(p.item7, "not-met");
  assert.equal(p.stage, "D");
  assert.equal(p.task, "kiro-data-governance-phase1b-item7-stage-d-prod-readiness");
  assert.equal(p.canonicalLedgerUpdated, false);
  assert.equal(p.canonicalCountClaimed, false);
  assert.equal(p.phase1bExecutionBlocked, true);
  assert.equal(p.phase1bUnlock, "not-issued");
  assert.equal(p.deployAuthorized, false);
  assert.equal(p.live, "forbidden");
  assert.equal(p.productionCatalogWrite, "none");
  assert.equal(p.schemaV2ProductionWrite, false);
  assert.equal(p.cloudSyncEnabled, false);
  assert.equal(p.byosEnabled, false);
});

void test("Stage D readiness packet is assessment-only, read-only, and switches nothing", () => {
  const p = load(PACKET);
  assert.equal(p.assessmentOnly, true);
  assert.equal(p.evaluatorPure, true);
  assert.equal(p.readOnly, true);
  assert.equal(p.productionSwitch, false);
  assert.equal(p.productionWrite, "legacy-only");
  assert.equal(p.stageDControlledWrite, "shadow-only");
  assert.equal(p.cutoverAuthorized, false);
  assert.equal(p.cutoverPerformed, false);
  assert.equal(p.managerSyncOpsModified, false);
  assert.equal(p.memorySyncModified, false);
  assert.equal(p.shadowCanaryModified, false);
  assert.equal(p.persistentStoreModified, false);
  assert.equal(p.localAdapterModified, false);
  assert.equal(p.siteOwner, "cursor-memory-wsc");
  assert.equal(p.ownerCoordinationPending, true);
  // Freeze-safe: adds no watched production call-site / helper / catalog synthesis.
  assert.equal(p.freezeSafe, true);
  assert.equal(p.trustedFreezeOk, true);
  assert.deepEqual(p.addedProductionCallSites, []);
  assert.deepEqual(p.addedProductionHelpers, []);
  assert.deepEqual(p.addedCatalogSynthesis, []);
  assert.equal(p.dynamicImportsAdded, 0);
});

void test("Stage D readiness packet enumerates the Phase E gates and current blockers honestly", () => {
  const p = load(PACKET);
  assert.deepEqual(p.phaseEGates, PHASE_E_GATES);
  // In the current phase every gate is open, so all five remain as blockers.
  assert.deepEqual(p.remainingBlockersAtCurrentSnapshot, PHASE_E_GATES);
  assert.equal(p.verdictLogicHonestBothWays, true);
  assert.equal(p.cutoverEligibleOnlyWhenAllShadowMatchAndAllGatesSatisfied, true);
  for (const gate of PHASE_E_GATES) {
    assert.equal(typeof p.phaseEGateDescriptions[gate], "string");
    assert.ok(p.phaseEGateDescriptions[gate].length > 0);
  }
});

void test("Stage D readiness packet retires nothing and is internally consistent", () => {
  const p = load(PACKET);
  assert.equal(p.retiredThisChange, 0);
  assert.equal(p.proposedRetiredThisSlice, 0);
  assert.equal(p.siteCount, 3);
  // Retiring nothing means remaining equals the observed baseline.
  assert.equal(p.remaining, p.observedAcceptedBaseline);
  assert.equal(p.sites.length, 3);
  assert.deepEqual(
    p.sites.map((s) => s.line),
    [1062, 1252, 1343],
  );
  assert.deepEqual(
    p.sites.map((s) => s.ledgerId),
    ["S33", "S34", "S35"],
  );
  for (const site of p.sites) {
    assert.equal(site.symbol, "syncMemoryFiles");
    assert.equal(site.pathId, "P8");
    assert.equal(site.file, "src/memory/manager-sync-ops.ts");
    assert.equal(site.retiredThisChange, false);
  }
  // The three business phases are distinct (the sites are not treated identically).
  assert.equal(new Set(p.sites.map((s) => s.businessPhase)).size, 3);
});

void test("Stage D readiness packet never contradicts the canonical scan or unlock decision", () => {
  const p = load(PACKET);
  const scan = load(SCAN);
  const unlock = load(UNLOCK);
  assert.equal(p.observedAcceptedBaseline, scan.remaining);
  assert.equal(p.remaining, scan.remaining);
  assert.equal(p.liveWriteWatchIndex, scan.liveWriteWatchIndex);
  assert.equal(scan.item7, "not-met");
  assert.equal(unlock.unlock, "not-issued");
  assert.equal(unlock.items["7"], "not-met");
  // The canonical scan still enumerates the three P8 sites; this packet retires none.
  const p8Lines = scan.sites
    .filter((s) => s.symbol === "syncMemoryFiles" && s.file === "src/memory/manager-sync-ops.ts")
    .map((s) => s.line)
    .toSorted((a, b) => a - b);
  assert.deepEqual(p8Lines, [1062, 1252, 1343]);
});

void test("Stage D readiness runtime module, test, and handoff exist", () => {
  const p = load(PACKET);
  for (const rel of [...p.runtime, ...p.tests]) {
    assert.equal(fs.existsSync(path.join(REPO, rel)), true, `${rel} must exist`);
  }
  assert.equal(fs.existsSync(path.join(REPO, HANDOFF)), true);
});

void test("Stage D readiness change edits nothing it must not (landed runtime, call-sites, scan, gate, schema)", () => {
  if (!gitAvailable()) {
    return; // ancestry checks require a fetched origin/main; skip in bare envs.
  }
  for (const file of MUST_NOT_CHANGE) {
    assert.equal(changedVsMain(file), "", `${file} must be unchanged vs origin/main`);
  }
});
