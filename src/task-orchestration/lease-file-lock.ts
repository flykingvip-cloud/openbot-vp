/**
 * Cross-process exclusive lock for orch lease JSON files (wx lockfile).
 *
 * Rules (delivery-reliability acceptance):
 * - Confirmably-alive holder PID → never steal by age alone.
 * - Incomplete lock metadata → wait / timeout error; never immediate delete.
 * - Lock carries unique ownerToken; release/cleanup must verify ownership.
 * - Stale reclaim / owned release are path-atomic via POSIX rename claim:
 *   rename(lock → tomb) removes the name in one filesystem operation, then we
 *   verify the tomb inode. A late reclaimer that renames a *replacement* lock
 *   sees ownerToken mismatch and renames it back — it never unlinkSync's the
 *   live path after a post-check replacement (the acceptance race).
 *
 * Why not reuse `plugin-sdk/file-lock` / `cognitive-file-lock`:
 * those still do read→age/pid check→unlinkSync(path), which has the same
 * check-vs-delete window. We need rename-claim, not another token re-read.
 *
 * Concurrent reclaimers: each rename to a unique tomb (`*.reclaimed.<token>.<uuid>`).
 * First wins (moves the inode); others get ENOENT and treat as already reclaimed.
 * Crash after rename before tomb unlink: lockPath is already free (new holders can
 * wx-create); orphaned `*.reclaimed.*` tombs are inert and swept on later acquire.
 *
 * Same-process reentry is not supported — callers must not nest.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const LEASE_LOCK_TIMEOUT_MS = 5_000;

export type LeaseLockPayload = {
  pid: number;
  createdAt: string;
  ownerToken: string;
};

export type LeaseLockEvaluation =
  | { status: "missing" }
  | { status: "incomplete" }
  | { status: "held"; payload: LeaseLockPayload }
  | { status: "stale"; payload: LeaseLockPayload };

/** Test-only seam: runs after rename claim, before tomb verification/unlink. */
export type LeaseLockReclaimHooks = {
  afterClaim?: (tombPath: string) => void;
};

function sleepMs(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse lock payload. Legacy locks (pid+createdAt, no ownerToken) get a
 * deterministic synthetic token so reclaim still works; they are NOT
 * treated as incomplete. Truly broken payloads are incomplete.
 */
export function readLeaseLockPayload(lockPath: string): LeaseLockPayload | "incomplete" | null {
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return "incomplete";
    }
    if (!parsed || typeof parsed !== "object") {
      return "incomplete";
    }
    const o = parsed as Record<string, unknown>;
    if (typeof o.pid !== "number" || !Number.isInteger(o.pid) || o.pid <= 0) {
      return "incomplete";
    }
    if (typeof o.createdAt !== "string" || o.createdAt.length === 0) {
      return "incomplete";
    }
    const ownerToken =
      typeof o.ownerToken === "string" && o.ownerToken.length > 0
        ? o.ownerToken
        : `legacy:${o.pid}:${o.createdAt}`;
    return { pid: o.pid, createdAt: o.createdAt, ownerToken };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    return "incomplete";
  }
}

export function evaluateLeaseLock(lockPath: string): LeaseLockEvaluation {
  const payload = readLeaseLockPayload(lockPath);
  if (payload === null) {
    return { status: "missing" };
  }
  if (payload === "incomplete") {
    return { status: "incomplete" };
  }
  // Alive holder: never stale by wall-clock age alone.
  if (isPidAlive(payload.pid)) {
    return { status: "held", payload };
  }
  return { status: "stale", payload };
}

function tombPathFor(lockPath: string, ownerToken: string): string {
  return `${lockPath}.reclaimed.${ownerToken}.${randomUUID()}`;
}

/**
 * Best-effort restore after a mistaken claim. If lockPath is already taken,
 * leave the tomb in place when it holds a non-expected payload (do not destroy
 * a replacement holder's inode); discard tomb only when it is the expected stale lock.
 */
function restoreOrDiscardTomb(
  tombPath: string,
  lockPath: string,
  expectedOwnerToken: string,
): void {
  try {
    fs.renameSync(tombPath, lockPath);
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "ENOENT") {
      // fall through to discard policy
    }
  }
  try {
    const tombPayload = readLeaseLockPayload(tombPath);
    if (
      tombPayload !== null &&
      tombPayload !== "incomplete" &&
      tombPayload.ownerToken === expectedOwnerToken &&
      !isPidAlive(tombPayload.pid)
    ) {
      fs.unlinkSync(tombPath);
    }
    // else: keep tomb (may hold a replacement inode we could not put back)
  } catch {
    // ignore
  }
}

/**
 * Atomically claim-and-drop a stale lock via rename (not path unlink).
 *
 * Serialization/atomicity: POSIX rename on the same volume is atomic. Claiming
 * moves the inode off `lockPath` in one step; verification happens on the tomb.
 * A concurrent new holder wx-creates at the freed `lockPath` and is never
 * targeted by our later tomb unlink. A late claim that picks up a replacement
 * sees token mismatch and renames back.
 */
