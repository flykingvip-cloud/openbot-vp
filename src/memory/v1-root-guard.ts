/**
 * v1 SQLite multi-root stop-loss (Phase 0 / §6.6).
 *
 * Production port of the accepted decision model. Runtime must not import docs/**.
 * Root fingerprint is conflict detection only — not a resource identity.
 * Does not authorize schema v2, Resolver write switch, or LIVE deploy.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DESTRUCTIVE_OPS = Object.freeze(["sync", "prune", "reset", "rebuild"] as const);
export type V1DestructiveOp = (typeof DESTRUCTIVE_OPS)[number];

export const V1_GUARD_TABLE = "_openbot_v1_root_guard";
export const V1_GUARD_KEY = "root_fingerprints";
export const V1_GUARD_DDL = `CREATE TABLE IF NOT EXISTS ${V1_GUARD_TABLE} (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`;
export const V1_GUARD_SECRET_ENV = "OPENBOT_V1_ROOT_GUARD_SECRET";
export const V1_GUARD_TOKEN_ENV = "OPENBOT_V1_ROOT_GUARD_TOKEN";

/**
 * @deprecated Empty on purpose. Conflict is sidecar / multi-fingerprint evidence,
 * not a named robot or seat-member list.
 */
export const KNOWN_CONFLICT_SQLITE_BASENAMES = Object.freeze<string[]>([]);

export interface V1GuardStatement {
  get(...params: unknown[]): { value?: string } | undefined;
  run(...params: unknown[]): unknown;
}

export interface V1GuardDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): V1GuardStatement;
  transaction?<T>(fn: () => T): () => T;
}

export type V1MaintenanceUnlock = {
  kind?: string;
  token?: string;
  secret?: string;
  now?: Date | string | number;
};

export type V1MaintenanceGrantPayload = {
  v: 1;
  kind: "maintenance";
  sqliteInstance: string;
  sqlitePath: string;
  op: string;
  reason: string;
  iat: string;
  exp: string;
};

export type V1MaintenanceAudit = {
  op: string;
  reason: string;
  sqliteInstance: string;
  sqlitePath: string;
  iat: string;
  exp: string;
  tokenVerified: true;
};

export type V1RootGuardDecision = {
  allow: boolean;
  status: "ok" | "unknown";
  action: "readonly" | "maintenance-unlock" | "same-root" | "refuse-destructive";
  recordedFingerprints: string[];
  knownConflict: boolean;
  unlocked?: boolean;
  audit?: V1MaintenanceAudit;
  refuse?: string;
  reason?: string;
  incomingFingerprint?: string;
};

export class V1RootGuardError extends Error {
  readonly code = "v1-root-guard-refused" as const;
  readonly decision: V1RootGuardDecision;

  constructor(decision: V1RootGuardDecision) {
    super(`v1-root-guard-refused:${decision.reason ?? "unknown"}`);
    this.name = "V1RootGuardError";
    this.decision = decision;
  }
}

export function isV1RootGuardError(error: unknown): error is V1RootGuardError {
  return error instanceof V1RootGuardError;
}

/** Unforgeable brand for in-process operation auth passed from public boundaries to internals. */
export const V1_OPERATION_AUTH_BRAND = Symbol.for("openbot.v1-operation-auth");

export type V1OperationAuth = {
  readonly brand: typeof V1_OPERATION_AUTH_BRAND;
  readonly op: V1DestructiveOp;
  readonly sqliteInstance: string;
  readonly expiresAtMs?: number;
};

export function createV1OperationAuth(
  op: V1DestructiveOp,
  sqlitePath: string,
  options?: { expiresAtMs?: number },
): V1OperationAuth {
  return {
    brand: V1_OPERATION_AUTH_BRAND,
    op,
    sqliteInstance: normalizeSqliteInstanceId(sqlitePath),
    ...(options?.expiresAtMs !== undefined ? { expiresAtMs: options.expiresAtMs } : {}),
  };
}

