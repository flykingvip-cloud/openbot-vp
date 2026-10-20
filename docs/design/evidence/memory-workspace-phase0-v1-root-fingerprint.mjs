/**
 * v1 SQLite multi-root stop-loss (Phase 0 / §6.6).
 *
 * Reviewable module only. Not wired into src/memory/**. Not a resource identity.
 * Does not authorize schema v2, Resolver write switch, or LIVE deploy.
 *
 * Fail-closed rules:
 * - empty fingerprint + destructive = refuse (no first-writer wins)
 * - known conflict = sidecar records more than one root fingerprint
 * - maintenance unlock requires a signed, expiring grant bound to a
 *   sha256(realpath) instance id, not the sqlite basename
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DESTRUCTIVE_OPS = Object.freeze(["sync", "prune", "reset", "rebuild"]);
export const V1_GUARD_TABLE = "_openbot_v1_root_guard";
export const V1_GUARD_KEY = "root_fingerprints";
export const V1_GUARD_DDL = `CREATE TABLE IF NOT EXISTS ${V1_GUARD_TABLE} (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`;
export const V1_GUARD_SECRET_ENV = "OPENBOT_V1_ROOT_GUARD_SECRET";

/** @deprecated Empty on purpose. Conflict is sidecar / multi-fingerprint evidence. */
export const KNOWN_CONFLICT_SQLITE_BASENAMES = Object.freeze([]);

export function sqliteBasename(sqlitePath) {
  if (typeof sqlitePath !== "string" || sqlitePath.trim() === "") {
    return "";
  }
  const base = path.basename(sqlitePath);
  return base.endsWith(".v1-root-guard.json") ? base.slice(0, -".v1-root-guard.json".length) : base;
}

export function normalizeSqlitePath(sqlitePath) {
  if (typeof sqlitePath !== "string" || sqlitePath.trim() === "") {
    throw new Error("v1-root-guard-requires-sqlite-path");
  }
  const resolved = path.resolve(sqlitePath);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/** Collision-resistant instance id. Grants must not bind basename only. */
export function normalizeSqliteInstanceId(sqlitePath) {
  return crypto.createHash("sha256").update(normalizeSqlitePath(sqlitePath)).digest("hex");
}

export function isKnownConflictSqlite(sqlitePath) {
  if (typeof sqlitePath !== "string" || sqlitePath.trim() === "") {
    return false;
  }
  const sidecar = sqlitePath.endsWith(".v1-root-guard.json")
    ? sqlitePath
    : sidecarPathForSqlite(sqlitePath);
  return readSidecar(sidecar).fingerprints.length > 1;
}

export function normalizeRootFingerprint(workspaceDir) {
  if (typeof workspaceDir !== "string" || workspaceDir.trim() === "") {
    throw new Error("v1-root-fingerprint-requires-workspace-dir");
  }
  const resolved = path.resolve(workspaceDir);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function signMaintenanceGrant(input) {
  const secret = requireSecret(input.secret);
  const sqlitePath = normalizeSqlitePath(input.sqlitePath);
  const sqliteInstance = normalizeSqliteInstanceId(sqlitePath);
  if (typeof input.reason !== "string" || input.reason.trim() === "") {
    throw new Error("v1-root-guard-grant-requires-reason");
  }
  const op = input.op ?? "*";
  if (op !== "*" && !DESTRUCTIVE_OPS.includes(op) && op !== "register") {
    throw new Error("v1-root-guard-grant-invalid-op");
  }
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const expiresAt = input.expiresAt;
  if (typeof expiresAt !== "string" || Number.isNaN(Date.parse(expiresAt))) {
    throw new Error("v1-root-guard-grant-requires-expires-at");
  }
  const payload = {
    v: 1,
    kind: "maintenance",
    sqliteInstance,
    sqlitePath,
    op,
    reason: input.reason.trim(),
    iat: issuedAt,
    exp: expiresAt,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `v1.${body}.${sig}`;
}

export function verifyMaintenanceGrant(input) {
  const now = input.now ?? new Date();
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  if (!input || input.kind !== "maintenance") {
    return { ok: false, reason: "unlock-not-maintenance" };
  }
  if (typeof input.token !== "string" || !input.token.startsWith("v1.")) {
    return { ok: false, reason: "unlock-token-unverified" };
  }
  let secret;
  try {
    secret = requireSecret(input.secret);
  } catch {
    return { ok: false, reason: "unlock-secret-missing" };
  }
  const parts = input.token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    return { ok: false, reason: "unlock-token-unverified" };
  }
  const [, body, sig] = parts;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, reason: "unlock-token-unverified" };
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "unlock-token-unverified" };
  }
  if (payload?.v !== 1 || payload.kind !== "maintenance") {
    return { ok: false, reason: "unlock-token-unverified" };
  }
  const expMs = Date.parse(payload.exp);
  if (Number.isNaN(expMs) || expMs <= nowMs) {
    return { ok: false, reason: "unlock-token-expired" };
  }
  const sqliteInstance = normalizeSqliteInstanceId(input.sqlitePath);
  if (!payload.sqliteInstance || payload.sqliteInstance !== sqliteInstance) {
    return { ok: false, reason: "unlock-sqlite-mismatch" };
  }
  const op = input.op;
  if (payload.op !== "*" && payload.op !== op) {
    return { ok: false, reason: "unlock-op-mismatch" };
  }
  return {
    ok: true,
    grant: payload,
    audit: {
      op,
      reason: payload.reason,
      sqliteInstance: payload.sqliteInstance,
      sqlitePath: payload.sqlitePath,
      iat: payload.iat,
      exp: payload.exp,
      tokenVerified: true,
    },
  };
}

