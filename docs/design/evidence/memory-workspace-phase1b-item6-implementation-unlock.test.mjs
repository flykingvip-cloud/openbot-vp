import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyAuthorizedSqlitePath } from "./openbot-cogniweave-u1-item6-production-equivalent-drill.mjs";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const REQUEST = "memory-workspace-phase1b-item6-implementation-unlock-request.json";
const PROPOSED = "memory-workspace-phase1b-item6-implementation-unlock-proposed-receipt.json";
const REVIEW = "memory-workspace-phase1b-item6-implementation-review.json";
const CANONICAL = "memory-workspace-phase1b-unlock-decision.json";
const MINIMA_ISSUED = "memory-workspace-phase1b-unlock-minima-issued-receipt.json";
const CURRENT = "memory-workspace-phase1b-unlock-current.json";
const MINIMA_TIP = "ce6cf5e1702c7f2de20b58f062fd100562b6ee01";
const ITEM5_TIP = "85f55ee2fa76f88dc538180b481a5823631af649";
const BASELINE = "775022ced88f459afea84bc5c3b3ef5a13a163b1";
const REVIEW_MERGE = "7aaa532f6b5a17e39343d7ab03811801fbcf8faa";
const ITEM7_UNLOCK_MERGE = "775022ced88f459afea84bc5c3b3ef5a13a163b1";
const OP = "phase1b-item6-implementation-unlock-775022ced8-20260820T155800Z";
const I4 = "openbot-data-governance-p4-later-i4-eval";
const HANDOFF =
  "docs/design/evidence/memory-workspace-phase1b-item6-implementation-unlock-handoff.md";

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

function evaluateItem6ImplementationUnlock(input) {
  if (input.selfIssue === true) {
    return { allow: false, reason: "self-issue-forbidden", failClosed: true };
  }
  if (input.markItem6Met === true) {
    return { allow: false, reason: "item6-met-from-this-packet-forbidden", failClosed: true };
  }
  if (input.productionSqliteWrite === true) {
    return { allow: false, reason: "production-sqlite-write-forbidden", failClosed: true };
  }
  if (input.unlockItem7 === true) {
    return { allow: false, reason: "item7-unlock-from-this-packet-forbidden", failClosed: true };
  }
  if (input.liveCutover === true) {
    return { allow: false, reason: "live-cutover-forbidden", failClosed: true };
  }
  if (input.treatProposedAsIssued === true) {
    return { allow: false, reason: "proposed-is-not-issued", failClosed: true };
  }
  return { allow: false, reason: "unlock-not-issued", failClosed: true };
}

void test("item 6 implementation-unlock request does not issue unlock or mark met", () => {
  const request = load(REQUEST);
  const proposed = load(PROPOSED);
  const review = load(REVIEW);
  const canonical = load(CANONICAL);
  const minima = load(MINIMA_ISSUED);
  const current = load(CURRENT);
  const packed = JSON.stringify(request);

  assert.equal(request.schema, "memory-workspace-phase1b-item6-implementation-unlock-request/v1");
  assert.equal(request.kind, "item6-implementation-unlock-decision-package");
  assert.equal(request.reviewRequest, "Item 6 Implementation Unlock Decision Review");
  assert.equal(request.decision, "submitted-for-independent-review");
  assert.equal(request.unlock, "not-issued");
  assert.equal(request.stamped, false);
  assert.equal(request.signedBy, null);
  assert.equal(request.item6, "not-met");
  assert.equal(request.item6Met, false);
  assert.equal(request.item6ImplementationUnlocked, false);
  assert.equal(request.item7ImplementationUnlocked, false);
  assert.equal(request.implementationUnlocked, false);
  assert.equal(request.retirement, "forbidden");
  assert.equal(request.thisPacketIssuesUnlock, false);
  assert.equal(request.thisPacketMarksItem6Met, false);
  assert.equal(request.thisPacketUnlocksItem7, false);
  assert.equal(request.thisPacketWritesProductionSqlite, false);
  assert.equal(request.phase1bUnlock, "not-issued");
  assert.equal(request.phase1bExecutionBlocked, true);
  assert.equal(request.productionCatalogWrite, "none");
  assert.equal(request.schemaV2Write, "disabled");
  assert.equal(request.productionSqliteWrite, false);
  assert.equal(request.deployAuthorized, false);
  assert.equal(request.live, "forbidden");
  assert.equal(request.liveWriteWatchIndex, 37);
  assert.equal(request.frozenWriteWatchIndex, 38);
  assert.equal(request.operationId, OP);
  assert.equal(request.baselineSha, BASELINE);
  assert.equal(request.implementationReviewMerge, REVIEW_MERGE);
  assert.equal(request.item7UnlockRequestMerge, ITEM7_UNLOCK_MERGE);
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", "origin/main", "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", MINIMA_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", ITEM5_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", REVIEW_MERGE, "HEAD"]), true);

  assert.equal(review.status, "implementation-review-submitted");
  assert.equal(review.thisPacketUnlocksImplementation, false);
  assert.equal(canonical.unlock, "not-issued");
  assert.equal(canonical.items["6"], "met");
  assert.equal(request.item6, "not-met");
  assert.equal(minima.item6ImplementationUnlocked, false);
  assert.equal(minima.item7ImplementationUnlocked, false);
  assert.equal(minima.fullUnlock, "not-issued");
  assert.equal(current.item6ImplementationUnlocked, true);
  assert.equal(current.item7ImplementationUnlocked, true);

  assert.equal(proposed.status, "proposed");
  assert.equal(proposed.effective, false);
  assert.equal(proposed.signedBy, null);
  assert.equal(proposed.unlock, "not-issued");
  assert.equal(proposed.item6, "not-met");
  assert.equal(proposed.item6ImplementationUnlocked, true);
  assert.equal(proposed.item7ImplementationUnlocked, false);
  assert.equal(proposed.productionSqliteWrite, false);
  assert.notEqual(proposed.status, "issued");
  assert.ok(request.thisPacketIsNot.includes("Item 6 evidence-preparation"));
  assert.ok(request.thisPacketIsNot.includes("existing SQLite/production-equivalent review"));
  assert.ok(request.thisPacketIsNot.includes("Item 6 implementation-review"));
  assert.ok(request.thisPacketIsNot.includes("Item 7 implementation-unlock request"));
  assert.ok(request.stillForbiddenAfterApproval.includes("score item 6 met from this packet"));
  assert.ok(
    request.stillForbiddenAfterApproval.includes(
      "host search or treat ~/.openbot / evidence / mkdtemp as production SoT",
    ),
  );
  assert.ok(request.stillForbiddenAfterApproval.includes("Item 7 implementation from this packet"));
  assert.doesNotMatch(packed, new RegExp(I4));
  assert.ok(!REPO.includes(I4), REPO);
});

