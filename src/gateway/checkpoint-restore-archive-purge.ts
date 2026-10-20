/**
 * Purge aged chat-checkpoint-rollback transcript tail archives.
 *
 * Restore keeps the truncated tail under `<transcript>.jsonl.archive/<checkpointId>.jsonl`
 * for short-term reversibility. After CHECKPOINT_RESTORE_ARCHIVE_RETENTION_MS the
 * archive is deleted automatically (no UI confirm) so disk does not grow unbounded.
 *
 * Age basis: file mtime (archives have no timestamp in the filename).
 */

import fs from "node:fs/promises";
import path from "node:path";

/** Default retention for checkpoint-restore transcript archives: 7 days. */
export const CHECKPOINT_RESTORE_ARCHIVE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const ARCHIVE_DIR_SUFFIX = ".jsonl.archive";

export type CheckpointRestoreArchivePurgeResult = {
  scannedDirs: number;
  scannedFiles: number;
  removedFiles: number;
  removedEmptyDirs: number;
};

function isCheckpointRestoreArchiveDirName(name: string): boolean {
  return name.endsWith(ARCHIVE_DIR_SUFFIX);
}

/**
 * Delete checkpoint-restore archive files older than `olderThanMs` under the
 * given session directories (looks for sibling `*.jsonl.archive/` folders).
 */
export async function purgeCheckpointRestoreArchives(opts: {
  directories: string[];
  olderThanMs?: number;
  nowMs?: number;
}): Promise<CheckpointRestoreArchivePurgeResult> {
  const olderThanMs = opts.olderThanMs ?? CHECKPOINT_RESTORE_ARCHIVE_RETENTION_MS;
  if (!Number.isFinite(olderThanMs) || olderThanMs < 0) {
    return { scannedDirs: 0, scannedFiles: 0, removedFiles: 0, removedEmptyDirs: 0 };
  }
  const now = opts.nowMs ?? Date.now();
  const roots = Array.from(new Set(opts.directories.map((dir) => path.resolve(dir))));
  let scannedDirs = 0;
  let scannedFiles = 0;
  let removedFiles = 0;
  let removedEmptyDirs = 0;

  for (const root of roots) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || !isCheckpointRestoreArchiveDirName(entry.name)) {
        continue;
      }
      scannedDirs += 1;
      const archiveDir = path.join(root, entry.name);
      const files = await fs.readdir(archiveDir, { withFileTypes: true }).catch(() => []);
      for (const file of files) {
        if (!file.isFile()) {
          continue;
        }
        scannedFiles += 1;
        const fullPath = path.join(archiveDir, file.name);
        const stat = await fs.stat(fullPath).catch(() => null);
        if (!stat) {
          continue;
        }
        if (now - stat.mtimeMs <= olderThanMs) {
          continue;
        }
        await fs.rm(fullPath).catch(() => undefined);
        removedFiles += 1;
      }
      const remaining = await fs.readdir(archiveDir).catch(() => ["_"]);
      if (remaining.length === 0) {
        await fs.rmdir(archiveDir).catch(() => undefined);
        removedEmptyDirs += 1;
      }
    }
  }

  return { scannedDirs, scannedFiles, removedFiles, removedEmptyDirs };
}
