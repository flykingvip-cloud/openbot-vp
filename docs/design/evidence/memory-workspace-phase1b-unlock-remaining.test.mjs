import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const SPEC = path.resolve(DIR, "../../../.kiro/specs/memory-workspace-platform-remediation");

function loadEvidence(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("canonical unlock receipt is not-issued and binds the scorecard", () => {
  const decision = loadEvidence("memory-workspace-phase1b-unlock-decision.json");
  const scorecard = loadEvidence("memory-workspace-phase1b-items-2-7-scorecard.json");
  const items37 = loadEvidence("memory-workspace-phase1b-items-3-7.json");
  const unlockRemaining = fs.readFileSync(
    path.join(SPEC, "phase1b-unlock-remaining-20260818.md"),
    "utf8",
  );
  const tasks = fs.readFileSync(path.join(SPEC, "tasks.md"), "utf8");

  assert.equal(decision.path, "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json");
  assert.equal(decision.unlock, "not-issued");
  assert.equal(decision.decision, "no-valid-issued-receipt");
  assert.equal(decision.signedBy, null);
  assert.equal(decision.issuedAt, null);
  assert.equal(decision.reviewedBy, "cursor-sot-reviewer");
  assert.equal(decision.phase1bExecutionBlocked, true);
  assert.equal(decision.deployAuthorized, false);
  assert.equal(decision.live, "forbidden");
  assert.equal(decision.productionCatalogWrite, "none");
  assert.equal(decision.items["2"], "met");
  assert.equal(decision.items["4"], "met");
  assert.equal(decision.items["5"], "met");
  assert.equal(decision.items["6"], "met");
  assert.equal(decision.items["7"], "not-met");
  assert.ok(decision.doesNotAuthorize.includes("phase1bExecutionBlocked=false"));
  assert.ok(decision.doesNotAuthorize.includes("LIVE migration"));

  assert.equal(scorecard.unlock, "not-issued");
  assert.equal(scorecard.unlockReceipt, decision.path);
  assert.equal(
    scorecard.unlockRevokeReceipt,
    "docs/design/evidence/memory-workspace-phase1b-unlock-issued-stamp-revoke.json",
  );
  assert.equal(scorecard.phase1bExecutionBlocked, true);
  assert.equal(scorecard.deployAuthorized, false);
  assert.equal(scorecard.items.find((item) => item.id === 2).status, "met");
  assert.equal(scorecard.items.find((item) => item.id === 4).status, "met");
  assert.equal(scorecard.items.find((item) => item.id === 5).status, "met");
  assert.equal(scorecard.items.find((item) => item.id === 6).status, "met");
  assert.equal(scorecard.items.find((item) => item.id === 7).status, "not-met");
  assert.ok(scorecard.explicitlyForbidden.includes("phase1bExecutionBlocked=false"));

  assert.equal(items37.unlock, "not-issued");
  assert.equal(items37.phase1bExecutionBlocked, true);
  assert.equal(items37.deployAuthorized, false);

  assert.match(unlockRemaining, /Unlock: \*\*未签发\*\*/);
  assert.match(unlockRemaining, /phase1bExecutionBlocked=true/);
  assert.match(unlockRemaining, /deployAuthorized=false/);
  assert.match(unlockRemaining, /[Dd]ecision: `no-valid-issued-receipt`/);
  assert.doesNotMatch(unlockRemaining, /已签发（unlock-first）/);

  assert.match(tasks, /canonical receipt = `not-issued`/);
  assert.match(tasks, /phase1bExecutionBlocked=true/);
  assert.doesNotMatch(tasks, /phase1bExecutionBlocked=false/);
  assert.doesNotMatch(tasks, /unlock-first 已签发；/);
});

void test("item 6 layout receipt stays not-met while official production-equivalent item 6 is met", () => {
  const receipt = loadEvidence("memory-workspace-phase1b-item6-cutover-drill-receipt.json");
  const equivalent = loadEvidence("openbot-cogniweave-u1-item6-production-equivalent-receipt.json");
  const items37 = loadEvidence("memory-workspace-phase1b-items-3-7.json");
  const scorecard = loadEvidence("memory-workspace-phase1b-items-2-7-scorecard.json");
  const item6 = items37.items.find((item) => item.id === 6);
  const score6 = scorecard.items.find((item) => item.id === 6);

  assert.equal(receipt.status, "green");
  assert.equal(receipt.backup, "green");
  assert.equal(receipt.fencing, "green");
  assert.equal(receipt.rollback, "green");
  assert.equal(receipt.item6, "not-met");
  assert.equal(receipt.authorizedSqliteFileBackup, "green");
  assert.equal(receipt.phase1bExecutionBlocked, true);
  assert.equal(receipt.deployAuthorized, false);
  assert.equal(receipt.live, false);
  assert.equal(item6.status, "not-met");
  assert.equal(item6.measured.drillStatus, "green");
  assert.equal(equivalent.item6Candidate, "met");
  assert.equal(equivalent.unlock, "not-issued");
  assert.equal(equivalent.item6Unlocked, false);
  assert.equal(equivalent.doesNotUnlockPhase1bItem6, true);
  assert.equal(equivalent.phase1bItem6, "not-met/locked");
  assert.equal(equivalent.phase1bExecutionBlocked, true);
  assert.equal(equivalent.deployAuthorized, false);
  assert.equal(score6.status, "met");
  assert.ok(score6.remaining.some((line) => line.includes("unlock stays not-issued")));
});

void test("issued stamp is archived and revoked; canonical receipt stays not-issued", () => {
  const decision = loadEvidence("memory-workspace-phase1b-unlock-decision.json");
  const revoke = loadEvidence("memory-workspace-phase1b-unlock-issued-stamp-revoke.json");
  const superseded = loadEvidence(
    "memory-workspace-phase1b-unlock-decision-issued-superseded.json",
  );

  assert.equal(decision.unlock, "not-issued");
  assert.equal(decision.decision, "no-valid-issued-receipt");
  assert.equal(decision.phase1bExecutionBlocked, true);
  assert.equal(revoke.unlock, "not-issued");
  assert.equal(revoke.decision, "revoke-issued-stamp");
  assert.equal(revoke.replacement, decision.path);
  assert.equal(revoke.item5Met, false);
  assert.equal(revoke.item6Unlocked, false);
  assert.equal(revoke.item7Unlocked, false);
  assert.equal(revoke.wiredToProductionResolver, false);
  assert.equal(superseded.status, "superseded");
  assert.equal(superseded.stamp.unlock, "issued");
  assert.equal(superseded.notCanonical, true);
  assert.equal(
    superseded.supersededBy,
    "docs/design/evidence/memory-workspace-phase1b-unlock-issued-stamp-revoke.json",
  );
});