void test("item 6 implementation-unlock fail-closed evaluator denies self-issue and sqlite write", () => {
  const request = load(REQUEST);
  const schema = readRepo("src/memory/schema-v2.ts");
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);
  assert.doesNotMatch(
    gitOut(["diff", "--name-only", "origin/main", "--", "src/memory/schema-v2.ts"]),
    /schema-v2/,
  );
  assert.equal(request.sqliteIdentity.requireExplicitPath, true);
  assert.equal(request.sqliteIdentity.forbidHostSearch, true);
  assert.equal(request.sqliteIdentity.failClosedOnUnknownIdentity, true);
  assert.equal(request.sqliteIdentity.authorizedEnv, "OPENBOT_AUTHORIZED_SQLITE_PATH");

  const evidencePath = path.join(DIR, REQUEST);
  const host = path.join(os.homedir(), ".openbot", "memory", "fixture.sqlite");
  const tmp = path.join(os.tmpdir(), "openbot-item6-implementation-unlock-fixture.sqlite");
  assert.equal(
    classifyAuthorizedSqlitePath({ OPENBOT_AUTHORIZED_SQLITE_PATH: "" }).status,
    "unconfigured",
  );
  assert.equal(
    classifyAuthorizedSqlitePath({
      OPENBOT_AUTHORIZED_SQLITE_PATH: evidencePath,
      OPENBOT_AUTHORIZED_SQLITE_TRUSTED_ROOT: DIR,
    }).status,
    "rejected-evidence-path",
  );
  assert.equal(
    classifyAuthorizedSqlitePath({
      OPENBOT_AUTHORIZED_SQLITE_PATH: host,
      OPENBOT_AUTHORIZED_SQLITE_TRUSTED_ROOT: path.dirname(path.dirname(host)),
    }).status,
    "host-not-production-sot",
  );
  assert.equal(
    classifyAuthorizedSqlitePath({
      OPENBOT_AUTHORIZED_SQLITE_PATH: tmp,
      OPENBOT_AUTHORIZED_SQLITE_TRUSTED_ROOT: os.tmpdir(),
    }).status,
    "rejected-fixture-path",
  );

  assert.equal(
    evaluateItem6ImplementationUnlock({ selfIssue: true }).reason,
    "self-issue-forbidden",
  );
  assert.equal(
    evaluateItem6ImplementationUnlock({ markItem6Met: true }).reason,
    "item6-met-from-this-packet-forbidden",
  );
  assert.equal(
    evaluateItem6ImplementationUnlock({ productionSqliteWrite: true }).reason,
    "production-sqlite-write-forbidden",
  );
  assert.equal(
    evaluateItem6ImplementationUnlock({ unlockItem7: true }).reason,
    "item7-unlock-from-this-packet-forbidden",
  );
  assert.equal(
    evaluateItem6ImplementationUnlock({ treatProposedAsIssued: true }).reason,
    "proposed-is-not-issued",
  );
  const locked = evaluateItem6ImplementationUnlock({});
  assert.equal(locked.allow, false);
  assert.equal(locked.reason, "unlock-not-issued");
});

void test("item 6 implementation-unlock handoff requests Decision Review only", () => {
  const handoff = readRepo(HANDOFF);
  assert.match(handoff, /Item 6 Implementation Unlock Decision Review/);
  assert.match(handoff, /does not issue Item 6 implementation unlock/);
  assert.match(handoff, /does not request Item 6 met/);
  assert.match(handoff, /signedBy=null/);
  assert.doesNotMatch(handoff, /Item 6 Implementation Review only/);
  assert.doesNotMatch(handoff, /phase1bExecutionBlocked=false/);
});
