import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { isPidAlive } from "../shared/pid-alive.js";
import { resolveProcessScopedMap } from "../shared/process-scoped-map.js";

export type FileLockOptions = {
  retries: {
    retries: number;
    factor: number;
    minTimeout: number;
    maxTimeout: number;
    randomize?: boolean;
  };
  stale: number;
};

type LockFilePayload = {
  pid: number;
  createdAt: string;
};

type HeldLock = {
  count: number;
  handle: fs.FileHandle;
  lockPath: string;
};

const HELD_LOCKS_KEY = Symbol.for("openclaw.fileLockHeldLocks");
const HELD_LOCKS = resolveProcessScopedMap<HeldLock>(HELD_LOCKS_KEY);

function computeDelayMs(retries: FileLockOptions["retries"], attempt: number): number {
  const base = Math.min(
    retries.maxTimeout,
    Math.max(retries.minTimeout, retries.minTimeout * retries.factor ** attempt),
  );
  const jitter = retries.randomize ? 1 + Math.random() : 1;
  return Math.min(retries.maxTimeout, Math.round(base * jitter));
}

async function readLockPayload(lockPath: string): Promise<LockFilePayload | null> {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LockFilePayload>;
    if (typeof parsed.pid !== "number" || typeof parsed.createdAt !== "string") {
      return null;
    }
    return { pid: parsed.pid, createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}

async function resolveNormalizedFilePath(filePath: string): Promise<string> {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  await fs.mkdir(dir, { recursive: true });
  try {
    const realDir = await fs.realpath(dir);
    return path.join(realDir, path.basename(resolved));
  } catch {
    return resolved;
  }
}

async function isStaleLock(lockPath: string, staleMs: number): Promise<boolean> {
  const payload = await readLockPayload(lockPath);
  if (payload?.pid) {
    // Elapsed time alone cannot revoke a live process holding the critical section.
    return !isPidAlive(payload.pid);
  }
  if (payload?.createdAt) {
    const createdAt = Date.parse(payload.createdAt);
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > staleMs) {
      return true;
    }
  }
  try {
    const stat = await fs.stat(lockPath);
    return Date.now() - stat.mtimeMs > staleMs;
  } catch {
    return true;
  }
}

export type FileLockHandle = {
  lockPath: string;
  release: () => Promise<void>;
};

async function releaseHeldLock(normalizedFile: string): Promise<void> {
  const current = HELD_LOCKS.get(normalizedFile);
  if (!current) {
    return;
  }
  current.count -= 1;
  if (current.count > 0) {
    return;
  }
  HELD_LOCKS.delete(normalizedFile);
  await current.handle.close().catch(() => undefined);
  await fs.rm(current.lockPath, { force: true }).catch(() => undefined);
}

export async function acquireFileLock(
  filePath: string,
  options: FileLockOptions,
): Promise<FileLockHandle> {
  const normalizedFile = await resolveNormalizedFilePath(filePath);
  const lockPath = `${normalizedFile}.lock`;
  const held = HELD_LOCKS.get(normalizedFile);
  if (held) {
    held.count += 1;
    return {
      lockPath,
      release: () => releaseHeldLock(normalizedFile),
    };
  }

  const attempts = Math.max(1, options.retries.retries + 1);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }, null, 2),
        "utf8",
      );
      HELD_LOCKS.set(normalizedFile, { count: 1, handle, lockPath });
      return {
        lockPath,
        release: () => releaseHeldLock(normalizedFile),
      };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "EEXIST") {
        throw err;
      }
      if (await isStaleLock(lockPath, options.stale)) {
        await fs.rm(lockPath, { force: true }).catch(() => undefined);
        continue;
      }
      if (attempt >= attempts - 1) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, computeDelayMs(options.retries, attempt)));
    }
  }

  throw new Error(`file lock timeout for ${normalizedFile}`);
}

