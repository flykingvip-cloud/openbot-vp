import { commitStagedTenantImport, verifyStagedTenantImport } from "./commit.js";
import { applyContentIdRewriteToStaging, flattenRemapPlanToIdMap } from "./content-rewrite.js";
import type { IdRemapPlan } from "./id-remap.js";
import type { TenantImportManifest } from "./manifest.js";
import { preflightTenantImportArchive } from "./preflight.js";
import { stageTenantImportPackage } from "./stage.js";

/**
 * tenant-import local job engine (SaaS tenant data architecture §6.2 / §12.6).
 *
 * Ties the local pipeline into one callable, phase-aware operation:
 *   preflight → stage → content-rewrite → verify → commit
 *
 * §12.6 safety is structural: preflight/stage/content-rewrite/verify only ever touch the isolated
 * staging dir, so any failure before commit leaves the live tenant tree untouched (no rollback
 * needed). Only the final commit writes into `tenantLiveRoot`. The caller supplies the already
 * resolved {@link IdRemapPlan} (built from the package's source ids + the target tenant's existing
 * users/agents); this engine stays store-agnostic. The platform `platform.tenant.import.*` RPC
 * wraps this with provisioning, an async job record, and idempotency.
 */

export type TenantImportPhase = "preflight" | "stage" | "verify" | "commit" | "done";

export type LocalTenantImportResult = {
  ok: boolean;
  /** The phase reached. On failure, the phase that failed; on success, `done`. */
  phase: TenantImportPhase;
  errors: string[];
  manifest?: TenantImportManifest;
  committedFiles: number;
  stats: { stagedFiles: number; rewrittenFiles: number };
};

export async function runLocalTenantImport(input: {
  buffer?: Buffer;
  archivePath?: string;
  jobTargetTenantId: string;
  plan: IdRemapPlan;
  stagingRoot: string;
  tenantLiveRoot: string;
}): Promise<LocalTenantImportResult> {
  const base = { committedFiles: 0, stats: { stagedFiles: 0, rewrittenFiles: 0 } };

  // 1) preflight — manifest + target match + secret scan + zip-slip. No writes.
  const preflight = await preflightTenantImportArchive({
    buffer: input.buffer,
    archivePath: input.archivePath,
    jobTargetTenantId: input.jobTargetTenantId,
  });
  if (!preflight.ok) {
    return {
      ...base,
      ok: false,
      phase: "preflight",
      errors: [
        ...preflight.errors,
        ...preflight.secretFindings.map((f) => `secret:${f.rule}@${f.path}`),
      ],
    };
  }

  // 2) stage — extract into isolated staging with id-keyed path rewrite (§10.3). No live writes.
  const staged = await stageTenantImportPackage({
    buffer: input.buffer,
    archivePath: input.archivePath,
    plan: input.plan,
    stagingRoot: input.stagingRoot,
  });

  // 3) content rewrite — id references inside staged JSON (§10 reference fixup).
  const rewrite = await applyContentIdRewriteToStaging({
    stagedRoot: input.stagingRoot,
    idMap: flattenRemapPlanToIdMap(input.plan),
  });

  const stats = { stagedFiles: staged.fileCount, rewrittenFiles: rewrite.filesRewritten };

  // 4) verify — no residual source-machine absolute paths (§10.3). Failure discards staging.
  const verify = await verifyStagedTenantImport(input.stagingRoot);
  if (!verify.ok) {
    return {
      ...base,
      ok: false,
      phase: "verify",
      errors: verify.errors,
      manifest: preflight.manifest,
      stats,
    };
  }

  // 5) commit — merge staged tree into the live tenant tree (last, side-effectful phase).
  const commit = await commitStagedTenantImport({
    stagedRoot: input.stagingRoot,
    tenantLiveRoot: input.tenantLiveRoot,
  });

  return {
    ok: true,
    phase: "done",
    errors: [],
    manifest: preflight.manifest,
    committedFiles: commit.committedFiles,
    stats,
  };
}
