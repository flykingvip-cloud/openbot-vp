/**
 * Cross-process exclusive lock for orch lease JSON files (wx lockfile).
 *
 * Rules (delivery-reliability acceptance):
 * - Confirmably-alive holder PID → never steal by age alone.
 * - Incomplete lock metadata → wait / timeout error; never immediate delete.
 * - Lock carries unique ownerToken; release/cleanup must verify ownership.
 * - Stale reclaim is TOCTOU-safe (re-read + ownerToken match + PID still dead).
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
 * deterministic synthetic token so TOCTOU reclaim still works; they are NOT
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

/**
 * TOCTOU-safe stale reclaim: only unlink if the lock is still the same
 * ownerToken we evaluated and the PID is still dead.
 */
export function tryReclaimStaleLeaseLock(lockPath: string, expected: LeaseLockPayload): boolean {
  try {
    const current = readLeaseLockPayload(lockPath);
    if (current === null) {
      return true;
    }
    if (current === "incomplete") {
      return false;
    }
    if (current.ownerToken !== expected.ownerToken) {
      return false;
    }
    if (isPidAlive(current.pid)) {
      return false;
    }
    fs.unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

/** Release only if we still own the lock (ownerToken match). */
export function releaseLeaseLockOwned(lockPath: string, ownerToken: string): void {
  try {
    const current = readLeaseLockPayload(lockPath);
    if (current === null || current === "incomplete") {
      return;
    }
    if (current.ownerToken !== ownerToken) {
      return;
    }
    fs.unlinkSync(lockPath);
  } catch {
    // ignore
  }
}

export function writeLeaseLockPayload(lockPath: string, payload: LeaseLockPayload): void {
  fs.writeFileSync(lockPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * Cross-process exclusive lock for a lease JSON path (wx lockfile).
 */
export function withLeaseFileLock<T>(leaseFilePath: string, fn: () => T): T {
  const lockPath = `${leaseFilePath}.lock`;
  fs.mkdirSync(path.dirname(leaseFilePath), { recursive: true });
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
