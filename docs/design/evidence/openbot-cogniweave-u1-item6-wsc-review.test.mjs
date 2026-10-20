import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("WSC independently accepts memory/guard/restore after an issued authorized path", () => {
  const review = load("openbot-cogniweave-u1-item6-wsc-signed-review.json");
  const status = load("openbot-cogniweave-u1-item6-wsc-status.json");
  const receipt = load("memory-workspace-phase1b-item6-cutover-drill-receipt.json");
  const equivalent = load("openbot-cogniweave-u1-item6-production-equivalent-receipt.json");
  const sreHalf = load("memory-workspace-phase1b-item6-sre-half.json");
  const prior = load("memory-workspace-phase1b-item6-sre-review-459.json");
  const unlock = load("openbot-cogniweave-u1-unlock-decision.json");
  const packed = JSON.stringify(review);

  assert.equal(review.kind, "item6-wsc-review");
  assert.equal(review.signedBy, "cursor-memory-wsc");
  assert.equal(review.reviewedBy, "cursor-memory-wsc");
  assert.notEqual(review.signedBy, "cursor-fable");
  assert.equal(review.decision, "accepted");
  assert.equal(review.item6, "met");
  assert.equal(review.item6Candidate, "met");
  assert.equal(review.authorizedPathIssued, true);
  assert.equal(review.classification, "production-candidate");
  assert.equal(review.productionEquivalentSnapshot, true);
  assert.equal(review.backupNonEmpty, true);
  assert.equal(review.backupHashVerified, true);
  assert.equal(review.restoreProven, true);
  assert.equal(review.v1RootGuardDrilled, true);
  assert.equal(review.productionWrites, 0);
  assert.equal(review.doesNotModifySreSignature, true);
  assert.equal(review.confirmed.didNotSignSreReview, true);
  assert.equal(review.confirmed.didNotSearchHost, true);
  assert.equal(review.srePr, 517);
  assert.deepEqual(review.doesNotAuthorize, [
    "implementation",
    "Catalog write",
    "schema-v2-write",
    "retirement",
    "LIVE",
  ]);
  assert.doesNotMatch(packed, /\/Users\//);
  assert.doesNotMatch(packed, /bot-2\.sqlite/);

  assert.equal(status.preparedBy, "cursor-memory-wsc");
  assert.equal(status.item6Candidate, "met");
  assert.equal(status.authorizedPathIssued, true);
  assert.equal(status.wscReview, "accepted");

  assert.equal(equivalent.item6Candidate, "met");
  assert.equal(equivalent.v1RootGuardDrilled, true);
  assert.equal(receipt.item6, "not-met");
  assert.equal(receipt.status, "green");
  assert.equal(sreHalf.item6, "not-met");
  assert.equal(prior.item6, "not-met");
  assert.equal(prior.reviewedBy, "cursor-memory-wsc");
  assert.equal(unlock.unlock, "issued");
  assert.equal(unlock.items["6"], "met");
  assert.equal(unlock.signedBy, "cursor-sot-reviewer");
});

void test("WSC packet does not enable schema v2, U1, or production writes", () => {
  const review = load("openbot-cogniweave-u1-item6-wsc-signed-review.json");
  const schema = fs.readFileSync(path.join(REPO, "src/memory/schema-v2.ts"), "utf8");
  const registry = fs.readFileSync(path.join(REPO, ".loom/registry.yaml"), "utf8");

  assert.equal(review.live, "forbidden");
  assert.equal(review.u1, "blocked");
  assert.equal(review.deployAuthorized, false);
  assert.equal(review.schemaV2Write, "disabled");
  assert.equal(review.authorizedPathIssued, true);
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);
  assert.ok(
    registry.includes("openbot-cogniweave-unified-memory-remediation:cursor-memory-wsc-item6"),
  );
  assert.ok(review.explicitlyForbidden.includes("modify cursor-fable SRE signatures"));
});
