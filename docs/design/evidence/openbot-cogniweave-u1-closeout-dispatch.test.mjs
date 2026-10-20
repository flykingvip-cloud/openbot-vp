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

void test("closeout dispatch keeps item 2/6 not-met and does not issue unlock", () => {
  const dispatch = loadEvidence("openbot-cogniweave-u1-closeout-dispatch-2026-08-19.json");
  const coverage = loadEvidence("memory-workspace-phase1b-item2-production-catalog-coverage.json");
  const receipt = loadEvidence("memory-workspace-phase1b-item6-cutover-drill-receipt.json");

  assert.equal(dispatch.kind, "u1-closeout-dispatch");
  assert.equal(dispatch.preparedBy, "cursor-unified-memory-u1-admission");
  assert.equal(dispatch.role, "coordinator");
  assert.equal(dispatch.coordinatorDoesNotSign, true);
  assert.equal(dispatch.unlock, "not-issued");
  assert.equal(dispatch.u1, "blocked");
  assert.equal(dispatch.authorizes, "none");
  assert.equal(dispatch.deployAuthorized, false);
  assert.equal(dispatch.live, "forbidden");
  assert.equal(dispatch.schemaV2Write, "disabled");
  assert.equal(dispatch.catalogWrite, "forbidden");
  assert.equal(dispatch.productionWrites, 0);
  assert.equal(dispatch.item7RetiredThisChange, 0);

  assert.equal(dispatch.item2.candidate, "not-met");
  assert.equal(dispatch.item2.productionCatalogPresent, false);
  assert.equal(dispatch.item2.covered, false);
  assert.equal(dispatch.item2.fourGates100, false);
  assert.equal(dispatch.item2.authorityCatalogGatesPass, false);
  assert.equal(dispatch.item2.quarantineNormalWrites, 0);
  assert.equal(dispatch.item2.productionCatalogWrite, "none");
  assert.equal(dispatch.item2.authorizedProductionStateDirIssued, false);
  assert.equal(coverage.item2, "not-met");
  assert.equal(dispatch.item2.productionCatalogPresent, coverage.target.catalogPresent);

  assert.equal(dispatch.item6.candidate, "not-met");
  assert.equal(dispatch.item6.productionEquivalentSnapshot, false);
  assert.equal(dispatch.item6.authorizedSqlitePathIssued, false);
  assert.equal(dispatch.item6.wscReview, "pending");
  assert.equal(dispatch.item6.sreReview, "pending");
  assert.equal(receipt.item6, "not-met");
  assert.equal(receipt.srePendingWscWrittenVerification, true);

  assert.equal(dispatch.unlock, "not-issued");
  assert.equal(dispatch.u1, "blocked");
  assert.equal(dispatch.authorizes, "none");
});

void test("coordinator left all four design-review signatures empty", () => {
  const request = loadEvidence("openbot-cogniweave-u1-design-review-request-2026-08-19.json");
  const dispatch = loadEvidence("openbot-cogniweave-u1-closeout-dispatch-2026-08-19.json");
  const required = [
    "codex-workspace-architecture",
    "cursor-data-governance",
    "cursor-memory-wsc",
    "cursor-conversation-lifecycle",
  ];

  assert.equal(request.preparedBy, "cursor-unified-memory-u1-admission");
  assert.equal(request.scope, "U1-dark-contract-only");
  assert.equal(request.status, "pending");
  assert.deepEqual(request.doesNotAuthorize, [
    "implementation",
    "Catalog write",
    "schema-v2-write",
    "retirement",
    "LIVE",
  ]);
  assert.deepEqual(
    request.requiredIndependentReviews.map((row) => row.reviewer),
    required,
  );
  for (const row of request.requiredIndependentReviews) {
    assert.equal(row.decision, "pending");
    assert.equal(row.signedBy, null);
    assert.equal(row.signedAt, null);
    assert.equal(row.scope, "U1-dark-contract-only");
    assert.notEqual(row.signedBy, request.preparedBy);
  }
  assert.deepEqual(dispatch.designReviews.acceptedBy, []);
  assert.equal(dispatch.designReviews.coordinatorFilledSignatures, false);
  assert.equal(dispatch.designReviews.status, "pending");
});

void test("U1 dark contract still forbids schema v2 write and item 7 retirement", () => {
  const request = loadEvidence("openbot-cogniweave-u1-design-review-request-2026-08-19.json");
  const schema = readRepo("src/memory/schema-v2.ts");

  assert.equal(
    request.contract.resolverReturns,
    "complete MemoryWorkspaceHandle or structured denial",
  );
  assert.equal(request.contract.persistentPrimaryKey, "resourceId only");
  assert.equal(request.contract.scopeWorkspaceId, "resourceId");
  assert.equal(request.contract.cloudTenantId, "Handle.tenantId");
  assert.equal(request.contract.cogniweaveConsumes, "complete Handle only");
  assert.equal(request.contract.mode, "dark-integration-only");
  assert.equal(request.contract.schemaV2Write, "disabled");
  assert.equal(request.contract.item7.u1Prerequisite, false);
  assert.equal(request.contract.item7.retirementInU1, "forbidden");
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);
});

void test("coordinator does not claim resolver, CogniWeave, or unlock paths", () => {
  const dispatch = loadEvidence("openbot-cogniweave-u1-closeout-dispatch-2026-08-19.json");
  const registry = fs.readFileSync(path.join(REPO, ".loom/registry.yaml"), "utf8");

  assert.ok(
    registry.includes(
      "openbot-cogniweave-unified-memory-remediation:cursor-unified-memory-u1-admission",
    ),
  );
  assert.ok(dispatch.ownership.doesNotClaim.includes("src/gateway/workspace-resolver/**"));
  assert.ok(dispatch.ownership.doesNotClaim.includes("src/memory/cogniweave-manager.ts"));
  assert.ok(
    dispatch.ownership.doesNotClaim.includes(
      "docs/design/evidence/openbot-cogniweave-u1-unlock-decision.json",
    ),
  );
  assert.equal(dispatch.item2.owner, "cursor-data-governance");
  assert.equal(dispatch.item6.owner, "cursor-memory-wsc");
});
