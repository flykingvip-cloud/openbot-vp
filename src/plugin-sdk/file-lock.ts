import fsSync from "node:fs";
import path from "node:path";
import { isPidAlive } from "../shared/pid-alive.js";
import { resolveProcessScopedMap } from "../shared/process-scoped-map.js";
import { tryWithFileLockArbitration } from "./file-lock-arbitration.js";

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
  fd: number;
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
  releaseDescriptor(current.fd, current.lockPath);
}

export async function acquireFileLock(
  filePath: string,
  options: FileLockOptions,
): Promise<FileLockHandle> {
  const normalizedFile = resolveNormalizedFilePathSync(filePath);
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
    const acquired = tryAcquireDescriptor(lockPath, options.stale);
    if (acquired !== undefined) {
      HELD_LOCKS.set(normalizedFile, { count: 1, fd: acquired, lockPath });
      return { lockPath, release: () => releaseHeldLock(normalizedFile) };
    }
    if (attempt < attempts - 1) {
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
    // Losing the inspection snapshot does not authorize deleting a replacement lock.
    return false;
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
  releaseDescriptor(current.fd, current.lockPath);
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
    const fd = tryAcquireDescriptor(lockPath, options.stale);
    if (fd !== undefined) {
      HELD_LOCKS_SYNC.set(normalizedFile, { count: 1, fd, lockPath });
      return { lockPath, release: () => releaseHeldLockSync(normalizedFile) };
    }
    if (attempt < attempts - 1) {
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

function tryAcquireDescriptor(lockPath: string, stale: number): number | undefined {
  const result = tryWithFileLockArbitration(lockPath, () => {
    if (fsSync.existsSync(lockPath)) {
      if (!isStaleLockSync(lockPath, stale)) {
        return undefined;
      }
      fsSync.rmSync(lockPath, { force: true });
    }
    const fd = fsSync.openSync(lockPath, "wx");
    try {
      fsSync.writeFileSync(
        fd,
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
      );
      return fd;
    } catch (error) {
      fsSync.closeSync(fd);
      fsSync.rmSync(lockPath, { force: true });
      throw error;
    }
  });
  return result.acquired ? result.value : undefined;
}

function releaseDescriptor(fd: number, lockPath: string): void {
  // Release also participates, so a delayed releaser cannot unlink a replacement.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = tryWithFileLockArbitration(lockPath, () => {
      const owned = fsSync.fstatSync(fd);
      try {
        const current = fsSync.statSync(lockPath);
        if (owned.dev === current.dev && owned.ino === current.ino) {
          fsSync.rmSync(lockPath, { force: true });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
      fsSync.closeSync(fd);
    });
    if (result.acquired) {
      return;
    }
    sleepMs(10);
  }
  fsSync.closeSync(fd);
  throw new Error(`file lock release arbitration timeout for ${lockPath}`);
}
