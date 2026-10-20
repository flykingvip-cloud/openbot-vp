import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { evaluatePhase0ExitGate } from "./memory-workspace-phase0-exit-gate.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

void test("close readiness: engineering and governance pass after official-review sign-off", () => {
  const readiness = JSON.parse(
    fs.readFileSync(
      path.join(import.meta.dirname, "memory-workspace-phase0-close-readiness.json"),
      "utf8",
    ),
  );
  assert.equal(readiness.engineeringGate.pass, true);
  assert.equal(readiness.governanceGate.pass, true);
  assert.ok(
    readiness.governanceGate.reviewSequence <= 26,
    "close-readiness may lag sign-off repair",
  );
  assert.equal(readiness.officialReviewAttestation.markPhase0Accepted, true);
  assert.equal(readiness.officialReviewAttestation.deployAuthorized, false);
  assert.ok(readiness.blockers.open.some((b) => b.id === "section141-unsigned"));
  assert.ok(!readiness.blockers.open.some((b) => b.id === "ws-b-change-request-unaccepted"));
  assert.ok(readiness.blockers.resolved.some((b) => b.id === "ws-b-change-request-unaccepted"));

  const signOff = JSON.parse(
    fs.readFileSync(
      path.join(import.meta.dirname, "memory-workspace-phase0-20260814.sign-off.json"),
      "utf8",
    ),
  );
  assert.equal(signOff.phase0Accepted, true);
  assert.ok(signOff.reviewSequence >= 26, "sign-off must be review-26 or later after repair");
  assert.equal(signOff.deployAuthorized, false);
  assert.equal(signOff.section141Signed, false);
  assert.equal(signOff.phase1bExecutionBlocked, true);

  const gate = JSON.parse(
    fs.readFileSync(
      path.join(import.meta.dirname, "memory-workspace-phase0-main-gate-evidence.json"),
      "utf8",
    ),
  );
  assert.equal(gate.mainSha, readiness.mainSha);
  assert.equal(signOff.mainSha, "58ce58793cd65bc2212b2446d648e85da5d4a919");
  assert.equal(gate.governance.phase0Accepted, true);

  const exit = evaluatePhase0ExitGate({ repoRoot: REPO_ROOT });
  assert.equal(exit.engineeringGate.pass, true);
});

void test("phase1a entry checklist unlocked after phase0 close", () => {
  const checklist = JSON.parse(
    fs.readFileSync(
      path.join(import.meta.dirname, "memory-workspace-phase0-phase1a-entry-checklist.json"),
      "utf8",
    ),
  );
  assert.equal(checklist.prerequisite.phase0MarkAccepted, true);
  assert.equal(checklist.phase1bExecutionBlocked, true);
  assert.equal(checklist.phase1aAllowedScope, "design-and-owner-signoff-only");
  assert.ok(checklist.section141Items.length >= 10);
  assert.ok(checklist.explicitlyForbidden.includes("deployAuthorized=true"));
});

void test("runner persistence evidence documents LaunchAgent", () => {
  const runner = JSON.parse(
    fs.readFileSync(
      path.join(import.meta.dirname, "memory-workspace-phase0-runner-persistence-evidence.json"),
      "utf8",
    ),
  );
  assert.equal(runner.launchAgent.state, "running");
  assert.equal(runner.launchAgent.keepAlive, true);
  assert.equal(runner.stabilityVerdict.launchAgentPersisted, true);
  assert.equal(runner.stabilityVerdict.longTermSloProven, false);
});

void test("review-25 submission pack indexes evidence on current main", () => {
  const submission = JSON.parse(
    fs.readFileSync(
      path.join(import.meta.dirname, "memory-workspace-phase0-review-25-submission.json"),
      "utf8",
    ),
  );
  assert.equal(submission.reviewSequenceRequested, 25);
  assert.equal(submission.executionTeamAttestation.markPhase0Accepted, false);
  assert.equal(submission.mainTipTripleGate.allSuccess, true);
  assert.ok(submission.evidenceIndex.length >= 7);
});
