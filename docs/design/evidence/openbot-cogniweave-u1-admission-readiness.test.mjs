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

void test("U1 admission packet stays changes-required and cites Phase 1B SoT", () => {
  const packet = loadEvidence("openbot-cogniweave-u1-admission-readiness-2026-08-19.json");
  const unlock = loadEvidence("openbot-cogniweave-u1-unlock-decision.json");
  const scorecard = loadEvidence("memory-workspace-phase1b-items-2-7-scorecard.json");
  const phase1bUnlock = loadEvidence("memory-workspace-phase1b-unlock-decision.json");

  assert.equal(packet.kind, "u1-admission-readiness-packet");
  assert.equal(packet.preparedBy, "cursor-unified-memory-u1-admission");
  assert.notEqual(packet.preparedBy, "cursor-unified-memory-u0");
  assert.equal(packet.u0, "accepted");
  assert.equal(packet.decision, "changes-required");
  assert.equal(packet.unlock, "not-issued");
  assert.equal(packet.u1, "blocked");
  assert.equal(packet.authorizes, "none");
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.live, "forbidden");
  assert.equal(packet.schemaV2Write, "disabled");
  assert.equal(packet.catalogWrite, "forbidden");
  assert.equal(packet.item2.status, "not-met");
  assert.equal(packet.item6.status, "not-met");
  assert.equal(packet.item7.status, "not-met");
  assert.equal(packet.item7.u1Prerequisite, false);
  assert.equal(packet.designReviews.status, "pending");
  assert.equal(packet.ownership.status, "clean");
  assert.equal(packet.ownership.notU0Owner, true);

  assert.equal(unlock.unlock, "issued");
  assert.equal(unlock.decision, "accepted");
  assert.equal(unlock.signedBy, "cursor-sot-reviewer");
  assert.ok(unlock.issuedAt);
  assert.equal(unlock.reviewedBy, "cursor-sot-reviewer");
  assert.equal(unlock.authorizes, "U1-dark-integration-only");
  assert.equal(unlock.u1, "authorized-dark-only");
  assert.ok(unlock.doesNotAuthorize.includes("self-issue unlock"));
  assert.ok(unlock.doesNotAuthorize.includes("LIVE"));

  assert.equal(scorecard.unlock, "not-issued");
  assert.equal(scorecard.items.find((item) => item.id === 2).status, "met");
  assert.equal(scorecard.items.find((item) => item.id === 6).status, "met");
  assert.equal(scorecard.items.find((item) => item.id === 7).status, "not-met");
  assert.equal(phase1bUnlock.unlock, "not-issued");
  assert.equal(phase1bUnlock.items["2"], "met");
  assert.equal(phase1bUnlock.items["6"], "met");
  assert.equal(packet.phase1bUnlockReceipt, phase1bUnlock.path);
});

void test("occupancy coverage stays non-SoT while official production coverage-sot is met", () => {
  const packet = loadEvidence("openbot-cogniweave-u1-admission-readiness-2026-08-19.json");
  const coverage = loadEvidence("memory-workspace-phase1b-item2-production-catalog-coverage.json");
  const coverageSot = loadEvidence(
    "memory-workspace-phase1b-item2-production-catalog-coverage-sot.json",
  );
  const persist = loadEvidence("memory-workspace-phase1b-item2-production-persist.json");
  const score = loadEvidence("memory-workspace-phase1b-item2-production-sot-score.json");

  assert.equal(coverage.item2, "not-met");
  assert.equal(coverage.covered, false);
  assert.equal(coverage.fourGates100, false);
  assert.equal(coverage.authorityCatalogGatesPass, false);
  assert.equal(coverage.uniqueUserOwnedEquivalent, 0);
  assert.equal(coverage.target.catalogPresent, false);
  assert.equal(coverage.evidenceCatalogIsNotProductionSot, true);
  assert.equal(coverage.productionCatalogWrite, "none");
  assert.equal(persist.productionCatalogWrite, "none");
  assert.equal(packet.item2.status, "not-met");
  assert.equal(packet.item2.measured.uniqueUserOwnedEquivalent, coverage.uniqueUserOwnedEquivalent);
  assert.equal(packet.item2.measured.fourGates100, coverage.fourGates100);
  assert.equal(packet.item2.measured.productionCatalogPresent, coverage.target.catalogPresent);
  assert.ok(packet.item2.missingAuthority.length >= 4);
  assert.ok(packet.explicitlyForbidden.includes("treat this packet as item 2 met"));

  assert.equal(coverageSot.occupancyProbeIsNotProductionSot, true);
  assert.equal(coverageSot.item2Official, "met");
  assert.equal(coverageSot.uniqueUserOwnedEquivalent, 7);
  assert.equal(coverageSot.productionCatalogPresent, true);
  assert.equal(coverageSot.fourGates100, true);
  assert.equal(score.item2, "met");
  assert.equal(score.occupancyRunnerItem2, "not-met");
  assert.equal(score.uniqueUserOwnedEquivalent, 7);
});

