/**
 * Cross-process exclusive lock for orch lease JSON files.
 *
 * Shared protocol (acquire / release / stale reclaim / tomb sweep):
 *
 * 1. Holder creates a *unique companion* `${lockPath}.owner.<token>` with wx,
 *    writes the payload, then publishes with `linkSync(companion, lockPath)`.
 *    `link` fails with EEXIST if another holder already published — no overwrite.
 * 2. The public `lockPath` and the companion are hard links to the *same inode*.
 * 3. Stale reclaim / owned release never rename or unlink `lockPath` first.
 *    They claim the *companion* (`rename(companion → unique tomb)`), verify the
 *    tomb inode, then `unlink(lockPath)` **only when** `stat(lockPath)` is still
 *    the same inode as the tomb. They never `rename(tomb → lockPath)`.
 * 4. Because claim targets `${lockPath}.owner.<expectedToken>`, a late reclaimer
 *    cannot move live holder B: B’s companion is a different path; the stale
 *    companion is already gone (ENOENT) after another reclaimer finished and B
 *    acquired. B’s public name is never the rename source.
 * 5. Crash after companion→tomb rename but before unlink(lockPath): the inode
 *    still has `lockPath` (nlink≥1), so new holders still see EEXIST; a later
 *    acquire’s sweep drops inert tombs / orphan companions when the public
 *    inode no longer matches (or pid is dead and companion is unlinked).
 *
 * Why not `plugin-sdk/file-lock` / cognitive-file-lock / path rename-claim:
 * those operate on the shared `lockPath` name (unlink or rename), so a gap
 * after “looks stale” can move or delete a replacement holder. Companion-claim
 * binds the destructive op to the expected token’s path instead.
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

/**
 * Test-only seams for deterministic interleave injection.
 * - beforeClaim: after stale preview, before companion rename (acceptance gap).
 * - afterClaim: after companion→tomb rename, before inode check / public unlink.
 */
