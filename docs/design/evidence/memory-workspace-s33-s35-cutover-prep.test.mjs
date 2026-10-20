import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const PACKET = "memory-workspace-s33-s35-cutover-prep.json";
const SCAN = "memory-workspace-phase1b-item7-retirement-scan.json";
const UNLOCK = "memory-workspace-phase1b-unlock-decision.json";
const HANDOFF =
  ".kiro/specs/memory-workspace-platform-remediation/handoff-sync-s33-s35-cutover-prep.md";

const MUST_NOT_CHANGE = [
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
  "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
  "src/memory/manager-sync-ops.ts",
  "src/memory/item7-stage-d-memory-sync.ts",
  "src/memory/item7-stage-d-persistent-store.ts",
  "src/memory/item7-stage-d-local-adapter.ts",
  "src/memory/item7-stage-d-shadow-canary.ts",
  "src/memory/item7-stage-d-readiness.ts",
  "src/auto-reply/reply/get-reply.ts",
  "src/gateway/data-governance/item7-retirement-preflight.ts",
  "src/memory/schema-v2.ts",
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
  const base = execFileSync("git", ["merge-base", "origin/main", "HEAD"], {
    cwd: REPO,
    encoding: "utf8",
  }).trim();
  return execFileSync("git", ["diff", "--name-only", base, "--", file], {
    cwd: REPO,
    encoding: "utf8",
  }).trim();
}

void test("S33-S35 cutover PREP packet records fail-closed governance fields", () => {
  const p = load(PACKET);
  assert.equal(p.item, 7);
  assert.equal(p.item7, "not-met");
  assert.equal(p.stage, "D");
  assert.equal(
    p.task,
    "memory-workspace-platform-remediation:kiro-data-governance-sync-s33-s35-cutover-prep",
  );
  assert.equal(p.agent, "kiro-data-governance");
  assert.equal(p.canonicalLedgerUpdated, false);
  assert.equal(p.canonicalCountClaimed, false);
  assert.equal(p.phase1bExecutionBlocked, true);
  assert.equal(p.phase1bUnlock, "not-issued");
  assert.equal(p.deployAuthorized, false);
  assert.equal(p.implementationVerified, false);
  assert.equal(p.live, "forbidden");
  assert.equal(p.productionCatalogWrite, "none");
  assert.equal(p.schemaV2ProductionWrite, false);
  assert.equal(p.cloudSyncEnabled, false);
  assert.equal(p.byosEnabled, false);
  assert.equal(p.cutoverAuthorized, false);
});

void test("S33-S35 cutover PREP is prep-only, read-only, and switches nothing", () => {
  const p = load(PACKET);
  assert.equal(p.prepOnly, true);
  assert.equal(p.evaluatorPure, true);
  assert.equal(p.readOnly, true);
  assert.equal(p.productionSwitch, false);
  assert.equal(p.productionWrite, "legacy-only");
  assert.equal(p.stageDControlledWrite, "shadow-only");
  assert.equal(p.cutoverPerformed, false);
  assert.equal(p.managerSyncOpsModified, false);
  assert.equal(p.thisPacketEditsManagerSyncOps, false);
  assert.equal(p.thisPacketEnablesCloudOrByos, false);
  assert.equal(p.thisPacketUpdatesCanonicalScan, false);
  assert.equal(p.canonicalScanModified, false);
  assert.equal(p.siteOwner, "cursor-memory-wsc");
  assert.equal(p.ownerCoordinationPending, true);
  assert.equal(p.sharedHotFileOwnershipRequest, null);
  assert.equal(p.freezeSafe, true);
  assert.equal(p.trustedFreezeOk, true);
  assert.deepEqual(p.addedProductionCallSites, []);
  assert.deepEqual(p.addedProductionHelpers, []);
  assert.deepEqual(p.addedCatalogSynthesis, []);
  assert.equal(p.dynamicImportsAdded, 0);
});

void test("S33-S35 cutover PREP scan stays 10/10 and retires nothing", () => {
  const p = load(PACKET);
  const scan = load(SCAN);
  assert.equal(p.retiredThisChange, 0);
  assert.equal(p.proposedRetiredThisSlice, 0);
  assert.equal(p.siteCount, 3);
  assert.equal(p.remaining, 10);
  assert.equal(p.liveWriteWatchIndex, 10);
  assert.equal(p.observedAcceptedBaseline, scan.remaining);
  assert.equal(p.remaining, scan.remaining);
  assert.equal(p.liveWriteWatchIndex, scan.liveWriteWatchIndex);
  assert.equal(scan.remaining, 10);
  assert.equal(scan.liveWriteWatchIndex, 10);
  assert.equal(scan.item7, "not-met");
  assert.equal(p.retirementDraft.applied, false);
  assert.equal(p.retirementDraft.canonicalScanTouched, false);
  assert.equal(p.retirementDraft.remainingUnchanged, 10);
  assert.equal(p.retirementDraft.liveWriteWatchIndexUnchanged, 10);
  assert.deepEqual(p.retirementDraft.proposedRetiredLedgerIds, ["S33", "S34", "S35"]);
});

void test("S33-S35 cutover PREP never contradicts the unlock decision", () => {
  const p = load(PACKET);
  const unlock = load(UNLOCK);
  assert.equal(unlock.unlock, "not-issued");
  assert.equal(unlock.items["7"], "not-met");
  assert.equal(p.phase1bUnlock, "not-issued");
});

void test("S33-S35 sites still call legacy syncMemoryFiles at verified lines", () => {
  const p = load(PACKET);
  const scan = load(SCAN);
  const src = fs.readFileSync(path.join(REPO, "src/memory/manager-sync-ops.ts"), "utf8");
  const lines = src.split("\n");
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
    assert.equal(site.productionCallSiteStillLegacy, true);
    assert.equal(site.retiredThisChange, false);
    const line = lines[site.line - 1] ?? "";
    assert.match(line, /await this\.syncMemoryFiles\(/);
  }
  const p8Lines = scan.sites
    .filter((s) => s.symbol === "syncMemoryFiles" && s.file === "src/memory/manager-sync-ops.ts")
    .map((s) => s.line)
    .toSorted((a, b) => a - b);
  assert.deepEqual(p8Lines, [1062, 1252, 1343]);
  assert.equal(new Set(p.sites.map((s) => s.businessPhase)).size, 3);
});

void test("S33-S35 cutover PREP runtime, tests, and handoff exist", () => {
  const p = load(PACKET);
  for (const rel of [...p.runtime, ...p.tests]) {
    assert.equal(fs.existsSync(path.join(REPO, rel)), true, `${rel} must exist`);
  }
  assert.equal(fs.existsSync(path.join(REPO, HANDOFF)), true);
});

void test("S33-S35 cutover PREP does not change manager-sync-ops.ts or the canonical scan vs origin/main", () => {
  if (!gitAvailable()) {
    return;
  }
  for (const file of MUST_NOT_CHANGE) {
    assert.equal(changedVsMain(file), "", `${file} must be unchanged vs origin/main`);
  }
});