function requireSecret(secret) {
  const value = secret ?? process.env[V1_GUARD_SECRET_ENV];
  if (typeof value !== "string" || value.length < 16) {
    throw new Error("v1-root-guard-secret-required");
  }
  return value;
}

export function decideV1RootGuard(input) {
  const op = input.op;
  const incoming = input.incomingFingerprint;
  const recorded = uniqueFingerprints(input.recordedFingerprints);
  const sqlitePath = input.sqlitePath ?? "";
  const knownConflict = Boolean(input.knownConflict) || isKnownConflictSqlite(sqlitePath);
  const verified = verifyMaintenanceGrant({
    kind: input.unlock?.kind,
    token: input.unlock?.token,
    secret: input.unlock?.secret,
    sqlitePath,
    op,
    now: input.unlock?.now ?? input.now,
  });

  if (!DESTRUCTIVE_OPS.includes(op)) {
    return {
      allow: true,
      status: knownConflict || recorded.length !== 1 || recorded[0] !== incoming ? "unknown" : "ok",
      action: "readonly",
      recordedFingerprints: recorded,
      knownConflict,
    };
  }

  if (verified.ok) {
    return {
      allow: true,
      status: "unknown",
      action: "maintenance-unlock",
      recordedFingerprints:
        recorded.length === 0 ? [incoming] : uniqueFingerprints([...recorded, incoming]),
      unlocked: true,
      knownConflict,
      audit: verified.audit,
    };
  }

  if (knownConflict) {
    return refuse(op, incoming, recorded, "known-conflict-preset-deny", knownConflict);
  }

  if (recorded.length === 0) {
    return refuse(op, incoming, recorded, "unregistered-v1-fail-closed", knownConflict);
  }

  if (recorded.length === 1 && recorded[0] === incoming) {
    return {
      allow: true,
      status: "ok",
      action: "same-root",
      recordedFingerprints: recorded,
      knownConflict,
    };
  }

  return refuse(op, incoming, recorded, "v1-multi-root-or-root-mismatch", knownConflict);
}