export function tryReclaimStaleLeaseLock(
  lockPath: string,
  expected: LeaseLockPayload,
  hooks?: LeaseLockReclaimHooks,
): boolean {
  // Fast reject if path already differs (avoid claiming a live replacement).
  try {
    const preview = readLeaseLockPayload(lockPath);
    if (preview === null) {
      return true;
    }
    if (preview === "incomplete") {
      return false;
    }
    if (preview.ownerToken !== expected.ownerToken) {
      return false;
    }
    if (isPidAlive(preview.pid)) {
      return false;
    }
  } catch {
    return false;
  }

  const tombPath = tombPathFor(lockPath, expected.ownerToken);
  try {
    fs.renameSync(lockPath, tombPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Another reclaimer already moved/removed it.
      return true;
    }
    return false;
  }

  try {
    hooks?.afterClaim?.(tombPath);

    const claimed = readLeaseLockPayload(tombPath);
    if (
      claimed === null ||
      claimed === "incomplete" ||
      claimed.ownerToken !== expected.ownerToken ||
      isPidAlive(claimed.pid)
    ) {
      restoreOrDiscardTomb(tombPath, lockPath, expected.ownerToken);
      return false;
    }

    // Destroy the claimed stale inode only — lockPath is already free (or holds a replacement).
    try {
      fs.unlinkSync(tombPath);
    } catch {
      // ignore
    }
    return true;
  } catch {
    restoreOrDiscardTomb(tombPath, lockPath, expected.ownerToken);
    return false;
  }
}

/**
 * Ownership-checked release via the same rename-claim pattern so an old holder
 * cannot path-unlink a newer holder's lock after replacement.
 */
export function releaseLeaseLockOwned(lockPath: string, ownerToken: string): void {
  try {
    const preview = readLeaseLockPayload(lockPath);
    if (preview === null || preview === "incomplete") {
      return;
    }
    if (preview.ownerToken !== ownerToken) {
      return;
    }
  } catch {
    return;
  }

  const tombPath = tombPathFor(lockPath, ownerToken);
  try {
    fs.renameSync(lockPath, tombPath);
  } catch {
    return;
  }

  try {
    const claimed = readLeaseLockPayload(tombPath);
    if (claimed === null || claimed === "incomplete" || claimed.ownerToken !== ownerToken) {
      restoreOrDiscardTomb(tombPath, lockPath, ownerToken);
      return;
    }
    try {
      fs.unlinkSync(tombPath);
    } catch {
      // ignore
    }
  } catch {
    restoreOrDiscardTomb(tombPath, lockPath, ownerToken);
  }
}

export function writeLeaseLockPayload(lockPath: string, payload: LeaseLockPayload): void {
  fs.writeFileSync(lockPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/** Remove orphaned `*.reclaimed.*` tombs left after crash mid-reclaim. */
function sweepReclaimTombs(lockPath: string): void {
  const dir = path.dirname(lockPath);
  const prefix = `${path.basename(lockPath)}.reclaimed.`;
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith(prefix)) {
      continue;
    }
    const tombPath = path.join(dir, name);
    try {
      const payload = readLeaseLockPayload(tombPath);
      if (payload !== null && payload !== "incomplete" && isPidAlive(payload.pid)) {
        // Live payload stuck in a tomb — try restore if lockPath free.
        restoreOrDiscardTomb(tombPath, lockPath, payload.ownerToken);
        continue;
      }
      fs.unlinkSync(tombPath);
    } catch {
      // ignore
    }
  }
}

/**
 * Cross-process exclusive lock for a lease JSON path (wx lockfile).
 */
export function withLeaseFileLock<T>(leaseFilePath: string, fn: () => T): T {
  const lockPath = `${leaseFilePath}.lock`;
  fs.mkdirSync(path.dirname(leaseFilePath), { recursive: true });
  sweepReclaimTombs(lockPath);
  const deadline = Date.now() + LEASE_LOCK_TIMEOUT_MS;
  let attempt = 0;
  while (true) {
    const ownerToken = randomUUID();
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        const payload: LeaseLockPayload = {
          pid: process.pid,
          createdAt: new Date().toISOString(),
          ownerToken,
        };
        fs.writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        return fn();
      } finally {
        try {
          fs.closeSync(fd);
        } catch {
          // ignore
        }
        releaseLeaseLockOwned(lockPath, ownerToken);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
      const evaluation = evaluateLeaseLock(lockPath);
      if (evaluation.status === "stale") {
        tryReclaimStaleLeaseLock(lockPath, evaluation.payload);
        // Whether reclaim succeeded or lost a race, retry wx.
        continue;
      }
      // held or incomplete: wait; never immediate delete.
      if (Date.now() >= deadline) {
        throw new Error(`orch_lease_file_lock_timeout:${leaseFilePath}`, { cause: err });
      }
      sleepMs(Math.min(25, 5 + attempt));
      attempt += 1;
    }
  }
}
