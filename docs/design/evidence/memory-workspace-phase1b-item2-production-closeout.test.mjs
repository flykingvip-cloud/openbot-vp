import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { measureProductionCatalogSotGates } from "./memory-workspace-phase1b-item2-production-closeout-gates.mjs";

const DIR = path.dirname(import.meta.filename);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const HOST = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

function sampleWorkspace(resourceId, tenantId, owner) {
  return {
    envelope: {
      resourceId,
      resourceType: "workspace",
      tenantId,
      owner,
      lifecycleState: "active",
      governanceVersion: 2,
    },
    bindings: [
      {
        bindingId: `bind:${resourceId}`,
        resourceId,
        role: "canonical",
        locator: `unplaced://classified/${resourceId}`,
        state: "active",
      },
    ],
  };
}

void test("production SoT gates pass on authority-complete Catalog rows", () => {
  const records = [
    sampleWorkspace("ws:t1:user:u1:asset:a1", "t1", { kind: "user", userId: "u1" }),
    sampleWorkspace("ws:t1:user:u2:asset:a2", "t1", { kind: "user", userId: "u2" }),
  ];
  const measured = measureProductionCatalogSotGates({ records });
  assert.equal(measured.fourGates100, true);
  assert.equal(measured.authorityCatalogGatesPass, true);
  assert.equal(measured.uniqueUserOwnedEquivalent, 2);
  assert.equal(measured.quarantinedWorkspaceRecords, 0);
  assert.equal(measured.memoryRelationOk, true);
  assert.equal(measured.workspaceMemoryIdCollision, false);
});

void test("production SoT gates refuse unknown lifecycle in the normal Catalog", () => {
  const records = [
    {
      ...sampleWorkspace("ws:t1:user:u1:asset:a1", "t1", { kind: "user", userId: "u1" }),
      envelope: {
        ...sampleWorkspace("ws:t1:user:u1:asset:a1", "t1", { kind: "user", userId: "u1" }).envelope,
        lifecycleState: "pending",
      },
    },
  ];
  const measured = measureProductionCatalogSotGates({ records });
  assert.equal(measured.normalWorkspaceRecords, 0);
  assert.equal(measured.fourGates100, false);
});

void test("Memory Asset ids stay distinct from Workspace ids", () => {
  const workspaceId = "ws:t1:user:u1:asset:a1";
  const memoryId = "memory:t1:source:src-1";
  assert.notEqual(workspaceId, memoryId);
  assert.match(memoryId, /^memory:/);
  assert.match(workspaceId, /^ws:/);
  const measured = measureProductionCatalogSotGates({
    records: [
      sampleWorkspace(workspaceId, "t1", { kind: "user", userId: "u1" }),
      {
        envelope: {
          resourceId: memoryId,
          resourceType: "memory",
          tenantId: "t1",
          owner: { kind: "user", userId: "u1" },
          lifecycleState: "active",
          governanceVersion: 1,
          projection: { sourceWorkspaceResourceId: workspaceId },
        },
        bindings: [],
      },
    ],
  });
  assert.equal(measured.memoryRelationOk, true);
  assert.equal(measured.workspaceMemoryIdCollision, false);
});

