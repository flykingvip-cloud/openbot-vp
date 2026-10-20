import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildReceipt, runCutoverDrill } from "./memory-workspace-phase1b-item6-cutover-drill.mjs";

const EVIDENCE_DIR = path.dirname(import.meta.filename);
const RECEIPT_PATH = path.join(
  EVIDENCE_DIR,
  "memory-workspace-phase1b-item6-cutover-drill-receipt.json",
);

void test("item6 cutover drill: authorized stateDir/memory sqlite backup + cutover.ts", async () => {
  const drill = await runCutoverDrill();
  assert.equal(drill.extendsExistingRecord, true);
  assert.equal(drill.secondStateMachine, false);
  assert.equal(drill.live, false);
  assert.equal(drill.authorizedSqliteFileBackup.ok, true, drill.authorizedSqliteFileBackup.detail);
  assert.equal(drill.authorizedSqliteFileBackup.reviewable, true);
  assert.equal(drill.fencing.ok, true, drill.fencing.detail);
  assert.equal(drill.rollback.ok, true, drill.rollback.detail);
  assert.equal(drill.sqliteRollback.ok, true, drill.sqliteRollback.detail);
  assert.equal(drill.allOk, true);
});

void test("item6 drill receipt v3: reviewable sqlite backup is green and item6 stays not-met", async () => {
  assert.ok(
    fs.existsSync(RECEIPT_PATH),
    "run memory-workspace-phase1b-item6-cutover-drill.mjs first",
  );
  const receipt = JSON.parse(fs.readFileSync(RECEIPT_PATH, "utf8"));
  const drill = await runCutoverDrill();
  const expected = buildReceipt(drill);

  assert.equal(receipt.status, "green");
  assert.equal(receipt.backup, "green");
  assert.equal(receipt.fencing, "green");
  assert.equal(receipt.rollback, "green");
  assert.equal(receipt.item6, "not-met");
  assert.equal(receipt.authorizedSqliteFileBackup, "green");
  assert.equal(receipt.extendsExistingRecord, true);
  assert.equal(receipt.secondStateMachine, false);
  assert.equal(receipt.live, false);
  assert.equal(receipt.preparedBy, "cursor-fable");
  assert.equal(receipt.srePendingWscWrittenVerification, true);
  assert.equal(receipt.sre, undefined);
  assert.equal(receipt.sqliteFileBackup, undefined);
  assert.equal(
    receipt.sreHalfRef,
    "docs/design/evidence/memory-workspace-phase1b-item6-sre-half.json",
  );
  assert.equal(receipt.phase1bExecutionBlocked, true);
  assert.equal(receipt.status, expected.status);
  assert.equal(expected.backup, "green");
  assert.match(String(receipt.details.authorizedSqliteSha256), /^[0-9a-f]{64}$/);
  assert.ok(
    receipt.explicitlyForbidden.includes(
      "claim item 6 met from receipt green or authorizedSqliteFileBackup green",
    ),
  );
  assert.ok(
    receipt.explicitlyForbidden.includes(
      "treat this authorized-layout drill as a production sqlite snapshot",
    ),
  );
  assert.ok(
    receipt.explicitlyForbidden.includes("fill sre before cursor-memory-wsc written verification"),
  );
});
