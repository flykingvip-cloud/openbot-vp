import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const EVIDENCE = "memory-workspace-phase1b-admission-remediation.json";
const BASELINE = "b0a3a7350b76d58318c42abce1b3cff3326877a1";
const CITED_USER_BASELINE = "69e9bf8c63ded61badf59fe0a6c7bc77166b39a1";
const OP = "phase1b-admission-remediation-b0a3a7350b-20260820T033500Z";
const I4 = "openbot-data-governance-p4-later-i4-eval";

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

function readRepo(relPath) {
  return fs.readFileSync(path.join(REPO, relPath), "utf8");
}

function gitOut(args) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
}

function evaluateItem7Retirement(input) {
  if (input.item7Met === true) {
    return { allow: false, reason: "item7-still-not-met", failClosed: true };
  }
  if (input.deleteCallSite === true) {
    return { allow: false, reason: "delete-call-site-forbidden", failClosed: true };
  }
  if (input.schemaV2Write === true) {
    return { allow: false, reason: "schema-v2-write-forbidden", failClosed: true };
  }
  if (input.resolverProductionWrite === true) {
    return { allow: false, reason: "resolver-write-forbidden", failClosed: true };
  }
  if (input.catalogWrite === true) {
    return { allow: false, reason: "catalog-write-forbidden", failClosed: true };
  }
  return { allow: false, reason: "retirement-locked", failClosed: true, retiredThisChange: 0 };
}

void test("admission remediation keeps canonical unlock SoT and does not promote items-3-7", () => {
  const remediation = load(EVIDENCE);
  const canonical = load("memory-workspace-phase1b-unlock-decision.json");
  const historical = load("memory-workspace-phase1b-items-3-7.json");
  const scorecard = load("memory-workspace-phase1b-items-2-7-scorecard.json");
  const packed = JSON.stringify(remediation);

  assert.equal(remediation.schema, "memory-workspace-phase1b-admission-remediation/v1");
  assert.equal(remediation.status, "evidence-preparation");
  assert.equal(remediation.operationId, OP);
  assert.equal(remediation.baselineSha, BASELINE);
  assert.equal(remediation.originMainSha, BASELINE);
  assert.equal(remediation.citedUserBaseline, CITED_USER_BASELINE);
  assert.equal(remediation.phase1bUnlock, "not-issued");
  assert.equal(remediation.productionWriteWatchIndex, 38);
  assert.equal(remediation.modifiedCanonicalUnlockReceipt, false);
  assert.doesNotThrow(() =>
    gitOut(["merge-base", "--is-ancestor", CITED_USER_BASELINE, remediation.baselineSha]),
  );
  assert.equal(remediation.items37IsCanonicalUnlockSoT, false);
  assert.equal(
    remediation.canonicalUnlockReceipt,
    "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
  );
  assert.equal(
    remediation.historicalItems37,
    "docs/design/evidence/memory-workspace-phase1b-items-3-7.json",
  );

  assert.equal(canonical.unlock, "not-issued");
  assert.equal(canonical.decision, "no-valid-issued-receipt");
  assert.equal(canonical.phase1bExecutionBlocked, true);
  assert.equal(canonical.deployAuthorized, false);
  assert.equal(canonical.live, "forbidden");
  assert.equal(canonical.productionCatalogWrite, "none");
  assert.equal(canonical.items["2"], "met");
  assert.equal(canonical.items["3"], "met");
  assert.equal(canonical.items["4"], "met");
  assert.equal(canonical.items["5"], "met");
  assert.equal(canonical.items["6"], "met");
  assert.equal(canonical.items["7"], "not-met");
  assert.deepEqual(remediation.authoritativeItems, canonical.items);

  assert.equal(historical.schema, "memory-workspace-phase1b-items-3-7/v1");
  assert.notEqual(scorecard.unlockReceipt, remediation.historicalItems37);
  assert.equal(scorecard.unlock, "not-issued");
  assert.equal(scorecard.unlockReceipt, canonical.path);
  assert.ok(
    remediation.explicitlyForbidden.includes(
      "treat items-3-7 historical files as canonical unlock SoT",
    ),
  );
  assert.doesNotMatch(packed, new RegExp(I4));
  assert.ok(!REPO.includes(I4), REPO);
});

void test("minima receipt is minima-issued and does not issue full unlock", () => {
  const remediation = load(EVIDENCE);
  const minima = remediation.minimaReceipt;
  const canonical = load("memory-workspace-phase1b-unlock-decision.json");

  assert.equal(minima.status, "minima-issued");
  assert.equal(minima.fullUnlock, "not-issued");
  assert.equal(minima.phase1bExecutionBlocked, true);
  assert.equal(minima.item6ImplementationUnlocked, false);
  assert.equal(minima.item7ImplementationUnlocked, false);
  assert.equal(minima.productionCatalogWrite, "none");
  assert.equal(minima.deployAuthorized, false);
  assert.equal(minima.live, "forbidden");
  assert.equal(minima.doesNotReplaceCanonicalFullUnlock, true);
  assert.equal(minima.canonicalFullUnlock, "not-issued");
  assert.equal(canonical.unlock, "not-issued");
  assert.equal(remediation.item6ImplementationUnlocked, false);
  assert.equal(remediation.item7ImplementationUnlocked, false);
  assert.equal(remediation.phase1bExecutionBlocked, true);
  assert.equal(remediation.deployAuthorized, false);
  assert.equal(remediation.live, "forbidden");
  assert.equal(remediation.productionCatalogWrite, "none");
});

