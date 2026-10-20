import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const PACKET = "memory-workspace-phase1b-item7-stage-d-persistent-sync.json";
const SCAN = "memory-workspace-phase1b-item7-retirement-scan.json";
const UNLOCK = "memory-workspace-phase1b-unlock-decision.json";
const HANDOFF =
  ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-item7-stage-d-persistent-sync.md";

// Files this persistent-sync change must NOT modify. It composes existing
// interfaces via NEW files only; it never edits the CR1 slice runtime, the three
// P8 call-sites, the canonical scan, the preflight gate, schema v2, or the W5 wave.
const MUST_NOT_CHANGE = [
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
  "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
  "src/memory/item7-stage-d-memory-sync.ts",
  "src/memory/manager-sync-ops.ts",
  "src/gateway/data-governance/item7-retirement-preflight.ts",
  "src/memory/schema-v2.ts",
  "src/memory/item7-w1-dark-tombstone.ts",
  "src/memory/item7-w5-index-last.ts",
  "src/memory/item7-w5-index-shadow.ts",
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
  // origin/main tip: otherwise a file the trunk advanced (but this branch never
  // touched) would falsely read as "changed" whenever the branch is behind.
  const base = execFileSync("git", ["merge-base", "origin/main", "HEAD"], {
    cwd: REPO,
    encoding: "utf8",
  }).trim();
  return execFileSync("git", ["diff", "--name-only", base, "--", file], {
    cwd: REPO,
    encoding: "utf8",
  }).trim();
}

void test("Stage D persistent-sync packet records the required fail-closed fields", () => {
  const p = load(PACKET);
  assert.equal(p.item, 7);
  assert.equal(p.item7, "not-met");
  assert.equal(p.stage, "D");
  assert.equal(p.task, "kiro-data-governance-phase1b-item7-stage-d-persistent-sync");
  assert.equal(p.canonicalLedgerUpdated, false);
  assert.equal(p.canonicalCountClaimed, false);
  assert.equal(p.stageBDependencyState, "blocked");
  assert.equal(p.phase1bExecutionBlocked, true);
  assert.equal(p.phase1bUnlock, "not-issued");
  assert.equal(p.deployAuthorized, false);
  assert.equal(p.live, "forbidden");
  assert.equal(p.productionCatalogWrite, "none");
  assert.equal(p.schemaV2ProductionWrite, false);
  assert.equal(p.cloudSyncEnabled, false);
  assert.equal(p.byosEnabled, false);
});

void test("Stage D persistent-sync packet asserts the persistent + shadow properties and proofs", () => {
  const p = load(PACKET);
  assert.equal(p.stageDTechnicalSliceAccepted, true);
  assert.equal(p.persistentFencingImplemented, true);
  assert.equal(p.persistentRecoveryImplemented, true);
  assert.equal(p.localOnlyShadow, true);
  assert.equal(p.productionSwitch, false);
  assert.equal(p.productionWrite, "legacy-only");
  assert.equal(p.stageDControlledWrite, "shadow-only");
  // Fail-closed / crash-safe proofs.
  assert.equal(p.rollbackProof, true);
  assert.equal(p.quarantineProof, true);
  assert.equal(p.recoveryRequiredProof, true);
  assert.equal(p.crossProcessSingleWinnerProof, true);
  assert.equal(p.crashRestartReplayProof, true);
  assert.equal(p.crashRestartRecoveryBlockProof, true);
  assert.equal(p.receiptWriteFailureHaltProof, true);
  assert.equal(p.noAutoStaleTakeover, true);
  assert.equal(p.failClosedAdapter, true);
  assert.equal(p.neverFakesSynced, true);
  // Property narratives are present and mention the distinguishing guarantees.
  const storeProps = p.persistentStorePropertiesProven.join(" | ");
  assert.ok(/O_EXCL/.test(storeProps));
  assert.ok(/NEVER cleared by release\(\)/.test(storeProps));
  assert.ok(/halts on durable write failure/.test(storeProps));
  const adapterProps = p.localOnlyAdapterPropertiesProven.join(" | ");
  assert.ok(/only for local-only/.test(adapterProps));
  assert.ok(/no double-write/.test(adapterProps));
  assert.equal(p.shadowCanaryScope.replacesSyncMemoryFiles, false);
  assert.equal(p.shadowCanaryScope.touchesLegacyCallSites, false);
});

void test("Stage D persistent-sync packet retires nothing and is internally consistent", () => {
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

void test("Stage D persistent-sync packet never contradicts the canonical scan or unlock decision", () => {
  const p = load(PACKET);
  const scan = load(SCAN);
  const unlock = load(UNLOCK);
  // Baseline mirrors the canonical live scan; counts are not re-derived or hardcoded here.
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

void test("Stage D persistent-sync runtime modules, tests, fixture, and handoff exist", () => {
  const p = load(PACKET);
  for (const rel of [...p.runtime, ...p.tests, ...p.fixtures]) {
    assert.equal(fs.existsSync(path.join(REPO, rel)), true, `${rel} must exist`);
  }
  assert.equal(fs.existsSync(path.join(REPO, HANDOFF)), true);
});

void test("Stage D persistent-sync change does not touch the CR1 slice, call-sites, scan, gate, schema, or W5", () => {
  if (!gitAvailable()) {
    return; // ancestry checks require a fetched origin/main; skip in bare envs.
  }
  for (const file of MUST_NOT_CHANGE) {
    assert.equal(changedVsMain(file), "", `${file} must be unchanged vs origin/main`);
  }
});
