import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyAuthorizedSqlitePath } from "./openbot-cogniweave-u1-item6-production-equivalent-drill.mjs";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const BUNDLE = "memory-workspace-phase1b-item6-item7-implementation-unlock-parallel-issuance.json";
const ITEM6_ISSUED = "memory-workspace-phase1b-item6-implementation-unlock-issued-receipt.json";
const ITEM7_ISSUED = "memory-workspace-phase1b-item7-implementation-unlock-issued-receipt.json";
const POINTER_PROPOSED =
  "memory-workspace-phase1b-unlock-current-item6-item7-implementation-unlock-proposed.json";
const CURRENT = "memory-workspace-phase1b-unlock-current.json";
const CANONICAL = "memory-workspace-phase1b-unlock-decision.json";
const MINIMA_ISSUED = "memory-workspace-phase1b-unlock-minima-issued-receipt.json";
const ITEM6_REQUEST = "memory-workspace-phase1b-item6-implementation-unlock-request.json";
const ITEM7_REQUEST = "memory-workspace-phase1b-item7-implementation-unlock-request.json";
const ISSUANCE_MERGE = "d3fd0f62cd9d979a07e0a64366127d62088485a2";
const ITEM7_UNLOCK_MERGE = "775022ced88f459afea84bc5c3b3ef5a13a163b1";
const ITEM6_REVIEW_MERGE = "7aaa532f6b5a17e39343d7ab03811801fbcf8faa";
const ITEM7_REVIEW_MERGE = "daaadd34cc44cce12a832e6f7c3bc355beb5aca6";
const REPLACEMENT_MERGE = "83f428c325697801ccd3d34cd1a3730f32c02ead";
const OP =
  "phase1b-item6-item7-implementation-unlock-parallel-issuance-d99569f370-20260821T014600Z";
const I4 = "openbot-data-governance-p4-later-i4-eval";
const HANDOFF =
  "docs/design/evidence/memory-workspace-phase1b-item6-item7-implementation-unlock-parallel-issuance-handoff.md";

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

function evaluateParallelIssuance(input) {
  if (input.selfIssue === true) {
    return { allow: false, reason: "self-issue-forbidden", failClosed: true };
  }
  if (input.markItem6Met === true || input.markItem7Met === true) {
    return { allow: false, reason: "item-met-from-this-packet-forbidden", failClosed: true };
  }
  if (input.deleteCallSite === true || input.executeRetirement === true) {
    return { allow: false, reason: "retirement-forbidden", failClosed: true };
  }
  if (input.liveCutover === true) {
    return { allow: false, reason: "live-cutover-forbidden", failClosed: true };
  }
  if (input.independentlyIssued === true) {
    return { allow: true, reason: "implementation-unlocked", failClosed: true };
  }
  return { allow: false, reason: "unlock-not-issued", failClosed: true };
}

void test("parallel issuance apply issues Item 6/7 implementation unlock only", () => {
  const bundle = load(BUNDLE);
  const item6 = load(ITEM6_ISSUED);
  const item7 = load(ITEM7_ISSUED);
  const pointer = load(POINTER_PROPOSED);
  const current = load(CURRENT);
  const canonical = load(CANONICAL);
  const minima = load(MINIMA_ISSUED);
  const item6Request = load(ITEM6_REQUEST);
  const item7Request = load(ITEM7_REQUEST);

  assert.equal(
    bundle.schema,
    "memory-workspace-phase1b-item6-item7-implementation-unlock-parallel-issuance/v1",
  );
  assert.equal(bundle.kind, "parallel-implementation-unlock-issuance-applied");
  assert.equal(bundle.decision, "approved-by-independent-review");
  assert.equal(bundle.parallelIssuance, true);
  assert.equal(bundle.signedBy, "independent-review");
  assert.notEqual(bundle.signedBy, "cursor-data-governance");
  assert.equal(bundle.reviewerLogin, "flykingvip-cloud");
  assert.equal(bundle.thisPacketIssuesUnlock, true);
  assert.equal(bundle.item6ImplementationUnlocked, true);
  assert.equal(bundle.item7ImplementationUnlocked, true);
  assert.equal(bundle.item6, "not-met");
  assert.equal(bundle.item7, "not-met");
  assert.equal(bundle.operationId, OP);
  assert.equal(bundle.issuanceReviewMerge, ISSUANCE_MERGE);
  assert.equal(gitOk(["merge-base", "--is-ancestor", ISSUANCE_MERGE, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", ITEM7_UNLOCK_MERGE, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", ITEM6_REVIEW_MERGE, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", ITEM7_REVIEW_MERGE, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", REPLACEMENT_MERGE, "HEAD"]), true);

  assert.equal(item6.status, "issued");
  assert.equal(item6.effective, true);
  assert.equal(item6.unlock, "item6-implementation-issued");
  assert.equal(item6.item6ImplementationUnlocked, true);
  assert.equal(item6.item6Met, false);
  assert.equal(item6.productionSqliteWrite, false);
  assert.equal(item7.status, "issued");
  assert.equal(item7.effective, true);
  assert.equal(item7.unlock, "item7-implementation-issued");
  assert.equal(item7.item7ImplementationUnlocked, true);
  assert.equal(item7.item7Met, false);
  assert.equal(item7.retirement, "forbidden");
  assert.equal(item7.deleteCallSites, false);
  assert.equal(item7.liveWriteWatchIndex, 37);
  assert.equal(pointer.applied, true);
  assert.equal(pointer.effective, false);
  assert.equal(current.item6ImplementationUnlocked, true);
  assert.equal(current.item7ImplementationUnlocked, true);
  assert.equal(current.fullUnlock, "not-issued");
  assert.equal(current.phase1bExecutionBlocked, true);
  assert.equal(canonical.unlock, "not-issued");
  assert.equal(minima.item6ImplementationUnlocked, false);
  assert.equal(minima.item7ImplementationUnlocked, false);
  assert.equal(item6Request.unlock, "not-issued");
  assert.equal(item7Request.unlock, "not-issued");
  assert.doesNotMatch(JSON.stringify(bundle), new RegExp(I4));
});

