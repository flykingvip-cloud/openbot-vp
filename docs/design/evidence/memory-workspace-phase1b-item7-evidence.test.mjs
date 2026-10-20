import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { measureItem7Retirement } from "./memory-workspace-phase1b-item7-retirement-scan.mjs";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const EVIDENCE = "memory-workspace-phase1b-item7-evidence.json";
const MINIMA_TIP = "ce6cf5e1702c7f2de20b58f062fd100562b6ee01";
const ITEM5_TIP = "85f55ee2fa76f88dc538180b481a5823631af649";
const OP = "phase1b-item7-evidence-f495f7a6a1-20260820T041500Z";
const I4 = "openbot-data-governance-p4-later-i4-eval";

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

function readRepo(relPath) {
  return fs.readFileSync(path.join(REPO, relPath), "utf8");
}

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: REPO, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function gitOut(args) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
}

function evaluateItem7Retirement(input) {
  if (input.implementationUnlocked === true) {
    return { allow: false, reason: "implementation-still-locked", failClosed: true };
  }
  if (input.phase1bExecutionBlocked !== true) {
    return { allow: false, reason: "execution-not-blocked", failClosed: true };
  }
  if (input.deleteCallSite === true) {
    return { allow: false, reason: "delete-call-site-forbidden", failClosed: true };
  }
  if (input.catalogMissDeny === true) {
    return { allow: false, reason: "catalog-miss-deny-forbidden", failClosed: true };
  }
  if (input.rewriteFreeze === true) {
    return { allow: false, reason: "freeze-rewrite-forbidden", failClosed: true };
  }
  return { allow: false, reason: "retirement-locked", failClosed: true, retiredThisChange: 0 };
}