void test("item 6 remains not-met even when the authorized-layout receipt is green", () => {
  const packet = loadEvidence("openbot-cogniweave-u1-admission-readiness-2026-08-19.json");
  const receipt = loadEvidence("memory-workspace-phase1b-item6-cutover-drill-receipt.json");
  const sre = loadEvidence("memory-workspace-phase1b-item6-sre-half.json");
  const items37 = loadEvidence("memory-workspace-phase1b-items-3-7.json");

  assert.equal(receipt.status, "green");
  assert.equal(receipt.item6, "not-met");
  assert.notEqual(receipt.status, "revoked");
  assert.equal(receipt.srePendingWscWrittenVerification, true);
  assert.equal(sre.item6, "not-met");
  assert.match(sre.memorySide.backup.gap, /not an authorized production sqlite/);
  assert.equal(items37.items.find((item) => item.id === 6).status, "not-met");
  assert.equal(packet.item6.measured.receiptStatus, "green");
  assert.equal(packet.item6.measured.receiptItem6, "not-met");
  assert.equal(packet.item6.measured.productionSqliteSnapshot, false);
  assert.equal(packet.item6.measured.v1RootGuardDrilled, false);
  assert.ok(
    receipt.explicitlyForbidden.includes(
      "treat this authorized-layout drill as a production sqlite snapshot",
    ),
  );
});

void test("item 7 is recorded and is not a U1 start gate", () => {
  const packet = loadEvidence("openbot-cogniweave-u1-admission-readiness-2026-08-19.json");
  const ledger = loadEvidence("memory-workspace-phase1b-item7-retirement-ledger.json");
  const inventory = loadEvidence("openbot-cogniweave-u0-readonly-inventory-2026-08-19.json");

  assert.equal(ledger.status, "not-met");
  assert.equal(packet.item7.measured.productionWriteWatchIndex, ledger.productionWriteWatchIndex);
  assert.equal(packet.item7.measured.frozenWriteWatchIndex, ledger.frozenWriteWatchIndex);
  assert.equal(packet.item7.u1Prerequisite, false);
  assert.deepEqual(packet.item7.blocks, ["U3", "U4", "I3"]);
  assert.equal(inventory.siteCount, 16);
  assert.equal(packet.item7.writeSites.siteCount, inventory.siteCount);
  assert.ok(packet.item7.forbiddenInU1.includes("delete productionWriteWatchIndex call-sites"));
});

void test("schema v2 write stays closed and U0 Handle files are not rewritten", () => {
  const schema = readRepo("src/memory/schema-v2.ts");
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);
  const handle = readRepo("src/memory/memory-workspace-handle.ts");
  assert.match(handle, /ISSUED_MEMORY_WORKSPACE_HANDLES/);
  const freeze = readRepo("src/memory/u0-boundary-freeze.ts");
  assert.match(freeze, /scanSelfResolveCalls/);
});

void test("admission owner does not claim resolver or CogniWeave manager paths", () => {
  const packet = loadEvidence("openbot-cogniweave-u1-admission-readiness-2026-08-19.json");
  const registry = fs.readFileSync(path.join(REPO, ".loom/registry.yaml"), "utf8");
  assert.ok(
    registry.includes(
      "openbot-cogniweave-unified-memory-remediation:cursor-unified-memory-u1-admission",
    ),
  );
  assert.ok(packet.ownership.doesNotClaim.includes("src/gateway/workspace-resolver/**"));
  assert.ok(packet.ownership.doesNotClaim.includes("src/memory/cogniweave-manager.ts"));
  assert.ok(packet.ownership.doesNotClaim.includes("src/memory/search-manager.ts"));
  assert.equal(
    packet.ownership.futureU1Implementation.find((row) => row.role === "resolver-handle-interface")
      .owner,
    "cursor-data-governance",
  );
  assert.equal(
    packet.ownership.futureU1Implementation.find((row) => row.role === "cogniweave-handle-consumer")
      .owner,
    "cursor-conversation-lifecycle",
  );
});
