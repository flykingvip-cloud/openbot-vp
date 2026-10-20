import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  classifyAuthorizedSqlitePath,
  requireItem6AuthorizedSqlitePath,
  type Item6AuthorizedSqlitePathStatus,
} from "./item6-authorized-sqlite-path.js";
import { SCHEMA_V2_ENABLED } from "./schema-v2.js";

export const ITEM6_PRODUCTION_SQLITE_WRITE = false;
export const ITEM6_SINGLE_WRITER = true;
export const ITEM6_SCHEMA_V2_PRODUCTION_WRITE = SCHEMA_V2_ENABLED;

export type Item6Identity = {
  tenantId: string;
  resourceId: string;
};

export type Item6MigrateDenyReason =
  | Item6AuthorizedSqlitePathStatus
  | "unknown-identity"
  | "cross-tenant"
  | "backup-hash-mismatch"
  | "restore-failure"
  | "integrity-failure"
  | "production-sqlite-write-forbidden"
  | "schema-v2-production-write-forbidden"
  | "live-cutover-forbidden"
  | "resolver-switch-forbidden"
  | "concurrent-migration-forbidden";

export type Item6MigrateDenial = {
  ok: false;
  allow: false;
  failClosed: true;
  reason: Item6MigrateDenyReason;
  recoveryRequired: boolean;
  productionSqliteWrite: false;
};

export type Item6MigrateReceipt = {
  ok: true;
  allow: true;
  pathToken: string;
  sourceHash: string;
  backupHash: string;
  copyHash: string;
  fencingToken: string;
  identity: Item6Identity;
  operationId: string;
  isolationRoot: string;
  integrityCheck: string;
  shadowTables: string[];
  recoveryRequired: false;
  productionSqliteWrite: false;
  sourceUnwritten: true;
  readOnlySource: true;
  item6Met: false;
};

const SHADOW_TABLES = ["item6_recovery_required", "item6_quarantine", "item6_tombstone"] as const;

function deny(
  reason: Item6MigrateDenyReason,
  recoveryRequired = reason === "backup-hash-mismatch" || reason === "integrity-failure",
): Item6MigrateDenial {
  return {
    ok: false,
    allow: false,
    failClosed: true,
    reason,
    recoveryRequired,
    productionSqliteWrite: false,
  };
}

function requiredText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hasIdentity(identity: Item6Identity | null | undefined): identity is Item6Identity {
  return Boolean(requiredText(identity?.tenantId) && requiredText(identity?.resourceId));
}

export function resolveItem6OperationId(input: {
  identity: Item6Identity;
  operationId?: string | null;
}): string {
  const explicit = requiredText(input.operationId);
  if (explicit) {
    return explicit;
  }
  return `${input.identity.tenantId.trim()}:${input.identity.resourceId.trim()}`;
}

