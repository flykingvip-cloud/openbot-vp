import fs from "node:fs";
import path from "node:path";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 20;
const LOCK_MAX_ATTEMPTS = 250;

function sleepAsync(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Exclusive `wx` lock file with stale takeover. Waits are async so the Gateway event loop
 * is never spun. Shared by the P3-e cognitive stores (graph head, merge receipts).
 */
export async function withCognitiveFileLock(
  lockPath: string,
  timeoutErrorCode: string,
  fn: () => void,
): Promise<void> {
  await withCognitiveFileLockAsync(lockPath, timeoutErrorCode, fn);
}

/**
 * Same exclusive lock as {@link withCognitiveFileLock}, but the critical section may await.
 * P3-f/P3-g need this: the operation-index lock has to span "read the indexed receipt →
 * durably create the one receipt → write its index → pointer CAS", and every one of those
 * steps is async. Lock acquisition/ordering/staleness semantics are unchanged.
 *
 * Lock ordering for the pointer stores is always operation index → history/content → pointer,
 * so nesting these locks cannot deadlock.
 */
export async function withCognitiveFileLockAsync<T>(
  lockPath: string,
  timeoutErrorCode: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
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
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // raced unlock
      }
      await sleepAsync(LOCK_RETRY_MS);
    }
  }
  throw new Error(timeoutErrorCode);
}

/** Atomic replace with fsync. Callers hold the lock. */
export function writeJsonDurable(dest: string, value: unknown): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, dest);
}

export function readJsonIfPresent(dest: string): unknown {
  if (!fs.existsSync(dest)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(dest, "utf8"));
  } catch {
    return null;
  }
}
