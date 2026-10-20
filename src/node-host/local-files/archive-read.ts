/**
 * In-memory ZIP inspection for `archive.list` and `archive.readEntry` (design 4.7).
 *
 * `fs.read` on a ZIP returns raw bytes, which cannot answer "compare this skill
 * pack against the existing skills". These two commands do, without ever writing
 * an extracted file to disk.
 *
 * Refusals implemented here:
 * - Zip Slip and absolute/backslash/traversing entry names
 * - compression bombs, by counting bytes as they decompress rather than trusting
 *   the declared uncompressed size in the central directory
 * - entry count, per-entry size and total expansion ceilings
 * - nested archives, which are not descended into
 * - entry names and content types that layer 2 refuses on disk: a ZIP sitting on
 *   the Desktop does not make the `.env` inside it readable (design 9.5)
 */

import { Readable } from "node:stream";
import JSZip from "jszip";
import { evaluateArchiveEntryPath, type PathDecision } from "../../local-files/path-policy.js";

export const ARCHIVE_LIMITS = {
  /** Largest archive we will load into memory at all. */
  maxArchiveBytes: 64 * 1024 * 1024,
  /** Entries reported by `archive.list`. */
  maxListedEntries: 500,
  /** Decompressed bytes for a single entry. */
  maxEntryBytes: 2 * 1024 * 1024,
  /**
   * Suspicious expansion ratio across the whole archive. A legitimate text-heavy
   * pack lands well under this; a bomb blows past it.
   */
  maxTotalExpansionRatio: 200,
} as const;

/** Suffixes we refuse to read as an entry, to avoid descending into nested archives. */
const NESTED_ARCHIVE_SUFFIXES = [
  ".zip",
  ".tar",
  ".tgz",
  ".tar.gz",
  ".tar.bz2",
  ".tar.xz",
  ".gz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".jar",
] as const;

