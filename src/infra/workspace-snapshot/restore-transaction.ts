/**
 * Fast, rollback-safe workspace restore engine (chat-checkpoint-rollback).
 *
 * Restore runs in three phases:
 *
 *   1. plan   (read-only)  compare the workspace to the manifest: files whose
 *                          size + sha256 already match are skipped, so a
 *                          workspace that already equals the checkpoint is a
 *                          no-op fast path.
 *   2. stage  (no workspace mutation) copy every blob that must be written into
 *                          a private transaction directory and verify its size.
 *                          A failure here leaves the workspace untouched.
 *   3. commit (journaled)  move extra files + files being replaced into the
 *                          transaction backup dir, then rename staged files into
 *                          place. Every step is journaled; on any failure the
 *                          journal is replayed in reverse so the workspace ends
 *                          up exactly as it was (no half-deleted workspace).
 *
 * No per-file child process is spawned (the old path spawned `python3` for each
 * file through fs-safe's pinned write helper). Containment is enforced here:
 * manifest paths are validated as plain relative paths and every parent
 * directory segment is lstat-checked to be a real directory (never a symlink)
 * under the realpath'd workspace root before anything is renamed into it.
 */

import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { isPathInside } from "../path-guards.js";
import type { SnapshotManifestEntry, SnapshotRestoreResult } from "./types.js";

const DEFAULT_CONCURRENCY = 8;

export type RestorePhase = "plan" | "stage" | "commit";

/** Restore failure that keeps the real errno, the relative path, and rollback status. */
export class WorkspaceRestoreError extends Error {
  readonly phase: RestorePhase;
  readonly relativePath?: string;
  readonly errno?: string;
  /** True when the workspace was left exactly as before the restore attempt. */
  readonly rolledBack: boolean;
  readonly rollbackFailures: string[];
  /** Transaction dir kept for manual recovery when rollback was incomplete. */
  readonly transactionDir?: string;

  constructor(params: {
    phase: RestorePhase;
    relativePath?: string;
    cause: unknown;
    rolledBack: boolean;
    rollbackFailures?: string[];
    transactionDir?: string;
  }) {
    const errno = readErrno(params.cause);
    const causeMessage = describeCause(params.cause);
    const where = params.relativePath ? ` "${params.relativePath}"` : "";
    const action =
      params.phase === "plan" ? "checking" : params.phase === "stage" ? "preparing" : "restoring";
    const outcome = params.rolledBack
      ? "workspace left unchanged"
      : `rollback incomplete (${(params.rollbackFailures ?? []).length} step(s) failed); backups kept at ${params.transactionDir ?? "?"}`;
    super(`restore failed while ${action}${where}: ${causeMessage}; ${outcome}`, {
      cause: params.cause instanceof Error ? params.cause : undefined,
    });
    this.name = "WorkspaceRestoreError";
    this.phase = params.phase;
    this.relativePath = params.relativePath;
    this.errno = errno;
    this.rolledBack = params.rolledBack;
    this.rollbackFailures = params.rollbackFailures ?? [];
    this.transactionDir = params.transactionDir;
  }
}

/** Raised when another restore is already running for the same workspace. */
export class WorkspaceRestoreBusyError extends Error {
  readonly code = "RESTORE_IN_PROGRESS";
  readonly startedAtMs: number;

  constructor(startedAtMs: number) {
    super("a restore is already in progress for this workspace");
    this.name = "WorkspaceRestoreBusyError";
    this.startedAtMs = startedAtMs;
  }
}

function readErrno(cause: unknown): string | undefined {
  if (cause && typeof cause === "object") {
    const errno = (cause as { errno?: unknown }).errno;
    if (typeof errno === "string" && errno) {
      return errno;
    }
    const code = (cause as { code?: unknown }).code;
    if (typeof code === "string" && /^E[A-Z0-9]+$/u.test(code)) {
      return code;
    }
  }
  return undefined;
}

function describeCause(cause: unknown): string {
  if (!(cause instanceof Error)) {
    return String(cause);
  }
  const errno = readErrno(cause);
  const message = cause.message.trim() || cause.name;
  return errno && !message.includes(errno) ? `${errno}: ${message}` : message;
}

