/**
 * Derived JSONL message index for chat.history paging.
 * JSONL is the source of truth. The sidecar is rebuildable and never blocks persist.
 */
import fs from "node:fs";
import path from "node:path";
import { pageHistoryMessages } from "./history-cursor.js";

export const TRANSCRIPT_INDEX_VERSION = 1 as const;

export type TranscriptIndexEntry = {
  offsetStart: number;
  offsetEnd: number;
  messageId?: string;
  timestamp?: number;
  role: string;
};

export type TranscriptIndexFile = {
  version: typeof TRANSCRIPT_INDEX_VERSION;
  fileSize: number;
  mtimeMs: number;
  dirty?: boolean;
  entries: TranscriptIndexEntry[];
};

export function transcriptIndexPath(jsonlPath: string): string {
  return `${jsonlPath}.idx.json`;
}

function emptyIndex(): TranscriptIndexFile {
  return {
    version: TRANSCRIPT_INDEX_VERSION,
    fileSize: 0,
    mtimeMs: 0,
    entries: [],
  };
}

function parseIndexFile(raw: string): TranscriptIndexFile | null {
  try {
    const parsed = JSON.parse(raw) as Partial<TranscriptIndexFile>;
    if (parsed.version !== TRANSCRIPT_INDEX_VERSION || !Array.isArray(parsed.entries)) {
      return null;
    }
    if (typeof parsed.fileSize !== "number" || typeof parsed.mtimeMs !== "number") {
      return null;
    }
    return {
      version: TRANSCRIPT_INDEX_VERSION,
      fileSize: parsed.fileSize,
      mtimeMs: parsed.mtimeMs,
      dirty: parsed.dirty === true,
      entries: parsed.entries,
    };
  } catch {
    return null;
  }
}

function classifyJsonlLine(parsed: Record<string, unknown>): TranscriptIndexEntry | null {
  if (parsed.message && typeof parsed.message === "object" && !Array.isArray(parsed.message)) {
    const message = parsed.message as Record<string, unknown>;
    const role = typeof message.role === "string" && message.role.trim() ? message.role : "unknown";
    const entryId = typeof parsed.id === "string" ? parsed.id.trim() : "";
    const messageId =
      (typeof message.id === "string" && message.id.trim()) ||
      (typeof message.messageId === "string" && message.messageId.trim()) ||
      entryId ||
      undefined;
    const timestamp =
      typeof message.timestamp === "number"
        ? message.timestamp
        : typeof parsed.timestamp === "string"
          ? Date.parse(parsed.timestamp)
          : undefined;
    return {
      offsetStart: 0,
      offsetEnd: 0,
      role,
      ...(messageId ? { messageId } : {}),
      ...(timestamp && Number.isFinite(timestamp) ? { timestamp } : {}),
    };
  }
  if (parsed.type === "compaction") {
    const timestamp =
      typeof parsed.timestamp === "string" ? Date.parse(parsed.timestamp) : undefined;
    return {
      offsetStart: 0,
      offsetEnd: 0,
      role: "system",
      ...(typeof parsed.id === "string" ? { messageId: parsed.id } : {}),
      ...(timestamp && Number.isFinite(timestamp) ? { timestamp } : {}),
    };
  }
  return null;
}

function scanJsonlRange(params: {
  fd: number;
  start: number;
  end: number;
}): TranscriptIndexEntry[] {
  const length = Math.max(0, params.end - params.start);
  if (length === 0) {
    return [];
  }
  const buf = Buffer.alloc(length);
  fs.readSync(params.fd, buf, 0, length, params.start);
  const entries: TranscriptIndexEntry[] = [];
  let lineStart = 0;
  while (lineStart <= buf.length) {
    const nl = buf.indexOf(0x0a, lineStart);
    const lineEnd = nl === -1 ? buf.length : nl;
    const absStart = params.start + lineStart;
    const absEnd = params.start + lineEnd + (nl === -1 ? 0 : 1);
    const line = buf.subarray(lineStart, lineEnd).toString("utf8").trim();
    lineStart = lineEnd + 1;
    if (!line) {
      if (nl === -1) {
        break;
      }
      continue;
    }
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const classified = classifyJsonlLine(parsed);
      if (classified) {
        entries.push({ ...classified, offsetStart: absStart, offsetEnd: absEnd });
      }
    } catch {
      // skip malformed lines; they remain in JSONL but not in the derived index
    }
    if (nl === -1) {
      break;
    }
  }
  return entries;
}

