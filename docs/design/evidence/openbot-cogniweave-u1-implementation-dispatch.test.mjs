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

void test("both designated owners accept U1 dark integration without LIVE or Phase 1B", () => {
  const dispatch = loadEvidence("openbot-cogniweave-u1-implementation-dispatch-2026-08-19.json");
  const unlock = loadEvidence("openbot-cogniweave-u1-unlock-decision.json");
  const phase1b = loadEvidence("memory-workspace-phase1b-unlock-decision.json");
  const request = loadEvidence("openbot-cogniweave-u1-design-review-request-2026-08-19.json");
  const schema = readRepo("src/memory/schema-v2.ts");
  const manager = readRepo("src/memory/cogniweave-manager.ts");

  assert.equal(dispatch.kind, "u1-implementation-dispatch");
  assert.equal(dispatch.preparedBy, "cursor-unified-memory-u1-admission");
  assert.equal(dispatch.role, "coordinator");
  assert.equal(dispatch.coordinatorDoesNotSign, true);
  assert.equal(dispatch.coordinatorDoesNotImplementU1, true);
  assert.equal(dispatch.coordinatorDoesNotAcceptForOwners, true);
  assert.equal(dispatch.unlockPr, 526);
  assert.equal(dispatch.u0, "accepted");
  assert.equal(dispatch.item2, "met");
  assert.equal(dispatch.item6, "met");
  assert.equal(dispatch.item7, "not-met");
  assert.equal(dispatch.u1, "authorized-dark-only");
  assert.equal(dispatch.authorizes, "U1-dark-integration-only");
  assert.equal(dispatch.implementationStarted, true);
  assert.equal(dispatch.status, "owners-accepted");
  assert.equal(dispatch.ownerAcceptVia, "operator-authorized-proxy");
  assert.equal(dispatch.jointTestsStatus, "landed-on-528-529");
  assert.equal(dispatch.mode, "dark-integration-only");
  assert.equal(dispatch.phase1bUnlock, "not-issued");
  assert.equal(dispatch.deployAuthorized, false);
  assert.equal(dispatch.live, "forbidden");
  assert.equal(dispatch.schemaV2Write, "disabled");
  assert.equal(dispatch.catalogWrite, "forbidden");
  assert.equal(dispatch.productionWrites, 0);
  assert.equal(dispatch.coordinatorSlotsFilled, false);

  assert.equal(unlock.unlock, "issued");
  assert.equal(unlock.signedBy, "cursor-sot-reviewer");
  assert.equal(unlock.authorizes, "U1-dark-integration-only");
  assert.equal(unlock.implementationStarted, false);
  assert.equal(unlock.u1, "authorized-dark-only");
  assert.equal(phase1b.unlock, "not-issued");
  assert.equal(phase1b.phase1bExecutionBlocked, true);
  assert.equal(phase1b.deployAuthorized, false);

  for (const row of request.requiredIndependentReviews) {
    assert.equal(row.signedBy, null);
  }

  const producerAccept = dispatch.ownerAcceptances["cursor-data-governance"];
  const consumerAccept = dispatch.ownerAcceptances["cursor-conversation-lifecycle"];
  assert.equal(producerAccept.status, "accepted");
  assert.equal(producerAccept.signedBy, "cursor-data-governance");
  assert.notEqual(producerAccept.signedBy, "cursor-unified-memory-u1-admission");
  assert.equal(producerAccept.acceptedVia, "operator-authorized-proxy");
  assert.equal(producerAccept.landedPr, 528);
  assert.equal(consumerAccept.status, "accepted");
  assert.equal(consumerAccept.signedBy, "cursor-conversation-lifecycle");
  assert.notEqual(consumerAccept.signedBy, "cursor-unified-memory-u1-admission");
  assert.equal(consumerAccept.acceptedVia, "operator-authorized-proxy");
  assert.equal(consumerAccept.landedPr, 529);

  assert.equal(dispatch.releaseMode.newEntryTakesProductionWrite, false);
  assert.equal(dispatch.releaseMode.missDeny, false);
  assert.equal(dispatch.releaseMode.productionReadPath, "unchanged");
  assert.equal(dispatch.releaseMode.dualWriteExpansion, false);
  assert.equal(dispatch.releaseMode.deleteLegacyCallSites, false);
  assert.equal(dispatch.releaseMode.u2, false);
  assert.equal(dispatch.delivery.separatePRs, true);
  assert.equal(dispatch.delivery.mixedImplementationPr, "forbidden");
  assert.ok(dispatch.requiredJointTests.includes("Catalog miss → denial"));
  assert.ok(
    dispatch.requiredJointTests.includes("legacy production behavior unchanged in dark mode"),
  );
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);
  assert.match(manager, /stableId\("ws"/);
});