export async function withFileLock<T>(
  filePath: string,
  options: FileLockOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const lock = await acquireFileLock(filePath, options);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

type HeldLockSync = {
  count: number;
  fd: number;
  lockPath: string;
};

const HELD_LOCKS_SYNC_KEY = Symbol.for("openclaw.fileLockHeldLocksSync");
const HELD_LOCKS_SYNC = resolveProcessScopedMap<HeldLockSync>(HELD_LOCKS_SYNC_KEY);

function sleepMs(ms: number): void {
  const ia = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(ia, 0, 0, ms);
}

function resolveNormalizedFilePathSync(filePath: string): string {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  fsSync.mkdirSync(dir, { recursive: true });
  try {
    const realDir = fsSync.realpathSync(dir);
    return path.join(realDir, path.basename(resolved));
  } catch {
    return resolved;
  }
}

function readLockPayloadSync(lockPath: string): LockFilePayload | null {
  try {
    const raw = fsSync.readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LockFilePayload>;
    if (typeof parsed.pid !== "number" || typeof parsed.createdAt !== "string") {
      return null;
    }
    return { pid: parsed.pid, createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}

function isStaleLockSync(lockPath: string, staleMs: number): boolean {
  const payload = readLockPayloadSync(lockPath);
  if (payload?.pid) {
    return !isPidAlive(payload.pid);
  }
  if (payload?.createdAt) {
    const createdAt = Date.parse(payload.createdAt);
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > staleMs) {
      return true;
    }
  }
  try {
    const stat = fsSync.statSync(lockPath);
    return Date.now() - stat.mtimeMs > staleMs;
  } catch {
    return true;
  }
}

function releaseHeldLockSync(normalizedFile: string): void {
  const current = HELD_LOCKS_SYNC.get(normalizedFile);
  if (!current) {
    return;
  }
  current.count -= 1;
  if (current.count > 0) {
    return;
  }
  HELD_LOCKS_SYNC.delete(normalizedFile);
  try {
    fsSync.closeSync(current.fd);
  } catch {
    // ignore
  }
  try {
    fsSync.rmSync(current.lockPath, { force: true });
  } catch {
    // ignore
  }
}

export type FileLockHandleSync = {
  lockPath: string;
  release: () => void;
};

/**
 * Sync counterpart of acquireFileLock — same `${file}.lock` protocol + stale pid break.
 * Used by sync stores (session task board) so cross-process writers share one mechanism.
 */
export function acquireFileLockSync(
  filePath: string,
  options: FileLockOptions,
): FileLockHandleSync {
  const normalizedFile = resolveNormalizedFilePathSync(filePath);
  const lockPath = `${normalizedFile}.lock`;
  const held = HELD_LOCKS_SYNC.get(normalizedFile);
  if (held) {
    held.count += 1;
    return {
      lockPath,
      release: () => releaseHeldLockSync(normalizedFile),
    };
  }

  const attempts = Math.max(1, options.retries.retries + 1);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const fd = fsSync.openSync(lockPath, "wx");
      fsSync.writeFileSync(
        fd,
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }, null, 2),
      );
      HELD_LOCKS_SYNC.set(normalizedFile, { count: 1, fd, lockPath });
      return {
        lockPath,
        release: () => releaseHeldLockSync(normalizedFile),
      };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "EEXIST") {
        throw err;
      }
      if (isStaleLockSync(lockPath, options.stale)) {
        try {
          fsSync.rmSync(lockPath, { force: true });
        } catch {
          // race
        }
        continue;
      }
      if (attempt >= attempts - 1) {
        break;
      }
      sleepMs(computeDelayMs(options.retries, attempt));
    }
  }

  throw new Error(`file lock timeout for ${normalizedFile}`);
}

export function withFileLockSync<T>(filePath: string, options: FileLockOptions, fn: () => T): T {
  const lock = acquireFileLockSync(filePath, options);
  try {
    return fn();
  } finally {
    lock.release();
  }
}