void test("item 7 evidence package stays preparation-only and locked", () => {
  const evidence = load(EVIDENCE);
  const scan = load("memory-workspace-phase1b-item7-retirement-scan.json");
  const ledger = load("memory-workspace-phase1b-item7-retirement-ledger.json");
  const current = load("memory-workspace-phase1b-unlock-current.json");
  const packed = JSON.stringify(evidence);

  assert.equal(evidence.schema, "memory-workspace-phase1b-item7-evidence/v1");
  assert.equal(evidence.status, "evidence-preparation");
  assert.equal(evidence.item7, "not-met");
  assert.equal(evidence.item7Met, false);
  assert.equal(evidence.implementationUnlocked, false);
  assert.equal(evidence.implementationStarted, false);
  assert.equal(evidence.retirement, "forbidden");
  assert.equal(evidence.retirementExecuted, false);
  assert.equal(evidence.phase1bExecutionBlocked, true);
  assert.equal(evidence.deployAuthorized, false);
  assert.equal(evidence.wiredToProductionResolver, false);
  assert.equal(evidence.liveCutover, false);
  assert.equal(evidence.catalogMissDeny, false);
  assert.equal(evidence.operationId, OP);
  assert.equal(evidence.minimaReceiptTip, MINIMA_TIP);
  assert.equal(evidence.item5ReviewTip, ITEM5_TIP);
  assert.equal(evidence.baselineSha, gitOut(["rev-parse", "origin/main"]));
  assert.equal(evidence.originMainSha, evidence.baselineSha);
  assert.equal(evidence.branchShaAtStart, evidence.baselineSha);
  assert.equal(evidence.priorOperationId, "phase1b-item7-evidence-a3305d2767-20260820T021600Z");
  assert.equal(evidence.inventory.frozenWriteWatchIndex, 38);
  assert.equal(evidence.inventory.liveWriteWatchIndex, 37);
  assert.equal(evidence.inventory.retiredThisChange, 0);
  assert.equal(evidence.callSites.length, 37);
  assert.equal(scan.liveWriteWatchIndex, scan.sites.length);
  assert.ok(scan.liveWriteWatchIndex > 0);
  assert.ok(scan.liveWriteWatchIndex <= 37);
  assert.notEqual(scan.liveWriteWatchIndex, 0);
  assert.equal(ledger.frozenWriteWatchIndex, 38);
  assert.equal(ledger.sites.length, 38);
  assert.equal(current.item7ImplementationUnlocked, false);
  assert.equal(current.fullUnlock, "not-issued");
  assert.equal(evidence.implementationRequestDraft.requestsRetirement, false);
  assert.equal(evidence.reviewRequest, "Item 7 Evidence Preparation Review only");
  assert.doesNotMatch(packed, /\/Users\//);
  assert.doesNotMatch(packed, /\/root\//);
  assert.doesNotMatch(packed, new RegExp(I4));
  assert.ok(evidence.explicitlyForbidden.includes("Item 7 Retirement"));
  assert.ok(
    evidence.explicitlyForbidden.includes("deleting any productionWriteWatchIndex call-site"),
  );
  assert.ok(evidence.explicitlyForbidden.includes("deriving Item 7 met from inventory or dry-run"));
});

void test("item 7 call-sites are reproducible and each has a unique owner", () => {
  const evidence = load(EVIDENCE);
  const scan = load("memory-workspace-phase1b-item7-retirement-scan.json");
  const keys = new Set();
  for (const site of evidence.callSites) {
    assert.equal(typeof site.owner, "string");
    assert.ok(site.owner.length > 0);
    assert.equal(site.uniqueOwner, true);
    assert.equal(site.deleteNow, false);
    assert.ok(site.resourceDomain);
    assert.ok(site.tenantBoundary);
    assert.ok(site.riskClass);
    assert.ok(site.retirementWave);
    const key = `${site.file}|${site.line}|${site.symbol}|${site.op}`;
    assert.equal(keys.has(key), false, key);
    keys.add(key);
  }
  assert.equal(keys.size, 37);

  const scanKeys = new Set(
    scan.sites.map((site) => `${site.file}|${site.line}|${site.symbol}|${site.op}`),
  );
  for (const key of scanKeys) {
    assert.ok(keys.has(key), `live scan site missing from historical evidence: ${String(key)}`);
  }
  assert.ok(scanKeys.size > 0);
  assert.ok(scanKeys.size <= keys.size);

  const ownerCount = evidence.callSites.reduce((sum, site) => sum + (site.owner ? 1 : 0), 0);
  assert.equal(ownerCount, evidence.callSites.length);
});

void test("item 7 dry-run does not delete call-sites or rewrite Freeze", () => {
  const evidence = load(EVIDENCE);
  const measured = measureItem7Retirement();
  const phase0 = JSON.parse(
    fs.readFileSync(path.join(DIR, "memory-workspace-phase0-20260814.call-sites.json"), "utf8"),
  );

  assert.equal(measured.item7, "not-met");
  assert.equal(measured.retiredThisChange, 0);
  assert.equal(measured.phase0Rewritten, false);
  assert.equal(measured.i3Executed, false);
  assert.equal(measured.liveWriteWatchIndex, measured.sites.length);
  assert.ok(measured.liveWriteWatchIndex > 0);
  assert.notEqual(measured.liveWriteWatchIndex, 0);
  assert.equal(phase0.productionWriteWatchIndex, 38);
  assert.equal(evidence.dryRun.deletesCallSites, false);
  assert.equal(evidence.dryRun.modifiesProductionCode, false);
  assert.equal(evidence.retirementOrderDesign.executed, false);

  const srcDiff = gitOut(["diff", "--name-only", "origin/main", "--", "src/memory/schema-v2.ts"]);
  assert.doesNotMatch(srcDiff, /schema-v2/);

  assert.equal(
    evaluateItem7Retirement({
      implementationUnlocked: false,
      phase1bExecutionBlocked: true,
      deleteCallSite: true,
    }).reason,
    "delete-call-site-forbidden",
  );
  assert.equal(
    evaluateItem7Retirement({
      implementationUnlocked: false,
      phase1bExecutionBlocked: true,
      catalogMissDeny: true,
    }).reason,
    "catalog-miss-deny-forbidden",
  );
  assert.equal(
    evaluateItem7Retirement({
      implementationUnlocked: false,
      phase1bExecutionBlocked: true,
      rewriteFreeze: true,
    }).reason,
    "freeze-rewrite-forbidden",
  );
  const locked = evaluateItem7Retirement({
    implementationUnlocked: false,
    phase1bExecutionBlocked: true,
  });
  assert.equal(locked.allow, false);
  assert.equal(locked.reason, "retirement-locked");
  assert.equal(locked.retiredThisChange, 0);
});

void test("item 7 package and ancestry stay off the I4 dirty tree", () => {
  const pkg = readRepo(
    ".kiro/specs/memory-workspace-platform-remediation/phase1b-item7-evidence-package.md",
  );
  const handoff = readRepo(
    ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-item7-evidence.md",
  );
  assert.match(pkg, /evidence-preparation/);
  assert.match(pkg, /not-met/);
  assert.doesNotMatch(pkg, /phase1bExecutionBlocked=false/);
  assert.match(handoff, /Item 7 Evidence Preparation Review only/);
  assert.match(handoff, /does not request Item 7 implementation unlock/);
  assert.match(handoff, /## Not requested/);
  assert.ok(!REPO.includes(I4), REPO);
  assert.equal(gitOk(["merge-base", "--is-ancestor", MINIMA_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", ITEM5_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", "origin/main", "HEAD"]), true);
});
