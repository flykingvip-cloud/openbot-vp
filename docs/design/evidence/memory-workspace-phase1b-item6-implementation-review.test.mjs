import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyAuthorizedSqlitePath } from "./openbot-cogniweave-u1-item6-production-equivalent-drill.mjs";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const REVIEW = "memory-workspace-phase1b-item6-implementation-review.json";
const EVIDENCE = "memory-workspace-phase1b-item6-evidence.json";
const MINIMA_TIP = "ce6cf5e1702c7f2de20b58f062fd100562b6ee01";
const ITEM5_TIP = "85f55ee2fa76f88dc538180b481a5823631af649";
const BASELINE = "d650a3fafa59192bef7823357d74eeca648e6ecf";
const LEDGER_MERGE = "c925b54ed9e48848a782a66064157cd085059367";
const OP = "phase1b-item6-implementation-review-d650a3fafa-20260820T051700Z";
const I4 = "openbot-data-governance-p4-later-i4-eval";
const HANDOFF =
  ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-item6-implementation-review.md";

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

function evaluateItem6ImplementationReview(input) {
  if (input.unlockImplementation === true) {
    return { allow: false, reason: "unlock-from-this-packet-forbidden", failClosed: true };
  }
  if (input.markItem6Met === true) {
    return { allow: false, reason: "item6-met-from-this-packet-forbidden", failClosed: true };
  }
  if (input.liveCutover === true) {
    return { allow: false, reason: "live-cutover-forbidden", failClosed: true };
  }
  if (input.implementationUnlocked === true) {
    return { allow: false, reason: "implementation-still-locked", failClosed: true };
  }
  if (input.phase1bExecutionBlocked !== true) {
    return { allow: false, reason: "execution-not-blocked", failClosed: true };
  }
  if (input.write === true) {
    return { allow: false, reason: "production-write-forbidden", failClosed: true };
  }
  return { allow: false, reason: "implementation-review-does-not-start-work", failClosed: true };
}

void test("item 6 implementation-review is not evidence-preparation and stays locked", () => {
  const review = load(REVIEW);
  const evidence = load(EVIDENCE);
  const current = load("memory-workspace-phase1b-unlock-current.json");
  const u1 = load("openbot-cogniweave-u1-item6-production-equivalent-receipt.json");
  const packed = JSON.stringify(review);

  assert.equal(review.schema, "memory-workspace-phase1b-item6-implementation-review/v1");
  assert.equal(review.kind, "item6-implementation-review");
  assert.notEqual(review.kind, "item6-evidence-preparation");
  assert.equal(review.status, "implementation-review-submitted");
  assert.notEqual(review.status, "evidence-preparation");
  assert.equal(review.reviewRequest, "Item 6 Implementation Review only");
  assert.notEqual(review.reviewRequest, "Item 6 Evidence Preparation Review only");
  assert.equal(evidence.reviewRequest, "Item 6 Evidence Preparation Review only");
  assert.equal(review.item6, "not-met");
  assert.equal(review.item6Met, false);
  assert.equal(review.implementationUnlocked, false);
  assert.equal(review.implementationStarted, false);
  assert.equal(review.thisPacketUnlocksImplementation, false);
  assert.equal(review.thisPacketMarksItem6Met, false);
  assert.equal(review.phase1bExecutionBlocked, true);
  assert.equal(review.deployAuthorized, false);
  assert.equal(review.wiredToProductionResolver, false);
  assert.equal(review.liveCutover, false);
  assert.equal(review.live, "forbidden");
  assert.equal(review.item7Retirement, "forbidden");
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
  assert.equal(u1.item6Candidate, "met");
  assert.notEqual(review.item6, "met");
  assert.equal(review.productionEquivalentReadOnly.citedReceiptIsNotThisReview, true);
  assert.ok(review.thisPacketIsNot.includes("Item 6 evidence-preparation"));
  assert.ok(review.thisPacketIsNot.includes("existing SQLite review"));
  assert.ok(review.thisPacketIsNot.includes("Item 7 call-site ledger"));
  assert.ok(review.thisPacketIsNot.includes("Retirement inventory"));
  assert.doesNotMatch(packed, /\/Users\//);
  assert.doesNotMatch(packed, /\/root\//);
  assert.doesNotMatch(packed, new RegExp(I4));
});

void test("item 6 implementation-review keeps sqlite identity fail-closed and does not write", () => {
  const review = load(REVIEW);
  const schema = readRepo("src/memory/schema-v2.ts");
  assert.equal(review.dryRun.productionWrites, 0);
  assert.equal(review.fencingDesign.productionWriterEnabled, false);
  assert.equal(review.rollbackDesign.productionWriteBack, "forbidden");
  assert.equal(review.identityRules.failClosedOnUnknownIdentity, true);
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);
  assert.doesNotMatch(
    gitOut(["diff", "--name-only", "origin/main", "--", "src/memory/schema-v2.ts"]),
    /schema-v2/,
  );

  const evidencePath = path.join(DIR, REVIEW);
  const host = path.join(os.homedir(), ".openbot", "memory", "fixture.sqlite");
  const tmp = path.join(os.tmpdir(), "openbot-item6-implementation-review-fixture.sqlite");
  assert.equal(
    classifyAuthorizedSqlitePath({ OPENBOT_AUTHORIZED_SQLITE_PATH: "" }).status,
    "unconfigured",
  );
  assert.equal(
    classifyAuthorizedSqlitePath({ OPENBOT_AUTHORIZED_SQLITE_PATH: evidencePath }).status,
    "rejected-evidence-path",
  );
  assert.equal(
    classifyAuthorizedSqlitePath({ OPENBOT_AUTHORIZED_SQLITE_PATH: host }).status,
    "host-not-production-sot",
  );
  assert.equal(
    classifyAuthorizedSqlitePath({ OPENBOT_AUTHORIZED_SQLITE_PATH: tmp }).status,
    "rejected-fixture-path",
  );

  assert.equal(
    evaluateItem6ImplementationReview({ unlockImplementation: true }).reason,
    "unlock-from-this-packet-forbidden",
  );
  assert.equal(
    evaluateItem6ImplementationReview({ markItem6Met: true }).reason,
    "item6-met-from-this-packet-forbidden",
  );
  assert.equal(
    evaluateItem6ImplementationReview({
      implementationUnlocked: false,
      phase1bExecutionBlocked: true,
      write: true,
    }).reason,
    "production-write-forbidden",
  );
  assert.equal(
    evaluateItem6ImplementationReview({ liveCutover: true }).reason,
    "live-cutover-forbidden",
  );
  const locked = evaluateItem6ImplementationReview({
    implementationUnlocked: false,
    phase1bExecutionBlocked: true,
    write: false,
  });
  assert.equal(locked.allow, false);
  assert.equal(locked.reason, "implementation-review-does-not-start-work");
});

void test("item 6 implementation-review handoff requests Implementation Review only", () => {
  const handoff = readRepo(HANDOFF);
  assert.match(handoff, /Item 6 Implementation Review only/);
  assert.match(handoff, /does not request Item 6 implementation unlock/);
  assert.match(handoff, /does not request Item 6 met/);
  assert.doesNotMatch(handoff, /Item 6 Evidence Preparation Review only/);
  assert.ok(!REPO.includes(I4), REPO);
  assert.equal(gitOk(["merge-base", "--is-ancestor", MINIMA_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", ITEM5_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", "origin/main", "HEAD"]), true);
});
