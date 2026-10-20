/**
 * Node-side safe resolution and opening (design 4.8, 9.1, 9.5).
 *
 * The threat this closes is the gap between checking a path and opening it.
 * `realpath` followed by an open-by-path is not enough: the name can be swapped
 * in between. So the final read comes from an already-open descriptor whose
 * `fstat` identity is compared against what resolution observed.
 *
 * Reuses `openFileWithinRoot` from `src/infra/fs-safe.ts`, which already does the
 * `O_NOFOLLOW` open, the lstat/fstat/realpath identity triangle and hard link
 * rejection, rather than reimplementing that logic here.
 */

import type { Dirent, Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import fs from "node:fs/promises";
import path from "node:path";
import { sameFileIdentity } from "../../infra/file-identity.js";
import { openFileWithinRoot, SafeOpenError } from "../../infra/fs-safe.js";
import { expandHomePrefix } from "../../infra/home-dir.js";
import { isNotFoundPathError } from "../../infra/path-guards.js";
import {
  evaluateCanonicalPath,
  evaluateStatFacts,
  type PathDecision,
  type PathPolicyContext,
  type PathStatFacts,
} from "../../local-files/path-policy.js";
import { LOCAL_FILES_LIMITS, type FileIdentity } from "../../local-files/types.js";

export type ResolveFailure =
  | { kind: "denied"; decision: PathDecision }
  | { kind: "not-found" }
  | { kind: "io-error"; detail: string }
  | { kind: "alias" };

export type ResolvedTarget = {
  canonicalPath: string;
  fileId: FileIdentity;
  facts: PathStatFacts;
  sizeBytes: number;
  mtimeMs: number;
};

export type ResolveResult =
  | { ok: true; target: ResolvedTarget }
  | { ok: false; failure: ResolveFailure };

function toFileIdentity(stat: Pick<Stats, "dev" | "ino">): FileIdentity {
  return { dev: String(stat.dev), ino: String(stat.ino) };
}

function classifyStat(stat: Stats): PathStatFacts["kind"] {
  if (stat.isSymbolicLink()) {
    return "symlink";
  }
  if (stat.isDirectory()) {
    return "directory";
  }
  if (stat.isFile()) {
    return "file";
  }
  if (stat.isSocket()) {
    return "socket";
  }
  if (stat.isFIFO()) {
    return "fifo";
  }
  if (stat.isCharacterDevice()) {
    return "char-device";
  }
  if (stat.isBlockDevice()) {
    return "block-device";
  }
  return "other";
}

/**
 * A Finder alias is a regular file holding bookmark data, not a symlink, so the
 * symlink guard does not catch it. The prototype refuses aliases outright
 * (design 9.5) by sniffing the bookmark magic.
 */
const ALIAS_MAGICS = ["book", "bplist00\u0000"] as const;

async function looksLikeFinderAlias(handle: FileHandle, size: number): Promise<boolean> {
  if (size < 4) {
    return false;
  }
  const head = Buffer.alloc(4);
  const { bytesRead } = await handle.read(head, 0, 4, 0);
  if (bytesRead < 4) {
    return false;
  }
  return ALIAS_MAGICS.some((magic) => head.toString("latin1").startsWith(magic.slice(0, 4)));
}

/**
 * Errno for a filesystem failure, with nothing else.
 *
 * `String(err)` on a Node fs error reads like
 * `Error: ENOENT: no such file or directory, lstat '/Users/…/Desktop/pack.zip'`,
 * so it embeds the full local path. Design 4.12 forbids a complete local path in
 * an operational log, and this detail does end up in node logs, so only the code
 * is kept.
 */
function errnoOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.length > 0 ? code : "unknown";
}

/**
 * Stage one of two-phase resolution: expand `~`, canonicalize, apply the hard
 * denials, and report the path identity back.
 *
 * Only ever called while holding a resolve ticket. It does not list directories,
 * does not read content, and does not hash content (design 9.1 step 2).
 */
