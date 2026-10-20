#!/usr/bin/env node
/**
 * Phase 1B item 6: offline cutover drill on existing cutover.ts plus authorized
 * `{stateDir}/memory/*.sqlite` file-level backup/restore. No second SM, no LIVE.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  advanceCutover,
  assertSingleWritableCanonical,
  createMemoryCutoverStore,
  resolveCutoverRollback,
} from "../../../src/gateway/workspace/cutover.ts";
import { V1_GUARD_DDL } from "../../../src/memory/v1-root-guard.ts";

const DIR = path.dirname(import.meta.filename);
const RECEIPT_PATH = path.join(DIR, "memory-workspace-phase1b-item6-cutover-drill-receipt.json");
const SRE_HALF_PATH = "docs/design/evidence/memory-workspace-phase1b-item6-sre-half.json";

const NOW = "2026-08-17T07:50:00.000Z";
const DRILL_RESOURCE_ID = "res-drill-1";

function baseOperation(overrides = {}) {
  return {
    operationId: "drill-op-1",
    resourceId: DRILL_RESOURCE_ID,
    sourceBindingId: "binding-src",
    targetBindingId: "binding-tgt",
    expectedContentVersion: "cv-drill-v1",
    state: "inventoried",
    retryCount: 0,
    lastError: null,
    compatibilityExpiresAt: null,
    cutoverCommitted: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sqliteIntegrityOk(sqlitePath) {
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const row = db.prepare("PRAGMA integrity_check").get();
    return row?.integrity_check === "ok";
  } finally {
    db.close();
  }
}

function createReviewableAuthorizedSqlite(sqlitePath) {
  const db = new DatabaseSync(sqlitePath);
  try {
    db.exec(V1_GUARD_DDL);
    db.exec(`
      CREATE TABLE workspace_envelope (
        workspace_id TEXT PRIMARY KEY NOT NULL,
        resource_id TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO workspace_envelope (workspace_id, resource_id) VALUES (?, ?)").run(
      `ws:ent-drill:user:user-1:steward`,
      `ws:ent-drill:user:user-1:steward`,
    );
    const row = db.prepare("PRAGMA integrity_check").get();
    if (row?.integrity_check !== "ok") {
      return { ok: false, detail: "integrity_check_failed_on_create" };
    }
  } finally {
    db.close();
  }
  const header = fs.readFileSync(sqlitePath).subarray(0, 16).toString("utf8");
  if (!header.startsWith("SQLite format 3")) {
    return { ok: false, detail: "missing_sqlite_header" };
  }
  if (fs.statSync(sqlitePath).size <= 32) {
    return { ok: false, detail: "header_only_not_reviewable" };
  }
  return { ok: true };
}

/**
 * Offline authorized layout under `{stateDir}/memory/`.
 * Uses a real SQLite database (v1-root-guard + workspace_envelope), not a
 * synthetic header. Not a production snapshot and not LIVE.
 */
