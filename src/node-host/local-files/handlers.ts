/**
 * The five node command handlers of the `local-files-readonly` profile.
 *
 * Shared shape: authorize, then act, then report. Nothing touches the filesystem
 * before the capability verifies locally and redeems online (design 9.3), and no
 * handler returns a hint about a path it was not allowed to open (design 9.1).
 *
 * `fs.stat` carries two authorization modes. With a resolve ticket it is stage
 * one of two-phase resolution; with an Invocation capability it reports metadata
 * for an already-authorized target. There is deliberately no `fs.resolve`
 * command — adding one would create a general path-probing interface (design 9.7).
 */

import crypto from "node:crypto";
import type { PathDecision, PathPolicyContext } from "../../local-files/path-policy.js";
import {
  LOCAL_FILES_LIMITS,
  LOCAL_FILES_OPAQUE_DENIAL,
  type FileIdentity,
  type LocalFilesFailureClass,
  type SignedCapability,
} from "../../local-files/types.js";
import {
  ARCHIVE_LIMITS,
  listArchiveEntries,
  readArchiveEntry,
  type ArchiveFailure,
} from "./archive-read.js";
import { detectFileEncoding } from "./encoding.js";
import {
  authorizeInvocation,
  authorizeResolve,
  type GuardFailure,
  type LocalFilesGuardDeps,
} from "./guard.js";
import {
  listDirectoryDirectChildren,
  openFileForRead,
  readFromOpenFile,
  resolveTargetPath,
  type DirectoryEntry,
  type OpenFailure,
  type ResolveFailure,
} from "./safe-open.js";

export type LocalFilesHandlerDeps = LocalFilesGuardDeps & {
  policy: PathPolicyContext;
};

/** Uniform failure envelope. `detail` is for audit; `message` is what the model sees. */
export type HandlerError = {
  ok: false;
  message: typeof LOCAL_FILES_OPAQUE_DENIAL;
  detail: string;
};

function denied(detail: string): HandlerError {
  return { ok: false, message: LOCAL_FILES_OPAQUE_DENIAL, detail };
}

/**
 * Coarse class for the refusal, derived from the detail it already carries.
 *
 * Only this class crosses to the gateway; `detail` stays here. That split is what
 * lets the gateway audit tell a redemption refusal from a failed open (design 10.4)
 * without shipping the detail string, which carries errno text.
 */
export function classifyHandlerFailure(detail: string): LocalFilesFailureClass {
  if (detail.startsWith("guard:redemption-refused")) {
    return "REDEMPTION_REFUSED";
  }
  // An io failure means the object was authorized but the filesystem call failed.
  if (/^(?:open|resolve|read|list|archive[a-z-]*):io:/.test(detail)) {
    return "OPEN_FAILED";
  }
  if (detail.startsWith("open:identity-mismatch") || detail.startsWith("resolve:identity")) {
    return "OPEN_FAILED";
  }
  return "PERMISSION_DENIED";
}

function guardDetail(failure: GuardFailure): string {
  return failure.kind === "capability-invalid"
    ? `guard:${failure.kind}:${failure.reason}`
    : failure.kind === "redemption-refused"
      ? `guard:${failure.kind}:${failure.reason}`
      : `guard:${failure.kind}`;
}

/** Which layer refused, for the audit detail only. */
function decisionLayer(decision: PathDecision): string {
  return decision.allowed ? "allowed" : decision.layer;
}

function resolveFailureDetail(failure: ResolveFailure): string {
  switch (failure.kind) {
    case "denied":
      return `resolve:denied:${decisionLayer(failure.decision)}`;
    case "io-error":
      return `resolve:io:${failure.detail}`;
    default:
      return `resolve:${failure.kind}`;
  }
}

function openFailureDetail(failure: OpenFailure): string {
  switch (failure.kind) {
    case "denied":
      return `open:denied:${decisionLayer(failure.decision)}`;
    case "io-error":
      return `open:io:${failure.detail}`;
    default:
      return `open:${failure.kind}`;
  }
}

