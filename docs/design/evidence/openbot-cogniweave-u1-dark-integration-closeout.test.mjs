import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");

function loadEvidence(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

function readRepo(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

void test("U1 dark closeout records trunk producer and consumer without expanding authority", () => {
  const closeout = loadEvidence("openbot-cogniweave-u1-dark-integration-closeout-2026-08-20.json");
  const unlock = loadEvidence("openbot-cogniweave-u1-unlock-decision.json");
  const phase1b = loadEvidence("memory-workspace-phase1b-unlock-decision.json");
  const request = loadEvidence("openbot-cogniweave-u1-design-review-request-2026-08-19.json");
  const historical = loadEvidence("openbot-cogniweave-u1-closeout-dispatch-2026-08-19.json");
  const schema = readRepo("src/memory/schema-v2.ts");
  const producer = readRepo("src/gateway/workspace-resolver/memory-workspace-resolve.ts");
  const consumer = readRepo("src/memory/cogniweave-manager.ts");
  const search = readRepo("src/memory/search-manager.ts");

  assert.equal(closeout.kind, "u1-dark-integration-closeout");
  assert.equal(closeout.preparedBy, "cursor-unified-memory-u1-admission");
  assert.equal(closeout.role, "coordinator");
  assert.equal(closeout.coordinatorDoesNotSign, true);
  assert.equal(closeout.doesNotModifyUnlockDecision, true);
  assert.equal(closeout.doesNotIssuePhase1bUnlock, true);
  assert.equal(closeout.decision, "accepted");
  assert.equal(closeout.status, "closed-dark-only");
  assert.equal(closeout.u1, "authorized-dark-only");
  assert.equal(closeout.authorizes, "none");
  assert.equal(closeout.baseline, "c78e5ee2a7f3d92dbb3acebfe35e2aeac53864fc");
  assert.equal(closeout.producerOnTrunk, true);
  assert.equal(closeout.consumerOnTrunk, true);
  assert.equal(closeout.implementationStarted, true);
  assert.equal(closeout.live, "forbidden");
  assert.equal(closeout.deployAuthorized, false);
  assert.equal(closeout.phase1bExecutionBlocked, true);
  assert.equal(closeout.productionCatalogWrite, "none");
  assert.equal(closeout.schemaV2Write, "disabled");
  assert.equal(closeout.catalogWrite, "forbidden");
  assert.equal(closeout.productionWrites, 0);
  assert.equal(closeout.item7RetiredThisChange, 0);
  assert.equal(closeout.item7, "not-met");
  assert.equal(closeout.coordinatorSlotsFilled, false);
  assert.equal(closeout.releaseMode.u2, false);
  assert.equal(closeout.releaseMode.migrateStores, false);
  assert.ok(closeout.doesNotAuthorize.includes("re-sign U1 unlock decision"));
  assert.ok(closeout.doesNotAuthorize.includes("issue Phase 1B unlock"));
  assert.ok(closeout.doesNotAuthorize.includes("LIVE"));
  assert.equal(closeout.landed.consumer.pr, 529);
  assert.equal(closeout.landed.producerInitial.pr, 528);
  assert.equal(closeout.landed.producerFollowups.at(-1).pr, 543);

  assert.match(producer, /export async function resolveMemoryWorkspaceHandle/);
  assert.match(consumer, /static async createFromHandle/);
  assert.match(consumer, /static async create\(/);
  assert.match(search, /export async function getMemorySearchManagerFromHandle/);
  assert.match(search, /export async function getMemorySearchManager\(/);
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);

  assert.equal(unlock.unlock, "issued");
  assert.equal(unlock.signedBy, "cursor-sot-reviewer");
  assert.equal(unlock.authorizes, "U1-dark-integration-only");
  assert.equal(unlock.implementationStarted, false);
  assert.equal(unlock.productionCatalogWrite, "none");
  assert.equal(unlock.schemaV2Write, "disabled");
  assert.equal(unlock.phase1bUnlock, "not-issued");
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.deployAuthorized, false);
  assert.equal(unlock.live, "forbidden");

  assert.equal(phase1b.unlock, "not-issued");
  assert.equal(phase1b.signedBy, null);
  assert.equal(phase1b.phase1bExecutionBlocked, true);
  assert.equal(phase1b.deployAuthorized, false);
  assert.equal(phase1b.live, "forbidden");
  assert.equal(phase1b.productionCatalogWrite, "none");

  assert.equal(historical.unlock, "not-issued");
  assert.equal(historical.u1, "blocked");
  assert.equal(historical.authorizes, "none");

  for (const row of request.requiredIndependentReviews) {
    assert.equal(row.signedBy, null);
  }
});

void test("closeout does not claim Resolver, CogniWeave, or unlock paths", () => {
  const closeout = loadEvidence("openbot-cogniweave-u1-dark-integration-closeout-2026-08-20.json");
  const registry = readRepo(".loom/registry.yaml");
  const admissionBlock = registry
    .split(
      "id: openbot-cogniweave-unified-memory-remediation:cursor-unified-memory-u1-admission",
    )[1]
    .split(/\n  - id:/)[0];

  assert.ok(registry.includes("openbot-cogniweave-u1-dark-integration-closeout-2026-08-20.json"));
  assert.ok(!admissionBlock.includes("src/gateway/workspace-resolver"));
  assert.ok(!admissionBlock.includes("src/memory/cogniweave-manager"));
  assert.ok(
    !admissionBlock.includes("docs/design/evidence/openbot-cogniweave-u1-unlock-decision.json"),
  );
  assert.equal(closeout.doesNotModifyUnlockDecision, true);
});
