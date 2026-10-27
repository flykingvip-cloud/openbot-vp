import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { PersistedRound, RoundRuntimeEvent } from "./round-state.js";

/** Stale lock age before withRoundLock unlinks and retries (ms). */
export const ROUND_LOCK_STALE_MS = 30_000;
const LOCK_STALE_MS = ROUND_LOCK_STALE_MS;
const LOCK_RETRY_MS = 20;
const LOCK_MAX_ATTEMPTS = 250;

export type RoundCommit = {
  snapshot: PersistedRound;
  event: RoundRuntimeEvent;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function roundSnapshotPath(roundsDir: string, roundId: string): string {
  return path.join(roundsDir, `${roundId}.json`);
}

export function roundEventsPath(roundsDir: string, roundId: string): string {
  return path.join(roundsDir, `${roundId}.events.jsonl`);
}

export function roundTxnPath(roundsDir: string, roundId: string): string {
  return path.join(roundsDir, `${roundId}.txn`);
}

export function roundLockPath(roundsDir: string, roundId: string): string {
  return path.join(roundsDir, `${roundId}.lock`);
}

export async function withRoundLock<T>(
  roundsDir: string,
  roundId: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const lockPath = roundLockPath(roundsDir, roundId);
  fs.mkdirSync(roundsDir, { recursive: true });
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
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // raced unlock
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
  throw new Error(`round lock timeout: ${roundId}`);
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

export async function readRoundEventIds(eventsPath: string): Promise<Set<string>> {
  let raw: string;
  try {
    raw = await fsp.readFile(eventsPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Set();
    }
    throw error;
  }
  const ids = new Set<string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as { eventId?: unknown };
      if (typeof parsed.eventId === "string" && parsed.eventId.trim()) {
        ids.add(parsed.eventId);
      }
    } catch {
      // skip corrupt line; CAS path fail-closed on write, not on historical junk
    }
  }
  return ids;
}

function isRoundCommit(value: unknown): value is RoundCommit {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as { snapshot?: unknown; event?: unknown };
  return Boolean(record.snapshot && record.event && typeof record.event === "object");
}

export async function readPendingRoundCommit(txnPath: string): Promise<RoundCommit | null> {
  try {
    const raw = await fsp.readFile(txnPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isRoundCommit(parsed) ? parsed : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Crash recovery for a one-commit txn: event log first, then snapshot.
 * Replaying is idempotent on eventId.
 */
export async function finishRoundCommit(params: {
  roundsDir: string;
  roundId: string;
  commit: RoundCommit;
}): Promise<void> {
  const eventsPath = roundEventsPath(params.roundsDir, params.roundId);
  const snapshotPath = roundSnapshotPath(params.roundsDir, params.roundId);
  const txnPath = roundTxnPath(params.roundsDir, params.roundId);
  const ids = await readRoundEventIds(eventsPath);
  if (!ids.has(params.commit.event.eventId)) {
    await appendJsonlDurable(eventsPath, params.commit.event);
  }
  await writeJsonDurable(snapshotPath, params.commit.snapshot);
  try {
    await fsp.unlink(txnPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function recoverRoundCommit(params: {
  roundsDir: string;
  roundId: string;
}): Promise<PersistedRound | null> {
  const commit = await readPendingRoundCommit(roundTxnPath(params.roundsDir, params.roundId));
  if (!commit) {
    return null;
  }
  await finishRoundCommit({ ...params, commit });
  return commit.snapshot;
}

export async function commitRoundSnapshotAndEvent(params: {
  roundsDir: string;
  snapshot: PersistedRound;
  event: RoundRuntimeEvent;
}): Promise<void> {
  const txnPath = roundTxnPath(params.roundsDir, params.snapshot.roundId);
  const commit: RoundCommit = { snapshot: params.snapshot, event: params.event };
  await writeJsonDurable(txnPath, commit);
  await finishRoundCommit({
    roundsDir: params.roundsDir,
    roundId: params.snapshot.roundId,
    commit,
  });
}