void test("owner/path matrix splits Resolver producer from CogniWeave consumer", () => {
  const matrix = loadEvidence("openbot-cogniweave-u1-implementation-owner-path-matrix.json");
  const dispatch = loadEvidence("openbot-cogniweave-u1-implementation-dispatch-2026-08-19.json");
  const registry = readRepo(".loom/registry.yaml");
  const producer = matrix.workflows.find((row) => row.id === "A");
  const consumer = matrix.workflows.find((row) => row.id === "B");

  assert.equal(matrix.kind, "u1-implementation-owner-path-matrix");
  assert.equal(matrix.preparedBy, "cursor-unified-memory-u1-admission");
  assert.equal(matrix.authorizes, "U1-dark-integration-only");
  assert.equal(matrix.implementationStarted, true);
  assert.equal(matrix.overlap, "forbidden");
  assert.equal(matrix.coordinatorDoesNotClaimImplementationPaths, true);
  assert.equal(dispatch.ownerPathMatrix, matrix.path);

  assert.equal(producer.designatedOwner, "cursor-data-governance");
  assert.equal(producer.status, "accepted");
  assert.equal(producer.signedBy, "cursor-data-governance");
  assert.notEqual(producer.signedBy, "cursor-unified-memory-u1-admission");
  assert.equal(producer.acceptedVia, "operator-authorized-proxy");
  assert.equal(producer.landedPr, 528);
  assert.deepEqual(producer.paths, ["src/gateway/workspace-resolver/**"]);
  assert.ok(producer.doesNotClaim.includes("src/memory/cogniweave-manager.ts"));
  assert.ok(producer.scope.includes("do not add a second Resolver"));
  assert.ok(producer.scope.includes("do not switch the production write path"));
  assert.equal(producer.separatePr, true);

  assert.equal(consumer.designatedOwner, "cursor-conversation-lifecycle");
  assert.equal(consumer.status, "accepted");
  assert.equal(consumer.signedBy, "cursor-conversation-lifecycle");
  assert.notEqual(consumer.signedBy, "cursor-unified-memory-u1-admission");
  assert.equal(consumer.acceptedVia, "operator-authorized-proxy");
  assert.equal(consumer.landedPr, 529);
  assert.deepEqual(consumer.paths, [
    "src/memory/cogniweave-manager.ts",
    "src/memory/search-manager.ts",
  ]);
  assert.ok(consumer.doesNotClaim.includes("src/gateway/workspace-resolver/**"));
  assert.ok(consumer.scope.includes("do not delete item 7 call-sites"));
  assert.ok(consumer.scope.includes("do not enable schema v2 write"));
  assert.equal(consumer.separatePr, true);

  assert.ok(matrix.coordinator.doesNotClaim.includes("src/gateway/workspace-resolver/**"));
  assert.ok(matrix.coordinator.doesNotClaim.includes("src/memory/cogniweave-manager.ts"));
  assert.ok(
    registry.includes(
      "openbot-cogniweave-unified-memory-remediation:cursor-unified-memory-u1-admission",
    ),
  );
  assert.ok(registry.includes("openbot-cogniweave-u1-implementation-dispatch-2026-08-19.json"));
  const admissionBlock = registry
    .split(
      "id: openbot-cogniweave-unified-memory-remediation:cursor-unified-memory-u1-admission",
    )[1]
    .split(/\n  - id:/)[0];
  assert.ok(!admissionBlock.includes("src/gateway/workspace-resolver"));
  assert.ok(!admissionBlock.includes("src/memory/cogniweave-manager"));
});

void test("owner sidecars accept A and B without filling coordinator slots", () => {
  const producer = loadEvidence("openbot-cogniweave-u1-owner-accept-cursor-data-governance.json");
  const consumer = loadEvidence(
    "openbot-cogniweave-u1-owner-accept-cursor-conversation-lifecycle.json",
  );
  const dispatch = loadEvidence("openbot-cogniweave-u1-implementation-dispatch-2026-08-19.json");
  const unlock = loadEvidence("openbot-cogniweave-u1-unlock-decision.json");
  const request = loadEvidence("openbot-cogniweave-u1-design-review-request-2026-08-19.json");

  assert.equal(producer.kind, "u1-implementation-owner-accept");
  assert.equal(producer.workflow, "A");
  assert.equal(producer.signedBy, "cursor-data-governance");
  assert.equal(producer.decision, "accepted");
  assert.equal(producer.acceptedVia, "operator-authorized-proxy");
  assert.equal(producer.landedPr, 528);
  assert.ok(producer.doesNotAuthorize.includes("sign Workflow B"));

  assert.equal(consumer.kind, "u1-implementation-owner-accept");
  assert.equal(consumer.workflow, "B");
  assert.equal(consumer.signedBy, "cursor-conversation-lifecycle");
  assert.equal(consumer.decision, "accepted");
  assert.equal(consumer.acceptedVia, "operator-authorized-proxy");
  assert.equal(consumer.landedPr, 529);
  assert.ok(consumer.doesNotAuthorize.includes("sign Workflow A"));

  assert.equal(dispatch.implementationStarted, true);
  assert.equal(unlock.implementationStarted, false);
  assert.equal(producer.live, "forbidden");
  assert.equal(consumer.live, "forbidden");
  assert.equal(producer.phase1bUnlock, "not-issued");
  assert.equal(consumer.phase1bUnlock, "not-issued");
  assert.ok(request.requiredIndependentReviews.every((row) => row.signedBy === null));
});

void test("historical closeout packet stays frozen and does not start U1", () => {
  const closeout = loadEvidence("openbot-cogniweave-u1-closeout-dispatch-2026-08-19.json");
  assert.equal(closeout.unlock, "not-issued");
  assert.equal(closeout.u1, "blocked");
  assert.equal(closeout.authorizes, "none");
  assert.equal(closeout.coordinatorDoesNotImplementU1, true);
});
