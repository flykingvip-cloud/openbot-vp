import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const ITEM3_PATH = path.join(DIR, "memory-workspace-phase1b-item3-write-switch-acceptance.json");

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("item 4 same-release plan stays dark and does not enable schema v2", () => {
  const doc = load("memory-workspace-phase1b-item4-schema-v2-same-release.json");
  const matrix = load("memory-workspace-phase0-section141-signoff-matrix.json");
  const item3Present = fs.existsSync(ITEM3_PATH);
  const item3 = item3Present
    ? load("memory-workspace-phase1b-item3-write-switch-acceptance.json")
    : null;

  assert.equal(doc.preparedBy, "cursor-memory-wsc");
  assert.equal(doc.schemaV2Enabled, false);
  assert.equal(doc.sameReleaseUnit, "memory-schema-v2");
  assert.equal(doc.dependsOnItem3, true);
  assert.equal(doc.plan.releaseUnit, "memory-schema-v2");
  assert.equal(doc.plan.partnerItem, 3);
  assert.equal(doc.plan.enablement, "only after independent Phase 1B unlock");
  assert.equal(doc.editsSrcMemoryProduction, false);
  assert.equal(doc.phase1bExecutionBlocked, true);
  assert.equal(doc.deployAuthorized, false);
  assert.equal(doc.unlock, "not-issued");
  assert.equal(doc.status, "prepared-not-enabled");
  assert.equal(doc.currentRuntime.filesV2Present, true);
  assert.equal(doc.currentRuntime.schemaVersion, 1);
  assert.equal(doc.currentRuntime.writePath, "closed");
  assert.equal(matrix.phase1bExecutionBlocked, true);
  assert.ok(doc.explicitlyForbidden.includes("enable schema v2 now"));
  assert.ok(doc.explicitlyForbidden.includes("enable schema v2 write path"));

  if (item3Present) {
    assert.equal(item3.decision, "accepted");
    assert.equal(item3.scope, "write-switch");
    assert.equal(item3.enablesProduction, false);
    assert.equal(item3.sameReleaseUnit, "memory-schema-v2");
    assert.equal(doc.item3AcceptancePresent, true);
  } else {
    assert.equal(doc.item3AcceptancePresent, false);
    assert.ok(String(doc.blockedOn).includes("#454"));
  }
});

void test("item 4: files_v2 DDL is prepared and the v1 write path stays closed", () => {
  const memoryDir = path.join(REPO, "src/memory");
  const files = fs.readdirSync(memoryDir).filter((name) => name.endsWith(".ts"));
  const source = files
    .map((name) => fs.readFileSync(path.join(memoryDir, name), "utf8"))
    .join("\n");
  const syncOps = fs.readFileSync(path.join(memoryDir, "manager-sync-ops.ts"), "utf8");
  const v1Schema = fs.readFileSync(path.join(memoryDir, "memory-schema.ts"), "utf8");
  assert.equal(/CREATE TABLE\s+files_v2\b/.test(source), true);
  assert.equal(/export const SCHEMA_V2_ENABLED = true\b/.test(source), false);
  assert.equal(syncOps.includes("schema-v2"), false);
  assert.equal(v1Schema.includes("schema-v2"), false);
  assert.equal(fs.existsSync(path.join(memoryDir, "v1-root-guard.ts")), true);
});

void test("item 6 SRE review accepts #456 fixture alignment and does not score item 6 met", () => {
  const prior = load("memory-workspace-phase1b-item6-sre-review-456.json");

  assert.equal(prior.reviewedBy, "cursor-memory-wsc");
  assert.equal(prior.fablePr, 456);
  assert.equal(prior.item6, "not-met");
  assert.equal(prior.sreDoesNotWriteGreenReceipt, true);
  assert.equal(prior.aligned.sqliteFileCopyRestoreMechanism, true);
  assert.equal(prior.notAligned.authorizedSqliteFileLevelCopy, false);
  assert.equal(prior.notAligned.v1RootGuardFencing, false);
});

void test("item 6 SRE review accepts #459 layout drill and does not score item 6 met", () => {
  const doc = load("memory-workspace-phase1b-item6-sre-half.json");
  const review = load("memory-workspace-phase1b-item6-sre-review-459.json");
  const receipt = load("memory-workspace-phase1b-item6-cutover-drill-receipt.json");

  assert.equal(doc.preparedBy, "cursor-memory-wsc");
  assert.equal(doc.role, "sre-half");
  assert.equal(doc.live, false);
  assert.equal(doc.secondStateMachine, false);
  assert.equal(doc.existingCutover, "src/gateway/workspace/cutover.ts");
  assert.equal(doc.cutoverOwner, "cursor-fable");
  assert.equal(doc.item6, "not-met");
  assert.equal(doc.status, "authorized-layout-reviewed-item6-not-met");
  assert.equal(doc.reviewedPr, 459);
  assert.equal(
    doc.review,
    "docs/design/evidence/memory-workspace-phase1b-item6-sre-review-459.json",
  );
  assert.equal(doc.drillReceipt.sreDoesNotWriteGreenReceipt, true);
  assert.equal(doc.drillReceipt.status, "fable-authorized-layout-reviewed");
  assert.equal(doc.memorySide.backup.status, "authorized-layout-file-copy-reviewed");
  assert.equal(doc.memorySide.fencing.status, "cutover-single-writer-reviewed");
  assert.equal(doc.memorySide.rollback.status, "authorized-layout-policy-reviewed");
  assert.equal(doc.memorySide.rollback.afterCommit.includes("allowOldWriter=false"), true);
  assert.ok(doc.explicitlyForbidden.includes("claim item 6 green from this SRE half"));
  assert.ok(doc.explicitlyForbidden.includes("write a green drill receipt as cursor-memory-wsc"));
  assert.ok(doc.explicitlyForbidden.includes("fill receipt.sre"));
  assert.ok(doc.explicitlyForbidden.includes("Retirement / zero call-sites (item 7)"));

  assert.equal(review.reviewedBy, "cursor-memory-wsc");
  assert.equal(review.fablePr, 459);
  assert.equal(review.item6, "not-met");
  assert.equal(review.sreDoesNotWriteGreenReceipt, true);
  assert.equal(review.doesNotFillReceiptSre, true);
  assert.equal(review.aligned.authorizedLayout, "{stateDir}/memory/resource-{resourceId}.sqlite");
  assert.equal(review.aligned.sqliteFileCopyRestoreMechanism, true);
  assert.equal(review.notAligned.authorizedProductionSqlite, false);
  assert.equal(review.notAligned.v1RootGuardFencing, false);

  assert.equal(receipt.preparedBy, "cursor-fable");
  assert.equal(receipt.status, "green");
  assert.equal(receipt.authorizedSqliteFileBackup, "green");
  assert.equal(receipt.backup, "green");
  assert.equal(receipt.sre, undefined);
  assert.equal(receipt.srePendingWscWrittenVerification, true);
  assert.equal(receipt.item6, "not-met");
});
