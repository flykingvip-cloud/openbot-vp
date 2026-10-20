/**
 * Shared types for the workspace snapshot store (chat-checkpoint-rollback P1).
 *
 * A snapshot captures the full set of regular files under a workspace root at a
 * point in time, using a content-addressed blob store so identical content is
 * stored once. Restoring a snapshot makes the workspace tree match the manifest
 * exactly (files created afterwards are removed, modified files reverted, and
 * deleted files recreated) — always constrained to the workspace root.
 */

/** One file recorded in a snapshot manifest (path is workspace-root-relative, posix). */
export type SnapshotManifestEntry = {
  path: string;
  sha256: string;
  /** POSIX mode bits (`stat.mode & 0o777`). Best-effort on Windows. */
  mode: number;
  size: number;
};

/** A file that was intentionally not captured (e.g. too large), for transparency. */
export type SnapshotSkippedEntry = {
  path: string;
  reason: "too-large" | "unreadable";
};

/** Full manifest for one checkpoint. Entries represent the complete captured tree. */
export type SnapshotManifest = {
  version: 1;
  checkpointId: string;
  createdAt: string;
  entries: SnapshotManifestEntry[];
  fileCount: number;
  byteCount: number;
  skipped: SnapshotSkippedEntry[];
};

/** Reference persisted on a checkpoint so it can later be restored. */
export type WorkspaceSnapshotRef = {
  store: "content-addressed" | "none";
  /** Manifest path relative to the snapshot store dir, e.g. `manifests/<id>.json`. */
  manifestPath?: string;
  checkpointId?: string;
  fileCount?: number;
  byteCount?: number;
};

export type SnapshotCaptureInput = {
  /** Absolute path to the agent workspace root; only files under it are captured. */
  workspaceRoot: string;
  /** Stable checkpoint id this snapshot belongs to (used as the manifest name). */
  checkpointId: string;
};

export type SnapshotRestoreResult = {
  /** Files actually (re)written because they differed from the checkpoint. */
  restoredFiles: number;
  /** Files present now but absent from the checkpoint that were removed. */
  removedFiles: number;
  /** Files skipped because size + sha256 already matched the checkpoint. */
  unchangedFiles?: number;
  /** Files left as-is because their snapshot blob was missing. */
  skippedFiles?: number;
  durationMs?: number;
};

export type SnapshotPruneResult = {
  removedBlobs: number;
  removedManifests: number;
};

export interface SnapshotStore {
  /** Capture the current workspace tree as a snapshot for `checkpointId`. */
  capture(input: SnapshotCaptureInput): Promise<WorkspaceSnapshotRef>;
  /** Restore the workspace tree to match the snapshot referenced by `ref`. */
  restore(input: {
    workspaceRoot: string;
    ref: WorkspaceSnapshotRef;
    /** Aborts cooperative reads before any workspace mutation. */
    signal?: AbortSignal;
  }): Promise<SnapshotRestoreResult>;
  /** Drop blobs/manifests not referenced by any of `keepCheckpointIds`. */
  prune(input: { keepCheckpointIds: string[] }): Promise<SnapshotPruneResult>;
}