void test("applied pointer keeps full unlock and LIVE blocked", () => {
  const current = load(CURRENT);
  const bundle = load(BUNDLE);
  assert.equal(current.item6ImplementationUnlocked, true);
  assert.equal(current.item7ImplementationUnlocked, true);
  assert.equal(current.fullUnlock, "not-issued");
  assert.equal(current.phase1bExecutionBlocked, true);
  assert.equal(current.deployAuthorized, false);
  assert.equal(current.wiredToProductionResolver, false);
  assert.equal(current.liveCutover, false);
  assert.equal(current.productionAuthorized, false);
  assert.ok(current.ordinaryCallerMustNotTreatImplementationUnlockAs.includes("Item 6 met"));
  assert.ok(current.ordinaryCallerMustNotTreatImplementationUnlockAs.includes("Item 7 met"));
  assert.ok(current.ordinaryCallerMustNotTreatImplementationUnlockAs.includes("LIVE cutover"));
  assert.ok(bundle.ifIssuedDoesNotMean.includes("LIVE cutover"));
  assert.ok(bundle.ifIssuedDoesNotMean.includes("delete productionWriteWatchIndex call-sites"));
});

void test("issued implementation unlock still fail-closes met, retirement, LIVE, and sqlite identity", () => {
  const item6 = load(ITEM6_ISSUED);
  const schema = readRepo("src/memory/schema-v2.ts");
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);
  assert.doesNotMatch(
    gitOut(["diff", "--name-only", "origin/main", "--", "src/memory/schema-v2.ts"]),
    /schema-v2/,
  );
  assert.equal(item6.sqliteIdentity.requireExplicitPath, true);
  assert.equal(item6.sqliteIdentity.forbidHostSearch, true);
  assert.equal(item6.productionSqliteWrite, false);

  const evidencePath = path.join(DIR, ITEM6_ISSUED);
  const host = path.join(os.homedir(), ".openbot", "memory", "fixture.sqlite");
  const tmp = path.join(os.tmpdir(), "openbot-parallel-issuance-fixture.sqlite");
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

  assert.equal(evaluateParallelIssuance({ selfIssue: true }).reason, "self-issue-forbidden");
  assert.equal(
    evaluateParallelIssuance({ markItem7Met: true }).reason,
    "item-met-from-this-packet-forbidden",
  );
  assert.equal(evaluateParallelIssuance({ deleteCallSite: true }).reason, "retirement-forbidden");
  assert.equal(evaluateParallelIssuance({ liveCutover: true }).reason, "live-cutover-forbidden");
  const unlocked = evaluateParallelIssuance({ independentlyIssued: true });
  assert.equal(unlocked.allow, true);
  assert.equal(unlocked.reason, "implementation-unlocked");
});

void test("parallel issuance handoff records independent apply of #569", () => {
  const handoff = readRepo(HANDOFF);
  assert.match(handoff, /Parallel Issuance Review/);
  assert.match(handoff, /independent-review/);
  assert.match(handoff, /#569/);
  assert.match(handoff, /item6ImplementationUnlocked\s+\|\s+true/);
  assert.match(handoff, /item7ImplementationUnlocked\s+\|\s+true/);
  assert.match(handoff, /deployAuthorized\s+\|\s+false/);
  assert.doesNotMatch(handoff, /signedBy=null/);
  assert.doesNotMatch(handoff, /phase1bExecutionBlocked=false/);
});
