import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const PACKET = "memory-workspace-phase1b-item7-stage-d-memory-sync-proposal.json";
const SCAN = "memory-workspace-phase1b-item7-retirement-scan.json";
const UNLOCK = "memory-workspace-phase1b-unlock-decision.json";
const RUNTIME = "src/memory/item7-stage-d-memory-sync.ts";
const RUNTIME_TEST = "src/memory/item7-stage-d-memory-sync.test.ts";
const HANDOFF =
  ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-item7-stage-d-memory-sync.md";

// Files Stage D must NOT modify (canonical scan, preflight gate, schema v2, W5 wave).
const MUST_NOT_CHANGE = [
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
  "src/gateway/data-governance/item7-retirement-preflight.ts",
  "src/memory/schema-v2.ts",
  "src/memory/item7-w1-dark-tombstone.ts",
  "src/memory/item7-w5-index-last.ts",
  "src/memory/item7-w5-index-shadow.ts",
  "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
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

void test("Stage D proposal records the required fail-closed fields", () => {
  const p = load(PACKET);
  assert.equal(p.item, 7);
  assert.equal(p.item7, "not-met");
  assert.equal(p.stage, "D");
  assert.equal(p.siteCount, 3);
  assert.equal(p.proposedRetiredThisSlice, 3);
  // baseline/remaining counts are asserted dynamically against the canonical scan below
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
  assert.equal(p.rollbackProof, true);
  assert.equal(p.quarantineProof, true);
  assert.equal(p.recoveryRequiredProof, true);
});

void test("Stage D proposal records the CR1 fixes and keeps retiredThisChange=0 / remaining=12", () => {
  const p = load(PACKET);
  assert.equal(p.cr, "CR1");
  assert.equal(p.retiredThisChange, 0);
  assert.ok(Array.isArray(p.cr1Fixes) && p.cr1Fixes.length >= 2);
  assert.equal(typeof p.darkSliceOnlyStores, "string");
  const semantics = p.controlledSyncSemanticsProven.join(" | ");
  assert.ok(/non-local-only destination .* unconditionally fail-closed/.test(semantics));
  assert.ok(/operationId idempotency bound to resource identity/.test(semantics));
});

void test("Stage D proposal is internally consistent and lists the three P8 sites", () => {
  const p = load(PACKET);
  assert.equal(p.siteCount, p.proposedRetiredThisSlice);
  assert.equal(
    p.observedAcceptedBaseline - p.proposedRetiredThisSlice,
    p.projectedRemainingIfAppliedDirectly,
  );
  assert.equal(p.sites.length, 3);
  assert.deepEqual(
    p.sites.map((s) => s.line),
    [1062, 1252, 1343],
  );
  assert.deepEqual(
    p.sites.map((s) => s.point),
    ["D1", "D2", "D3"],
  );
  for (const site of p.sites) {
    assert.equal(site.symbol, "syncMemoryFiles");
    assert.equal(site.pathId, "P8");
    assert.equal(site.file, "src/memory/manager-sync-ops.ts");
  }
  // The three business phases must be distinct (sites are not identical).
  assert.equal(new Set(p.sites.map((s) => s.businessPhase)).size, 3);
});

void test("Stage D proposal never contradicts the canonical scan or unlock decision", () => {
  const p = load(PACKET);
  const scan = load(SCAN);
  const unlock = load(UNLOCK);
  // Baseline mirrors the canonical live scan's remaining count; it is not re-derived here.
  assert.equal(p.observedAcceptedBaseline, scan.remaining);
  assert.equal(p.remaining, scan.remaining);
  assert.equal(p.projectedRemainingIfAppliedDirectly, scan.remaining - p.proposedRetiredThisSlice);
  assert.equal(scan.item7, "not-met");
  assert.equal(unlock.unlock, "not-issued");
  assert.equal(unlock.items["7"], "not-met");
  // The canonical scan still enumerates the three P8 sites Stage D targets.
  const p8Lines = scan.sites
    .filter((s) => s.symbol === "syncMemoryFiles" && s.file === "src/memory/manager-sync-ops.ts")
    .map((s) => s.line)
    .toSorted((a, b) => a - b);
  assert.deepEqual(p8Lines, [1062, 1252, 1343]);
});

void test("Stage D runtime + tests + handoff exist", () => {
  assert.equal(fs.existsSync(path.join(REPO, RUNTIME)), true);
  assert.equal(fs.existsSync(path.join(REPO, RUNTIME_TEST)), true);
  assert.equal(fs.existsSync(path.join(REPO, HANDOFF)), true);
});

void test("Stage D CR1 touches the runtime module but not the canonical scan / gate / schema / W5", () => {
  if (!gitAvailable()) {
    return; // ancestry checks require a fetched origin/main; skip in bare envs.
  }
  // CR1 fixes live in the controlled-command runtime; the three call sites were
  // already landed in #689 and are unchanged here.
  assert.notEqual(changedVsMain("src/memory/item7-stage-d-memory-sync.ts"), "");
  for (const file of MUST_NOT_CHANGE) {
    assert.equal(changedVsMain(file), "", `${file} must be unchanged vs origin/main`);
  }
});