void test("item 7 stays not-met and only allows inventory/design evidence", () => {
  const remediation = load(EVIDENCE);
  const scan = load("memory-workspace-phase1b-item7-retirement-scan.json");
  const schema = readRepo("src/memory/schema-v2.ts");

  assert.equal(remediation.item7, "not-met");
  assert.equal(remediation.item7Met, false);
  assert.notEqual(remediation.item7, "met");
  assert.equal(remediation.item7Allowed.deleteProductionWriteWatchIndexCallSites, false);
  assert.equal(remediation.item7Allowed.retireOldMemoryEngine, false);
  assert.equal(remediation.item7Allowed.productionWriteSiteInventory, true);
  assert.equal(remediation.item7Allowed.readOnlyShadowDryRun, true);
  assert.equal(remediation.item7Inventory.productionWriteWatchIndex, 38);
  assert.equal(remediation.item7Inventory.frozenWriteWatchIndex, 38);
  assert.equal(remediation.item7Inventory.liveWriteWatchIndex, 37);
  assert.equal(remediation.item7Inventory.retiredThisChange, 0);

  const readonlyScan = load("memory-workspace-phase1b-item7-readonly-scan-2026-08-20.json");
  const dryRun = load("memory-workspace-phase1b-item7-shadow-dry-run-2026-08-20.json");
  const graph = load("memory-workspace-phase1b-item7-retirement-dependency-graph-2026-08-20.json");
  const rollback = load("memory-workspace-phase1b-item7-rollback-quarantine-2026-08-20.json");
  assert.equal(readonlyScan.mode, "read-only-scan");
  assert.equal(readonlyScan.productionWriteWatchIndex, 38);
  assert.equal(readonlyScan.rewroteFreezeBaseline, false);
  assert.equal(readonlyScan.deletedCallSites, 0);
  assert.equal(dryRun.mode, "shadow-dry-run");
  assert.equal(dryRun.executed, false);
  assert.equal(dryRun.sitesDeleted, 0);
  assert.equal(dryRun.wouldDeleteCallSites, false);
  assert.equal(graph.executed, false);
  assert.ok(graph.waves.every((wave) => wave.deleteCallSites === false));
  assert.equal(rollback.executed, false);
  assert.equal(rollback.quarantine.quarantineNormalWrites, 0);
  assert.equal(rollback.rollback.rewriteFreezeBaselineToZero, false);
  assert.equal(scan.item7, "not-met");
  assert.equal(scan.retiredThisChange, 0);
  assert.equal(remediation.item7RetirementDependencyGraph.executed, false);
  assert.ok(
    remediation.item7RetirementDependencyGraph.waves.every(
      (wave) => wave.deleteCallSites === false,
    ),
  );
  assert.equal(remediation.item7RollbackQuarantineDesign.enabled, false);
  assert.equal(remediation.item7RollbackQuarantineDesign.rewriteFreezeBaselineToZero, false);
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);
  assert.doesNotMatch(
    gitOut(["diff", "--name-only", "origin/main", "--", "src/memory/schema-v2.ts"]),
    /schema-v2/,
  );

  assert.equal(evaluateItem7Retirement({ item7Met: true }).reason, "item7-still-not-met");
  assert.equal(
    evaluateItem7Retirement({ deleteCallSite: true }).reason,
    "delete-call-site-forbidden",
  );
  assert.equal(
    evaluateItem7Retirement({ schemaV2Write: true }).reason,
    "schema-v2-write-forbidden",
  );
  assert.equal(
    evaluateItem7Retirement({ resolverProductionWrite: true }).reason,
    "resolver-write-forbidden",
  );
  assert.equal(evaluateItem7Retirement({ catalogWrite: true }).reason, "catalog-write-forbidden");
  const locked = evaluateItem7Retirement({});
  assert.equal(locked.allow, false);
  assert.equal(locked.reason, "retirement-locked");
  assert.equal(locked.retiredThisChange, 0);
});

void test("handoff requests admission remediation review only", () => {
  const pkg = readRepo("docs/design/evidence/memory-workspace-phase1b-admission-remediation.md");
  const handoff = readRepo(
    "docs/design/evidence/memory-workspace-phase1b-admission-remediation-handoff.md",
  );
  assert.match(pkg, /items-3-7.*historical files as canonical unlock SoT/);
  assert.match(pkg, /Item 7 stays \*\*not-met\*\*/);
  assert.match(pkg, /productionWriteWatchIndex=38/);
  assert.match(handoff, /Phase 1B Admission Remediation Evidence Review only/);
  assert.match(handoff, /does not request Phase 1B full unlock/);
  assert.match(handoff, /phase1bUnlock=not-issued/);
  assert.doesNotMatch(pkg, /phase1bExecutionBlocked=false/);
  assert.doesNotMatch(handoff, /requests Item 7 met/);
});