export async function resolveTargetPath(params: {
  rawPath: string;
  ctx: PathPolicyContext;
}): Promise<ResolveResult> {
  const raw = params.rawPath.trim();
  if (!raw || raw.includes("\0")) {
    return {
      ok: false,
      failure: {
        kind: "denied",
        decision: { allowed: false, layer: "malformed-path", rule: "empty or NUL path" },
      },
    };
  }
  // `~` is expanded here, on the node, against the bound user's home. The
  // gateway cannot do this for a filesystem it does not have.
  const expanded = expandHomePrefix(raw, { home: params.ctx.homeDir });
  if (!path.isAbsolute(expanded)) {
    return {
      ok: false,
      failure: {
        kind: "denied",
        decision: { allowed: false, layer: "malformed-path", rule: "path must be absolute" },
      },
    };
  }

  let canonicalPath: string;
  try {
    canonicalPath = await fs.realpath(path.resolve(expanded));
  } catch (err) {
    if (isNotFoundPathError(err)) {
      return { ok: false, failure: { kind: "not-found" } };
    }
    return { ok: false, failure: { kind: "io-error", detail: errnoOf(err) } };
  }

  const pathDecision = evaluateCanonicalPath(canonicalPath, params.ctx);
  if (!pathDecision.allowed) {
    return { ok: false, failure: { kind: "denied", decision: pathDecision } };
  }

  let stat: Stats;
  try {
    stat = await fs.lstat(canonicalPath);
  } catch (err) {
    if (isNotFoundPathError(err)) {
      return { ok: false, failure: { kind: "not-found" } };
    }
    return { ok: false, failure: { kind: "io-error", detail: errnoOf(err) } };
  }

  const facts: PathStatFacts = { kind: classifyStat(stat), nlink: stat.nlink };
  const factsDecision = evaluateStatFacts(facts);
  if (!factsDecision.allowed) {
    return { ok: false, failure: { kind: "denied", decision: factsDecision } };
  }

  if (facts.kind === "file") {
    // Alias sniffing needs the file open; use the safe path for it.
    try {
      const opened = await openFileWithinRoot({
        rootDir: params.ctx.homeDir,
        relativePath: path.relative(params.ctx.homeDir, canonicalPath),
        rejectHardlinks: true,
      });
      try {
        if (await looksLikeFinderAlias(opened.handle, opened.stat.size)) {
          return { ok: false, failure: { kind: "alias" } };
        }
      } finally {
        await opened.handle.close().catch(() => {});
      }
    } catch (err) {
      if (err instanceof SafeOpenError) {
        return {
          ok: false,
          failure:
            err.code === "not-found"
              ? { kind: "not-found" }
              : {
                  kind: "denied",
                  decision: { allowed: false, layer: "special-file", rule: err.code },
                },
        };
      }
      return { ok: false, failure: { kind: "io-error", detail: errnoOf(err) } };
    }
  }

  return {
    ok: true,
    target: {
      canonicalPath,
      fileId: toFileIdentity(stat),
      facts,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
    },
  };
}

export type OpenFailure =
  | { kind: "denied"; decision: PathDecision }
  | { kind: "not-found" }
  | { kind: "identity-mismatch" }
  | { kind: "io-error"; detail: string };

export type OpenedFile = {
  handle: FileHandle;
  canonicalPath: string;
  fileId: FileIdentity;
  sizeBytes: number;
  mtimeMs: number;
};

/**
 * Open a regular file for reading and confirm it is still the object resolution
 * saw.
 *
 * `expectedFileId` comes from the resolve stage. A mismatch means the path was
 * replaced after approval, so the read fails rather than silently serving the
 * substitute (design 9.1 step 4, acceptance 9.6 case 16).
 */
export async function openFileForRead(params: {
  canonicalPath: string;
  expectedFileId: FileIdentity;
  ctx: PathPolicyContext;
}): Promise<{ ok: true; file: OpenedFile } | { ok: false; failure: OpenFailure }> {
  const pathDecision = evaluateCanonicalPath(params.canonicalPath, params.ctx);
  if (!pathDecision.allowed) {
    return { ok: false, failure: { kind: "denied", decision: pathDecision } };
  }

  let opened: Awaited<ReturnType<typeof openFileWithinRoot>>;
  try {
    opened = await openFileWithinRoot({
      rootDir: params.ctx.homeDir,
      relativePath: path.relative(params.ctx.homeDir, params.canonicalPath),
      rejectHardlinks: true,
    });
  } catch (err) {
    if (err instanceof SafeOpenError) {
      if (err.code === "not-found") {
        return { ok: false, failure: { kind: "not-found" } };
      }
      return {
        ok: false,
        failure: {
          kind: "denied",
          decision: { allowed: false, layer: "special-file", rule: err.code },
        },
      };
    }
    return { ok: false, failure: { kind: "io-error", detail: errnoOf(err) } };
  }

  // fstat on the open descriptor, compared with what resolution recorded.
  const actual = toFileIdentity(opened.stat);
  if (
    !sameFileIdentity(
      { dev: BigInt(actual.dev), ino: BigInt(actual.ino) },
      { dev: BigInt(params.expectedFileId.dev), ino: BigInt(params.expectedFileId.ino) },
    )
  ) {
    await opened.handle.close().catch(() => {});
    return { ok: false, failure: { kind: "identity-mismatch" } };
  }

  const facts: PathStatFacts = { kind: classifyStat(opened.stat), nlink: opened.stat.nlink };
  const factsDecision = evaluateStatFacts(facts);
  if (!factsDecision.allowed) {
    await opened.handle.close().catch(() => {});
    return { ok: false, failure: { kind: "denied", decision: factsDecision } };
  }

  return {
    ok: true,
    file: {
      handle: opened.handle,
      canonicalPath: opened.realPath,
      fileId: actual,
      sizeBytes: opened.stat.size,
      mtimeMs: opened.stat.mtimeMs,
    },
  };
}