export function resolveItem6IsolationRoot(params: {
  trustedRoot: string;
  identity: Item6Identity;
  operationId: string;
}): string {
  const partition = crypto
    .createHash("sha256")
    .update(
      `${params.identity.tenantId.trim()}\0${params.identity.resourceId.trim()}\0${params.operationId.trim()}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 24);
  return path.join(params.trustedRoot, ".item6-isolated", partition);
}

function acquireExclusiveMigrationLock(lockPath: string): boolean {
  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(fd, `${process.pid}`, "utf8");
    fs.closeSync(fd);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

function releaseExclusiveMigrationLock(lockPath: string): void {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // best-effort release
  }
}

export function denyItem6ProductionSqliteWrite(): Item6MigrateDenial {
  return deny("production-sqlite-write-forbidden", false);
}

export function denyItem6LiveCutover(): Item6MigrateDenial {
  return deny("live-cutover-forbidden", false);
}

export function denyItem6ResolverSwitch(): Item6MigrateDenial {
  return deny("resolver-switch-forbidden", false);
}

export function denyItem6SchemaV2ProductionWrite(): Item6MigrateDenial {
  return deny("schema-v2-production-write-forbidden", false);
}

/**
 * Isolated-copy shadow migration. Authorizes the operator-issued path first,
 * then copies. Never writes the authorized source. Schema v2 stays disabled.
 */
export function runItem6IsolatedShadowMigration(input: {
  env?: NodeJS.ProcessEnv;
  identity: Item6Identity;
  operationId?: string | null;
  accessTenantId?: string;
  expectedSourceHash?: string;
}): Item6MigrateReceipt | Item6MigrateDenial {
  if (SCHEMA_V2_ENABLED) {
    return denyItem6SchemaV2ProductionWrite();
  }
  if (!hasIdentity(input.identity)) {
    return deny("unknown-identity", false);
  }
  const accessTenantId = requiredText(input.accessTenantId) ?? input.identity.tenantId;
  if (accessTenantId !== input.identity.tenantId) {
    return deny("cross-tenant", false);
  }

  const classified = classifyAuthorizedSqlitePath(input.env);
  if (classified.status !== "production-candidate") {
    return deny(classified.status, false);
  }
  const gate = requireItem6AuthorizedSqlitePath(input.env);
  if (!gate.ok) {
    return deny(gate.status, false);
  }

  if (!fs.existsSync(gate.resolved)) {
    return deny("unconfigured", false);
  }

  const operationId = resolveItem6OperationId({
    identity: input.identity,
    operationId: input.operationId,
  });
  const isolatedRoot = resolveItem6IsolationRoot({
    trustedRoot: gate.trustedRoot,
    identity: input.identity,
    operationId,
  });
  const lockPath = path.join(isolatedRoot, ".migrate.lock");
  fs.mkdirSync(isolatedRoot, { recursive: true });
  if (!acquireExclusiveMigrationLock(lockPath)) {
    return deny("concurrent-migration-forbidden", false);
  }

  try {
    const sourceHash = sha256File(gate.resolved);
    if (input.expectedSourceHash && input.expectedSourceHash !== sourceHash) {
      return deny("backup-hash-mismatch", true);
    }

    const backupPath = path.join(isolatedRoot, "backup.sqlite");
    const copyPath = path.join(isolatedRoot, "copy.sqlite");
    fs.copyFileSync(gate.resolved, backupPath);
    fs.copyFileSync(backupPath, copyPath);
    const backupHash = sha256File(backupPath);
    const copyHash = sha256File(copyPath);
    if (backupHash !== sourceHash || copyHash !== sourceHash) {
      return deny("backup-hash-mismatch", true);
    }

    const fencingToken = `fence:${gate.pathToken}:${operationId}:${backupHash.slice(0, 12)}`;
    fs.writeFileSync(path.join(isolatedRoot, "fence.token"), fencingToken, "utf8");

    const db = new DatabaseSync(copyPath);
    try {
      const integrityRow = db.prepare("PRAGMA integrity_check").get() as
        | { integrity_check?: string }
        | undefined;
      const integrityCheck = String(integrityRow?.integrity_check ?? "fail");
      if (integrityCheck !== "ok") {
        return deny("integrity-failure", true);
      }
      db.exec(`
      CREATE TABLE IF NOT EXISTS item6_recovery_required (
        id TEXT PRIMARY KEY,
        reason TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS item6_quarantine (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        reason TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS item6_tombstone (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        lifted INTEGER NOT NULL DEFAULT 0
      );
    `);
    } finally {
      db.close();
    }

    const sourceHashAfter = sha256File(gate.resolved);
    if (sourceHashAfter !== sourceHash) {
      return deny("production-sqlite-write-forbidden", false);
    }

    return {
      ok: true,
      allow: true,
      pathToken: gate.pathToken,
      sourceHash,
      backupHash,
      copyHash,
      fencingToken,
      identity: {
        tenantId: input.identity.tenantId.trim(),
        resourceId: input.identity.resourceId.trim(),
      },
      operationId,
      isolationRoot: isolatedRoot,
      integrityCheck: "ok",
      shadowTables: [...SHADOW_TABLES],
      recoveryRequired: false,
      productionSqliteWrite: false,
      sourceUnwritten: true,
      readOnlySource: true,
      item6Met: false,
    };
  } finally {
    releaseExclusiveMigrationLock(lockPath);
  }
}

export function restoreItem6IsolatedCopy(input: {
  env?: NodeJS.ProcessEnv;
  identity: Item6Identity;
  operationId?: string | null;
  backupMustMatchSource?: boolean;
}): Item6MigrateReceipt | Item6MigrateDenial {
  const migrated = runItem6IsolatedShadowMigration(input);
  if (!migrated.ok) {
    return migrated;
  }
  const gate = requireItem6AuthorizedSqlitePath(input.env);
  if (!gate.ok) {
    return deny(gate.status, false);
  }
  const operationId = resolveItem6OperationId({
    identity: input.identity,
    operationId: input.operationId,
  });
  const isolatedRoot = resolveItem6IsolationRoot({
    trustedRoot: gate.trustedRoot,
    identity: input.identity,
    operationId,
  });
  const backupPath = path.join(isolatedRoot, "backup.sqlite");
  const copyPath = path.join(isolatedRoot, "copy.sqlite");
  if (!fs.existsSync(backupPath)) {
    return deny("restore-failure", true);
  }
  const backupHash = sha256File(backupPath);
  if (backupHash !== migrated.sourceHash) {
    return deny("restore-failure", true);
  }
  fs.copyFileSync(backupPath, copyPath);
  const restoredHash = sha256File(copyPath);
  if (restoredHash !== migrated.sourceHash) {
    return deny("restore-failure", true);
  }
  if (sha256File(gate.resolved) !== migrated.sourceHash) {
    return deny("production-sqlite-write-forbidden", false);
  }
  return migrated;
}

export function failClosedItem6Restore(input: { backupPath?: string }): Item6MigrateDenial {
  if (!input.backupPath || !fs.existsSync(input.backupPath)) {
    return deny("restore-failure", true);
  }
  return deny("restore-failure", true);
}