function writeIndexBestEffort(indexPath: string, index: TranscriptIndexFile): void {
  try {
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    const tmp = `${indexPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(index)}\n`, "utf8");
    fs.renameSync(tmp, indexPath);
  } catch {
    // Index is derived. Failure must not affect JSONL persistence or history reads.
  }
}

function readByte(fd: number, position: number): number | null {
  if (position < 0) {
    return null;
  }
  const buf = Buffer.alloc(1);
  const n = fs.readSync(fd, buf, 0, 1, position);
  return n === 1 ? buf[0] : null;
}

function readSlice(fd: number, start: number, end: number): string {
  const length = Math.max(0, end - start);
  if (length === 0) {
    return "";
  }
  const buf = Buffer.alloc(length);
  fs.readSync(fd, buf, 0, length, start);
  return buf.toString("utf8");
}

/**
 * Incremental tail-scan is valid only for append-only JSONL. Group public
 * transcripts (and compacted agent sessions) rewrite earlier bytes while the
 * file size still grows — leftover sidecar offsets then point mid-line, so
 * chat.history pages 0 messages with hasMore=true and the workbench looks empty.
 */
function canIncrementallyAppendIndex(
  fd: number,
  existing: TranscriptIndexFile,
  currentSize: number,
): boolean {
  if (existing.fileSize <= 0) {
    return existing.entries.length === 0;
  }
  if (existing.fileSize > currentSize) {
    return false;
  }
  const last = existing.entries[existing.entries.length - 1];
  if (!last) {
    return existing.fileSize <= currentSize;
  }
  if (
    last.offsetStart < 0 ||
    last.offsetEnd > existing.fileSize ||
    last.offsetStart >= last.offsetEnd
  ) {
    return false;
  }
  const lastByte = readByte(fd, existing.fileSize - 1);
  const endsOnLineBoundary = lastByte === 0x0a;
  const lastEntryIsExactTail = last.offsetEnd === existing.fileSize;
  if (!endsOnLineBoundary && !lastEntryIsExactTail) {
    return false;
  }
  return parseTranscriptLine(readSlice(fd, last.offsetStart, last.offsetEnd)) !== undefined;
}

function markTranscriptIndexDirty(jsonlPath: string): void {
  const indexPath = transcriptIndexPath(jsonlPath);
  try {
    const existing = parseIndexFile(fs.readFileSync(indexPath, "utf8"));
    if (!existing) {
      return;
    }
    writeIndexBestEffort(indexPath, { ...existing, dirty: true });
  } catch {
    try {
      fs.unlinkSync(indexPath);
    } catch {
      // Best-effort; next sync rebuilds from JSONL.
    }
  }
}

export function syncTranscriptIndex(jsonlPath: string): TranscriptIndexFile {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(jsonlPath);
  } catch {
    return emptyIndex();
  }

  const indexPath = transcriptIndexPath(jsonlPath);
  let existing: TranscriptIndexFile | null = null;
  try {
    existing = parseIndexFile(fs.readFileSync(indexPath, "utf8"));
  } catch {
    existing = null;
  }

  const fd = fs.openSync(jsonlPath, "r");
  try {
    if (
      existing &&
      !existing.dirty &&
      existing.fileSize === stat.size &&
      existing.mtimeMs === stat.mtimeMs &&
      canIncrementallyAppendIndex(fd, existing, stat.size)
    ) {
      return existing;
    }

    if (
      existing &&
      !existing.dirty &&
      existing.fileSize > 0 &&
      existing.fileSize < stat.size &&
      existing.mtimeMs <= stat.mtimeMs &&
      canIncrementallyAppendIndex(fd, existing, stat.size)
    ) {
      const appended = scanJsonlRange({ fd, start: existing.fileSize, end: stat.size });
      const next: TranscriptIndexFile = {
        version: TRANSCRIPT_INDEX_VERSION,
        fileSize: stat.size,
        mtimeMs: stat.mtimeMs,
        entries: [...existing.entries, ...appended],
      };
      writeIndexBestEffort(indexPath, next);
      return next;
    }

    const rebuilt: TranscriptIndexFile = {
      version: TRANSCRIPT_INDEX_VERSION,
      fileSize: stat.size,
      mtimeMs: stat.mtimeMs,
      entries: scanJsonlRange({ fd, start: 0, end: stat.size }),
    };
    writeIndexBestEffort(indexPath, rebuilt);
    return rebuilt;
  } finally {
    fs.closeSync(fd);
  }
}

