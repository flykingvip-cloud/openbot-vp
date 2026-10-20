import fs from "node:fs";
import path from "node:path";
import { digestWorkspaceTree, verifiedCopyStewardWorkspace } from "./steward-write.js";

/**
 * Safe steward cutover materialization (Stage B P0-2 hardening).
 *
 * The prior implementation copied straight into the final target root and left a partial/incorrect
 * target behind on digest mismatch or a thrown `cpSync`. This module makes materialization all-or-nothing:
 *  - copy into an operation-scoped STAGING root (never the live target),
 *  - hash-verify staging against source,
 *  - atomically publish via `rename(staging -> target)` (atomic on one filesystem),
 *  - re-verify the published target digest,
 *  - on ANY failure, move the partial artifact into a QUARANTINE root and report its residual path,
 *    so a half-copied directory is never exposed as a normal target binding.
 *
 * Fencing (one operation at a time per resource) is enforced by the caller via the cutover store; the
 * staging/quarantine roots are derived from the operation id so concurrent operations cannot collide.
 */

export type StewardMaterializeInput = {
  sourceRoot: string;
  targetRoot: string;
  /** Operation-scoped staging root (never the live target). */
  stagingRoot: string;
  /** Operation-scoped quarantine root for partial artifacts on failure. */
  quarantineRoot: string;
};

export type StewardMaterializeReason =
  | "mkdir_source_failed"
  | "target_exists"
  | "copy_failed"
  | "digest_mismatch"
  | "publish_failed"
  | "post_publish_digest_mismatch";

export type StewardMaterializeResult =
  | { ok: true; digest: string; published: string; stagingRoot: string }
  | { ok: false; reason: StewardMaterializeReason; residualPath: string | null };

/** Move a partial artifact aside for operator recovery; report where it ended up (or null if gone). */
function quarantinePartial(from: string, to: string): string | null {
  try {
    if (!fs.existsSync(from)) {
      return null;
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    return to;
  } catch {
    // Could not move it; report the original location so recovery still has the residual path.
    return fs.existsSync(from) ? from : null;
  }
}

/**
 * Materialize source -> target with staging + atomic publish + quarantine. Never clobbers an
 * already-published target and never leaves a partial target as a "successful" asset.
 */
export function materializeStewardCutover(
  input: StewardMaterializeInput,
): StewardMaterializeResult {
  const { sourceRoot, targetRoot, stagingRoot, quarantineRoot } = input;

  // 1. Ensure the source exists (an empty source is legal; the digest check covers content).
  try {
    fs.mkdirSync(sourceRoot, { recursive: true });
  } catch {
    return { ok: false, reason: "mkdir_source_failed", residualPath: null };
  }

  // 2. Never clobber an already-published target; atomic publish requires an absent target.
  if (fs.existsSync(targetRoot)) {
    return { ok: false, reason: "target_exists", residualPath: null };
  }

  // 3. Clear any stale staging left by a previously aborted run.
  try {
    if (fs.existsSync(stagingRoot)) {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  } catch {
    // Fall through: the copy below will fail closed if staging is unusable.
  }

  // 4. Copy source -> operation-scoped staging (never straight into the live target).
  const copy = verifiedCopyStewardWorkspace({ sourceRoot, targetRoot: stagingRoot });
  if (!copy.ok) {
    const residualPath = quarantinePartial(stagingRoot, quarantineRoot);
    const reason: StewardMaterializeReason =
      copy.reason === "digest_mismatch" ? "digest_mismatch" : "copy_failed";
    return { ok: false, reason, residualPath };
  }

  // 5. Atomic publish: rename staging -> target.
  try {
    fs.renameSync(stagingRoot, targetRoot);
  } catch {
    const residualPath = quarantinePartial(stagingRoot, quarantineRoot);
    return { ok: false, reason: "publish_failed", residualPath };
  }

  // 6. Re-verify the published target matches the copied digest.
  if (digestWorkspaceTree(targetRoot) !== copy.digest) {
    const residualPath = quarantinePartial(targetRoot, quarantineRoot);
    return { ok: false, reason: "post_publish_digest_mismatch", residualPath };
  }

  return { ok: true, digest: copy.digest, published: targetRoot, stagingRoot };
}