function refuse(op, incoming, recorded, reason, knownConflict) {
  return {
    allow: false,
    status: "unknown",
    action: "refuse-destructive",
    refuse: op,
    reason,
    recordedFingerprints: recorded,
    incomingFingerprint: incoming,
    knownConflict,
  };
}

function uniqueFingerprints(values) {
  return [
    ...new Set((values ?? []).filter((value) => typeof value === "string" && value.length > 0)),
  ];
}

export function sidecarPathForSqlite(sqlitePath) {
  return `${sqlitePath}.v1-root-guard.json`;
}

export function readSidecar(filePath) {
  if (!fs.existsSync(filePath)) {
    return { version: 1, fingerprints: [], unlocked: false };
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    version: 1,
    fingerprints: uniqueFingerprints(parsed.fingerprints),
    unlocked: Boolean(parsed.unlocked),
  };
}

export function writeSidecar(filePath, state) {
  const next = {
    version: 1,
    fingerprints: uniqueFingerprints(state.fingerprints),
    unlocked: Boolean(state.unlocked),
    updatedAt: new Date().toISOString(),
    note: "v1 conflict detection only; not a workspace resourceId",
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function withSidecarLock(lockPath, fn, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  const staleMs = options.staleMs ?? 30_000;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        fs.writeFileSync(
          fd,
          `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`,
        );
      } finally {
        fs.closeSync(fd);
      }
      try {
        return await fn();
      } finally {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // lock already released
        }
      }
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // raced with unlock
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error("v1-root-guard-lock-timeout");
}

export function evaluateDestructiveWithSidecar(params) {
  const sidecar = params.sidecarPath;
  const lockPath = `${sidecar}.lock`;
  const sqlitePath = params.sqlitePath ?? sidecar;
  return withSidecarLock(lockPath, () => {
    const state = readSidecar(sidecar);
    const decision = decideV1RootGuard({
      op: params.op,
      incomingFingerprint: params.incomingFingerprint,
      recordedFingerprints: state.fingerprints,
      sqlitePath,
      knownConflict: params.knownConflict,
      unlock: params.unlock,
      now: params.now,
    });
    if (decision.action === "maintenance-unlock") {
      writeSidecar(sidecar, {
        fingerprints: decision.recordedFingerprints,
        unlocked: true,
      });
    }
    return decision;
  });
}

export function ensureGuardTable(db) {
  db.exec(V1_GUARD_DDL);
}

export function readFingerprintsFromDb(db) {
  ensureGuardTable(db);
  const row = db.prepare(`SELECT value FROM ${V1_GUARD_TABLE} WHERE key = ?`).get(V1_GUARD_KEY);
  if (!row?.value) {
    return [];
  }
  return uniqueFingerprints(JSON.parse(row.value));
}

export function writeFingerprintsToDb(db, fingerprints) {
  ensureGuardTable(db);
  const value = JSON.stringify(uniqueFingerprints(fingerprints));
  db.prepare(
    `INSERT INTO ${V1_GUARD_TABLE} (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(V1_GUARD_KEY, value);
}

export function evaluateDestructiveInDbTransaction(db, params) {
  const run = () => {
    const recorded = readFingerprintsFromDb(db);
    const decision = decideV1RootGuard({
      op: params.op,
      incomingFingerprint: params.incomingFingerprint,
      recordedFingerprints: recorded,
      sqlitePath: params.sqlitePath,
      knownConflict: params.knownConflict,
      unlock: params.unlock,
      now: params.now,
    });
    if (decision.action === "maintenance-unlock") {
      writeFingerprintsToDb(db, decision.recordedFingerprints);
    }
    return decision;
  };
  if (typeof db.transaction === "function") {
    return db.transaction(run)();
  }
  db.exec("BEGIN");
  try {
    const decision = run();
    db.exec("COMMIT");
    return decision;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function rollbackSidecarToSingleRoot(sidecarPath, fingerprint) {
  return writeSidecar(sidecarPath, { fingerprints: [fingerprint], unlocked: false });
}
