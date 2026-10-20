import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const HOST = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("residual opaque rows have a no-rewrite quarantine receipt", () => {
  const receipt = read("memory-workspace-phase1b-item2-residual-opaque-quarantine.json");
  const closeout = read("memory-workspace-phase1b-item2-production-closeout.json");
  const decision = read("memory-workspace-phase1b-item2-production-sot-decision.json");
  const raw = JSON.stringify(receipt);

  assert.equal(receipt.schema, "memory-workspace-phase1b-item2-residual-opaque-quarantine/v1");
  assert.equal(receipt.status, "quarantine-receipt-no-rewrite");
  assert.equal(receipt.item2, "met");
  assert.equal(receipt.item2Official, "met");
  assert.equal(receipt.architectureReview, "accepted");
  assert.equal(receipt.productionCatalogWrite, "none");
  assert.equal(receipt.normalCatalogWrite, "none");
  assert.equal(receipt.quarantineNormalWrites, 0);
  assert.equal(receipt.thisPacketWrites, 0);
  assert.equal(receipt.residualOpaqueRecords, 9);
  assert.equal(receipt.hashedRecords.length, 9);
  assert.equal(receipt.authorityShaped, false);
  assert.equal(receipt.inItem2NormalCatalogPopulation, false);
  assert.equal(receipt.disposition, "residual-not-normal-no-rewrite");
  assert.equal(receipt.identityInvention, "forbidden");
  assert.equal(receipt.identityFromAgentId, "forbidden");
  assert.equal(receipt.identityFromPath, "forbidden");
  assert.equal(receipt.identityFromStateDir, "forbidden");
  assert.equal(receipt.unlock, "not-issued");
  assert.equal(receipt.LIVE, "forbidden");
  assert.equal(receipt.deployAuthorized, false);
  assert.equal(receipt.authorizedFuturePath.action, "quarantine-without-minting-ws-identity");
  assert.ok(receipt.authorizedFuturePath.forbidden.includes("invent resourceId"));
  assert.ok(receipt.authorizedFuturePath.forbidden.includes("backfill from agentId"));
  assert.ok(receipt.authorizedFuturePath.forbidden.includes("backfill from path"));
  assert.ok(receipt.authorizedFuturePath.forbidden.includes("backfill from stateDir"));

  const residual = closeout.hashedNormalWorkspaceRecords.filter((row) => !row.authorityShaped);
  assert.equal(residual.length, 9);
  const closeoutIds = residual.map((row) => row.hashedResourceId).toSorted();
  const receiptIds = receipt.hashedRecords.map((row) => row.hashedResourceId).toSorted();
  assert.deepEqual(receiptIds, closeoutIds);
  assert.ok(receipt.hashedRecords.every((row) => row.authorityShaped === false));
  assert.ok(receipt.hashedRecords.every((row) => row.workspaceKind === null));
  assert.equal(
    closeout.residualOpaque.receipt,
    "memory-workspace-phase1b-item2-residual-opaque-quarantine.json",
  );
  assert.equal(decision.status, "accepted");
  assert.equal(
    decision.decisions.residualOpaqueWorkspaceRows.receipt,
    "memory-workspace-phase1b-item2-residual-opaque-quarantine.json",
  );
  assert.ok(!UUID.test(raw));
  assert.ok(!HOST.test(raw));
  assert.ok(!raw.includes("@"));
  assert.doesNotMatch(raw, /ws:[^"]+:(user|seat|group):/);
  assert.doesNotMatch(raw, /\/root\/|\/Users\/|realpath/);
});
