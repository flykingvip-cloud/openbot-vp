import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const REQUEST = "memory-workspace-phase1b-item7-retirement-review-request.json";
const PROPOSED = "memory-workspace-phase1b-item7-retirement-review-proposed-receipt.json";
const PREFLIGHT = "memory-workspace-phase1b-item7-retirement-preflight.json";
const CURRENT = "memory-workspace-phase1b-unlock-current.json";
const CANONICAL = "memory-workspace-phase1b-unlock-decision.json";
const MINIMA_ISSUED = "memory-workspace-phase1b-unlock-minima-issued-receipt.json";
const MINIMA_TIP = "ce6cf5e1702c7f2de20b58f062fd100562b6ee01";
const ITEM5_TIP = "85f55ee2fa76f88dc538180b481a5823631af649";
const BASELINE = "e5e707264498a9b29fe92acb3d3df42d3c6c5816";
const LOCATOR_MERGE = "751c9af985d05d7b73f59fe785cef9d5fccda2f4";
const OP = "phase1b-item7-retirement-review-e5e7072644-20260822T070200Z";
const I4 = "openbot-data-governance-p4-later-i4-eval";
const HANDOFF = "docs/design/evidence/memory-workspace-phase1b-item7-retirement-review-handoff.md";

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

function evaluateItem7RetirementReview(input) {
  if (input.selfIssue === true) {
    return { allow: false, reason: "self-issue-forbidden", failClosed: true };
  }
  if (input.markItem7Met === true) {
    return { allow: false, reason: "item7-met-from-this-packet-forbidden", failClosed: true };
  }
  if (input.deleteCallSite === true) {
    return { allow: false, reason: "delete-call-site-forbidden", failClosed: true };
  }
  if (input.executeRetirement === true) {
    return {
      allow: false,
      reason: "retirement-execute-from-this-packet-forbidden",
      failClosed: true,
    };
  }
  if (input.liveCutover === true) {
    return { allow: false, reason: "live-cutover-forbidden", failClosed: true };
  }
  if (input.treatProposedAsIssued === true) {
    return { allow: false, reason: "proposed-is-not-issued", failClosed: true };
  }
  return { allow: false, reason: "review-not-accepted", failClosed: true };
}

