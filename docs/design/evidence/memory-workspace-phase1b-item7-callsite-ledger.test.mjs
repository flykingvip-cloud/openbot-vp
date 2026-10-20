import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { measureItem7Retirement } from "./memory-workspace-phase1b-item7-retirement-scan.mjs";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const LEDGER = "memory-workspace-phase1b-item7-callsite-ledger.json";
const SCAN = "memory-workspace-phase1b-item7-retirement-scan.json";
const EVIDENCE = "memory-workspace-phase1b-item7-evidence.json";
const MINIMA_TIP = "ce6cf5e1702c7f2de20b58f062fd100562b6ee01";
const ITEM5_TIP = "85f55ee2fa76f88dc538180b481a5823631af649";
const BASELINE = "104c3d5636bfc941998efbc47e641a8045895468";
const CITED_USER_BASELINE = "f495f7a6a17ea5a1b4bdbfbec83842501b3ef38f";
const OP = "phase1b-item7-callsite-ledger-104c3d5636-20260820T044500Z";
const I4 = "openbot-data-governance-p4-later-i4-eval";
const REQUIRED_FIELDS = [
  "file",
  "symbol",
  "currentWriteBehavior",
  "replacementPath",
  "owner",
  "rollback",
  "quarantine",
  "retirementPrerequisite",
];

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

