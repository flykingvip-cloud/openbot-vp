import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { collectProbeSnapshotPaths, hashProbeSnapshot } from "./health-probe-snapshot.js";

/** Warm up readonly SQLite open so platform WAL/SHM sidecars exist when supported. */
export function warmUpReadonlySqliteSidecars(indexPath: string): void {
  const ro = new DatabaseSync(indexPath, { readOnly: true, allowExtension: false });
  try {
    ro.prepare(`SELECT COUNT(*) AS count FROM sqlite_master`).get();
  } finally {
    ro.close();
  }
}

/** Create a valid SQLite database; warm-up readonly open materializes WAL/SHM when supported. */
export function createWalBackedSqlite(indexPath: string): void {
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  const db = new DatabaseSync(indexPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("CREATE TABLE files (path TEXT PRIMARY KEY)");
  db.exec("INSERT INTO files(path) VALUES ('memory/a.md')");
  db.close();
  warmUpReadonlySqliteSidecars(indexPath);
}

export function readSqliteHeader(indexPath: string): string {
  const fd = fs.openSync(indexPath, "r");
  const header = Buffer.alloc(16);
  fs.readSync(fd, header, 0, 16, 0);
  fs.closeSync(fd);
  return header.toString("utf8", 0, 15);
}

export function fileContentSha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/** Create a valid empty SQLite database (no user tables). */
export function createEmptyValidSqlite(indexPath: string): void {
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  const db = new DatabaseSync(indexPath);
  db.exec("SELECT 1");
  db.close();
}

export function listUserSqliteTables(indexPath: string): string[] {
  const db = new DatabaseSync(indexPath, { readOnly: true, allowExtension: false });
  try {
    const rows = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  } finally {
    db.close();
  }
}

export function fingerprintPaths(paths: string[]): string {
  return hashProbeSnapshot(collectProbeSnapshotPaths(paths));
}

export function sqliteSidecarPaths(indexPath: string): string[] {
  return [indexPath, `${indexPath}-wal`, `${indexPath}-shm`, `${indexPath}.v1-root-guard.json`];
}
