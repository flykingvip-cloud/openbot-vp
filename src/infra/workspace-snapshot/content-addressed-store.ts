/**
 * Content-addressed workspace snapshot store (chat-checkpoint-rollback P1).
 *
 * Design decision D1: snapshots are stored as content-addressed blobs plus a
 * per-checkpoint manifest, fully isolated from the user's own git. This dedupes
 * unchanged content, is trivial to prune, and works cross-platform.
 *
 * Layout under `storeDir`:
 *   objects/<sha[0:2]>/<sha256>     deduped file content
 *   manifests/<checkpointId>.json   full file set for that checkpoint
 *
 * Containment (design principle 1): reads and writes of workspace files always
 * go through `fs-safe` root-scoped helpers, and every path is re-checked to live
 * under the realpath of `workspaceRoot`. Nothing outside the root is ever touched.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { SafeOpenError, readFileWithinRoot } from "../fs-safe.js";
import { runRestoreTransaction, withWorkspaceRestoreLock } from "./restore-transaction.js";
import type {
  SnapshotManifest,
  SnapshotManifestEntry,
  SnapshotPruneResult,
  SnapshotRestoreResult,
  SnapshotSkippedEntry,
  SnapshotStore,
  WorkspaceSnapshotRef,
} from "./types.js";

const log = createSubsystemLogger("workspace-snapshot");

const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MiB
const DEFAULT_IGNORE = [".git", "node_modules"];
/** Fallback restore transaction dir (only used when the store is on another device). */
const RESTORE_TXN_DIRNAME = ".openbot-restore-txn";

export type ContentAddressedSnapshotStoreOptions = {
  /** Directory where blobs + manifests live (may be inside the workspace root). */
  storeDir: string;
  /** Files larger than this are skipped (recorded in manifest.skipped). */
  maxFileBytes?: number;
  /**
   * Ignore rules. An entry without `/` matches a path segment anywhere (e.g.
   * `.git`, `node_modules`); an entry with `/` matches a workspace-relative
   * prefix (e.g. `memory/checkpoints`). The store dir is auto-ignored when it
   * lives inside the workspace root.
   */
  ignore?: string[];
};

function toPosix(relPath: string): string {
  return relPath.split(path.sep).join(path.posix.sep);
}

function shardedBlobRelPath(sha: string): string {
  return path.posix.join("objects", sha.slice(0, 2), sha);
}

function isIgnored(relPosix: string, ignore: string[]): boolean {
  const segments = new Set(relPosix.split("/").filter(Boolean));
  for (const rule of ignore) {
    if (!rule) {
      continue;
    }
    if (rule.includes("/")) {
      const prefix = rule.replace(/\/+$/u, "");
      if (relPosix === prefix || relPosix.startsWith(`${prefix}/`)) {
        return true;
      }
    } else if (segments.has(rule)) {
      return true;
    }
  }
  return false;
}

async function realpathOrThrow(dir: string): Promise<string> {
  return await fs.realpath(dir);
}

/** Build the effective ignore set, auto-adding the store dir when it is inside root. */
function resolveIgnore(workspaceRootReal: string, storeDir: string, ignore: string[]): string[] {
  const combined = [...ignore];
  const relStore = path.relative(workspaceRootReal, path.resolve(storeDir));
  if (relStore && !relStore.startsWith("..") && !path.isAbsolute(relStore)) {
    combined.push(toPosix(relStore));
  }
  return combined;
}

function throwIfSnapshotAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }
  const reason = signal.reason;
  throw reason instanceof Error ? reason : new Error("restore aborted");
}

/**
 * Recursively collect regular-file relative posix paths under root, honoring ignore.
 * Inode identity stops bind-mount cycles from walking forever (chat.restore hang).
 */
async function walkFiles(
  rootReal: string,
  ignore: string[],
  signal?: AbortSignal,
): Promise<Array<{ relPosix: string; abs: string }>> {
  const out: Array<{ relPosix: string; abs: string }> = [];
  const seenInodes = new Set<string>();
  async function recurse(absDir: string): Promise<void> {
    throwIfSnapshotAborted(signal);
    let dirStat: import("node:fs").Stats;
    try {
      dirStat = await fs.lstat(absDir);
    } catch {
      return;
    }
    if (!dirStat.isDirectory()) {
      return;
    }
    const inodeKey = `${dirStat.dev}:${dirStat.ino}`;
    if (seenInodes.has(inodeKey)) {
      return;
    }
    seenInodes.add(inodeKey);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      throwIfSnapshotAborted(signal);
      const abs = path.join(absDir, entry.name);
      const relPosix = toPosix(path.relative(rootReal, abs));
      if (isIgnored(relPosix, ignore)) {
        continue;
      }
      if (entry.isSymbolicLink()) {
        // Never follow or capture symlinks (containment).
        continue;
      }
      if (entry.isDirectory()) {
        await recurse(abs);
      } else if (entry.isFile()) {
        out.push({ relPosix, abs });
      }
    }
  }
  await recurse(rootReal);
  return out;
}