function evaluateItem7Ledger(input) {
  if (input.deleteCallSite === true) {
    return { allow: false, reason: "delete-call-site-forbidden", failClosed: true };
  }
  if (input.rewriteCountToZero === true) {
    return { allow: false, reason: "count-rewrite-forbidden", failClosed: true };
  }
  if (input.markItem7Met === true && input.liveWriteWatchIndex !== 0) {
    return { allow: false, reason: "item7-met-gate-not-satisfied", failClosed: true };
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
  if (input.liveCutover === true) {
    return { allow: false, reason: "live-cutover-forbidden", failClosed: true };
  }
  return { allow: false, reason: "retirement-locked", failClosed: true, retiredThisChange: 0 };
}

void test("item 7 callsite ledger stays preparation-only at 37 and not-met", () => {
  const ledger = load(LEDGER);
  const scan = load(SCAN);
  const evidence = load(EVIDENCE);
  const packed = JSON.stringify(ledger);

  assert.equal(ledger.schema, "memory-workspace-phase1b-item7-callsite-ledger/v1");
  assert.equal(ledger.status, "evidence-preparation");
  assert.equal(ledger.item7, "not-met");
  assert.equal(ledger.item7Met, false);
  assert.equal(ledger.implementationUnlocked, false);
  assert.equal(ledger.retirement, "forbidden");
  assert.equal(ledger.retirementExecuted, false);
  assert.equal(ledger.operationId, OP);
  assert.equal(ledger.baselineSha, BASELINE);
  assert.equal(ledger.baselineSha, gitOut(["rev-parse", "origin/main"]));
  assert.equal(ledger.citedUserBaseline, CITED_USER_BASELINE);
  assert.equal(ledger.retargetFrom, CITED_USER_BASELINE);
  assert.equal(ledger.minimaReceiptTip, MINIMA_TIP);
  assert.equal(ledger.item5ReviewTip, ITEM5_TIP);
  assert.equal(gitOk(["merge-base", "--is-ancestor", CITED_USER_BASELINE, "HEAD"]), true);
  assert.equal(ledger.phase1bExecutionBlocked, true);
  assert.equal(ledger.deployAuthorized, false);
  assert.equal(ledger.wiredToProductionResolver, false);
  assert.equal(ledger.liveCutover, false);
  assert.equal(ledger.live, "forbidden");
  assert.equal(ledger.productionCatalogWrite, "none");
  assert.equal(ledger.schemaV2Write, "disabled");
  assert.equal(ledger.productionWriteWatchIndex, 37);
  assert.equal(ledger.liveWriteWatchIndex, 37);
  assert.equal(ledger.frozenWriteWatchIndex, 38);
  assert.equal(ledger.retiredThisChange, 0);
  assert.equal(ledger.remaining, 37);
  assert.equal(ledger.sites.length, 37);
  assert.equal(scan.liveWriteWatchIndex, scan.sites.length);
  assert.ok(scan.liveWriteWatchIndex > 0);
  assert.ok(scan.liveWriteWatchIndex <= 37);
  assert.notEqual(scan.liveWriteWatchIndex, 0);
  assert.equal(evidence.callSites.length, 37);
  assert.equal(ledger.item7MetGate.thisPacketMarksItem7Met, false);
  assert.equal(ledger.item7MetGate.liveWriteWatchIndexMustBe, 0);
  assert.equal(ledger.reviewRequest, "Item 7 Evidence Preparation Review only");
  assert.doesNotMatch(packed, /\/Users\//);
  assert.doesNotMatch(packed, /\/root\//);
  assert.doesNotMatch(packed, new RegExp(I4));
  assert.ok(
    ledger.explicitlyForbidden.includes("rewriting liveWriteWatchIndex 37 to 0 in this packet"),
  );
  assert.ok(
    ledger.explicitlyForbidden.includes("deleting any productionWriteWatchIndex call-site"),
  );
});

void test("each of 37 sites has file, symbol, write behavior, replacement, owner, rollback, quarantine, prerequisite", () => {
  const ledger = load(LEDGER);
  const scan = load(SCAN);
  const keys = new Set();
  for (const site of ledger.sites) {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(site[field], `${site.ledgerId} missing ${field}`);
    }
    assert.equal(typeof site.owner, "string");
    assert.equal(site.uniqueOwner, true);
    assert.equal(site.deleteNow, false);
    assert.equal(site.retiredThisChange, false);
    assert.equal(site.replacementImplemented, false);
    assert.equal(site.rollback.restoreFromGit, true);
    assert.equal(site.rollback.rewriteFreezeBaselineToZero, false);
    assert.equal(site.quarantine.enabled, false);
    assert.equal(site.quarantine.quarantineNormalWrites, 0);
    const key = `${site.file}|${site.line}|${site.symbol}|${site.op}`;
    assert.equal(keys.has(key), false, key);
    keys.add(key);
    const src = fs.readFileSync(path.join(REPO, site.file), "utf8").split(/\n/);
    assert.ok(src[site.line - 1], `${key} cited line missing`);
  }
  assert.equal(keys.size, 37);
  const scanKeys = new Set(
    scan.sites.map((site) => `${site.file}|${site.line}|${site.symbol}|${site.op}`),
  );
  for (const key of scanKeys) {
    assert.ok(keys.has(key), `live scan site missing from historical ledger: ${String(key)}`);
  }
  assert.ok(scanKeys.size > 0);
  assert.ok(scanKeys.size <= keys.size);
});

void test("dry-run does not delete call-sites, rewrite Freeze, or mark item 7 met", () => {
  const ledger = load(LEDGER);
  const measured = measureItem7Retirement();
  const phase0 = JSON.parse(
    fs.readFileSync(path.join(DIR, "memory-workspace-phase0-20260814.call-sites.json"), "utf8"),
  );
  const schema = readRepo("src/memory/schema-v2.ts");

  assert.equal(measured.item7, "not-met");
  assert.equal(measured.retiredThisChange, 0);
  assert.equal(measured.liveWriteWatchIndex, measured.sites.length);
  assert.ok(measured.liveWriteWatchIndex > 0);
  assert.notEqual(measured.liveWriteWatchIndex, 0);
  assert.equal(phase0.productionWriteWatchIndex, 38);
  assert.equal(ledger.dryRun.deletesCallSites, false);
  assert.equal(ledger.dryRun.modifiesProductionCode, false);
  assert.equal(ledger.dryRun.rewritesPhase0Freeze, false);
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);
  assert.doesNotMatch(
    gitOut(["diff", "--name-only", "origin/main", "--", "src/memory/schema-v2.ts"]),
    /schema-v2/,
  );

  assert.equal(evaluateItem7Ledger({ deleteCallSite: true }).reason, "delete-call-site-forbidden");
  assert.equal(evaluateItem7Ledger({ rewriteCountToZero: true }).reason, "count-rewrite-forbidden");
  assert.equal(
    evaluateItem7Ledger({ markItem7Met: true, liveWriteWatchIndex: 37 }).reason,
    "item7-met-gate-not-satisfied",
  );
  assert.equal(evaluateItem7Ledger({ schemaV2Write: true }).reason, "schema-v2-write-forbidden");
  assert.equal(
    evaluateItem7Ledger({ resolverProductionWrite: true }).reason,
    "resolver-write-forbidden",
  );
  assert.equal(evaluateItem7Ledger({ catalogWrite: true }).reason, "catalog-write-forbidden");
  assert.equal(evaluateItem7Ledger({ liveCutover: true }).reason, "live-cutover-forbidden");
  const locked = evaluateItem7Ledger({});
  assert.equal(locked.allow, false);
  assert.equal(locked.reason, "retirement-locked");
  assert.equal(locked.retiredThisChange, 0);
});

void test("handoff requests Item 7 evidence-preparation review only", () => {
  const pkg = readRepo("docs/design/evidence/memory-workspace-phase1b-item7-callsite-ledger.md");
  const handoff = readRepo(
    "docs/design/evidence/memory-workspace-phase1b-item7-callsite-ledger-handoff.md",
  );
  assert.match(pkg, /evidence-preparation/);
  assert.match(pkg, /not-met/);
  assert.match(pkg, /productionWriteWatchIndex=37/);
  assert.match(pkg, /live=forbidden/);
  assert.doesNotMatch(pkg, /phase1bExecutionBlocked=false/);
  assert.match(handoff, /Item 7 Evidence Preparation Review only/);
  assert.match(handoff, /does not request Item 7 implementation unlock/);
  assert.match(handoff, /does not request Item 7 met/);
  assert.ok(!REPO.includes(I4), REPO);
  assert.equal(gitOk(["merge-base", "--is-ancestor", MINIMA_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", ITEM5_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", "origin/main", "HEAD"]), true);
});