export function parseTranscriptLine(line: string): unknown {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed.message) {
      const entryId = typeof parsed.id === "string" ? parsed.id.trim() : "";
      const message = parsed.message;
      if (entryId && message && typeof message === "object" && !Array.isArray(message)) {
        const record = message as Record<string, unknown>;
        const hasId =
          (typeof record.id === "string" && record.id.trim().length > 0) ||
          (typeof record.messageId === "string" && record.messageId.trim().length > 0);
        // Checkpoint boundaries use the JSONL entry id. Keep message.id for
        // delivery, and always expose the entry id so the restore line can bind.
        const withEntry = { ...record, transcriptEntryId: entryId };
        return hasId ? withEntry : { ...withEntry, id: entryId };
      }
      return message;
    }
    if (parsed.type === "compaction") {
      const ts = typeof parsed.timestamp === "string" ? Date.parse(parsed.timestamp) : Number.NaN;
      const timestamp = Number.isFinite(ts) ? ts : Date.now();
      const marker = {
        kind: "compaction",
        id: typeof parsed.id === "string" ? parsed.id : undefined,
      };
      return {
        role: "system",
        content: [{ type: "text", text: "Compaction" }],
        timestamp,
        __openbot: marker,
        __openclaw: marker,
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function readIndexedTranscriptMessages(params: {
  jsonlPath: string;
  entries: TranscriptIndexEntry[];
}): unknown[] {
  if (params.entries.length === 0) {
    return [];
  }
  const fd = fs.openSync(params.jsonlPath, "r");
  try {
    const messages: unknown[] = [];
    for (const entry of params.entries) {
      const length = Math.max(0, entry.offsetEnd - entry.offsetStart);
      if (length === 0) {
        continue;
      }
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, entry.offsetStart);
      const parsed = parseTranscriptLine(buf.toString("utf8"));
      if (parsed !== undefined) {
        messages.push(parsed);
      }
    }
    return messages;
  } finally {
    fs.closeSync(fd);
  }
}

export function pageTranscriptIndex(params: {
  entries: TranscriptIndexEntry[];
  includeTools: boolean;
  limit: number;
  sessionId: string;
  before?: string | null;
}): {
  entries: TranscriptIndexEntry[];
  nextBefore: string | null;
  hasMore: boolean;
} {
  const visible = params.includeTools
    ? params.entries
    : params.entries.filter((entry) => entry.role !== "toolResult" && entry.role !== "tool");
  const paged = pageHistoryMessages({
    messages: visible,
    limit: params.limit,
    sessionId: params.sessionId,
    before: params.before,
  });
  return {
    entries: paged.messages,
    nextBefore: paged.nextBefore,
    hasMore: paged.hasMore,
  };
}

export function readPagedChatHistoryMessages(params: {
  jsonlPath: string;
  sessionId: string;
  limit: number;
  before?: string | null;
  includeTools: boolean;
}): {
  messages: unknown[];
  nextBefore: string | null;
  hasMore: boolean;
} {
  const readOnce = () => {
    const index = syncTranscriptIndex(params.jsonlPath);
    const paged = pageTranscriptIndex({
      entries: index.entries,
      includeTools: params.includeTools,
      limit: params.limit,
      sessionId: params.sessionId,
      before: params.before,
    });
    return {
      paged,
      messages: readIndexedTranscriptMessages({
        jsonlPath: params.jsonlPath,
        entries: paged.entries,
      }),
    };
  };
  let result = readOnce();
  if (result.paged.entries.length > 0 && result.messages.length === 0) {
    markTranscriptIndexDirty(params.jsonlPath);
    result = readOnce();
  }
  return {
    messages: result.messages,
    nextBefore: result.paged.nextBefore,
    hasMore: result.paged.hasMore,
  };
}
