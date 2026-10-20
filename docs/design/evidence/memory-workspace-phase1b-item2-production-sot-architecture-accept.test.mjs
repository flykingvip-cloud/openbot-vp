import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const HOST = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("architecture accepts item 2 production SoT rules without scoring met or issuing unlock", () => {
  const accept = read("memory-workspace-phase1b-item2-production-sot-architecture-accept.json");
  const decision = read("memory-workspace-phase1b-item2-production-sot-decision.json");
  const request = read("memory-workspace-phase1b-item2-production-sot-review-request.json");
  const closeout = read("memory-workspace-phase1b-item2-production-closeout.json");
  const coverage = read("memory-workspace-phase1b-item2-production-catalog-coverage.json");
  const scorecard = read("memory-workspace-phase1b-items-2-7-scorecard.json");
  const u1Unlock = read("openbot-cogniweave-u1-unlock-decision.json");
  const phase1bUnlock = read("memory-workspace-phase1b-unlock-decision.json");
  const raw = JSON.stringify(accept);

  assert.equal(accept.schema, "memory-workspace-phase1b-item2-production-sot-accept/v1");
  assert.equal(accept.decision, "accepted");
  assert.equal(accept.signedBy, "codex-workspace-architecture");
  assert.equal(accept.acceptedBy, "codex-workspace-architecture");
  assert.notEqual(accept.signedBy, "cursor-data-governance");
  assert.equal(accept.item2, "not-met");
  assert.equal(accept.item2Official, "not-met");
  assert.equal(accept.item2RulesAccepted, true);
  assert.equal(accept.unlock, "not-issued");
  assert.equal(accept.unlockScoring, "blocked");
  assert.equal(accept.LIVE, "forbidden");
  assert.equal(accept.deployAuthorized, false);
  assert.equal(accept.productionCatalogWrite, "none");
  assert.equal(accept.u1, "blocked");
  assert.equal(accept.answers.length, 4);
  assert.ok(accept.answers.every((row) => row.answer === "yes"));

  assert.equal(decision.status, "accepted");
  assert.equal(decision.signedBy, "codex-workspace-architecture");
  assert.equal(decision.reviewer, "codex-workspace-architecture");
  assert.equal(decision.unlock, "not-issued");
  assert.equal(decision.productionCatalogWrite, "none");
  assert.equal(decision.doesNotEditUnlockDecision, true);

  assert.equal(request.mustNotSelfAccept, true);
  assert.equal(request.decisionStatus, "accepted");
  assert.equal(request.reviewer, "codex-workspace-architecture");

  assert.equal(closeout.uniqueUserOwnedEquivalent, 7);
  assert.equal(closeout.fourGates100, true);
  assert.equal(closeout.residualOpaqueWorkspaceRecords, 9);
  assert.equal(coverage.item2, "not-met");
  assert.equal(coverage.uniqueUserOwnedEquivalent, 0);
  const coverageSot = read("memory-workspace-phase1b-item2-production-catalog-coverage-sot.json");
  assert.equal(coverageSot.item2Official, "met");
  assert.equal(coverageSot.uniqueUserOwnedEquivalent, 7);
  assert.equal(scorecard.items.find((item) => item.id === 2).status, "met");

  assert.equal(u1Unlock.unlock, "issued");
  assert.equal(u1Unlock.signedBy, "cursor-sot-reviewer");
  assert.equal(phase1bUnlock.unlock, "not-issued");
  assert.equal(phase1bUnlock.items["2"], "met");
  assert.ok(accept.doesNotAuthorize.includes("unlock"));
  assert.ok(!UUID.test(raw));
  assert.ok(!HOST.test(raw));
  assert.ok(!raw.includes("@"));
  assert.doesNotMatch(raw, /\/root\/|\/Users\/|realpath/);
});

void test("architecture U1 contract sidecar does not fill coordinator slots or issue unlock", () => {
  const review = read("openbot-cogniweave-u1-design-review-codex-workspace-architecture.json");
  const request = read("openbot-cogniweave-u1-design-review-request-2026-08-19.json");
  const unlock = read("openbot-cogniweave-u1-unlock-decision.json");
  const registry = fs.readFileSync(path.join(REPO, ".loom/registry.yaml"), "utf8");

  assert.equal(review.reviewer, "codex-workspace-architecture");
  assert.equal(review.signedBy, "codex-workspace-architecture");
  assert.equal(review.decision, "accepted");
  assert.equal(review.scope, "U1-dark-contract-only");
  assert.equal(review.unlock, "not-issued");
  assert.equal(review.u1, "blocked");
  assert.equal(review.authorizes, "none");
  assert.equal(review.item2, "not-met");
  assert.equal(review.item6, "not-met");
  assert.notEqual(review.signedBy, "cursor-unified-memory-u1-admission");

  const architectureSlot = request.requiredIndependentReviews.find(
    (row) => row.reviewer === "codex-workspace-architecture",
  );
  assert.equal(architectureSlot.signedBy, null);
  assert.equal(architectureSlot.decision, "pending");
  assert.equal(request.status, "pending");
  assert.ok(
    request.requiredIndependentReviews.every(
      (row) => row.signedBy === null && row.decision === "pending",
    ),
  );
  assert.equal(unlock.unlock, "issued");
  assert.equal(unlock.signedBy, "cursor-sot-reviewer");
  assert.ok(
    registry.includes(
      "openbot-cogniweave-unified-memory-remediation:codex-workspace-architecture-item2",
    ),
  );
});
