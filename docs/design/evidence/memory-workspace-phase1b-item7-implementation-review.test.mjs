import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { measureItem7Retirement } from "./memory-workspace-phase1b-item7-retirement-scan.mjs";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const REVIEW = "memory-workspace-phase1b-item7-implementation-review.json";
const EVIDENCE = "memory-workspace-phase1b-item7-evidence.json";
const LEDGER = "memory-workspace-phase1b-item7-callsite-ledger.json";
const SCAN = "memory-workspace-phase1b-item7-retirement-scan.json";
const MINIMA_TIP = "ce6cf5e1702c7f2de20b58f062fd100562b6ee01";
const ITEM5_TIP = "85f55ee2fa76f88dc538180b481a5823631af649";
const BASELINE = "daa00a3d7006f2b7023f2540f276bc831f538317";
const LEDGER_MERGE = "c925b54ed9e48848a782a66064157cd085059367";
const OP = "phase1b-item7-implementation-review-daa00a3d70-20260820T054500Z";
const I4 = "openbot-data-governance-p4-later-i4-eval";
const HANDOFF =
  ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-item7-implementation-review.md";

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

function evaluateItem7ImplementationReview(input) {
  if (input.unlockImplementation === true) {
    return { allow: false, reason: "unlock-from-this-packet-forbidden", failClosed: true };
  }
  if (input.deleteCallSite === true) {
    return { allow: false, reason: "delete-call-site-forbidden", failClosed: true };
  }
  if (input.rewriteCountToZero === true) {
    return { allow: false, reason: "count-rewrite-forbidden", failClosed: true };
  }
  if (input.markItem7Met === true && input.liveWriteWatchIndex !== 0) {
    return { allow: false, reason: "item7-met-gate-not-satisfied", failClosed: true };
  }
  if (input.executeRetirement === true) {
    return { allow: false, reason: "retirement-forbidden", failClosed: true };
  }
  if (input.liveCutover === true) {
    return { allow: false, reason: "live-cutover-forbidden", failClosed: true };
  }
  return { allow: false, reason: "implementation-review-does-not-start-work", failClosed: true };
}