export function isV1OperationAuthExpired(
  auth: V1OperationAuth,
  nowMs: number = Date.now(),
): boolean {
  return auth.expiresAtMs !== undefined && nowMs >= auth.expiresAtMs;
}

export function isV1OperationAuth(value: unknown): value is V1OperationAuth {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as V1OperationAuth).brand === V1_OPERATION_AUTH_BRAND
  );
}

/** Whether an active boundary op authorizes a nested destructive step without re-verifying env grant. */
export function v1OperationCoversDestructive(
  boundaryOp: V1DestructiveOp,
  destructive: V1DestructiveOp,
): boolean {
  if (boundaryOp === destructive) {
    return true;
  }
  if (boundaryOp === "rebuild") {
    return destructive === "sync" || destructive === "prune" || destructive === "reset";
  }
  if (boundaryOp === "sync") {
    return destructive === "prune";
  }
  return false;
}

export type V1RootGuardIndexStatus = {
  indexStatus: "ok" | "unknown" | "degraded";
  reason?: string;
  refusedOp?: string;
  knownConflict?: boolean;
};

/** Read-only status surface for manager.status() / doctor — does not re-read env grants. */
export function resolveV1RootGuardIndexStatus(params: {
  lastRefusal?: V1RootGuardDecision | null;
  incomingFingerprint: string;
  recordedFingerprints: string[];
  sqlitePath: string;
}): V1RootGuardIndexStatus {
  const last = params.lastRefusal;
  if (last && !last.allow) {
    return {
      indexStatus: last.knownConflict ? "degraded" : "unknown",
      reason: last.reason,
      refusedOp: last.refuse,
      knownConflict: last.knownConflict,
    };
  }
  const knownConflict = isKnownConflictSqlite(params.sqlitePath);
  const recorded = uniqueFingerprints(params.recordedFingerprints);
  const incoming = params.incomingFingerprint;
  if (knownConflict) {
    return {
      indexStatus: "degraded",
      reason: "known-conflict-preset-deny",
      knownConflict: true,
    };
  }
  if (recorded.length === 0) {
    return { indexStatus: "unknown", reason: "unregistered-v1-fail-closed" };
  }
  if (recorded.length === 1 && recorded[0] === incoming) {
    return { indexStatus: "ok" };
  }
  return {
    indexStatus: "unknown",
    reason: "v1-multi-root-or-root-mismatch",
    knownConflict,
  };
}

export function sqliteBasename(sqlitePath: string): string {
  if (typeof sqlitePath !== "string" || sqlitePath.trim() === "") {
    return "";
  }
  const base = path.basename(sqlitePath);
  return base.endsWith(".v1-root-guard.json") ? base.slice(0, -".v1-root-guard.json".length) : base;
}