export type DirectoryEntry = {
  name: string;
  kind: "file" | "directory" | "other";
};

/**
 * List a directory's direct children only.
 *
 * Never recursive, capped at 200 entries, and any child name containing a path
 * separator is dropped rather than returned (design 4.8, 4.10). Listing a child
 * grants nothing: reading one still needs its own authorization (design 9.4).
 */
export async function listDirectoryDirectChildren(params: {
  canonicalPath: string;
  expectedFileId: FileIdentity;
  ctx: PathPolicyContext;
  maxEntries?: number;
}): Promise<
  | { ok: true; entries: DirectoryEntry[]; truncated: boolean; totalSeen: number }
  | { ok: false; failure: OpenFailure }
> {
  const pathDecision = evaluateCanonicalPath(params.canonicalPath, params.ctx);
  if (!pathDecision.allowed) {
    return { ok: false, failure: { kind: "denied", decision: pathDecision } };
  }

  let stat: Stats;
  try {
    stat = await fs.lstat(params.canonicalPath);
  } catch (err) {
    if (isNotFoundPathError(err)) {
      return { ok: false, failure: { kind: "not-found" } };
    }
    return { ok: false, failure: { kind: "io-error", detail: errnoOf(err) } };
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    return {
      ok: false,
      failure: {
        kind: "denied",
        decision: { allowed: false, layer: "special-file", rule: "not a directory" },
      },
    };
  }
  const actual = toFileIdentity(stat);
  if (actual.dev !== params.expectedFileId.dev || actual.ino !== params.expectedFileId.ino) {
    return { ok: false, failure: { kind: "identity-mismatch" } };
  }

  const limit = params.maxEntries ?? LOCAL_FILES_LIMITS.maxListEntries;
  let dirents: Dirent[];
  try {
    dirents = await fs.readdir(params.canonicalPath, { withFileTypes: true });
  } catch (err) {
    return { ok: false, failure: { kind: "io-error", detail: errnoOf(err) } };
  }

  const entries: DirectoryEntry[] = [];
  for (const dirent of dirents) {
    // A child name must never contain a separator; such a name cannot be a
    // direct child and would widen the target.
    if (dirent.name.includes("/") || dirent.name.includes("\\") || dirent.name.includes("\0")) {
      continue;
    }
    if (entries.length >= limit) {
      break;
    }
    entries.push({
      name: dirent.name,
      kind: dirent.isDirectory() ? "directory" : dirent.isFile() ? "file" : "other",
    });
  }

  return {
    ok: true,
    entries,
    truncated: dirents.length > entries.length,
    totalSeen: dirents.length,
  };
}

/**
 * Read from an already-open descriptor, never by re-opening the path.
 *
 * `maxBytes` is applied as given. The caller owns the ceiling because the limits
 * differ by purpose: a text read is capped at `maxSingleReadBytes`, while loading
 * an archive for inspection needs the whole container. Clamping here silently
 * truncated archives and produced "corrupt zip" instead of a size refusal.
 */
export async function readFromOpenFile(params: {
  file: OpenedFile;
  maxBytes: number;
}): Promise<{ buffer: Buffer; truncated: boolean; totalBytes: number }> {
  const toRead = Math.min(params.file.sizeBytes, Math.max(0, params.maxBytes));
  const buffer = Buffer.alloc(toRead);
  let offset = 0;
  while (offset < toRead) {
    const { bytesRead } = await params.file.handle.read(buffer, offset, toRead - offset, offset);
    if (bytesRead <= 0) {
      break;
    }
    offset += bytesRead;
  }
  return {
    buffer: buffer.subarray(0, offset),
    truncated: params.file.sizeBytes > toRead,
    totalBytes: params.file.sizeBytes,
  };
}
