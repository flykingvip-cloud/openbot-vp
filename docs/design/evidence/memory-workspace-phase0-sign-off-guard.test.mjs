import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const EVIDENCE_DIR = path.dirname(import.meta.filename);

const SIGN_OFF = path.join(EVIDENCE_DIR, "memory-workspace-phase0-20260814.sign-off.json");
const DELEGATION = path.join(
  EVIDENCE_DIR,
  "memory-workspace-phase0-official-review-26-delegation.json",
);
const INDEPENDENT = path.join(
  EVIDENCE_DIR,
  "memory-workspace-phase0-official-review-26-independent-verification.json",
);

void test("sign-off guard: review-26 files exist and main SHA aligned", () => {
  assert.ok(fs.existsSync(SIGN_OFF), "sign-off.json must exist");
  assert.ok(fs.existsSync(DELEGATION), "review-26 delegation must exist");
  assert.ok(fs.existsSync(INDEPENDENT), "review-26 independent verification must exist");

  const signOff = JSON.parse(fs.readFileSync(SIGN_OFF, "utf8"));
  const delegation = JSON.parse(fs.readFileSync(DELEGATION, "utf8"));
  const independent = JSON.parse(fs.readFileSync(INDEPENDENT, "utf8"));

  assert.ok(signOff.reviewSequence >= 26, "reviewSequence must not regress below 26");
  assert.equal(delegation.reviewSequence, signOff.reviewSequence);
  assert.equal(independent.reviewSequence, signOff.reviewSequence);

  const mainSha =
    signOff.mainSha ?? signOff.mainShaAtSignOff ?? signOff.mainShaAtVerification ?? null;
  assert.ok(mainSha, "sign-off must record mainSha");
  assert.equal(delegation.mainSha, mainSha);
  assert.equal(independent.mainShaAtVerification, mainSha);

  assert.equal(signOff.phase0Accepted, true);
  assert.equal(signOff.deployAuthorized, false);
  assert.equal(signOff.section141Signed, false);
  assert.equal(signOff.phase1bExecutionBlocked, true);
  assert.equal(signOff.closesWsC, false);
  assert.notEqual(signOff.decision, "PHASE0_ACCEPTED", "review-25 decision label must not regress");
});

void test("sign-off guard: review-25 regression blocked", () => {
  const signOff = JSON.parse(fs.readFileSync(SIGN_OFF, "utf8"));
  assert.ok(
    signOff.reviewSequence !== 25 || signOff.decision === "P0_ACCEPTED",
    "reviewSequence=25 with PHASE0_ACCEPTED is forbidden after repair",
  );
  if (signOff.supersededUnauthorizedCandidate) {
    assert.ok(signOff.supersededUnauthorizedCandidate.claimedReviewSequence <= 25);
  }
});