export function createContentAddressedSnapshotStore(
  options: ContentAddressedSnapshotStoreOptions,
): SnapshotStore {
  const storeDir = path.resolve(options.storeDir);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const baseIgnore = options.ignore ?? DEFAULT_IGNORE;
  const objectsDir = path.join(storeDir, "objects");
  const manifestsDir = path.join(storeDir, "manifests");

  /**
   * Ensure the store dirs exist and return the store's realpath. Realpath is
   * required so the auto-ignore computation compares in the same namespace as
   * the realpath'd workspace root (e.g. macOS `/var` -> `/private/var`);
   * otherwise the store dir fails to be ignored and gets captured/removed.
   */
  async function ensureStoreReal(): Promise<string> {
    await fs.mkdir(objectsDir, { recursive: true });
    await fs.mkdir(manifestsDir, { recursive: true });
    return await fs.realpath(storeDir);
  }

  async function writeBlobIfAbsent(sha: string, data: Buffer): Promise<void> {
    const rel = shardedBlobRelPath(sha);
    const abs = path.join(storeDir, rel);
    try {
      await fs.access(abs);
      return; // already stored (content-addressed → identical content)
    } catch {
      // not present; write it
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, abs).catch(async (err) => {
      await fs.rm(tmp, { force: true }).catch(() => {});
      // If a concurrent writer created it first, that's fine.
      try {
        await fs.access(abs);
        return;
      } catch {
        throw err;
      }
    });
  }

  async function readManifest(checkpointId: string): Promise<SnapshotManifest | undefined> {
    try {
      const raw = await fs.readFile(path.join(manifestsDir, `${checkpointId}.json`), "utf8");
      return JSON.parse(raw) as SnapshotManifest;
    } catch {
      return undefined;
    }
  }

  async function capture(input: {
    workspaceRoot: string;
    checkpointId: string;
  }): Promise<WorkspaceSnapshotRef> {
    const rootReal = await realpathOrThrow(input.workspaceRoot);
    const storeReal = await ensureStoreReal();
    const ignore = resolveIgnore(rootReal, storeReal, baseIgnore);
    const files = await walkFiles(rootReal, ignore);
    const entries: SnapshotManifestEntry[] = [];
    const skipped: SnapshotSkippedEntry[] = [];
    let byteCount = 0;

    for (const file of files) {
      try {
        const read = await readFileWithinRoot({
          rootDir: rootReal,
          relativePath: file.relPosix,
          rejectHardlinks: false,
          maxBytes: maxFileBytes,
        });
        const sha = crypto.createHash("sha256").update(read.buffer).digest("hex");
        await writeBlobIfAbsent(sha, read.buffer);
        entries.push({
          path: file.relPosix,
          sha256: sha,
          mode: read.stat.mode & 0o777,
          size: read.stat.size,
        });
        byteCount += read.stat.size;
      } catch (err) {
        if (err instanceof SafeOpenError && err.code === "too-large") {
          skipped.push({ path: file.relPosix, reason: "too-large" });
        } else {
          skipped.push({ path: file.relPosix, reason: "unreadable" });
        }
      }
    }

    entries.sort((a, b) => a.path.localeCompare(b.path));
    const manifest: SnapshotManifest = {
      version: 1,
      checkpointId: input.checkpointId,
      createdAt: new Date().toISOString(),
      entries,
      fileCount: entries.length,
      byteCount,
      skipped,
    };
    const manifestRel = path.posix.join("manifests", `${input.checkpointId}.json`);
    const manifestAbs = path.join(storeDir, manifestRel);
    const tmp = `${manifestAbs}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await fs.rename(tmp, manifestAbs);

    return {
      store: "content-addressed",
      manifestPath: manifestRel,
      checkpointId: input.checkpointId,
      fileCount: entries.length,
      byteCount,
    };
  }

  async function restore(input: {
    workspaceRoot: string;
    ref: WorkspaceSnapshotRef;
    signal?: AbortSignal;
  }): Promise<SnapshotRestoreResult> {
    if (input.ref.store !== "content-addressed" || !input.ref.checkpointId) {
      return { restoredFiles: 0, removedFiles: 0 };
    }
    throwIfSnapshotAborted(input.signal);
    const manifest = await readManifest(input.ref.checkpointId);
    if (!manifest) {
      throw new Error(`snapshot manifest not found for checkpoint ${input.ref.checkpointId}`);
    }
    const rootReal = await realpathOrThrow(input.workspaceRoot);
    return await withWorkspaceRestoreLock(rootReal, async () => {
      throwIfSnapshotAborted(input.signal);
      const storeReal = await ensureStoreReal();
      const ignore = resolveIgnore(rootReal, storeReal, [...baseIgnore, RESTORE_TXN_DIRNAME]);
      const current = await walkFiles(rootReal, ignore, input.signal);
      // Stage/backup inside the store dir when it shares the workspace's
      // filesystem (cheap atomic renames); otherwise fall back to a hidden,
      // ignored dir under the workspace root so renames never cross devices.
      const [storeStat, rootStat] = await Promise.all([fs.stat(storeReal), fs.stat(rootReal)]);
      const transactionParentDir =
        storeStat.dev === rootStat.dev
          ? path.join(storeReal, "txn")
          : path.join(rootReal, RESTORE_TXN_DIRNAME);
      const result = await runRestoreTransaction({
        rootReal,
        transactionParentDir,
        entries: manifest.entries,
        currentFiles: current,
        signal: input.signal,
        blobPath: (sha) => path.join(storeDir, shardedBlobRelPath(sha)),
        onMissingBlob: (entry) =>
          log.warn("snapshot blob missing during restore; keeping current file", {
            path: entry.path,
            sha: entry.sha256,
          }),
      });
      await removeEmptyDirs(rootReal, ignore);
      log.debug("snapshot restore done", {
        checkpointId: input.ref.checkpointId,
        ...result,
      });
      return result;
    });
  }

  async function prune(input: { keepCheckpointIds: string[] }): Promise<SnapshotPruneResult> {
    const keep = new Set(input.keepCheckpointIds);
    const referenced = new Set<string>();
    let removedManifests = 0;

    let manifestFiles: string[] = [];
    try {
      manifestFiles = (await fs.readdir(manifestsDir)).filter((n) => n.endsWith(".json"));
    } catch {
      return { removedBlobs: 0, removedManifests: 0 };
    }

    for (const file of manifestFiles) {
      const checkpointId = file.replace(/\.json$/u, "");
      if (keep.has(checkpointId)) {
        const manifest = await readManifest(checkpointId);
        for (const entry of manifest?.entries ?? []) {
          referenced.add(entry.sha256);
        }
      } else {
        await fs.rm(path.join(manifestsDir, file), { force: true }).catch(() => {});
        removedManifests += 1;
      }
    }

    let removedBlobs = 0;
    let shardDirs: string[] = [];
    try {
      shardDirs = await fs.readdir(objectsDir);
    } catch {
      return { removedBlobs: 0, removedManifests };
    }
    for (const shard of shardDirs) {
      const shardAbs = path.join(objectsDir, shard);
      let blobs: string[] = [];
      try {
        blobs = await fs.readdir(shardAbs);
      } catch {
        continue;
      }
      for (const sha of blobs) {
        if (!referenced.has(sha)) {
          await fs.rm(path.join(shardAbs, sha), { force: true }).catch(() => {});
          removedBlobs += 1;
        }
      }
    }
    return { removedBlobs, removedManifests };
  }

  return { capture, restore, prune };
}

/** Remove now-empty directories under root (post-restore cleanup), honoring ignore. */
async function removeEmptyDirs(rootReal: string, ignore: string[]): Promise<void> {
  async function recurse(absDir: string): Promise<boolean> {
    // Returns true if the directory is empty after processing children.
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return false;
    }
    let remaining = 0;
    for (const entry of entries) {
      const abs = path.join(absDir, entry.name);
      const relPosix = toPosix(path.relative(rootReal, abs));
      if (isIgnored(relPosix, ignore) || entry.isSymbolicLink()) {
        remaining += 1;
        continue;
      }
      if (entry.isDirectory()) {
        const emptied = await recurse(abs);
        if (emptied) {
          await fs.rmdir(abs).catch(() => {});
        } else {
          remaining += 1;
        }
      } else {
        remaining += 1;
      }
    }
    return remaining === 0;
  }
  await recurse(rootReal);
}