function drillAuthorizedSqliteFileBackup() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-item6-statedir-"));
  const memoryDir = path.join(stateDir, "memory");
  fs.mkdirSync(memoryDir, { recursive: true });

  const sqlitePath = path.join(memoryDir, `resource-${DRILL_RESOURCE_ID}.sqlite`);
  const backupPath = `${sqlitePath}.backup`;

  try {
    const created = createReviewableAuthorizedSqlite(sqlitePath);
    if (!created.ok) {
      return { ok: false, reviewable: false, detail: created.detail, stateDir, sqlitePath };
    }
    const beforeHash = sha256File(sqlitePath);

    fs.copyFileSync(sqlitePath, backupPath);

    fs.writeFileSync(sqlitePath, Buffer.from("simulated-rebuild-corruption"));
    if (sha256File(sqlitePath) === beforeHash) {
      return {
        ok: false,
        reviewable: false,
        detail: "mutation_did_not_change_file",
        stateDir,
        sqlitePath,
      };
    }

    fs.copyFileSync(backupPath, sqlitePath);
    if (sha256File(sqlitePath) !== beforeHash) {
      return {
        ok: false,
        reviewable: false,
        detail: "restore_hash_mismatch",
        stateDir,
        sqlitePath,
      };
    }
    if (!sqliteIntegrityOk(sqlitePath)) {
      return {
        ok: false,
        reviewable: false,
        detail: "restore_integrity_check_failed",
        stateDir,
        sqlitePath,
      };
    }

    return {
      ok: true,
      reviewable: true,
      detail: "stateDir_memory_real_sqlite_copy_restore",
      sha256: beforeHash,
      stateDir,
      sqlitePath,
      layout: "{stateDir}/memory/resource-{resourceId}.sqlite",
    };
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

async function drillCutoverRecordSnapshot() {
  const store = createMemoryCutoverStore();
  const initial = baseOperation();
  await store.save(initial);
  const snapshot = structuredClone(await store.load(initial.operationId));
  if (!snapshot) {
    return { ok: false, detail: "snapshot_missing" };
  }

  await advanceCutover({
    store,
    operationId: initial.operationId,
    nextState: "prepared",
    nowIso: NOW,
  });
  await store.save(snapshot);
  const restored = await store.load(initial.operationId);
  if (restored?.state !== "inventoried") {
    return { ok: false, detail: "restore_failed" };
  }
  return { ok: true, detail: "record_snapshot_restore" };
}

function drillFencing() {
  try {
    assertSingleWritableCanonical([
      { role: "canonical", state: "active" },
      { role: "canonical", state: "active" },
    ]);
    return { ok: false, detail: "dual_writer_not_rejected" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("expected_one_writable_canonical")) {
      return { ok: false, detail: `unexpected_error:${message}` };
    }
  }

  assertSingleWritableCanonical([
    { role: "canonical", state: "active" },
    { role: "compatibility", state: "read_only" },
  ]);
  return { ok: true, detail: "single_writer_enforced" };
}

function drillRollback() {
  const preCutover = resolveCutoverRollback(
    baseOperation({ state: "write_frozen", cutoverCommitted: false }),
  );
  if (preCutover.mode !== "restore_original_writer" || !preCutover.allowOldWriter) {
    return { ok: false, detail: "pre_cutover_rollback_wrong" };
  }

  const postCutover = resolveCutoverRollback(
    baseOperation({ state: "resolver_write_cutover", cutoverCommitted: true }),
  );
  if (postCutover.mode !== "roll_forward_or_restore_target" || postCutover.allowOldWriter) {
    return { ok: false, detail: "post_cutover_rollback_wrong" };
  }

  return { ok: true, detail: "pre_and_post_cutover_policy" };
}

async function drillExistingStateMachinePath() {
  const store = createMemoryCutoverStore();
  await store.save(baseOperation());
  for (const nextState of [
    "prepared",
    "write_frozen",
    "copied_or_adopted",
    "verified",
    "dual_read_verified",
  ]) {
    await advanceCutover({
      store,
      operationId: "drill-op-1",
      nextState,
      nowIso: NOW,
    });
  }
  const op = await store.load("drill-op-1");
  if (op?.state !== "dual_read_verified" || op.cutoverCommitted) {
    return { ok: false, detail: "path_incomplete" };
  }
  return { ok: true, detail: "existing_sm_through_dual_read" };
}

function drillSqliteRollbackWithCutoverPolicy() {
  const sqlite = drillAuthorizedSqliteFileBackup();
  if (!sqlite.ok) {
    return sqlite;
  }
  const pre = resolveCutoverRollback(baseOperation({ state: "dual_read_verified" }));
  if (!pre.allowOldWriter) {
    return { ok: false, detail: "sqlite_restore_requires_pre_commit_policy" };
  }
  const post = resolveCutoverRollback(
    baseOperation({ state: "resolver_write_cutover", cutoverCommitted: true }),
  );
  if (post.allowOldWriter) {
    return { ok: false, detail: "post_commit_must_forbid_old_writer_with_sqlite_restore" };
  }
  return { ok: true, detail: "sqlite_restore_follows_cutover_rollback" };
}

export async function runCutoverDrill() {
  const authorizedSqliteFileBackup = drillAuthorizedSqliteFileBackup();
  const cutoverRecord = await drillCutoverRecordSnapshot();
  const fencing = drillFencing();
  const rollback = drillRollback();
  const sqliteRollback = drillSqliteRollbackWithCutoverPolicy();
  const path = await drillExistingStateMachinePath();

  const allOk =
    authorizedSqliteFileBackup.ok &&
    cutoverRecord.ok &&
    fencing.ok &&
    rollback.ok &&
    sqliteRollback.ok &&
    path.ok;

  return {
    authorizedSqliteFileBackup,
    cutoverRecord,
    fencing,
    rollback,
    sqliteRollback,
    path,
    allOk,
    extendsExistingRecord: true,
    secondStateMachine: false,
    live: false,
    cutoverModule: "src/gateway/workspace/cutover.ts",
    sreHalfPath: SRE_HALF_PATH,
  };
}

function statusFrom(ok) {
  return ok ? "green" : "fail";
}

export function buildReceipt(drill) {
  const authorizedGreen = drill.authorizedSqliteFileBackup.ok && drill.sqliteRollback.ok;
  const reviewableBackup = drill.authorizedSqliteFileBackup.reviewable === true && authorizedGreen;
  const allGreen =
    reviewableBackup &&
    drill.fencing.ok &&
    drill.rollback.ok &&
    drill.allOk &&
    drill.live === false;
  return {
    schema: "memory-workspace-phase1b-item6-cutover-drill-receipt/v3",
    status: allGreen ? "green" : "revoked",
    item6: "not-met",
    extendsExistingRecord: true,
    secondStateMachine: false,
    backup: reviewableBackup ? "green" : null,
    authorizedSqliteFileBackup: reviewableBackup
      ? statusFrom(authorizedGreen)
      : "synthetic-not-reviewable",
    fencing: statusFrom(drill.fencing.ok),
    rollback: statusFrom(drill.rollback.ok),
    live: false,
    preparedBy: "cursor-fable",
    sreHalfRef: drill.sreHalfPath,
    srePendingWscWrittenVerification: true,
    phase1bExecutionBlocked: true,
    deployAuthorized: false,
    drilledAt: NOW,
    cutoverModule: drill.cutoverModule,
    drillHarness: "docs/design/evidence/memory-workspace-phase1b-item6-cutover-drill.mjs",
    details: {
      authorizedSqliteFileBackup: drill.authorizedSqliteFileBackup.detail,
      authorizedSqliteLayout: drill.authorizedSqliteFileBackup.layout ?? null,
      authorizedSqliteSha256: drill.authorizedSqliteFileBackup.sha256 ?? null,
      sqliteEngine: "node:sqlite DatabaseSync + PRAGMA integrity_check",
      sqliteRollbackWithCutover: drill.sqliteRollback.detail,
      cutoverRecordSnapshot: drill.cutoverRecord.detail,
      fencing: drill.fencing.detail,
      rollback: drill.rollback.detail,
      existingStateMachinePath: drill.path.detail,
    },
    explicitlyForbidden: [
      "second migration state machine",
      "LIVE migration",
      "deployAuthorized=true",
      "phase1bExecutionBlocked=false",
      "claim item 6 met from receipt green or authorizedSqliteFileBackup green",
      "treat synthetic mkdtemp sqlite header as reviewable backup green",
      "treat this authorized-layout drill as a production sqlite snapshot",
      "treat cutover record snapshot as authorized sqlite backup",
      "fill sre before cursor-memory-wsc written verification",
      "Retirement / item 7",
    ],
  };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);

if (isMain) {
  const drill = await runCutoverDrill();
  const receipt = buildReceipt(drill);
  fs.writeFileSync(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (!drill.allOk) {
    process.exitCode = 1;
  }
}
