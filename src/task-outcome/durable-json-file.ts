/**
 * Locked, rename-atomic JSON files.
 * In-process mutex first: withFileLock reenters inside one process.
 * The file lock covers other processes. A dead holder's pid is stale.
 * Readers never treat parse or I/O errors as an empty document.
 */
import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { withFileLock, type FileLockOptions } from "../infra/file-lock.js";
import { createAsyncLock } from "../infra/json-files.js";

const LOCK_OPTIONS: FileLockOptions = {
  retries: {
    retries: 40,
    factor: 1.3,
    minTimeout: 10,
    maxTimeout: 200,
    randomize: true,
  },
  stale: 15_000,
};

const gates = new Map<string, ReturnType<typeof createAsyncLock>>();

export type DurableJsonRead =
  | { ok: true; missing: true }
  | { ok: true; missing: false; value: unknown }
  | { ok: false; code: "read_failed" };

function gateFor(filePath: string): ReturnType<typeof createAsyncLock> {
  const key = path.resolve(filePath);
  const existing = gates.get(key);
  if (existing) {
    return existing;
  }
  const created = createAsyncLock();
  gates.set(key, created);
  return created;
}

export async function withDurableJsonLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  return gateFor(filePath)(() => withFileLock(filePath, LOCK_OPTIONS, fn));
}

export function readDurableJsonSync(filePath: string): DurableJsonRead {
  let raw: string;
  try {
    raw = fsSync.readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      return { ok: true, missing: true };
    }
    return { ok: false, code: "read_failed" };
  }
  try {
    return { ok: true, missing: false, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, code: "read_failed" };
  }
}

export async function readDurableJson(filePath: string): Promise<DurableJsonRead> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      return { ok: true, missing: true };
    }
    return { ok: false, code: "read_failed" };
  }
  try {
    return { ok: true, missing: false, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, code: "read_failed" };
  }
}

/** Write temp, fsync, then rename. A crash before rename leaves the previous file. */
export async function writeDurableJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await fs.open(tmp, "w");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
  await handle.close();
  try {
    await fs.rename(tmp, filePath);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
  const dirHandle = await fs.open(directory, "r").catch(() => null);
  if (!dirHandle) {
    return;
  }
  try {
    await dirHandle.sync();
  } catch {
    // Directory fsync is best-effort. The rename is already visible.
  } finally {
    await dirHandle.close().catch(() => undefined);
  }
}
