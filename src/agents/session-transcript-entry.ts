/**
 * Session transcript entries for gateway early-persist paths.
 *
 * pi-coding-agent SessionManager requires each non-header JSONL line to carry
 * `type`, `id`, and `parentId` so the leaf chain stays intact. A bare
 * `{ message }` line sets `leafId` to undefined on reload; the next
 * SessionManager append then omits `parentId` and re-roots the tree (model
 * context collapses to near-empty history).
 *
 * - Gateway chat early-persist + inject paths write via SessionManager.appendMessage
 *   (see chat-transcript-inject.ts). Do not use this helper for those product leaves.
 * - This helper remains for bounded-tail append / tests and as the building block
 *   documented for heal: `healBareTranscriptEntries` is a pure transform applied
 *   only by `repairSessionFileIfNeeded` (src/agents/session-file-repair.ts),
 *   which runs under the session write lock and writes atomically with a backup.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";

export type SessionTranscriptMessageEntry = {
  type: "message";
  id: string;
  parentId: string | null;
  timestamp: string;
  message: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasEntryId(entry: Record<string, unknown>): entry is Record<string, unknown> & {
  id: string;
} {
  return typeof entry.id === "string" && entry.id.trim().length > 0;
}

/** True when a parsed JSONL line is a bare `{ message }` without session entry fields. */
export function isBareTranscriptMessageLine(entry: unknown): boolean {
  if (!isRecord(entry)) {
    return false;
  }
  if (typeof entry.type === "string" && entry.type.trim()) {
    return false;
  }
  return isRecord(entry.message);
}

function newEntryId(): string {
  // Never reuse message.id as the entry id: a duplicate id elsewhere in the
  // file would alias byId and can create a parent cycle in SessionManager.
  return randomUUID();
}

function resolveEntryTimestamp(message: Record<string, unknown>): string {
  const ts = message.timestamp;
  if (typeof ts === "string" && ts.trim()) {
    return ts;
  }
  if (typeof ts === "number" && Number.isFinite(ts)) {
    return new Date(ts).toISOString();
  }
  return new Date().toISOString();
}

/** Build a SessionManager-compatible message entry chained to parentId. */
export function buildSessionMessageEntry(params: {
  message: Record<string, unknown>;
  parentId: string | null;
}): SessionTranscriptMessageEntry {
  return {
    type: "message",
    id: newEntryId(),
    parentId: params.parentId,
    timestamp: resolveEntryTimestamp(params.message),
    message: params.message,
  };
}

const TAIL_SCAN_INITIAL_BYTES = 64 * 1024;

/**
 * Resolve the leaf id SessionManager would pick on reload (id of the last
 * non-header entry), reading only the tail of the file. Bare/malformed lines
 * are skipped so a new entry chains to the last well-formed entry.
 * Returns null for a missing/empty file or a header-only file.
 */
export function readTranscriptLeafId(transcriptPath: string): string | null {
  let fd: number;
  try {
    fd = fs.openSync(transcriptPath, "r");
  } catch {
    return null;
  }
  try {
    const size = fs.fstatSync(fd).size;
    if (size === 0) {
      return null;
    }
    let window = TAIL_SCAN_INITIAL_BYTES;
    for (;;) {
      const start = Math.max(0, size - window);
      const length = size - start;
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, start);
      const lines = buf.toString("utf-8").split(/\r?\n/);
      if (start > 0) {
        // First fragment may be a partial line (or split a UTF-8 sequence).
        lines.shift();
      }
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]?.trim();
        if (!line) {
          continue;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (!isRecord(parsed)) {
          continue;
        }
        if (parsed.type === "session") {
          return null;
        }
        if (hasEntryId(parsed)) {
          return parsed.id;
        }
      }
      if (start === 0) {
        return null;
      }
      window *= 4;
    }
  } finally {
    fs.closeSync(fd);
  }
}

export type AppendTranscriptMessageResult =
  | { ok: true; entry: SessionTranscriptMessageEntry }
  | { ok: false; error: string };

/**
 * Append a user/assistant message as a proper session entry (type/id/parentId)
 * chained to the current leaf. Use instead of writing bare `{ message }` lines.
 */
export function appendTranscriptMessageEntry(params: {
  transcriptPath: string;
  message: Record<string, unknown>;
}): AppendTranscriptMessageResult {
  try {
    const entry = buildSessionMessageEntry({
      message: params.message,
      parentId: readTranscriptLeafId(params.transcriptPath),
    });
    fs.appendFileSync(params.transcriptPath, `${JSON.stringify(entry)}\n`, "utf-8");
    return { ok: true, entry };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type HealBareTranscriptResult = {
  entries: unknown[];
  /** Bare `{ message }` lines converted to typed message entries. */
  convertedBareLines: number;
  /** Entries whose omitted `parentId` key was re-linked to the prior leaf. */
  relinkedParents: number;
};

/**
 * Pure transform over parsed transcript entries (header first). Converts
 * legacy bare `{ message }` lines into typed entries chained to the prior leaf
 * and re-links entries that were appended after a bare line with the
 * `parentId` key omitted. Explicit `parentId: null` is left alone (deliberate
 * root). Returns the input array unchanged when nothing needs healing.
 */
export function healBareTranscriptEntries(entries: readonly unknown[]): HealBareTranscriptResult {
  let leafId: string | null = null;
  let convertedBareLines = 0;
  let relinkedParents = 0;
  const out: unknown[] = [];

  for (const entry of entries) {
    if (!isRecord(entry) || entry.type === "session") {
      out.push(entry);
      continue;
    }
    if (isBareTranscriptMessageLine(entry)) {
      const healed = buildSessionMessageEntry({
        message: entry.message as Record<string, unknown>,
        parentId: leafId,
      });
      out.push(healed);
      leafId = healed.id;
      convertedBareLines += 1;
      continue;
    }
    let next = entry;
    if (hasEntryId(entry) && !("parentId" in entry) && leafId !== null) {
      next = { ...entry, parentId: leafId };
      relinkedParents += 1;
    }
    if (hasEntryId(next)) {
      leafId = next.id;
    }
    out.push(next);
  }

  if (convertedBareLines === 0 && relinkedParents === 0) {
    return { entries: entries as unknown[], convertedBareLines: 0, relinkedParents: 0 };
  }
  return { entries: out, convertedBareLines, relinkedParents };
}
