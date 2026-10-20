import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);

void test("ws-b unknown/conflict rows fail closed until membership and AgentAsset exist", () => {
  const doc = JSON.parse(
    fs.readFileSync(
      path.join(DIR, "memory-workspace-phase1a-ws-b-unknown-conflict-failclosed.json"),
      "utf8",
    ),
  );
  assert.equal(doc.preparedBy, "cursor-data-governance");
  assert.equal(doc.inventoryRows.unknown.write, "deny");
  assert.equal(doc.inventoryRows.conflict.write, "deny");
  assert.equal(doc.inventoryRows.unknown.disposition, "quarantine");
  assert.equal(doc.inventoryRows.conflict.disposition, "quarantine");
  assert.equal(doc.inventoryRows.unknown.mayAutoClassify, false);
  assert.equal(doc.inventoryRows.conflict.mayAutoRepair, false);
  assert.equal(doc.inventoryRows.conflict.mayInferOwnerFromPath, false);
  assert.equal(doc.requestPathCatalogWrite, false);
  assert.ok(doc.forbiddenOwnershipSignals.includes("agentId"));
  assert.ok(doc.forbiddenOwnershipSignals.includes("mtime"));
  assert.equal(doc.catalogSot, "Data Governance Catalog");
  assert.ok(doc.notYetEnabled.includes("resolver production write switch"));
  assert.ok(doc.notYetEnabled.includes("Catalog miss=deny"));
  assert.ok(doc.forbiddenParallelSot.includes("second memory resolver"));
  assert.equal(doc.section141Signed, false);
  assert.equal(doc.phase1bExecutionBlocked, true);
  assert.equal(doc.deployAuthorized, false);
});