function archiveFailureDetail(failure: ArchiveFailure): string {
  switch (failure.kind) {
    case "entry-denied":
      return `archive:entry-denied:${decisionLayer(failure.decision)}`;
    case "bomb":
    case "too-large":
    case "not-an-archive":
    case "io-error":
      return `archive:${failure.kind}:${failure.detail}`;
    default:
      return `archive:${failure.kind}`;
  }
}

/**
 * Stage one: resolve exactly one path.
 *
 * Returns the canonical path, the target kind and the file identity — and nothing
 * else. No directory contents, no file body, no content hash (design 9.1 step 2).
 * The caller is the gateway, which uses this to build the approval card; the
 * result must not be handed to the model before the user approves.
 */
export type ResolveOutcome =
  | {
      ok: true;
      canonicalPath: string;
      targetKind: "file" | "directory";
      fileId: FileIdentity;
      sizeBytes: number;
      mtimeMs: number;
    }
  | HandlerError;

export async function handleFsStatResolve(params: {
  ticket: SignedCapability;
  deps: LocalFilesHandlerDeps;
}): Promise<ResolveOutcome> {
  const authorized = await authorizeResolve({ ticket: params.ticket, deps: params.deps });
  if (!authorized.ok) {
    return denied(guardDetail(authorized.failure));
  }

  const resolved = await resolveTargetPath({
    rawPath: authorized.claims.rawPath,
    ctx: params.deps.policy,
  });
  if (!resolved.ok) {
    return denied(resolveFailureDetail(resolved.failure));
  }

  const kind = resolved.target.facts.kind;
  if (kind !== "file" && kind !== "directory") {
    return denied(`resolve:unsupported-kind:${kind}`);
  }

  return {
    ok: true,
    canonicalPath: resolved.target.canonicalPath,
    targetKind: kind,
    fileId: resolved.target.fileId,
    sizeBytes: resolved.target.sizeBytes,
    mtimeMs: resolved.target.mtimeMs,
  };
}

export type StatOutcome =
  | {
      ok: true;
      canonicalPath: string;
      targetKind: "file" | "directory";
      sizeBytes: number;
      mtimeMs: number;
    }
  | HandlerError;

/** `fs.stat` against an already-authorized target. */
export async function handleFsStat(params: {
  capability: SignedCapability;
  deps: LocalFilesHandlerDeps;
}): Promise<StatOutcome> {
  const authorized = await authorizeInvocation({
    capability: params.capability,
    command: "fs.stat",
    deps: params.deps,
  });
  if (!authorized.ok) {
    return denied(guardDetail(authorized.failure));
  }
  const claims = authorized.claims;

  if (claims.targetKind === "directory") {
    const listed = await listDirectoryDirectChildren({
      canonicalPath: claims.canonicalPath,
      expectedFileId: claims.fileId,
      ctx: params.deps.policy,
      maxEntries: 1,
    });
    if (!listed.ok) {
      return denied(openFailureDetail(listed.failure));
    }
    return {
      ok: true,
      canonicalPath: claims.canonicalPath,
      targetKind: "directory",
      sizeBytes: 0,
      mtimeMs: 0,
    };
  }

  const opened = await openFileForRead({
    canonicalPath: claims.canonicalPath,
    expectedFileId: claims.fileId,
    ctx: params.deps.policy,
  });
  if (!opened.ok) {
    return denied(openFailureDetail(opened.failure));
  }
  try {
    return {
      ok: true,
      canonicalPath: opened.file.canonicalPath,
      targetKind: "file",
      sizeBytes: opened.file.sizeBytes,
      mtimeMs: opened.file.mtimeMs,
    };
  } finally {
    await opened.file.handle.close().catch(() => {});
  }
}

export type ListOutcome =
  | {
      ok: true;
      canonicalPath: string;
      entries: DirectoryEntry[];
      truncated: boolean;
      totalEntries: number;
    }
  | HandlerError;

/**
 * List a directory's direct children.
 *
 * Listing a child does not authorize reading it: each child needs its own
 * authorization, either a fresh naming by the user or a new one-time approval
 * (design 9.4).
 */
