/**
 * Item 7 Stage D — local-only staging → verify → atomic-publish adapter.
 *
 * Implements the existing `StageDSyncAdapter` port (from item7-stage-d-memory-sync.ts)
 * for the `local-only` / `device` custodian ONLY. Every non-local mode
 * (encrypted-cloud / tenant-cloud / dedicated / byos / cold-archive), any network
 * upload, and any caller-supplied destination path are refused. Destinations live
 * under a CONTROLLED root (`resolveStateDir()/data-governance/stage-d-local`),
 * keyed by a validated operationId — never an arbitrary wire path.
 *
 * copy() flow: operation-scoped staging → write source content → recompute the
 * staging manifest hash from the bytes actually written → verify it equals the
 * source manifest → atomically publish (rename) staging → controlled destination.
 * On ANY failure: staging is left QUARANTINED (not deleted), no destination is
 * published, an already-published version is never overwritten (no double-write),
 * and there is no fallback to a legacy host path. It returns a partial-failure so
 * the caller records recovery_required and halts.
 *
 * This module performs NO cloud/BYOS I/O and does not touch production sync.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { assertSafeRecoveryReceiptToken } from "../gateway/data-governance/recovery-receipt.js";
import {
  computeStageDManifest,
  type StageDAdapterCopyResult,
  type StageDDestinationMode,
  type StageDManifest,
  type StageDSourceFile,
  type StageDSyncAdapter,
} from "./item7-stage-d-memory-sync.js";

export const STAGE_D_LOCAL_ADAPTER = "item7-stage-d-local-adapter/v1" as const;
const ADAPTER_SUBDIR = "stage-d-local";

/** Test-only fault injection to exercise the failure/recovery paths. Never set
 * in production wiring; the default adapter injects nothing. */
export type StageDLocalAdapterFaults = {
  throwOnCopy?: boolean;
  /** Tamper the staged bytes after writing so the staging-verify hash mismatches. */
  corruptStaging?: boolean;
  /** Make the atomic publish (rename) fail, leaving staging quarantined. */
  failPublish?: boolean;
};

export type StageDLocalAdapter = StageDSyncAdapter & {
  readonly root: string;
  stagingPathFor(operationId: string): string;
  publishedPathFor(operationId: string): string;
  isPublished(operationId: string): boolean;
  hasResidualStaging(operationId: string): boolean;
};

/** Reject absolute paths and `..` escapes in a source-relative path. */
function assertSafeRelPath(relPath: string): string {
  const normalized = path.normalize(relPath);
  if (path.isAbsolute(normalized) || normalized.split(path.sep).includes("..")) {
    throw new Error(`unsafe_source_relpath:${relPath}`);
  }
  return normalized;
}

function toBytes(content: Uint8Array | string): Buffer {
  return typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
}

export function createLocalOnlyStagingAdapter(
  opts: { stateDir?: string; faults?: StageDLocalAdapterFaults } = {},
): StageDLocalAdapter {
  const root = path.join(
    path.resolve(opts.stateDir ?? resolveStateDir()),
    "data-governance",
    ADAPTER_SUBDIR,
  );
  const faults = opts.faults ?? {};

  const stagingPathFor = (operationId: string): string =>
    path.join(root, "staging", assertSafeRecoveryReceiptToken(operationId, "operationId"));
  const publishedPathFor = (operationId: string): string =>
    path.join(root, "published", assertSafeRecoveryReceiptToken(operationId, "operationId"));

  /** Recompute the manifest from the bytes actually staged on disk (genuine
   * post-copy verification, not a trust of the input manifest). */
  function stagedManifest(stagingDir: string, files: readonly StageDSourceFile[]): StageDManifest {
    const readBack: StageDSourceFile[] = files.map((file) => {
      const rel = assertSafeRelPath(file.path);
      const bytes = fs.readFileSync(path.join(stagingDir, rel));
      return { path: file.path, content: new Uint8Array(bytes) };
    });
    return computeStageDManifest(readBack);
  }

  return {
    root,
    custodian: "device",

    supportsMode(mode: StageDDestinationMode): boolean {
      // Local-only device custodian: every other mode is refused here.
      return mode === "local-only";
    },

    stagingPathFor,
    publishedPathFor,
    isPublished(operationId: string): boolean {
      return fs.existsSync(publishedPathFor(operationId));
    },
    hasResidualStaging(operationId: string): boolean {
      return fs.existsSync(stagingPathFor(operationId));
    },

    async copy({ operationId, manifest, files }): Promise<StageDAdapterCopyResult> {
      const stagingDir = stagingPathFor(operationId);
      const publishedDir = publishedPathFor(operationId);

      // (12) No double-write: never overwrite an already-published version.
      if (fs.existsSync(publishedDir)) {
        return { ok: false, partial: false, error: "already_published_no_overwrite" };
      }

      try {
        if (faults.throwOnCopy) {
          throw new Error("injected_copy_failure");
        }
        // Fresh operation-scoped staging (clears any prior partial staging).
        fs.rmSync(stagingDir, { recursive: true, force: true });
        fs.mkdirSync(stagingDir, { recursive: true });

        for (const file of files) {
          const rel = assertSafeRelPath(file.path);
          const dest = path.join(stagingDir, rel);
          const escapeCheck = path.relative(stagingDir, dest);
          if (escapeCheck.startsWith("..") || path.isAbsolute(escapeCheck)) {
            throw new Error(`staging_path_escape:${file.path}`);
          }
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, toBytes(file.content), { mode: 0o600 });
        }

        if (faults.corruptStaging) {
          // Simulate media corruption between write and verify.
          const first = files[0];
          if (first) {
            fs.writeFileSync(path.join(stagingDir, assertSafeRelPath(first.path)), "CORRUPTED", {
              mode: 0o600,
            });
          }
        }

        // Verify staging hash against the source manifest BEFORE publishing.
        const staged = stagedManifest(stagingDir, files);
        if (staged.manifestSha256 !== manifest.manifestSha256) {
          // Leave staging quarantined for recovery inspection; do not publish.
          return {
            ok: false,
            partial: true,
            error: `staging_hash_mismatch expected=${manifest.manifestSha256} staged=${staged.manifestSha256}`,
          };
        }

        if (faults.failPublish) {
          throw new Error("injected_publish_failure");
        }

        // (10) Atomic publish: rename is atomic on the same filesystem.
        fs.mkdirSync(path.dirname(publishedDir), { recursive: true });
        fs.renameSync(stagingDir, publishedDir);

        return { ok: true, writtenSha256: manifest.manifestSha256 };
      } catch (err) {
        // Any failure: staging is left in place (quarantined), nothing published.
        return {
          ok: false,
          partial: true,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