void test("item 7 retirement-review request does not accept review, delete sites, or mark met", () => {
  const request = load(REQUEST);
  const proposed = load(PROPOSED);
  const preflight = load(PREFLIGHT);
  const current = load(CURRENT);
  const canonical = load(CANONICAL);
  const minima = load(MINIMA_ISSUED);
  const packed = JSON.stringify(request);

  assert.equal(request.schema, "memory-workspace-phase1b-item7-retirement-review-request/v1");
  assert.equal(request.kind, "item7-retirement-preflight-review-decision-package");
  assert.equal(request.reviewRequest, "Item 7 Retirement Preflight Review Acceptance");
  assert.equal(request.decision, "submitted-for-independent-review");
  assert.equal(request.independentRetirementReviewAccepted, false);
  assert.equal(request.stamped, false);
  assert.equal(request.signedBy, null);
  assert.equal(request.item7, "not-met");
  assert.equal(request.item7Met, false);
  assert.equal(request.item7RetirementUnlocked, true);
  assert.equal(request.retirementExecuted, false);
  assert.equal(request.thisPacketAcceptsReview, false);
  assert.equal(request.thisPacketMarksItem7Met, false);
  assert.equal(request.thisPacketDeletesCallSites, false);
  assert.equal(request.thisPacketExecutesRetirement, false);
  assert.equal(request.thisPacketWiresProductionResolver, false);
  assert.equal(request.phase1bUnlock, "not-issued");
  assert.equal(request.phase1bExecutionBlocked, true);
  assert.equal(request.productionCatalogWrite, "none");
  assert.equal(request.schemaV2Write, "disabled");
  assert.equal(request.deployAuthorized, false);
  assert.equal(request.live, "forbidden");
  assert.equal(request.productionWriteWatchIndex, 38);
  assert.equal(request.liveWriteWatchIndex, 37);
  assert.equal(request.retiredThisChange, 0);
  assert.equal(request.rollbackProof, true);
  assert.equal(request.quarantineProof, true);
  assert.equal(request.replacement, "resolveWorkspaceLocator");
  assert.equal(request.operationId, OP);
  assert.equal(request.baselineSha, BASELINE);
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", LOCATOR_MERGE, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", MINIMA_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", ITEM5_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", "origin/main", "HEAD"]), true);

  assert.equal(preflight.independentRetirementReviewAccepted, true);
  assert.equal(preflight.rollbackProof, true);
  assert.equal(preflight.quarantineProof, true);
  assert.equal(current.item7RetirementUnlocked, true);
  assert.equal(current.retirementExecuted, false);
  assert.equal(current.fullUnlock, "not-issued");
  assert.equal(canonical.unlock, "not-issued");
  assert.equal(canonical.items["7"], "not-met");
  assert.equal(minima.fullUnlock, "not-issued");

  assert.equal(proposed.status, "proposed");
  assert.equal(proposed.effective, false);
  assert.equal(proposed.signedBy, null);
  assert.equal(proposed.independentRetirementReviewAccepted, true);
  assert.equal(proposed.deleteCallSites, false);
  assert.equal(proposed.item7, "not-met");
  assert.notEqual(proposed.status, "issued");
  assert.ok(
    request.stillForbiddenAfterApproval.includes(
      "score item 7 met while liveWriteWatchIndex is not 0",
    ),
  );
  assert.ok(
    request.stillForbiddenAfterApproval.includes(
      "rewrite liveWriteWatchIndex 37 to 0 without deleting sites",
    ),
  );
  assert.ok(
    request.stillForbiddenAfterApproval.includes(
      "use a snapshot/agentId/endsWith Catalog fallback instead of resolveWorkspaceLocator",
    ),
  );
  assert.doesNotMatch(packed, new RegExp(I4));
  assert.ok(!REPO.includes(I4), REPO);
});

void test("item 7 retirement-review fail-closed evaluator denies self-issue, delete, and met", () => {
  const schema = readRepo("src/memory/schema-v2.ts");
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);
  assert.equal(gitOut(["diff", "--name-only", "origin/main", "--", "src"]), "");
  assert.equal(evaluateItem7RetirementReview({ selfIssue: true }).reason, "self-issue-forbidden");
  assert.equal(
    evaluateItem7RetirementReview({ markItem7Met: true }).reason,
    "item7-met-from-this-packet-forbidden",
  );
  assert.equal(
    evaluateItem7RetirementReview({ deleteCallSite: true }).reason,
    "delete-call-site-forbidden",
  );
  assert.equal(
    evaluateItem7RetirementReview({ executeRetirement: true }).reason,
    "retirement-execute-from-this-packet-forbidden",
  );
  assert.equal(
    evaluateItem7RetirementReview({ treatProposedAsIssued: true }).reason,
    "proposed-is-not-issued",
  );
  const locked = evaluateItem7RetirementReview({});
  assert.equal(locked.allow, false);
  assert.equal(locked.reason, "review-not-accepted");
});

void test("item 7 retirement-review handoff requests Acceptance only", () => {
  const handoff = readRepo(HANDOFF);
  assert.match(handoff, /Item 7 Retirement Preflight Review Acceptance/);
  assert.match(handoff, /does not accept `independentRetirementReviewAccepted`/);
  assert.match(handoff, /does not delete productionWriteWatchIndex call-sites/);
  assert.match(handoff, /signedBy=null/);
  assert.doesNotMatch(handoff, /phase1bExecutionBlocked=false/);
  assert.doesNotMatch(handoff, /liveWriteWatchIndex=0/);
});