export async function handleFsList(params: {
  capability: SignedCapability;
  deps: LocalFilesHandlerDeps;
}): Promise<ListOutcome> {
  const authorized = await authorizeInvocation({
    capability: params.capability,
    command: "fs.list",
    deps: params.deps,
  });
  if (!authorized.ok) {
    return denied(guardDetail(authorized.failure));
  }
  const claims = authorized.claims;
  if (claims.targetKind !== "directory") {
    return denied("list:target-not-directory");
  }

  const listed = await listDirectoryDirectChildren({
    canonicalPath: claims.canonicalPath,
    expectedFileId: claims.fileId,
    ctx: params.deps.policy,
  });
  if (!listed.ok) {
    return denied(openFailureDetail(listed.failure));
  }
  return {
    ok: true,
    canonicalPath: claims.canonicalPath,
    entries: listed.entries,
    truncated: listed.truncated,
    totalEntries: listed.totalSeen,
  };
}

export type ReadOutcome =
  | {
      ok: true;
      canonicalPath: string;
      name: string;
      sizeBytes: number;
      mtimeMs: number;
      sha256: string;
      isText: boolean;
      encoding: string | null;
      bytesReturned: number;
      truncated: boolean;
      /** Present only for text; binary returns metadata only (design 4.10). */
      text?: string;
    }
  | HandlerError;

/**
 * Read a regular file.
 *
 * Returns metadata plus text, not raw bytes. Binary content gets metadata only,
 * and everything is capped so a large file cannot be pushed into the model's
 * context wholesale (design 4.10).
 */
export async function handleFsRead(params: {
  capability: SignedCapability;
  deps: LocalFilesHandlerDeps;
  maxBytes?: number;
}): Promise<ReadOutcome> {
  const authorized = await authorizeInvocation({
    capability: params.capability,
    command: "fs.read",
    deps: params.deps,
  });
  if (!authorized.ok) {
    return denied(guardDetail(authorized.failure));
  }
  const claims = authorized.claims;
  if (claims.targetKind !== "file") {
    return denied("read:target-not-file");
  }

  const opened = await openFileForRead({
    canonicalPath: claims.canonicalPath,
    expectedFileId: claims.fileId,
    ctx: params.deps.policy,
  });
  if (!opened.ok) {
    return denied(openFailureDetail(opened.failure));
  }

  try {
    const read = await readFromOpenFile({
      file: opened.file,
      maxBytes: params.maxBytes ?? LOCAL_FILES_LIMITS.maxSingleReadBytes,
    });
    const detected = detectFileEncoding(read.buffer);
    const sha256 = crypto.createHash("sha256").update(read.buffer).digest("hex");
    const base = opened.file.canonicalPath.split("/").pop() ?? "";

    const outcome: ReadOutcome = {
      ok: true,
      canonicalPath: opened.file.canonicalPath,
      name: base,
      sizeBytes: opened.file.sizeBytes,
      mtimeMs: opened.file.mtimeMs,
      sha256,
      isText: detected.isText,
      encoding: detected.encoding,
      bytesReturned: read.buffer.byteLength,
      truncated: read.truncated,
    };
    if (detected.isText) {
      outcome.text = read.buffer.toString("utf8");
    }
    return outcome;
  } finally {
    await opened.file.handle.close().catch(() => {});
  }
}

async function loadArchiveBytes(params: {
  capability: SignedCapability;
  deps: LocalFilesHandlerDeps;
  claims: { canonicalPath: string; fileId: FileIdentity };
}): Promise<{ ok: true; bytes: Buffer } | HandlerError> {
  const opened = await openFileForRead({
    canonicalPath: params.claims.canonicalPath,
    expectedFileId: params.claims.fileId,
    ctx: params.deps.policy,
  });
  if (!opened.ok) {
    return denied(openFailureDetail(opened.failure));
  }
  try {
    // Refuse an oversized container up front. Truncating it instead would surface
    // as a bogus "corrupt archive" error and hide the real reason.
    if (opened.file.sizeBytes > ARCHIVE_LIMITS.maxArchiveBytes) {
      return denied(
        `archive:too-large:${opened.file.sizeBytes} exceeds ${ARCHIVE_LIMITS.maxArchiveBytes}`,
      );
    }
    // The archive is read whole into memory, never extracted to disk.
    const read = await readFromOpenFile({
      file: opened.file,
      maxBytes: ARCHIVE_LIMITS.maxArchiveBytes,
    });
    return { ok: true, bytes: read.buffer };
  } finally {
    await opened.file.handle.close().catch(() => {});
  }
}

