import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("item 2 Stage B persists classified only and keeps item 2 not-met", () => {
  const measured = load("memory-workspace-phase1b-item2-stage-b.json");
  const catalog = load("memory-workspace-phase1b-item2-stage-b-catalog.json");
  const quarantine = load("memory-workspace-phase1b-item2-stage-b-quarantine.json");
  const dump = load("memory-workspace-phase1b-authority-dump.json");
  const dumpAccept = load("memory-workspace-phase1b-item2-stage-a-dump-accept.json");
  const governanceAccept = load("memory-workspace-phase1b-item2-stage-a-governance-accept.json");
  const architecture = load("memory-workspace-phase1b-item2-stage-a-architecture-accept.json");

  assert.equal(dump.live, false);
  assert.equal(dumpAccept.acceptedBy, "cursor-data-governance");
  assert.equal(dumpAccept.didNotSign, "architecture Stage A rules");
  assert.equal(governanceAccept.decision, "accepted");
  assert.equal(governanceAccept.stage, "A");
  assert.equal(governanceAccept.acceptedBy, "cursor-data-governance");
  assert.equal(governanceAccept.item2, "not-met");
  assert.equal(governanceAccept.catalogWrite, false);
  assert.equal(governanceAccept.phase1bExecutionBlocked, true);
  assert.equal(governanceAccept.didNotSign, "architecture Stage A rules");
  assert.equal(architecture.acceptedBy, "codex-workspace-architecture");
  assert.equal(measured.item2, "not-met");
  assert.equal(measured.authorityCatalogGatesPass, true);
  assert.equal(measured.productionInventoryCovered, false);
  assert.equal(measured.productionInventory.reason, "production_dump_present_not_persisted");
  assert.equal(measured.productionInventory.refusedPhase0, true);
  assert.equal(measured.unlock, "not-issued");
  assert.equal(measured.productionCatalogWrite, "classified-only");
  assert.equal(measured.productionStateDirWrite, false);
  assert.equal(measured.gates.employee_private.stewardContractDefined, true);
  assert.equal(measured.gates.employee_private.classifiedAuthority, 2);
  assert.equal(measured.gates.employee_private.gate, "pass");
  assert.equal(measured.gates.agent_primary.gate, "pass");
  assert.equal(measured.gates.group_shared.gate, "pass");
  assert.equal(measured.gates.conflict_or_unknown.blockedInProduction, true);
  assert.equal(measured.gates.conflict_or_unknown.inCatalog, 0);
  assert.equal(measured.gates.conflict_or_unknown.gate, "pass");
  assert.deepEqual(measured.persisted.toSorted(), [
    "ws:tenant-1:group:group-1",
    "ws:tenant-1:seat:seat-1:asset:asset-seat",
    "ws:tenant-1:user:user-1:asset:asset-1",
    "ws:tenant-1:user:user-1:steward",
    "ws:tenant-1:user:user-2:steward",
  ]);
  assert.equal(Object.keys(catalog.records).length, 5);
  assert.ok(
    !Object.keys(catalog.records).some((id) => id.includes(":unknown:") || id.includes("bot-2")),
  );
  assert.equal(
    quarantine.rows.filter(
      (row) => row.reason === "employee_private_membership_proven_resource_id_unspecified",
    ).length,
    0,
  );
  assert.ok(quarantine.rows.some((row) => row.reason === "agentId_is_not_agentAssetId"));
});

void test("item 3 acceptance does not enable production", () => {
  const packet = load("memory-workspace-phase1b-item3-write-switch-acceptance.json");
  assert.equal(packet.decision, "accepted");
  assert.equal(packet.scope, "write-switch");
  assert.equal(packet.acceptedBy, "cursor-data-governance");
  assert.equal(packet.enablesProduction, false);
  assert.equal(packet.sameReleaseUnit, "memory-schema-v2");
  assert.equal(packet.phase1bExecutionBlocked, true);
});

void test("item 5 is met after named wired flip; item 7 stays at 38", () => {
  const item5 = load("memory-workspace-phase1b-item5-fail-closed-evidence.json");
  const item7 = load("memory-workspace-phase1b-item7-retirement-ledger.json");
  const toolCwd = fs.readFileSync(
    path.join(DIR, "../../../src/gateway/workspace-resolver/tool-cwd.ts"),
    "utf8",
  );
  const tenantContext = fs.readFileSync(
    path.join(DIR, "../../../src/gateway/tenant-context.ts"),
    "utf8",
  );
  assert.equal(item5.wiredToProductionResolver, true);
  assert.equal(item5.status, "met");
  assert.equal(item5.status, item5.wiredToProductionResolver ? "met" : "not-met");
  assert.equal(item5.enablesProduction, false);
  assert.equal(item5.productionStillSynthesizesEmptyCatalog, false);
  assert.equal(item5.productionStillUsesAgentIdAsAgentAssetId, false);
  assert.equal(item5.productionCallerFallsBackOnUnwiredCatalog, false);
  assert.equal(item5.managedCwdThrows, false);
  assert.ok(!toolCwd.includes("createEmptyWorkspaceCatalog"));
  assert.ok(!/agentAssetId:\s*params\.agentId/.test(toolCwd));
  assert.ok(/agentAssetId:\s*params\.agentAssetId/.test(toolCwd));
  assert.ok(toolCwd.includes("empty_catalog_synthesis_forbidden"));
  assert.ok(toolCwd.includes("catalog_record_required"));
  assert.ok(toolCwd.includes("assertFailClosedWorkspaceIdentity"));
  assert.ok(tenantContext.includes("loadExistingGovernedWorkspaceIdentity"));
  assert.equal(item5.helperInvokedFromToolCwd, true);
  assert.ok(
    !/empty_catalog_synthesis_forbidden[\s\S]{0,250}return workspaceDir/.test(tenantContext),
  );
  assert.ok(!/agent_asset_id_required[\s\S]{0,250}return workspaceDir/.test(tenantContext));
  assert.ok(!/agent tool cwd denied/.test(tenantContext));
  assert.equal(item7.retirementOwner, "cursor-data-governance");
  assert.equal(item7.freezeOwner, "cursor-fable");
  assert.equal(item7.ownersDistinct, true);
  assert.equal(item7.productionWriteWatchIndex, 38);
  assert.equal(item7.retiredThisChange, 0);
  assert.equal(item7.sites.length, 38);
});