function errnoError(code: string, message: string): NodeJS.ErrnoException {
  const err = new Error(`${code}: ${message}`) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

/** Reject anything that is not a plain, normalized, root-relative posix path. */
export function assertPlainRelativePath(relPosix: string): void {
  if (
    !relPosix ||
    relPosix.includes("\0") ||
    relPosix.includes("\\") ||
    relPosix.startsWith("/") ||
    /^[A-Za-z]:/u.test(relPosix)
  ) {
    throw errnoError("EINVAL", `unsafe manifest path: ${JSON.stringify(relPosix)}`);
  }
  for (const segment of relPosix.split("/")) {
    if (!segment || segment === "." || segment === "..") {
      throw errnoError("EINVAL", `unsafe manifest path: ${JSON.stringify(relPosix)}`);
    }
  }
}

async function lstatOrNull(abs: string): Promise<import("node:fs").Stats | null> {
  try {
    return await fs.lstat(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

function throwIfRestoreSignalAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }
  const reason = signal.reason;
  throw reason instanceof Error ? reason : new Error("restore aborted");
}

/** Hash in chunks so a large workspace file cannot block the event loop past the restore deadline. */
async function sha256OfFile(abs: string, signal?: AbortSignal): Promise<string> {
  throwIfRestoreSignalAborted(signal);
  const hash = crypto.createHash("sha256");
  const handle = await fs.open(abs, "r");
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      throwIfRestoreSignalAborted(signal);
      const { bytesRead } = await handle.read(buf, 0, buf.length, position);
      if (bytesRead <= 0) {
        break;
      }
      hash.update(buf.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function mapLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | null = null;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (failure === null && next < items.length) {
      const index = next++;
      try {
        await fn(items[index], index);
      } catch (error) {
        failure ??= { error };
      }
    }
  });
  await Promise.all(workers);
  if (failure !== null) {
    throw (failure as { error: unknown }).error;
  }
}

type JournalOp =
  | { kind: "moved-out"; abs: string; backup: string }
  | { kind: "placed"; abs: string }
  | { kind: "created-dir"; abs: string }
  | { kind: "removed-dir"; abs: string };

class TaggedError extends Error {
  constructor(
    readonly relativePath: string,
    readonly original: unknown,
  ) {
    super(describeCause(original));
  }
}

function tag<T>(relativePath: string, fn: () => Promise<T>): Promise<T> {
  return fn().catch((err: unknown) => {
    throw err instanceof TaggedError ? err : new TaggedError(relativePath, err);
  });
}

/**
 * Make sure every parent directory of `relPosix` exists as a real directory
 * (not a symlink) under `rootReal`, creating missing ones and journaling them.
 */
async function ensureParentDirs(
  rootReal: string,
  relPosix: string,
  journal: JournalOp[],
): Promise<string> {
  const segments = relPosix.split("/").slice(0, -1);
  let current = rootReal;
  for (const segment of segments) {
    const next = path.join(current, segment);
    let stat = await lstatOrNull(next);
    if (!stat) {
      await fs.mkdir(next);
      journal.push({ kind: "created-dir", abs: next });
      stat = await fs.lstat(next);
    }
    if (stat.isSymbolicLink()) {
      throw errnoError("ELOOP", `parent directory is a symlink: ${path.relative(rootReal, next)}`);
    }
    if (!stat.isDirectory()) {
      throw errnoError(
        "ENOTDIR",
        `parent path is not a directory: ${path.relative(rootReal, next)}`,
      );
    }
    current = next;
  }
  const parentReal = await fs.realpath(current);
  if (parentReal !== rootReal && !isPathInside(rootReal, parentReal)) {
    throw errnoError("EPERM", "parent directory resolves outside workspace root");
  }
  return current;
}

async function rollback(journal: JournalOp[]): Promise<string[]> {
  const failures: string[] = [];
  for (let i = journal.length - 1; i >= 0; i -= 1) {
    const op = journal[i];
    if (!op) {
      continue;
    }
    try {
      switch (op.kind) {
        case "placed":
          await fs.rm(op.abs, { force: true });
          break;
        case "moved-out":
          await fs.rename(op.backup, op.abs);
          break;
        case "created-dir":
          await fs.rmdir(op.abs);
          break;
        case "removed-dir":
          await fs.mkdir(op.abs, { recursive: true });
          break;
      }
    } catch (err) {
      failures.push(`${op.kind} ${op.abs}: ${describeCause(err)}`);
    }
  }
  return failures;
}

export type RestoreTransactionInput = {
  rootReal: string;
  /** Directory (outside the walked tree) used for staging + backups. */
  transactionParentDir: string;
  entries: SnapshotManifestEntry[];
  /** Files currently present under the root (already filtered by ignore rules). */
  currentFiles: Array<{ relPosix: string; abs: string }>;
  blobPath: (sha256: string) => string;
  concurrency?: number;
  /** Checked between files so a deadline can stop the restore before commit. */
  signal?: AbortSignal;
  onMissingBlob?: (entry: SnapshotManifestEntry) => void;
};

export async function runRestoreTransaction(
  input: RestoreTransactionInput,
): Promise<SnapshotRestoreResult> {
  throwIfRestoreSignalAborted(input.signal);
  const startedAt = Date.now();
  const { rootReal } = input;
  const concurrency = Math.max(1, input.concurrency ?? DEFAULT_CONCURRENCY);
  const wanted = new Map<string, SnapshotManifestEntry>();

  // ── Phase 1: plan (read-only) ────────────────────────────────────────────
  type PlannedWrite = { entry: SnapshotManifestEntry; blobAbs: string; stagePath?: string };
  const writes: PlannedWrite[] = [];
  const modeFixes: Array<{ abs: string; mode: number }> = [];
  let unchangedFiles = 0;
  let skippedFiles = 0;
  const current = new Map(input.currentFiles.map((file) => [file.relPosix, file]));
  try {
    for (const entry of input.entries) {
      await tag(entry.path, async () => assertPlainRelativePath(entry.path));
      wanted.set(entry.path, entry);
    }
    await mapLimit(input.entries, concurrency, async (entry) =>
      tag(entry.path, async () => {
        const existing = current.get(entry.path);
        if (existing) {
          const stat = await lstatOrNull(existing.abs);
          if (
            stat?.isFile() &&
            stat.nlink === 1 &&
            stat.size === entry.size &&
            (await sha256OfFile(existing.abs, input.signal)) === entry.sha256
          ) {
            unchangedFiles += 1;
            if ((stat.mode & 0o777) !== entry.mode) {
              modeFixes.push({ abs: existing.abs, mode: entry.mode });
            }
            return;
          }
        }
        const blobAbs = input.blobPath(entry.sha256);
        if (!(await lstatOrNull(blobAbs))) {
          // Missing blob: keep the current file rather than corrupt the tree.
          skippedFiles += 1;
          input.onMissingBlob?.(entry);
          return;
        }
        writes.push({ entry, blobAbs });
      }),
    );
  } catch (err) {
    const tagged = err instanceof TaggedError ? err : null;
    throw new WorkspaceRestoreError({
      phase: "plan",
      relativePath: tagged?.relativePath,
      cause: tagged?.original ?? err,
      rolledBack: true,
    });
  }
  const extras = input.currentFiles.filter((file) => !wanted.has(file.relPosix));

  throwIfRestoreSignalAborted(input.signal);
  // Fast path: workspace already matches the checkpoint.
  if (writes.length === 0 && extras.length === 0) {
    for (const fix of modeFixes) {
      await fs.chmod(fix.abs, fix.mode).catch(() => {});
    }
    return {
      restoredFiles: 0,
      removedFiles: 0,
      unchangedFiles,
      skippedFiles,
      durationMs: Date.now() - startedAt,
    };
  }

  // Stable order: shallow paths first so parent dirs are created predictably.
  writes.sort((a, b) => a.entry.path.localeCompare(b.entry.path));

  await fs.mkdir(input.transactionParentDir, { recursive: true });
  const txnDir = await fs.mkdtemp(path.join(input.transactionParentDir, "restore-"));
  const stageDir = path.join(txnDir, "stage");
  const backupDir = path.join(txnDir, "backup");
  await fs.mkdir(stageDir);
  await fs.mkdir(backupDir);

  // ── Phase 2: stage (workspace untouched) ─────────────────────────────────
  try {
    await mapLimit(writes, concurrency, async (write, index) =>
      tag(write.entry.path, async () => {
        throwIfRestoreSignalAborted(input.signal);
        const stagePath = path.join(stageDir, String(index));
        await fs.copyFile(write.blobAbs, stagePath, fsConstants.COPYFILE_FICLONE);
        await fs.chmod(stagePath, write.entry.mode);
        const staged = await fs.stat(stagePath);
        if (staged.size !== write.entry.size) {
          throw errnoError(
            "EIO",
            `snapshot blob size mismatch (expected ${write.entry.size}, got ${staged.size})`,
          );
        }
        write.stagePath = stagePath;
      }),
    );
  } catch (err) {
    await fs.rm(txnDir, { recursive: true, force: true }).catch(() => {});
    const tagged = err instanceof TaggedError ? err : null;
    throw new WorkspaceRestoreError({
      phase: "stage",
      relativePath: tagged?.relativePath,
      cause: tagged?.original ?? err,
      rolledBack: true,
    });
  }

  // ── Phase 3: commit (journaled, reversible) ──────────────────────────────
  const journal: JournalOp[] = [];
  let backupSeq = 0;
  const moveOut = async (abs: string) => {
    const backup = path.join(backupDir, String(backupSeq++));
    await fs.rename(abs, backup);
    journal.push({ kind: "moved-out", abs, backup });
  };
  try {
    for (const extra of extras) {
      throwIfRestoreSignalAborted(input.signal);
      await tag(extra.relPosix, async () => {
        const abs = path.resolve(rootReal, extra.relPosix);
        if (!isPathInside(rootReal, abs)) {
          throw errnoError("EPERM", "path resolves outside workspace root");
        }
        if (await lstatOrNull(abs)) {
          await moveOut(abs);
        }
      });
    }
    for (const write of writes) {
      throwIfRestoreSignalAborted(input.signal);
      await tag(write.entry.path, async () => {
        await ensureParentDirs(rootReal, write.entry.path, journal);
        const target = path.join(rootReal, ...write.entry.path.split("/"));
        const existing = await lstatOrNull(target);
        if (existing?.isDirectory()) {
          // Only an (now) empty directory may be replaced by a file.
          await fs.rmdir(target);
          journal.push({ kind: "removed-dir", abs: target });
        } else if (existing) {
          await moveOut(target);
        }
        await fs.rename(write.stagePath as string, target);
        journal.push({ kind: "placed", abs: target });
      });
    }
  } catch (err) {
    const failures = await rollback(journal);
    const rolledBack = failures.length === 0;
    if (rolledBack) {
      await fs.rm(txnDir, { recursive: true, force: true }).catch(() => {});
    }
    const tagged = err instanceof TaggedError ? err : null;
    throw new WorkspaceRestoreError({
      phase: "commit",
      relativePath: tagged?.relativePath,
      cause: tagged?.original ?? err,
      rolledBack,
      rollbackFailures: failures,
      transactionDir: rolledBack ? undefined : txnDir,
    });
  }

  for (const fix of modeFixes) {
    await fs.chmod(fix.abs, fix.mode).catch(() => {});
  }
  await fs.rm(txnDir, { recursive: true, force: true }).catch(() => {});
  return {
    restoredFiles: writes.length,
    removedFiles: extras.length,
    unchangedFiles,
    skippedFiles,
    durationMs: Date.now() - startedAt,
  };
}

const workspaceRestoreLocks = new Map<string, number>();

/**
 * Per-workspace (realpath) restore mutex. A second restore of the same
 * workspace while one is running fails fast with WorkspaceRestoreBusyError
 * instead of queueing a duplicate full restore behind it.
 */
export async function withWorkspaceRestoreLock<T>(
  rootReal: string,
  fn: () => Promise<T>,
): Promise<T> {
  const heldSince = workspaceRestoreLocks.get(rootReal);
  if (heldSince !== undefined) {
    throw new WorkspaceRestoreBusyError(heldSince);
  }
  workspaceRestoreLocks.set(rootReal, Date.now());
  try {
    return await fn();
  } finally {
    workspaceRestoreLocks.delete(rootReal);
  }
}