export function normalizeSqlitePath(sqlitePath: string): string {
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
export function normalizeSqliteInstanceId(sqlitePath: string): string {
  return crypto.createHash("sha256").update(normalizeSqlitePath(sqlitePath)).digest("hex");
}

export function isKnownConflictSqlite(sqlitePath: string): boolean {
  if (typeof sqlitePath !== "string" || sqlitePath.trim() === "") {
    return false;
  }
  const sidecar = sqlitePath.endsWith(".v1-root-guard.json")
    ? sqlitePath
    : sidecarPathForSqlite(sqlitePath);
  return readSidecar(sidecar).fingerprints.length > 1;
}

export function normalizeRootFingerprint(workspaceDir: string): string {
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

export function signMaintenanceGrant(input: {
  secret?: string;
  sqlitePath: string;
  reason: string;
  op?: string;
  issuedAt?: string;
  expiresAt: string;
}): string {
  const secret = requireSecret(input.secret);
  const sqlitePath = normalizeSqlitePath(input.sqlitePath);
  const sqliteInstance = normalizeSqliteInstanceId(sqlitePath);
  if (typeof input.reason !== "string" || input.reason.trim() === "") {
    throw new Error("v1-root-guard-grant-requires-reason");
  }
  const op = input.op ?? "*";
  if (op !== "*" && !isDestructiveOp(op) && op !== "register") {
    throw new Error("v1-root-guard-grant-invalid-op");
  }
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const expiresAt = input.expiresAt;
  if (typeof expiresAt !== "string" || Number.isNaN(Date.parse(expiresAt))) {
    throw new Error("v1-root-guard-grant-requires-expires-at");
  }
  const payload: V1MaintenanceGrantPayload = {
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

export function verifyMaintenanceGrant(input: {
  kind?: string;
  token?: string;
  secret?: string;
  sqlitePath: string;
  op?: string;
  now?: Date | string | number;
}):
  | { ok: true; grant: V1MaintenanceGrantPayload; audit: V1MaintenanceAudit }
  | { ok: false; reason: string } {
  const now = input.now ?? new Date();
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  if (!input || input.kind !== "maintenance") {
    return { ok: false, reason: "unlock-not-maintenance" };
  }
  if (typeof input.token !== "string" || !input.token.startsWith("v1.")) {
    return { ok: false, reason: "unlock-token-unverified" };
  }
  let secret: string;
  try {
    secret = requireSecret(input.secret);
  } catch {
    return { ok: false, reason: "unlock-secret-missing" };
  }
  const parts = input.token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    return { ok: false, reason: "unlock-token-unverified" };
  }
  const body = parts[1] ?? "";
  const sig = parts[2] ?? "";
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, reason: "unlock-token-unverified" };
  }
  let payload: V1MaintenanceGrantPayload;
  try {
    payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as V1MaintenanceGrantPayload;
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
      op: op ?? payload.op,
      reason: payload.reason,
      sqliteInstance: payload.sqliteInstance,
      sqlitePath: payload.sqlitePath,
      iat: payload.iat,
      exp: payload.exp,
      tokenVerified: true,
    },
  };
}

function requireSecret(secret?: string): string {
  const value = secret ?? process.env[V1_GUARD_SECRET_ENV];
  if (typeof value !== "string" || value.length < 16) {
    throw new Error("v1-root-guard-secret-required");
  }
  return value;
}

export function readV1RootGuardUnlockFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): V1MaintenanceUnlock | undefined {
  const token = env[V1_GUARD_TOKEN_ENV];
  if (typeof token !== "string" || token.trim() === "") {
    return undefined;
  }
  return {
    kind: "maintenance",
    token,
    secret: env[V1_GUARD_SECRET_ENV],
  };
}

