import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const ISSUED = "memory-workspace-phase1b-item7-retirement-unlock-issued-receipt.json";
const REQUEST = "memory-workspace-phase1b-item7-retirement-unlock-request.json";
const CURRENT = "memory-workspace-phase1b-unlock-current.json";
const CANONICAL = "memory-workspace-phase1b-unlock-decision.json";
const MINIMA_ISSUED = "memory-workspace-phase1b-unlock-minima-issued-receipt.json";
const BASELINE = "28d83211ee5c8826b66b1e52e14aacf1a9902c9f";
const OP = "phase1b-item7-retirement-unlock-apply-28d83211ee-20260821T171900Z";
const I4 = "openbot-data-governance-p4-later-i4-eval";
const HANDOFF =
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-unlock-apply-handoff.md";

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

void test("item 7 retirement unlock apply issues pointer without deleting sites or marking met", () => {
  const issued = load(ISSUED);
  const request = load(REQUEST);
  const current = load(CURRENT);
  const canonical = load(CANONICAL);
  const minima = load(MINIMA_ISSUED);
  const packed = JSON.stringify(issued);

  assert.equal(issued.status, "issued");
  assert.equal(issued.effective, true);
  assert.equal(issued.signedBy, "independent-review");
  assert.equal(issued.reviewerLogin, "flykingvip-cloud");
  assert.notEqual(issued.signedBy, "cursor-data-governance");
  assert.equal(issued.item7, "not-met");
  assert.equal(issued.item7Met, false);
  assert.equal(issued.item7RetirementUnlocked, true);
  assert.equal(issued.retirementExecuted, false);
  assert.equal(issued.thisPacketDeletesCallSites, false);
  assert.equal(issued.thisPacketMarksItem7Met, false);
  assert.equal(issued.liveWriteWatchIndex, 37);
  assert.equal(issued.retiredThisChange, 0);
  assert.equal(issued.deployAuthorized, false);
  assert.equal(issued.live, "forbidden");
  assert.equal(issued.fullUnlock, "not-issued");
  assert.equal(issued.operationId, OP);
  assert.equal(issued.baselineSha, BASELINE);
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", "origin/main", "HEAD"]), true);

  assert.equal(request.unlock, "not-issued");
  assert.equal(request.signedBy, null);
  assert.equal(current.item7RetirementUnlocked, true);
  assert.equal(current.item7RetirementUnlock, "issued");
  assert.equal(current.retirementExecuted, false);
  assert.equal(current.item7ImplementationUnlocked, true);
  assert.equal(current.fullUnlock, "not-issued");
  assert.equal(current.phase1bExecutionBlocked, true);
  assert.equal(canonical.unlock, "not-issued");
  assert.equal(canonical.items["7"], "not-met");
  assert.equal(minima.fullUnlock, "not-issued");
  assert.equal(minima.item7ImplementationUnlocked, false);
  assert.doesNotMatch(packed, new RegExp(I4));
  assert.ok(!REPO.includes(I4), REPO);
});

void test("item 7 retirement unlock apply does not touch src or canonical receipt", () => {
  const schema = readRepo("src/memory/schema-v2.ts");
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);
  assert.doesNotMatch(
    gitOut(["diff", "--name-only", "origin/main", "--", "src/memory/schema-v2.ts"]),
    /schema-v2/,
  );
  assert.equal(
    gitOut([
      "diff",
      "--name-only",
      "origin/main",
      "--",
      "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
    ]),
    "",
  );
  assert.equal(
    gitOut([
      "diff",
      "--name-only",
      "origin/main",
      "--",
      "docs/design/evidence/memory-workspace-phase1b-unlock-minima-issued-receipt.json",
    ]),
    "",
  );
});

void test("item 7 retirement unlock apply handoff records independent issue without deletion", () => {
  const handoff = readRepo(HANDOFF);
  assert.match(handoff, /signedBy=independent-review/);
  assert.match(handoff, /does not delete productionWriteWatchIndex call-sites/);
  assert.match(handoff, /not-met/);
  assert.doesNotMatch(handoff, /signedBy=cursor-data-governance/);
  assert.doesNotMatch(handoff, /phase1bExecutionBlocked=false/);
});
