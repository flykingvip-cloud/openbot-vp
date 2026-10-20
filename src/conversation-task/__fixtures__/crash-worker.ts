/**
 * Test fixture (not a unit test): a child process that opens a real transaction
 * (`BEGIN IMMEDIATE` + an uncommitted INSERT), signals readiness, then hangs so
 * the parent can SIGKILL it mid-transaction. Used by store.test.ts to prove real
 * crash recovery: after an abnormal process exit the uncommitted row must be
 * absent (WAL rollback) and previously committed rows intact.
 *
 * argv: <dbPath> <sourceMessageId>
 * stdout: "READY\n" once the transaction is open and the INSERT has run.
 */

import { requireNodeSqlite } from "../../memory/sqlite.js";

function main(): void {
  const [dbPath, sourceMessageId] = process.argv.slice(2);
  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("BEGIN IMMEDIATE");
  db.prepare(
    `INSERT INTO candidates
       (candidate_id, tenant_id, conversation_id, source_message_id, decision_version,
        status, payload, created_at_ms, expires_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("cand_crash", "tenant-a", "conv-1", sourceMessageId, "v1", "observing", "{}", 1, 9_999_999);
  // Transaction is open and the INSERT has run but is NOT committed.
  process.stdout.write("READY\n");
  // Hang forever so the parent can kill us mid-transaction.
  setInterval(() => {}, 1_000);
}

main();
