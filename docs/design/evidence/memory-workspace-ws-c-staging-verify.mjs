#!/usr/bin/env node
/**
 * WS-C staging deployment verification (Phase 0 evidence runner).
 * Uses the accepted v1-root-fingerprint module — no src/memory imports required.
 *
 *   node docs/design/evidence/memory-workspace-ws-c-staging-verify.mjs --mode fixture
 *   OPENBOT_STATE_DIR=/root/.openbot \
 *     node docs/design/evidence/memory-workspace-ws-c-staging-verify.mjs --mode live --agent bot-2
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  evaluateDestructiveInDbTransaction,
  isKnownConflictSqlite,
  readFingerprintsFromDb,
} from "./memory-workspace-phase0-v1-root-fingerprint.mjs";

function parseArgs(argv) {
  let mode = "fixture";
  let agentId = "bot-2";
  let stateDir = process.env.OPENBOT_STATE_DIR?.trim() || path.join(os.homedir(), ".openbot");
  let workspaceDir;
  let sqlitePath;
  let outPath;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--mode" && argv[i + 1]) {
      mode = argv[++i].trim();
    } else if (arg === "--agent" && argv[i + 1]) {
      agentId = argv[++i].trim();
    } else if (arg === "--state-dir" && argv[i + 1]) {
      stateDir = path.resolve(argv[++i].trim());
    } else if (arg === "--workspace-dir" && argv[i + 1]) {
      workspaceDir = path.resolve(argv[++i].trim());
    } else if (arg === "--sqlite" && argv[i + 1]) {
      sqlitePath = path.resolve(argv[++i].trim());
    } else if (arg === "--out" && argv[i + 1]) {
      outPath = path.resolve(argv[++i].trim());
    }
  }
  return { mode, agentId, stateDir, workspaceDir, sqlitePath, outPath };
}

function countRows(db) {
  const files = db.prepare(`SELECT COUNT(*) as c FROM files`).get()?.c ?? 0;
  const chunks = db.prepare(`SELECT COUNT(*) as c FROM chunks`).get()?.c ?? 0;
  return { files, chunks };
}

function normalizeRootFingerprint(workspaceDir) {
  const resolved = path.resolve(workspaceDir);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function probe(db, workspaceDir, sqlitePath) {
  const decision = evaluateDestructiveInDbTransaction(db, {
    op: "sync",
    incomingFingerprint: normalizeRootFingerprint(workspaceDir),
    sqlitePath,
  });
  return decision;
}

function runFixture(params) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ws-c-verify-"));
  const workspaceDir = path.join(tmp, "workspace-bot-2");
  const sqlitePath = path.join(tmp, "bot-2.sqlite");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const db = new DatabaseSync(sqlitePath);
  db.exec(`CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY, source TEXT NOT NULL DEFAULT 'memory',
    hash TEXT NOT NULL, mtime INTEGER NOT NULL, size INTEGER NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY, path TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'memory',
    start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, hash TEXT NOT NULL,
    model TEXT NOT NULL, text TEXT NOT NULL, embedding TEXT NOT NULL, updated_at INTEGER NOT NULL
  )`);
  db.prepare(`INSERT OR REPLACE INTO files VALUES (?, ?, ?, ?, ?)`).run(
    "tenant/memory/2026-08-06.md",
    "memory",
    "h1",
    Date.now(),
    100,
  );
  db.prepare(`INSERT OR REPLACE INTO chunks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "c1",
    "tenant/memory/2026-08-06.md",
    "memory",
    1,
    1,
    "h1",
    "mock",
    "tenant",
    "[]",
    Date.now(),
  );
  const before = countRows(db);
  const decision = probe(db, workspaceDir, sqlitePath);
  const after = countRows(db);
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  return {
    ok:
      !decision.allow &&
      decision.reason === "known-conflict-preset-deny" &&
      before.files === after.files &&
      before.chunks === after.chunks,
    mode: "fixture",
    agentId: params.agentId,
    sqlitePath,
    workspaceDir,
    knownConflict: isKnownConflictSqlite(sqlitePath),
    before,
    after,
    syncRefused: !decision.allow,
    refuseReason: decision.reason,
    ts: new Date().toISOString(),
  };
}

function resolveLivePaths(params) {
  const configPath = path.join(params.stateDir, "openbot.json");
  let workspaceDir = params.workspaceDir;
  let sqlitePath = params.sqlitePath;
  if (fs.existsSync(configPath)) {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const agent = raw.agents?.list?.find((entry) => entry.id === params.agentId);
    if (!workspaceDir && typeof agent?.workspace === "string") {
      workspaceDir = agent.workspace;
    }
  }
  workspaceDir = workspaceDir || path.join(params.stateDir, `workspace-${params.agentId}`);
  sqlitePath = sqlitePath || path.join(params.stateDir, "memory", `${params.agentId}.sqlite`);
  return { workspaceDir: path.resolve(workspaceDir), sqlitePath: path.resolve(sqlitePath) };
}

function runLive(params) {
  const { workspaceDir, sqlitePath } = resolveLivePaths(params);
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`sqlite not found: ${sqlitePath}`);
  }
  const db = new DatabaseSync(sqlitePath);
  const before = countRows(db);
  const decision = probe(db, workspaceDir, sqlitePath);
  const after = countRows(db);
  const fingerprints = readFingerprintsFromDb(db);
  db.close();
  return {
    ok: !decision.allow && before.files === after.files && before.chunks === after.chunks,
    mode: "live",
    agentId: params.agentId,
    sqlitePath,
    workspaceDir,
    knownConflict: isKnownConflictSqlite(sqlitePath),
    before,
    after,
    syncRefused: !decision.allow,
    refuseReason: decision.reason,
    fingerprints,
    ts: new Date().toISOString(),
  };
}

const args = parseArgs(process.argv.slice(2));
const report = args.mode === "live" ? runLive(args) : runFixture(args);
const text = `${JSON.stringify(report, null, 2)}\n`;
if (args.outPath) {
  fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
  fs.writeFileSync(args.outPath, text);
}
process.stdout.write(text);
process.exit(report.ok ? 0 : 1);