export function decideV1RootGuard(input: {
  op: string;
  incomingFingerprint: string;
  recordedFingerprints?: string[] | null;
  sqlitePath?: string;
  knownConflict?: boolean;
  unlock?: V1MaintenanceUnlock;
  now?: Date | string | number;
}): V1RootGuardDecision {
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

  if (!isDestructiveOp(op)) {
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

function refuse(
  op: string,
  incoming: string,
  recorded: string[],
  reason: string,
  knownConflict: boolean,
): V1RootGuardDecision {
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

export function uniqueFingerprints(values?: string[] | null): string[] {
  return [
    ...new Set((values ?? []).filter((value) => typeof value === "string" && value.length > 0)),
  ];
}

function isDestructiveOp(op: string): op is V1DestructiveOp {
  return (DESTRUCTIVE_OPS as readonly string[]).includes(op);
}

export function sidecarPathForSqlite(sqlitePath: string): string {
  return `${sqlitePath}.v1-root-guard.json`;
}

export function readSidecar(filePath: string): {
  version: 1;
  fingerprints: string[];
  unlocked: boolean;
} {
  if (!fs.existsSync(filePath)) {
    return { version: 1, fingerprints: [], unlocked: false };
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    fingerprints?: string[];
    unlocked?: boolean;
  };
  return {
    version: 1,
    fingerprints: uniqueFingerprints(parsed.fingerprints),
    unlocked: Boolean(parsed.unlocked),
  };
}

export function writeSidecar(
  filePath: string,
  state: { fingerprints?: string[]; unlocked?: boolean },
): {
  version: 1;
  fingerprints: string[];
  unlocked: boolean;
  updatedAt: string;
  note: string;
} {
  const next = {
    version: 1 as const,
    fingerprints: uniqueFingerprints(state.fingerprints),
    unlocked: Boolean(state.unlocked),
    updatedAt: new Date().toISOString(),
    note: "v1 conflict detection only; not a workspace resourceId",
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function withSidecarLock<T>(
  lockPath: string,
  fn: () => T | Promise<T>,
  options: { timeoutMs?: number; staleMs?: number } = {},
): Promise<T> {
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
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") {
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

export function evaluateDestructiveWithSidecar(params: {
  sidecarPath: string;
  sqlitePath?: string;
  op: string;
  incomingFingerprint: string;
  knownConflict?: boolean;
  unlock?: V1MaintenanceUnlock;
  now?: Date | string | number;
}): Promise<V1RootGuardDecision> {
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

export function ensureGuardTable(db: V1GuardDatabase): void {
  db.exec(V1_GUARD_DDL);
}

export function readFingerprintsFromDb(db: V1GuardDatabase): string[] {
  ensureGuardTable(db);
  const row = db.prepare(`SELECT value FROM ${V1_GUARD_TABLE} WHERE key = ?`).get(V1_GUARD_KEY);
  if (!row?.value) {
    return [];
  }
  return uniqueFingerprints(JSON.parse(row.value) as string[]);
}

export function writeFingerprintsToDb(db: V1GuardDatabase, fingerprints: string[]): void {
  ensureGuardTable(db);
  const value = JSON.stringify(uniqueFingerprints(fingerprints));
  db.prepare(
    `INSERT INTO ${V1_GUARD_TABLE} (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(V1_GUARD_KEY, value);
}

export function evaluateDestructiveInDbTransaction(
  db: V1GuardDatabase,
  params: {
    op: string;
    incomingFingerprint: string;
    sqlitePath?: string;
    knownConflict?: boolean;
    unlock?: V1MaintenanceUnlock;
    now?: Date | string | number;
  },
): V1RootGuardDecision {
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

export function rollbackSidecarToSingleRoot(sidecarPath: string, fingerprint: string) {
  return writeSidecar(sidecarPath, { fingerprints: [fingerprint], unlocked: false });
}

export function assertV1RootGuardDecision(decision: V1RootGuardDecision): void {
  if (!decision.allow) {
    throw new V1RootGuardError(decision);
  }
}

export const V1_MAINTENANCE_AUDIT_SUFFIX = ".v1-maintenance-unlock.audit.jsonl";

export type V1MaintenanceUnlockAuditRecord = V1MaintenanceAudit & {
  action: "maintenance-unlock";
  recordedAt: string;
};

export function maintenanceUnlockAuditPath(sqlitePath: string): string {
  return `${normalizeSqlitePath(sqlitePath)}${V1_MAINTENANCE_AUDIT_SUFFIX}`;
}

export function appendMaintenanceUnlockAudit(
  sqlitePath: string,
  audit: V1MaintenanceAudit,
): V1MaintenanceUnlockAuditRecord {
  const record: V1MaintenanceUnlockAuditRecord = {
    action: "maintenance-unlock",
    op: audit.op,
    reason: audit.reason,
    sqliteInstance: audit.sqliteInstance,
    sqlitePath: audit.sqlitePath,
    iat: audit.iat,
    exp: audit.exp,
    tokenVerified: audit.tokenVerified,
    recordedAt: new Date().toISOString(),
  };
  const filePath = maintenanceUnlockAuditPath(sqlitePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
  return record;
}

export function readMaintenanceUnlockAudit(sqlitePath: string): V1MaintenanceUnlockAuditRecord[] {
  const filePath = maintenanceUnlockAuditPath(sqlitePath);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as V1MaintenanceUnlockAuditRecord);
}
