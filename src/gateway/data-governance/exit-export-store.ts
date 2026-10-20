/**
 * Durable P5-d exit-import drill receipts. Not production Catalog. No fs mtime truth.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveExitImportCatalogPath, resolveExitImportRoot } from "./paths.js";
import type { CatalogRecord, ExitImportDrillReceipt, IdMappingReceipt } from "./types.js";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 20;
const LOCK_MAX_ATTEMPTS = 250;

export type TenantExitImportState = {
  schemaVersion: 1;
  revision: number;
  destTenantId: string;
  mappingReceipts: Record<string, IdMappingReceipt>;
  importDrillReceipts: Record<string, ExitImportDrillReceipt>;
};

export type ExitStoreMutateResult<T> =
  | { ok: true; value: T; state: TenantExitImportState }
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
  throw new Error("exit_import_lock_timeout");
}

function storePathFor(stateDir: string, destTenantId: string): string {
  return path.join(resolveExitImportRoot(stateDir), destTenantId, "import-drill.json");
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

export function emptyExitImportState(destTenantId: string): TenantExitImportState {
  return {
    schemaVersion: 1,
    revision: 0,
    destTenantId,
    mappingReceipts: {},
    importDrillReceipts: {},
  };
}

export function readExitImportState(params: {
  stateDir: string;
  destTenantId: string;
}): TenantExitImportState | null {
  const storePath = storePathFor(params.stateDir, params.destTenantId);
  if (!fs.existsSync(storePath)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as TenantExitImportState;
  if (
    parsed?.schemaVersion !== 1 ||
    parsed.destTenantId !== params.destTenantId ||
    typeof parsed.revision !== "number"
  ) {
    throw new Error("exit_import_corrupt");
  }
  return parsed;
}

export function mutateExitImportState<T>(params: {
  stateDir: string;
  destTenantId: string;
  fn: (
    state: TenantExitImportState,
  ) => { ok: true; value: T; state: TenantExitImportState } | { ok: false; error: string };
}): ExitStoreMutateResult<T> {
  const storePath = storePathFor(params.stateDir, params.destTenantId);
  let outcome: ExitStoreMutateResult<T> | null = null;
  withExclusiveLockSync(`${storePath}.lock`, () => {
    const current = readExitImportState(params) ?? emptyExitImportState(params.destTenantId);
    const next = params.fn(current);
    if (!next.ok) {
      outcome = next;
      return;
    }
    const written: TenantExitImportState = {
      ...next.state,
      schemaVersion: 1,
      destTenantId: params.destTenantId,
      revision: current.revision + 1,
    };
    writeFileDurable(storePath, written);
    outcome = { ok: true, value: next.value, state: written };
  });
  return outcome ?? { ok: false, error: "exit_import_corrupt" };
}

type ImportCatalogFile = {
  schemaVersion: 1;
  revision: number;
  records: Record<string, CatalogRecord>;
};

export function writeExitImportCatalog(params: {
  stateDir: string;
  destTenantId: string;
  records: readonly CatalogRecord[];
}): void {
  const records: Record<string, CatalogRecord> = {};
  for (const record of params.records) {
    records[record.envelope.resourceId] = record;
  }
  const file: ImportCatalogFile = { schemaVersion: 1, revision: 1, records };
  writeFileDurable(resolveExitImportCatalogPath(params.stateDir, params.destTenantId), file);
}

export function destroyExitImportCatalog(params: { stateDir: string; destTenantId: string }): void {
  const catalogPath = resolveExitImportCatalogPath(params.stateDir, params.destTenantId);
  try {
    fs.unlinkSync(catalogPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}
