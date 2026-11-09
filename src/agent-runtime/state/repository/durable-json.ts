import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/** Stale lock age before the directory lock unlinks and retries (ms). */
export const DIRECTORY_LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 20;
const LOCK_MAX_ATTEMPTS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function lockPathFor(dir: string, stem: string): string {
  return path.join(dir, `${stem}.lock`);
}

/**
 * Exclusive directory lock. Same retry and stale-unlink behavior as the
 * collaboration round lock: 30s stale, 20ms retry, 250 attempts.
 */
export async function withDirectoryLock<T>(
  dir: string,
  stem: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const lockPath = lockPathFor(dir, stem);
  fs.mkdirSync(dir, { recursive: true });
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try {
        fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, "utf8");
        return await fn();
      } finally {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // ignore
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > DIRECTORY_LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // raced unlock
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
  throw new Error(`round lock timeout: ${stem}`);
}

export async function writeJsonDurable(dest: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await fsp.open(tmp, "w", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.rename(tmp, dest);
}

export async function appendJsonlDurable(dest: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const handle = await fsp.open(dest, "a", 0o600);
  try {
    await handle.appendFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}
