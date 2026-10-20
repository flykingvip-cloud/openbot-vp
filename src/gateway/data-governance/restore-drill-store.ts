/**
 * Durable P5-c restore-drill receipts and backup/restore observability.
 * Not a P5-d exit package store. Lock expiry uses the lock payload, not fs mtime.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateFormatMigrationJournalLocators } from "./format-migration-locator.js";
import {
  resolveFormatMigrationJournalPath,
  resolveRestoreDrillCatalogPath,
  resolveRestoreDrillRoot,
} from "./paths.js";
import type {
  CatalogRecord,
  ContentFormatMigrationReceipt,
  IntegrityScanReceipt,
  RestoreDrillReceipt,
} from "./types.js";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 20;
const LOCK_MAX_ATTEMPTS = 250;

export type TenantRestoreDrillState = {
  schemaVersion: 1;
  revision: number;
  tenantId: string;
  lastBackupAt: string | null;
  lastRestoreAt: string | null;
  drillReceipts: Record<string, RestoreDrillReceipt>;
  integrityReceipts: Record<string, IntegrityScanReceipt>;
  formatReceipts: Record<string, ContentFormatMigrationReceipt>;
};

export type RestoreStoreMutateResult<T> =
  | { ok: true; value: T; state: TenantRestoreDrillState }
  | { ok: false; error: string };

function sleep(ms: number): void {
  const buf = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buf, 0, 0, ms);
}

function withExclusiveLockSync(lockPath: string, fn: () => void): void {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try {
        const startedAt = Date.now();
        fs.writeFileSync(fd, `${process.pid}\n${startedAt}\n`, "utf8");
        fn();
        return;
      } finally {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // raced unlock
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
      try {
        const raw = fs.readFileSync(lockPath, "utf8");
        const startedAt = Number(raw.trim().split("\n")[1] ?? "");
        if (Number.isFinite(startedAt) && Date.now() - startedAt > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // raced unlock
      }
      sleep(LOCK_RETRY_MS);
    }
  }
  throw new Error("restore_drill_lock_timeout");
}

function storePathFor(stateDir: string, tenantId: string): string {
  return path.join(resolveRestoreDrillRoot(stateDir), tenantId, "drill.json");
}

function writeFileDurable(storePath: string, file: object): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const payload = `${JSON.stringify(file, null, 2)}\n`;
  const tmp = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, payload, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, storePath);
}

export function emptyRestoreDrillState(tenantId: string): TenantRestoreDrillState {
  return {
    schemaVersion: 1,
    revision: 0,
    tenantId,
    lastBackupAt: null,
    lastRestoreAt: null,
    drillReceipts: {},
    integrityReceipts: {},
    formatReceipts: {},
  };
}

export function readRestoreDrillState(params: {
  stateDir: string;
  tenantId: string;
}): TenantRestoreDrillState | null {
  const storePath = storePathFor(params.stateDir, params.tenantId);
  if (!fs.existsSync(storePath)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as TenantRestoreDrillState;
  if (
    parsed?.schemaVersion !== 1 ||
    parsed.tenantId !== params.tenantId ||
    typeof parsed.revision !== "number"
  ) {
    throw new Error("restore_drill_corrupt");
  }
  return parsed;
}

export function mutateRestoreDrillState<T>(params: {
  stateDir: string;
  tenantId: string;
  fn: (
    state: TenantRestoreDrillState,
  ) => { ok: true; value: T; state: TenantRestoreDrillState } | { ok: false; error: string };
}): RestoreStoreMutateResult<T> {
  const storePath = storePathFor(params.stateDir, params.tenantId);
  let outcome: RestoreStoreMutateResult<T> | null = null;
  withExclusiveLockSync(`${storePath}.lock`, () => {
    const current = readRestoreDrillState(params) ?? emptyRestoreDrillState(params.tenantId);
    const next = params.fn(current);
    if (!next.ok) {
      outcome = next;
      return;
    }
    const written: TenantRestoreDrillState = {
      ...next.state,
      schemaVersion: 1,
      tenantId: params.tenantId,
      revision: current.revision + 1,
    };
    writeFileDurable(storePath, written);
    outcome = { ok: true, value: next.value, state: written };
  });
  return outcome ?? { ok: false, error: "restore_drill_corrupt" };
}

type DrillCatalogFile = {
  schemaVersion: 1;
  revision: number;
  records: Record<string, CatalogRecord>;
};

/** One durable Catalog image for the drill namespace. Not the production Catalog. */
export function writeRestoreDrillCatalog(params: {
  stateDir: string;
  tenantId: string;
  records: readonly CatalogRecord[];
}): void {
  const records: Record<string, CatalogRecord> = {};
  for (const record of params.records) {
    records[record.envelope.resourceId] = record;
  }
  const file: DrillCatalogFile = { schemaVersion: 1, revision: 1, records };
  writeFileDurable(resolveRestoreDrillCatalogPath(params.stateDir, params.tenantId), file);
}

/** Remove the isolated drill Catalog so a failed/finished drill leaves no restored result. */
export function destroyRestoreDrillCatalog(params: { stateDir: string; tenantId: string }): void {
  const catalogPath = resolveRestoreDrillCatalogPath(params.stateDir, params.tenantId);
  try {
    fs.unlinkSync(catalogPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}

export type FormatMigrationJournal = {
  schemaVersion: 1;
  kind: "p5_content_format_migration_journal";
  tenantId: string;
  resourceId: string;
  receiptId: string;
  previousLocator: string;
  nextLocator: string;
  fromFormat: string;
  toFormat: string;
  transformId: string;
  fromContentVersion: string;
  contentVersion: string;
  sourceChecksum: string;
  resultChecksum: string;
  expectedGovernanceVersion: number;
  operatedAt: string;
};

export function readFormatMigrationJournal(params: {
  stateDir: string;
  tenantId: string;
  resourceId: string;
}): FormatMigrationJournal | null {
  const dest = resolveFormatMigrationJournalPath(
    params.stateDir,
    params.tenantId,
    params.resourceId,
  );
  if (!fs.existsSync(dest)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(dest, "utf8")) as FormatMigrationJournal;
  if (
    parsed?.schemaVersion !== 1 ||
    parsed.kind !== "p5_content_format_migration_journal" ||
    parsed.tenantId !== params.tenantId ||
    parsed.resourceId !== params.resourceId
  ) {
    throw new Error("format_migration_journal_corrupt");
  }
  if (!validateFormatMigrationJournalLocators(parsed)) {
    throw new Error("format_migration_journal_corrupt");
  }
  return parsed;
}

export function writeFormatMigrationJournal(params: {
  stateDir: string;
  journal: FormatMigrationJournal;
}): void {
  writeFileDurable(
    resolveFormatMigrationJournalPath(
      params.stateDir,
      params.journal.tenantId,
      params.journal.resourceId,
    ),
    params.journal,
  );
}

export function unlinkFormatMigrationJournal(params: {
  stateDir: string;
  tenantId: string;
  resourceId: string;
}): void {
  const dest = resolveFormatMigrationJournalPath(
    params.stateDir,
    params.tenantId,
    params.resourceId,
  );
  try {
    fs.unlinkSync(dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}