export type ArchiveListOutcome =
  | {
      ok: true;
      canonicalPath: string;
      entries: Array<{ path: string; isDirectory: boolean; declaredSizeBytes: number | null }>;
      deniedCount: number;
      truncated: boolean;
      totalEntries: number;
    }
  | HandlerError;

export async function handleArchiveList(params: {
  capability: SignedCapability;
  deps: LocalFilesHandlerDeps;
}): Promise<ArchiveListOutcome> {
  const authorized = await authorizeInvocation({
    capability: params.capability,
    command: "archive.list",
    deps: params.deps,
  });
  if (!authorized.ok) {
    return denied(guardDetail(authorized.failure));
  }
  const claims = authorized.claims;
  if (claims.targetKind !== "file") {
    return denied("archive-list:target-not-file");
  }

  const bytes = await loadArchiveBytes({
    capability: params.capability,
    deps: params.deps,
    claims,
  });
  if (!("bytes" in bytes)) {
    return bytes;
  }

  const listed = await listArchiveEntries({ archiveBytes: bytes.bytes });
  if (!listed.ok) {
    return denied(archiveFailureDetail(listed.failure));
  }
  return {
    ok: true,
    canonicalPath: claims.canonicalPath,
    entries: listed.listing.entries,
    deniedCount: listed.listing.deniedCount,
    truncated: listed.listing.truncated,
    totalEntries: listed.listing.totalEntries,
  };
}

export type ArchiveReadEntryOutcome =
  | {
      ok: true;
      canonicalPath: string;
      entryPath: string;
      bytesReturned: number;
      truncated: boolean;
      sha256: string;
      isText: boolean;
      encoding: string | null;
      text?: string;
    }
  | HandlerError;

export async function handleArchiveReadEntry(params: {
  capability: SignedCapability;
  deps: LocalFilesHandlerDeps;
}): Promise<ArchiveReadEntryOutcome> {
  const authorized = await authorizeInvocation({
    capability: params.capability,
    command: "archive.readEntry",
    deps: params.deps,
  });
  if (!authorized.ok) {
    return denied(guardDetail(authorized.failure));
  }
  const claims = authorized.claims;
  if (claims.targetKind !== "file") {
    return denied("archive-read:target-not-file");
  }
  // The entry to read is named on the capability, not chosen by the caller at
  // call time, so it is covered by the signature.
  const entryPath = claims.archiveEntryPath;
  if (!entryPath) {
    return denied("archive-read:entry-path-missing");
  }

  const bytes = await loadArchiveBytes({
    capability: params.capability,
    deps: params.deps,
    claims,
  });
  if (!("bytes" in bytes)) {
    return bytes;
  }

  const entry = await readArchiveEntry({ archiveBytes: bytes.bytes, entryPath });
  if (!entry.ok) {
    return denied(archiveFailureDetail(entry.failure));
  }

  const detected = detectFileEncoding(entry.content.buffer);
  const outcome: ArchiveReadEntryOutcome = {
    ok: true,
    canonicalPath: claims.canonicalPath,
    entryPath,
    bytesReturned: entry.content.bytesRead,
    truncated: entry.content.truncated,
    sha256: crypto.createHash("sha256").update(entry.content.buffer).digest("hex"),
    isText: detected.isText,
    encoding: detected.encoding,
  };
  if (detected.isText) {
    outcome.text = entry.content.buffer.toString("utf8");
  }
  return outcome;
}