void test("item 2 production closeout is a read-only SoT packet and does not edit unlock", () => {
  const closeout = read("memory-workspace-phase1b-item2-production-closeout.json");
  const unlock = read("memory-workspace-phase1b-unlock-decision.json");
  const evidenceCatalog = path.join(DIR, "memory-workspace-phase1b-item2-production-catalog.json");
  const fixtureCatalog = path.join(
    DIR,
    "memory-workspace-phase1b-item2-runtime-state",
    "data-governance",
    "catalog.json",
  );
  const raw = JSON.stringify(closeout);

  assert.equal(closeout.schema, "memory-workspace-phase1b-item2-production-closeout/v1");
  assert.equal(closeout.item, 2);
  assert.equal(closeout.LIVE, "forbidden");
  assert.equal(closeout.live, false);
  assert.equal(closeout.deployAuthorized, false);
  assert.equal(closeout.productionCatalogWrite, "none");
  assert.equal(closeout.quarantineNormalWrites, 0);
  assert.equal(closeout.unlock, "not-issued");
  assert.equal(closeout.phase1bExecutionBlocked, true);
  assert.equal(closeout.identifierPolicy, "hashed");
  assert.equal(closeout.catalogLogicalPath, "data-governance/catalog.json");
  assert.equal(closeout.runtimeLoader, "getSharedDataGovernanceCatalog");
  assert.equal(closeout.catalogPathResolver, "resolveDataGovernanceCatalogPath");
  assert.equal(
    closeout.uniqueUserOwnedMetric,
    "production_catalog_users_with_exactly_one_user_owned_agent_primary",
  );
  assert.equal(typeof closeout.productionCatalogPresent, "boolean");
  assert.equal(typeof closeout.covered, "boolean");
  assert.equal(typeof closeout.fourGates100, "boolean");
  assert.equal(typeof closeout.authorityCatalogGatesPass, "boolean");
  assert.equal(closeout.item2, "met");
  assert.equal(closeout.item2Candidate, "met");
  assert.equal(closeout.item2Official, "met");
  assert.equal(closeout.architectureReview, "accepted");
  assert.equal(closeout.sotDecisionStatus, "accepted");
  assert.equal(closeout.status, "official-met-after-architecture-accept-and-scorecard-retarget");
  assert.equal(closeout.missDenyEnabled, false);
  assert.equal(closeout.wiredToProductionResolver, false);
  assert.equal(closeout.productionCatalogPresent, true);
  assert.equal(closeout.covered, true);
  assert.equal(closeout.fourGates100, true);
  assert.equal(closeout.authorityCatalogGatesPass, true);
  assert.equal(closeout.fourGatePopulation, "authority-shaped");
  assert.equal(closeout.uniqueUserOwnedEquivalent, 7);
  const uniqueRows = closeout.hashedNormalWorkspaceRecords.filter(
    (row) => row.authorityShaped && row.ownerKind === "user" && row.hasAgentAssetAssociation,
  );
  assert.equal(uniqueRows.length, 7);
  assert.equal(closeout.occupancyDumpMetricReplaced, true);
  assert.equal(closeout.residualOpaqueWorkspaceRecords, 9);
  assert.equal(closeout.residualOpaque.disposition, "residual-not-normal-no-rewrite");
  assert.equal(
    closeout.residualOpaque.receipt,
    "memory-workspace-phase1b-item2-residual-opaque-quarantine.json",
  );
  assert.equal(closeout.residualOpaque.identityInvention, "forbidden");
  assert.equal(closeout.residualOpaque.allWorkspaceFourGates100, false);
  assert.equal(closeout.memory.workspaceResourceIdEqualsMemoryResourceId, false);
  assert.equal(closeout.memory.memorySourceWorkspaceBound, true);
  assert.equal(closeout.memory.sqliteWorkspaceIdIsIsolationKeyOnly, true);
  assert.equal(closeout.quarantineNormalWrites, 0);
  const persist = read("memory-workspace-phase1b-item2-production-persist.json");
  const decision = read("memory-workspace-phase1b-item2-production-sot-decision.json");
  assert.equal(persist.item2, "not-met");
  assert.equal(persist.productionCatalogWrite, "none");
  const coveragePath = path.join(
    DIR,
    "memory-workspace-phase1b-item2-production-catalog-coverage.json",
  );
  if (fs.existsSync(coveragePath)) {
    const coverage = JSON.parse(fs.readFileSync(coveragePath, "utf8"));
    assert.equal(coverage.item2, "not-met");
    assert.equal(coverage.target.catalogPresent, false);
    assert.equal(coverage.covered, false);
    assert.notEqual(closeout.productionCatalogPresent, coverage.target.catalogPresent);
  }
  const coverageSot = read("memory-workspace-phase1b-item2-production-catalog-coverage-sot.json");
  assert.equal(coverageSot.item2Official, "met");
  assert.equal(coverageSot.uniqueUserOwnedEquivalent, 7);
  assert.equal(coverageSot.occupancyProbeIsNotProductionSot, true);
  assert.equal(decision.status, "accepted");
  assert.equal(decision.signedBy, "codex-workspace-architecture");
  assert.equal(decision.reviewer, "codex-workspace-architecture");
  assert.equal(decision.doesNotEditUnlockDecision, true);
  assert.equal(
    decision.decisions.residualOpaqueWorkspaceRows.receipt,
    "memory-workspace-phase1b-item2-residual-opaque-quarantine.json",
  );
  assert.equal(
    decision.decisions.memoryAssetRelation.workspaceResourceIdEqualsMemoryResourceId,
    false,
  );
  assert.equal(
    decision.decisions.memoryAssetRelation.memorySourceWorkspaceResourceIdEqualsWorkspaceResourceId,
    true,
  );
  assert.equal(
    decision.decisions.memoryAssetRelation.sqliteWorkspaceId,
    "isolation-partition-key-only",
  );
  const reviewRequest = read("memory-workspace-phase1b-item2-production-sot-review-request.json");
  assert.equal(reviewRequest.status, "architecture-accepted");
  assert.equal(reviewRequest.decisionStatus, "accepted");
  assert.equal(reviewRequest.mustNotSelfAccept, true);
  assert.equal(reviewRequest.reviewer, "codex-workspace-architecture");
  assert.equal(
    decision.decisions.fourGatePopulation.population,
    "authority-shaped-workspace-resourceId",
  );
  assert.ok(!UUID.test(raw));
  assert.ok(!HOST.test(raw));
  assert.ok(!raw.includes("@"));
  assert.ok(!raw.includes(evidenceCatalog));
  assert.ok(!raw.includes(fixtureCatalog));
  assert.equal(unlock.unlock, "not-issued");
  assert.equal(unlock.items["2"], "met");
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.deployAuthorized, false);
});