void test("item 7 implementation-review is not ledger or evidence-preparation and stays locked", () => {
  const review = load(REVIEW);
  const evidence = load(EVIDENCE);
  const ledger = load(LEDGER);
  const scan = load(SCAN);
  const current = load("memory-workspace-phase1b-unlock-current.json");
  const packed = JSON.stringify(review);

  assert.equal(review.schema, "memory-workspace-phase1b-item7-implementation-review/v1");
  assert.equal(review.kind, "item7-implementation-review");
  assert.notEqual(review.kind, "item7-evidence-preparation");
  assert.notEqual(review.kind, "item7-callsite-ledger");
  assert.equal(review.status, "implementation-review-submitted");
  assert.notEqual(review.status, "evidence-preparation");
  assert.equal(review.reviewRequest, "Item 7 Implementation Review only");
  assert.notEqual(review.reviewRequest, "Item 7 Evidence Preparation Review only");
  assert.equal(evidence.reviewRequest, "Item 7 Evidence Preparation Review only");
  assert.equal(ledger.reviewRequest, "Item 7 Evidence Preparation Review only");
  assert.equal(review.item7, "not-met");
  assert.equal(review.item7Met, false);
  assert.equal(review.implementationUnlocked, false);
  assert.equal(review.implementationStarted, false);
  assert.equal(review.retirement, "forbidden");
  assert.equal(review.retirementExecuted, false);
  assert.equal(review.thisPacketUnlocksImplementation, false);
  assert.equal(review.thisPacketMarksItem7Met, false);
  assert.equal(review.thisPacketExecutesRetirement, false);
  assert.equal(review.phase1bExecutionBlocked, true);
  assert.equal(review.deployAuthorized, false);
  assert.equal(review.wiredToProductionResolver, false);
  assert.equal(review.liveCutover, false);
  assert.equal(review.live, "forbidden");
  assert.equal(review.liveWriteWatchIndex, 37);
  assert.equal(review.frozenWriteWatchIndex, 38);
  assert.equal(review.retiredThisChange, 0);
  assert.equal(scan.liveWriteWatchIndex, scan.sites.length);
  assert.ok(scan.liveWriteWatchIndex > 0);
  assert.notEqual(scan.liveWriteWatchIndex, 0);
  assert.equal(ledger.liveWriteWatchIndex, 37);
  assert.equal(review.operationId, OP);
  assert.equal(review.baselineSha, BASELINE);
  assert.equal(review.baselineSha, gitOut(["rev-parse", "origin/main"]));
  assert.equal(review.citedLedgerMerge, LEDGER_MERGE);
  assert.equal(review.retargetFrom, LEDGER_MERGE);
  assert.equal(gitOk(["merge-base", "--is-ancestor", LEDGER_MERGE, "HEAD"]), true);
  assert.equal(review.minimaReceiptTip, MINIMA_TIP);
  assert.equal(review.item5ReviewTip, ITEM5_TIP);
  assert.equal(current.item6ImplementationUnlocked, false);
  assert.equal(current.item7ImplementationUnlocked, false);
  assert.equal(current.fullUnlock, "not-issued");
  assert.ok(review.thisPacketIsNot.includes("Item 7 evidence-preparation"));
  assert.ok(review.thisPacketIsNot.includes("Item 7 call-site ledger"));
  assert.ok(review.thisPacketIsNot.includes("existing SQLite review"));
  assert.ok(review.thisPacketIsNot.includes("Retirement inventory"));
  assert.doesNotMatch(packed, /\/Users\//);
  assert.doesNotMatch(packed, /\/root\//);
  assert.doesNotMatch(packed, new RegExp(I4));
});

void test("item 7 implementation-review dry-run does not delete call-sites or mark met", () => {
  const review = load(REVIEW);
  const measured = measureItem7Retirement();
  const schema = readRepo("src/memory/schema-v2.ts");

  assert.equal(measured.item7, "not-met");
  assert.equal(measured.retiredThisChange, 0);
  assert.equal(measured.liveWriteWatchIndex, measured.sites.length);
  assert.ok(measured.liveWriteWatchIndex > 0);
  assert.notEqual(measured.liveWriteWatchIndex, 0);
  assert.equal(review.dryRun.deletesCallSites, false);
  assert.equal(review.item7MetGate.thisPacketMarksItem7Met, false);
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);
  assert.doesNotMatch(
    gitOut(["diff", "--name-only", "origin/main", "--", "src/memory/schema-v2.ts"]),
    /schema-v2/,
  );

  assert.equal(
    evaluateItem7ImplementationReview({ unlockImplementation: true }).reason,
    "unlock-from-this-packet-forbidden",
  );
  assert.equal(
    evaluateItem7ImplementationReview({ deleteCallSite: true }).reason,
    "delete-call-site-forbidden",
  );
  assert.equal(
    evaluateItem7ImplementationReview({ rewriteCountToZero: true }).reason,
    "count-rewrite-forbidden",
  );
  assert.equal(
    evaluateItem7ImplementationReview({ markItem7Met: true, liveWriteWatchIndex: 37 }).reason,
    "item7-met-gate-not-satisfied",
  );
  assert.equal(
    evaluateItem7ImplementationReview({ executeRetirement: true }).reason,
    "retirement-forbidden",
  );
  assert.equal(
    evaluateItem7ImplementationReview({ liveCutover: true }).reason,
    "live-cutover-forbidden",
  );
  const locked = evaluateItem7ImplementationReview({});
  assert.equal(locked.allow, false);
  assert.equal(locked.reason, "implementation-review-does-not-start-work");
});

void test("item 7 implementation-review handoff requests Implementation Review only", () => {
  const handoff = readRepo(HANDOFF);
  assert.match(handoff, /Item 7 Implementation Review only/);
  assert.match(handoff, /does not request Item 7 implementation unlock/);
  assert.match(handoff, /does not request Item 7 met/);
  assert.match(handoff, /does not request Item 7 Retirement/);
  assert.doesNotMatch(handoff, /Item 7 Evidence Preparation Review only/);
  assert.ok(!REPO.includes(I4), REPO);
  assert.equal(gitOk(["merge-base", "--is-ancestor", MINIMA_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", ITEM5_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", "origin/main", "HEAD"]), true);
});