export function isNestedArchiveName(entryPath: string): boolean {
  const lower = entryPath.toLowerCase();
  return NESTED_ARCHIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

export type ArchiveFailure =
  | { kind: "too-large"; detail: string }
  | { kind: "not-an-archive"; detail: string }
  | { kind: "entry-denied"; decision: PathDecision }
  | { kind: "entry-not-found" }
  | { kind: "nested-archive" }
  | { kind: "bomb"; detail: string }
  | { kind: "io-error"; detail: string };

export type ArchiveEntrySummary = {
  path: string;
  isDirectory: boolean;
  /** Declared uncompressed size. Informational only; never used as a safety bound. */
  declaredSizeBytes: number | null;
};

export type ArchiveListing = {
  entries: ArchiveEntrySummary[];
  /** Entries refused by the entry-path or sensitive-name rules, counted not named. */
  deniedCount: number;
  truncated: boolean;
  totalEntries: number;
};

/**
 * Local view of the JSZip entry surface we use.
 *
 * `nodeStream` is declared as returning `Readable` rather than the broader
 * `NodeJS.ReadableStream`, because we need `destroy()` to abort a decompressing
 * bomb mid-stream and the narrower interface does not expose it.
 */
type JSZipObjectLike = {
  name: string;
  dir: boolean;
  nodeStream?: () => Readable;
  async: (type: "nodebuffer") => Promise<Buffer>;
};

function declaredSize(entry: unknown): number | null {
  const data = (entry as { _data?: { uncompressedSize?: unknown } })?._data;
  const size = data?.uncompressedSize;
  return typeof size === "number" && Number.isFinite(size) ? size : null;
}

async function loadZip(
  archiveBytes: Buffer,
): Promise<{ ok: true; zip: JSZip } | { ok: false; failure: ArchiveFailure }> {
  if (archiveBytes.byteLength > ARCHIVE_LIMITS.maxArchiveBytes) {
    return {
      ok: false,
      failure: {
        kind: "too-large",
        detail: `archive is ${archiveBytes.byteLength} bytes, limit ${ARCHIVE_LIMITS.maxArchiveBytes}`,
      },
    };
  }
  try {
    const zip = await JSZip.loadAsync(archiveBytes);
    return { ok: true, zip };
  } catch (err) {
    return { ok: false, failure: { kind: "not-an-archive", detail: String(err) } };
  }
}

/**
 * List archive entries without decompressing any of them.
 *
 * Denied entries are counted rather than named, so listing cannot be used to
 * enumerate which sensitive files an archive contains.
 */
export async function listArchiveEntries(params: {
  archiveBytes: Buffer;
  maxEntries?: number;
}): Promise<{ ok: true; listing: ArchiveListing } | { ok: false; failure: ArchiveFailure }> {
  const loaded = await loadZip(params.archiveBytes);
  if (!loaded.ok) {
    return loaded;
  }

  const limit = params.maxEntries ?? ARCHIVE_LIMITS.maxListedEntries;
  const names = Object.keys(loaded.zip.files);

  // Declared-size bomb pre-check: if the central directory already claims an
  // absurd expansion, refuse before doing any work.
  let declaredTotal = 0;
  for (const name of names) {
    declaredTotal += declaredSize(loaded.zip.files[name]) ?? 0;
  }
  const ratio = declaredTotal / Math.max(1, params.archiveBytes.byteLength);
  if (ratio > ARCHIVE_LIMITS.maxTotalExpansionRatio) {
    return {
      ok: false,
      failure: {
        kind: "bomb",
        detail: `declared expansion ratio ${ratio.toFixed(1)} exceeds ${ARCHIVE_LIMITS.maxTotalExpansionRatio}`,
      },
    };
  }

  const entries: ArchiveEntrySummary[] = [];
  let deniedCount = 0;
  for (const name of names) {
    const decision = evaluateArchiveEntryPath(name.endsWith("/") ? name.slice(0, -1) : name);
    if (!decision.allowed) {
      deniedCount += 1;
      continue;
    }
    if (entries.length >= limit) {
      break;
    }
    const entry = loaded.zip.files[name];
    entries.push({
      path: name,
      isDirectory: entry.dir,
      declaredSizeBytes: declaredSize(entry),
    });
  }

  return {
    ok: true,
    listing: {
      entries,
      deniedCount,
      truncated: names.length - deniedCount > entries.length,
      totalEntries: names.length,
    },
  };
}

export type ArchiveEntryContent = {
  path: string;
  buffer: Buffer;
  truncated: boolean;
  bytesRead: number;
};

/**
 * Read one entry, streaming it so the byte ceiling is enforced on actual output.
 *
 * Trusting the declared size would let a crafted central directory understate a
 * bomb, so the cap is applied to bytes as they arrive and the stream is destroyed
 * the moment it is exceeded.
 */
export async function readArchiveEntry(params: {
  archiveBytes: Buffer;
  entryPath: string;
  maxEntryBytes?: number;
}): Promise<{ ok: true; content: ArchiveEntryContent } | { ok: false; failure: ArchiveFailure }> {
  const decision = evaluateArchiveEntryPath(params.entryPath);
  if (!decision.allowed) {
    return { ok: false, failure: { kind: "entry-denied", decision } };
  }
  if (isNestedArchiveName(params.entryPath)) {
    return { ok: false, failure: { kind: "nested-archive" } };
  }

  const loaded = await loadZip(params.archiveBytes);
  if (!loaded.ok) {
    return loaded;
  }

  const entry = loaded.zip.files[params.entryPath] as unknown as JSZipObjectLike | undefined;
  if (!entry || entry.dir) {
    return { ok: false, failure: { kind: "entry-not-found" } };
  }

  const cap = Math.min(
    params.maxEntryBytes ?? ARCHIVE_LIMITS.maxEntryBytes,
    ARCHIVE_LIMITS.maxEntryBytes,
  );

  const stream: Readable =
    typeof entry.nodeStream === "function"
      ? entry.nodeStream()
      : Readable.from(await entry.async("nodebuffer"));

  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;

  try {
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (total >= cap) {
          truncated = true;
          return;
        }
        const remaining = cap - total;
        if (buf.byteLength > remaining) {
          chunks.push(buf.subarray(0, remaining));
          total += remaining;
          truncated = true;
          // Stop decompressing immediately; do not keep inflating a bomb.
          stream.destroy();
          resolve();
          return;
        }
        chunks.push(buf);
        total += buf.byteLength;
      });
      stream.on("end", () => resolve());
      stream.on("close", () => resolve());
      stream.on("error", (err: Error) => reject(err));
    });
  } catch (err) {
    return { ok: false, failure: { kind: "io-error", detail: String(err) } };
  }

  return {
    ok: true,
    content: {
      path: params.entryPath,
      buffer: Buffer.concat(chunks),
      truncated,
      bytesRead: total,
    },
  };
}