export type LeaseLockReclaimHooks = {
  beforeClaim?: () => void;
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

function tokenFileSafe(ownerToken: string): string {
  return ownerToken.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Per-holder companion path — reclaim/release claim THIS, never the shared lockPath via rename. */
export function ownerCompanionPath(lockPath: string, ownerToken: string): string {
  return `${lockPath}.owner.${tokenFileSafe(ownerToken)}`;
}

function sameInode(a: fs.Stats, b: fs.Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
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

function unlinkQuiet(p: string): void {
  try {
    fs.unlinkSync(p);
  } catch {
    // ignore
  }
}

/**
 * Ensure a companion hardlink exists for a legacy single-file lock so reclaim
 * can claim the companion path. After link, re-read and verify the expected
 * token; if the public path was replaced under us, unlink only the companion
 * name we added (nlink drops) and leave the live holder's lockPath intact.
 */
function ensureCompanionHardlink(lockPath: string, expected: LeaseLockPayload): string | null {
  const companion = ownerCompanionPath(lockPath, expected.ownerToken);
  try {
    if (fs.existsSync(companion)) {
      const stL = fs.statSync(lockPath);
      const stC = fs.statSync(companion);
      if (!sameInode(stL, stC)) {
        return null;
      }
      const body = readLeaseLockPayload(companion);
      if (body === null || body === "incomplete" || body.ownerToken !== expected.ownerToken) {
        return null;
      }
      return companion;
    }
  } catch {
    return null;
  }

  const preview = readLeaseLockPayload(lockPath);
  if (
    preview === null ||
    preview === "incomplete" ||
    preview.ownerToken !== expected.ownerToken ||
    isPidAlive(preview.pid)
  ) {
    return null;
  }

  try {
    fs.linkSync(lockPath, companion);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      try {
        const stL = fs.statSync(lockPath);
        const stC = fs.statSync(companion);
        if (!sameInode(stL, stC)) {
          return null;
        }
      } catch {
        return null;
      }
    } else if (code === "ENOENT") {
      return null;
    } else {
      throw err;
    }
  }

  // Verify we linked the expected inode, not a replacement published in the gap.
  const linked = readLeaseLockPayload(companion);
  if (linked === null || linked === "incomplete" || linked.ownerToken !== expected.ownerToken) {
    unlinkQuiet(companion);
    return null;
  }
  return companion;
}

/**
 * Drop the public lockPath name only when it still names the claimed inode.
 * Never rename anything onto lockPath (POSIX rename would replace a new holder).
 */
function unlinkPublicIfSameInode(lockPath: string, claimedPath: string): void {
  try {
    const claimedStat = fs.statSync(claimedPath);
    const publicStat = fs.statSync(lockPath);
    if (sameInode(claimedStat, publicStat)) {
      unlinkQuiet(lockPath);
    }
  } catch {
    // Public name already gone or claimed path gone — fine.
  }
}

/**
 * Put a mistaken tomb back onto the companion path only. Never onto lockPath.
 */
function restoreCompanionFromTomb(tombPath: string, companionPath: string): void {
  try {
    fs.renameSync(tombPath, companionPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ENOENT") {
      // Companion already present or tomb gone — leave tomb for sweep if needed.
      return;
    }
    // Best-effort discard only when tomb still looks like dead expected payload.
    try {
      const tombPayload = readLeaseLockPayload(tombPath);
      if (tombPayload !== null && tombPayload !== "incomplete" && !isPidAlive(tombPayload.pid)) {
        unlinkQuiet(tombPath);
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Claim-and-drop a stale lock via the expected token's companion path.
 *
 * Serialization: `rename(companion → tomb)` is atomic; first reclaimer wins.
 * Others see ENOENT on the companion. Live holder B uses a different companion
 * path and a different inode — this function never renames `lockPath`, so it
 * cannot move B. It never renames onto `lockPath`, so it cannot overwrite C.
 */
export function tryReclaimStaleLeaseLock(
  lockPath: string,
  expected: LeaseLockPayload,
  hooks?: LeaseLockReclaimHooks,
): boolean {
  // Fast reject if public path already differs (avoid work; not the safety gate).
  try {
    const preview = readLeaseLockPayload(lockPath);
    if (preview === null) {
      // Public name gone — still drop orphan companion for this token if any.
      unlinkQuiet(ownerCompanionPath(lockPath, expected.ownerToken));
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

  hooks?.beforeClaim?.();

  // Re-check public path after the injection window — another reclaimer may
  // have finished and B may now hold. Safety still comes from companion claim.
  try {
    const again = readLeaseLockPayload(lockPath);
    if (again === null) {
      unlinkQuiet(ownerCompanionPath(lockPath, expected.ownerToken));
      return true;
    }
    if (again === "incomplete" || again.ownerToken !== expected.ownerToken) {
      return false;
    }
    if (isPidAlive(again.pid)) {
      return false;
    }
  } catch {
    return false;
  }

  let companion = ownerCompanionPath(lockPath, expected.ownerToken);
  try {
    if (!fs.existsSync(companion)) {
      // Legacy single-file lock: promote to companion hardlink, then claim it.
      const promoted = ensureCompanionHardlink(lockPath, expected);
      if (!promoted) {
        return false;
      }
      companion = promoted;
    } else {
      const stL = fs.statSync(lockPath);
      const stC = fs.statSync(companion);
      if (!sameInode(stL, stC)) {
        return false;
      }
    }
  } catch {
    return false;
  }

  const tombPath = `${companion}.reclaimed.${randomUUID()}`;
  try {
    fs.renameSync(companion, tombPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Peer already claimed this companion — public name handled by peer (or gone).
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
      restoreCompanionFromTomb(tombPath, companion);
      return false;
    }

    // Free the public name only if it still refers to *this* inode.
    unlinkPublicIfSameInode(lockPath, tombPath);
    unlinkQuiet(tombPath);
    return true;
  } catch {
    restoreCompanionFromTomb(tombPath, companion);
    return false;
  }
}

/**
 * Ownership-checked release via the same companion-claim protocol.
 */
export function releaseLeaseLockOwned(lockPath: string, ownerToken: string): void {
  const companion = ownerCompanionPath(lockPath, ownerToken);

  // Fast path: public payload must still be us (best-effort; safety is companion).
  try {
    const preview = readLeaseLockPayload(lockPath);
    if (preview === null) {
      unlinkQuiet(companion);
      return;
    }
    if (preview === "incomplete" || preview.ownerToken !== ownerToken) {
      return;
    }
  } catch {
    return;
  }

  if (!fs.existsSync(companion)) {
    // Legacy: promote then claim.
    try {
      const payload = readLeaseLockPayload(lockPath);
      if (payload === null || payload === "incomplete" || payload.ownerToken !== ownerToken) {
        return;
      }
      if (!ensureCompanionHardlink(lockPath, payload)) {
        return;
      }
    } catch {
      return;
    }
  }

  if (!fs.existsSync(companion)) {
    return;
  }

  const tombPath = `${companion}.reclaimed.${randomUUID()}`;
  try {
    fs.renameSync(companion, tombPath);
  } catch {
    return;
  }

  try {
    const claimed = readLeaseLockPayload(tombPath);
    if (claimed === null || claimed === "incomplete" || claimed.ownerToken !== ownerToken) {
      restoreCompanionFromTomb(tombPath, companion);
      return;
    }
    unlinkPublicIfSameInode(lockPath, tombPath);
    unlinkQuiet(tombPath);
  } catch {
    restoreCompanionFromTomb(tombPath, companion);
  }
}

/**
 * Test / fixture helper: install a full published lock (companion + hardlink).
 * Force-replaces any prior public name (tests only).
 */
export function writeLeaseLockPayload(lockPath: string, payload: LeaseLockPayload): void {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const companion = ownerCompanionPath(lockPath, payload.ownerToken);
  // Drop stale public + any prior companion for this token so tests start clean.
  unlinkQuiet(lockPath);
  unlinkQuiet(companion);
  fs.writeFileSync(companion, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.linkSync(companion, lockPath);
}

/**
 * Remove orphaned companions / reclaim tombs. Never renames onto lockPath.
 */
function sweepLockSideFiles(lockPath: string): void {
  const dir = path.dirname(lockPath);
  const base = path.basename(lockPath);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }

  let publicStat: fs.Stats | null = null;
  try {
    publicStat = fs.statSync(lockPath);
  } catch {
    publicStat = null;
  }

  for (const name of entries) {
    if (name === base) {
      continue;
    }
    if (!name.startsWith(`${base}.owner.`) && !name.startsWith(`${base}.reclaimed.`)) {
      continue;
    }
    const sidePath = path.join(dir, name);
    try {
      const sideStat = fs.statSync(sidePath);
      if (publicStat && sameInode(publicStat, sideStat)) {
        // Live holder's companion (or hardlinked tomb mid-reclaim) — leave it.
        continue;
      }
      const payload = readLeaseLockPayload(sidePath);
      if (
        payload !== null &&
        payload !== "incomplete" &&
        isPidAlive(payload.pid) &&
        publicStat &&
        sameInode(publicStat, sideStat)
      ) {
        continue;
      }
      // Orphan companion / inert tomb: not the public inode.
      if (
        payload === null ||
        payload === "incomplete" ||
        !isPidAlive(payload.pid) ||
        !publicStat ||
        !sameInode(publicStat, sideStat)
      ) {
        // If alive payload but not public inode, try to restore companion only
        // when public is missing — never onto an occupied lockPath.
        if (
          payload !== null &&
          payload !== "incomplete" &&
          isPidAlive(payload.pid) &&
          !publicStat &&
          name.includes(".owner.") &&
          !name.includes(".reclaimed.")
        ) {
          try {
            fs.linkSync(sidePath, lockPath);
            publicStat = fs.statSync(lockPath);
            continue;
          } catch {
            // EEXIST or other — do not overwrite.
          }
        }
        if (payload !== null && payload !== "incomplete" && isPidAlive(payload.pid)) {
          // Alive orphan we could not publish — leave for manual inspection.
          continue;
        }
        unlinkQuiet(sidePath);
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Publish a new exclusive lock: companion wx + link to lockPath.
 * Returns ownerToken on success; throws on unexpected errors.
 * Returns null when lockPath is busy (EEXIST on link).
 */
function tryPublishLeaseLock(lockPath: string): string | null {
  const ownerToken = randomUUID();
  const companion = ownerCompanionPath(lockPath, ownerToken);
  const payload: LeaseLockPayload = {
    pid: process.pid,
    createdAt: new Date().toISOString(),
    ownerToken,
  };
  let fd: number | null = null;
  try {
    fd = fs.openSync(companion, "wx");
    fs.writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
    unlinkQuiet(companion);
    throw err;
  }
  try {
    fs.closeSync(fd);
  } catch {
    // ignore
  }
  try {
    fs.linkSync(companion, lockPath);
    return ownerToken;
  } catch (err) {
    unlinkQuiet(companion);
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      return null;
    }
    throw err;
  }
}

/**
 * Cross-process exclusive lock for a lease JSON path.
 */
export function withLeaseFileLock<T>(leaseFilePath: string, fn: () => T): T {
  const lockPath = `${leaseFilePath}.lock`;
  fs.mkdirSync(path.dirname(leaseFilePath), { recursive: true });
  sweepLockSideFiles(lockPath);
  const deadline = Date.now() + LEASE_LOCK_TIMEOUT_MS;
  let attempt = 0;
  while (true) {
    const published = tryPublishLeaseLock(lockPath);
    if (published !== null) {
      try {
        return fn();
      } finally {
        releaseLeaseLockOwned(lockPath, published);
      }
    }
    const evaluation = evaluateLeaseLock(lockPath);
    if (evaluation.status === "stale") {
      tryReclaimStaleLeaseLock(lockPath, evaluation.payload);
      continue;
    }
    // held or incomplete: wait; never immediate delete.
    if (Date.now() >= deadline) {
      throw new Error(`orch_lease_file_lock_timeout:${leaseFilePath}`);
    }
    sleepMs(Math.min(25, 5 + attempt));
    attempt += 1;
  }
}
