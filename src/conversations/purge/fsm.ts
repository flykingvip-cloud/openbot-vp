/**
 * Purge FSM minimal executor (CL-P0-05).
 * Manifest must persist before any irreversible delete. Restart-safe via step records.
 */
import { createHash } from "node:crypto";
import { authorizeConversationAction } from "../acl.js";
import type { ConversationCatalogRepository } from "../catalog/repository.js";
import { createEtag, createPurgeJobId } from "../ids.js";
import type {
  ConversationPurgeJob,
  ConversationPurgeManifest,
  ConversationPurgeManifestObject,
  ConversationPurgeStep,
  ConversationPurgeStepName,
  ConversationRecord,
  ConversationTenantContext,
} from "../types.js";

export type PurgeManifestObject = ConversationPurgeManifestObject;
export type PurgeManifest = ConversationPurgeManifest;

export type PurgeStepAdapter = {
  name: ConversationPurgeStepName;
  /**
   * Execute one step. Must be idempotent for the same job + step.
   * CONTENT_DELETE is irreversible once it starts writing.
   */
  run: (ctx: {
    job: ConversationPurgeJob;
    record: ConversationRecord;
    manifest: PurgeManifest;
  }) => Promise<void>;
};

export type PurgeExecutorDeps = {
  catalog: ConversationCatalogRepository;
  adapters: PurgeStepAdapter[];
  /** Collect objects for the immutable manifest before any delete. */
  collectManifestObjects: (record: ConversationRecord) => Promise<PurgeManifestObject[]>;
  now?: () => string;
};

const STEP_ORDER: ConversationPurgeStepName[] = [
  "FREEZE",
  "MEMORY_REVOKE",
  "DERIVED_DELETE",
  "CONTENT_DELETE",
  "VERIFY",
];

/** Steps that cross the irreversible barrier (plan §5.7.1). FREEZE is reversible. */
export const IRREVERSIBLE_PURGE_STEPS: ReadonlySet<ConversationPurgeStepName> = new Set([
  "MEMORY_REVOKE",
  "DERIVED_DELETE",
  "CONTENT_DELETE",
]);

/** Canonical digest for purge manifest integrity (job.manifestDigest). */
export function computePurgeManifestDigest(manifest: PurgeManifest): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

function digestManifest(manifest: PurgeManifest): string {
  return computePurgeManifestDigest(manifest);
}

/**
 * Load and verify the immutable job.manifest. External manifests must never
 * drive deletes — only the durable snapshot on the job (re-checked via digest).
 */
export function resolveVerifiedJobManifest(job: ConversationPurgeJob): PurgeManifest {
  if (!job.manifest) {
    throw new Error("MANIFEST_MISSING: purge job has no immutable manifest snapshot");
  }
  const digest = computePurgeManifestDigest(job.manifest);
  if (digest !== job.manifestDigest) {
    throw new Error(
      `MANIFEST_DIGEST_MISMATCH: expected ${job.manifestDigest.slice(0, 12)}… got ${digest.slice(0, 12)}…`,
    );
  }
  return job.manifest;
}

function freshSteps(now: string): ConversationPurgeStep[] {
  return STEP_ORDER.map((name) => ({
    name,
    status: "PENDING" as const,
    attempts: 0,
    lastErrorCode: null,
    updatedAt: now,
  }));
}

export class PurgeBlockedError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PurgeBlockedError";
    this.code = code;
  }
}

/**
 * Start or resume a purge job. Same dataPlaneId + conversationId + requestId → same job.
 */
export async function requestConversationPurge(params: {
  catalog: ConversationCatalogRepository;
  ctx: ConversationTenantContext;
  conversationId: string;
  requestId: string;
  requestedBy?: string;
  collectManifestObjects: (record: ConversationRecord) => Promise<PurgeManifestObject[]>;
  now?: string;
}): Promise<{ job: ConversationPurgeJob; manifest: PurgeManifest }> {
  const now = params.now ?? new Date().toISOString();
  const existing = await params.catalog.findPurgeJobByRequestId(
    params.ctx.dataPlaneId,
    params.conversationId,
    params.requestId,
  );
  if (existing) {
    // Receipt replay — use immutable snapshot; never re-collect live objects.
    if (!existing.manifest) {
      throw new PurgeBlockedError(
        "MANIFEST_MISSING",
        "purge job has no immutable manifest snapshot; cannot safely resume",
      );
    }
    resolveVerifiedJobManifest(existing);
    // Complete provisional → frozen if crash left job without governance freeze.
    let job = existing;
    if (existing.status !== "SUCCEEDED" && existing.status !== "CANCELLED") {
      job = await completeGovernanceFreeze({
        catalog: params.catalog,
        job: existing,
        now,
      });
    }
    return { job, manifest: job.manifest! };
  }

  const record = await params.catalog.getConversation(
    params.ctx.dataPlaneId,
    params.conversationId,
  );
  if (!record) {
    throw new PurgeBlockedError("NOT_FOUND", "conversation not found");
  }

  const auth = authorizeConversationAction({
    ctx: params.ctx,
    record,
    action: "purge",
  });
  if (!auth.allowed) {
    throw new PurgeBlockedError(auth.reasonCode, "purge not authorized");
  }

  const holds = await params.catalog.listActiveLegalHolds(
    params.ctx.dataPlaneId,
    params.conversationId,
  );
  if (holds.length > 0 || record.retentionState === "LEGAL_HOLD") {
    throw new PurgeBlockedError("LEGAL_HOLD_BLOCKS_PURGE", "active legal hold blocks purge");
  }

  // Collect manifest in memory first.
  const objects = await params.collectManifestObjects(record);
  const manifest: PurgeManifest = {
    schemaVersion: 1,
    conversationId: params.conversationId,
    dataPlaneId: params.ctx.dataPlaneId,
    objects,
    createdAt: now,
  };
  const manifestDigest = digestManifest(manifest);

  // Snapshot retention from the live record BEFORE any freeze.
  // Never invent RETAIN when already PURGE_PENDING without a prior job snapshot
  // (orphan freeze is an operator error — still refuse to clobber unknown state).
  if (record.retentionState === "PURGE_PENDING") {
    throw new PurgeBlockedError(
      "PURGE_ALREADY_PENDING",
      "conversation already PURGE_PENDING without matching requestId job; refuse to invent prePurgeRetentionState",
    );
  }
  const prePurgeRetentionState = record.retentionState;

  // 1) Persist provisional job (not irreversible-executable) with prePurge + manifest.
  //    Crash here: no freeze, no job → safe retry.
  //    Crash after save, before freeze: provisional job preserves EXPIRING/etc.
  let job: ConversationPurgeJob = {
    schemaVersion: 1,
    purgeJobId: createPurgeJobId(),
    dataPlaneId: params.ctx.dataPlaneId,
    conversationId: params.conversationId,
    requestedBy: params.requestedBy ?? params.ctx.principalId,
    requestId: params.requestId,
    status: "PENDING",
    manifestDigest,
    manifest,
    prePurgeRetentionState,
    governanceFrozenAt: null, // provisional until FREEZE completes
    irreversibleStartedAt: null,
    steps: freshSteps(now),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  await params.catalog.savePurgeJob(job);

  // 2) FREEZE governance + mark job executable.
  job = await completeGovernanceFreeze({
    catalog: params.catalog,
    job,
    now,
  });

  return { job, manifest: job.manifest! };
}

/**
 * Apply PURGE_PENDING to the conversation and stamp governanceFrozenAt on the job.
 * Idempotent. Uses job.prePurgeRetentionState (never re-derived from PURGE_PENDING).
 */
async function completeGovernanceFreeze(params: {
  catalog: ConversationCatalogRepository;
  job: ConversationPurgeJob;
  now: string;
}): Promise<ConversationPurgeJob> {
  let job = params.job;
  const rec = await params.catalog.getConversation(job.dataPlaneId, job.conversationId);
  if (!rec) {
    throw new PurgeBlockedError("NOT_FOUND", "conversation not found during freeze");
  }
  if (rec.retentionState !== "PURGE_PENDING") {
    const frozen: ConversationRecord = {
      ...rec,
      retentionState: "PURGE_PENDING",
      updatedAt: params.now,
      etag: createEtag(),
    };
    await params.catalog.updateConversation(frozen, rec.etag);
  }
  if (!job.governanceFrozenAt) {
    job = {
      ...job,
      governanceFrozenAt: params.now,
      updatedAt: params.now,
    };
    await params.catalog.savePurgeJob(job);
  }
  return job;
}

/**
 * Run pending steps until success or first failure. Safe to call after crash.
 * Executes ONLY against job.manifest (re-verified via digest) — never an external manifest.
 */
export async function runPurgeJob(params: {
  deps: PurgeExecutorDeps;
  jobId: string;
  dataPlaneId: string;
  /** @deprecated Ignored. Manifest is always loaded from the durable job snapshot. */
  manifest?: PurgeManifest;
}): Promise<ConversationPurgeJob> {
  void params.manifest; // external manifests must not drive execution
  const now = () => params.deps.now?.() ?? new Date().toISOString();
  let job = await params.deps.catalog.getPurgeJob(params.dataPlaneId, params.jobId);
  if (!job) {
    throw new Error("purge job not found");
  }
  if (job.status === "SUCCEEDED" || job.status === "CANCELLED") {
    return job;
  }

  // Sole execution source: durable job.manifest + digest.
  const manifest = resolveVerifiedJobManifest(job);

  // Complete provisional freeze if needed (crash between provisional save and FREEZE).
  job = await completeGovernanceFreeze({
    catalog: params.deps.catalog,
    job,
    now: now(),
  });

  let record = await params.deps.catalog.getConversation(params.dataPlaneId, job.conversationId);
  if (!record) {
    throw new Error("conversation missing during purge");
  }
  if (record.retentionState !== "PURGE_PENDING") {
    throw new Error("PURGE_NOT_FROZEN: retentionState must be PURGE_PENDING before steps");
  }

  job = {
    ...job,
    status: "RUNNING",
    updatedAt: now(),
  };
  await params.deps.catalog.savePurgeJob(job);

  const adapterByName = new Map(params.deps.adapters.map((a) => [a.name, a]));

  for (let i = 0; i < job.steps.length; i++) {
    const step = job.steps[i];
    if (step.status === "SUCCEEDED") {
      continue;
    }

    // Hard gate: irreversible steps require FREEZE step succeeded + governance freeze.
    if (IRREVERSIBLE_PURGE_STEPS.has(step.name)) {
      if (!job.governanceFrozenAt) {
        job = {
          ...job,
          status: "FAILED_RETRYABLE",
          updatedAt: now(),
          steps: job.steps.map((s) =>
            s.name === step.name
              ? {
                  ...s,
                  status: "FAILED",
                  lastErrorCode: "GOVERNANCE_FREEZE_INCOMPLETE",
                  updatedAt: now(),
                }
              : s,
          ),
        };
        await params.deps.catalog.savePurgeJob(job);
        return job;
      }
      const freezeStep = job.steps.find((s) => s.name === "FREEZE");
      if (freezeStep && freezeStep.status !== "SUCCEEDED") {
        if (freezeStep.status === "FAILED" || freezeStep.status === "PENDING") {
          if (step.name !== "FREEZE") {
            job = {
              ...job,
              status: "FAILED_RETRYABLE",
              updatedAt: now(),
              steps: job.steps.map((s) =>
                s.name === step.name
                  ? {
                      ...s,
                      status: "FAILED",
                      lastErrorCode: "FREEZE_INCOMPLETE",
                      updatedAt: now(),
                    }
                  : s,
              ),
            };
            await params.deps.catalog.savePurgeJob(job);
            return job;
          }
        }
      }
      const live = await params.deps.catalog.getConversation(
        params.dataPlaneId,
        job.conversationId,
      );
      if (!live || live.retentionState !== "PURGE_PENDING") {
        job = {
          ...job,
          status: "FAILED_RETRYABLE",
          updatedAt: now(),
          steps: job.steps.map((s) =>
            s.name === step.name
              ? {
                  ...s,
                  status: "FAILED",
                  lastErrorCode: "PURGE_NOT_FROZEN",
                  updatedAt: now(),
                }
              : s,
          ),
        };
        await params.deps.catalog.savePurgeJob(job);
        return job;
      }
      record = live;
    }

    const adapter = adapterByName.get(step.name);
    if (!adapter) {
      job.steps[i] = {
        ...step,
        status: "FAILED",
        attempts: step.attempts + 1,
        lastErrorCode: "ADAPTER_MISSING",
        updatedAt: now(),
      };
      job = {
        ...job,
        status: "FAILED_RETRYABLE",
        updatedAt: now(),
      };
      await params.deps.catalog.savePurgeJob(job);
      return job;
    }

    job.steps[i] = {
      ...step,
      status: "RUNNING",
      attempts: step.attempts + 1,
      lastErrorCode: null,
      updatedAt: now(),
    };
    // Barrier before first irreversible step (MEMORY_REVOKE / purgeSource), not only CONTENT_DELETE.
    if (IRREVERSIBLE_PURGE_STEPS.has(step.name) && !job.irreversibleStartedAt) {
      job = { ...job, irreversibleStartedAt: now(), steps: [...job.steps], updatedAt: now() };
    } else {
      job = { ...job, steps: [...job.steps], updatedAt: now() };
    }
    await params.deps.catalog.savePurgeJob(job);

    try {
      // Always pass verified job.manifest — never caller-supplied.
      await adapter.run({ job, record, manifest });
      job.steps[i] = {
        ...job.steps[i],
        status: "SUCCEEDED",
        lastErrorCode: null,
        updatedAt: now(),
      };
      job = { ...job, steps: [...job.steps], updatedAt: now() };
      await params.deps.catalog.savePurgeJob(job);
    } catch (err) {
      const code = err instanceof Error ? err.message.slice(0, 64) : "STEP_FAILED";
      job.steps[i] = {
        ...job.steps[i],
        status: "FAILED",
        lastErrorCode: code,
        updatedAt: now(),
      };
      job = {
        ...job,
        status: "FAILED_RETRYABLE",
        steps: [...job.steps],
        updatedAt: now(),
      };
      await params.deps.catalog.savePurgeJob(job);
      return job;
    }
  }

  // Mark conversation DELETED (minimal tombstone fields retained on record).
  // Catalog write failure must NOT yield SUCCEEDED (plan §8.4 / VERIFY consistency).
  const expectedEtag = record.etag;
  const deleted: ConversationRecord = {
    ...record,
    lifecycleStatus: "DELETED",
    retentionState: "PURGE_PENDING",
    deletedAt: now(),
    updatedAt: now(),
    etag: createEtag(),
    title: record.title,
    messageCount: 0,
  };
  try {
    await params.deps.catalog.updateConversation(deleted, expectedEtag);
  } catch (err) {
    const code = err instanceof Error ? err.message.slice(0, 64) : "CATALOG_DELETE_FAILED";
    job = {
      ...job,
      status: "FAILED_RETRYABLE",
      updatedAt: now(),
      steps: [
        ...job.steps,
        // keep last step as-is; surface catalog failure on job status
      ],
    };
    // Annotate VERIFY-like failure for operators
    const last = job.steps[job.steps.length - 1];
    if (last) {
      job.steps[job.steps.length - 1] = {
        ...last,
        lastErrorCode: `CATALOG_TOMBSTONE:${code}`,
        updatedAt: now(),
      };
    }
    await params.deps.catalog.savePurgeJob(job);
    return job;
  }

  job = {
    ...job,
    status: "SUCCEEDED",
    completedAt: now(),
    updatedAt: now(),
  };
  await params.deps.catalog.savePurgeJob(job);
  return job;
}

/** In-memory / test adapters that no-op but record progress. */
export function createNoopPurgeAdapters(log?: string[]): PurgeStepAdapter[] {
  return STEP_ORDER.map((name) => ({
    name,
    run: async () => {
      log?.push(name);
    },
  }));
}

export class PurgeCancelError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PurgeCancelError";
    this.code = code;
  }
}

/**
 * Cancel a purge job only when irreversibleStartedAt is still null and no
 * irreversible step has SUCCEEDED (plan §5.7.1 / B4 / B5).
 */
export async function cancelPurgeJob(params: {
  catalog: ConversationCatalogRepository;
  dataPlaneId: string;
  jobId: string;
  /** Override pre-purge retention (default: job.prePurgeRetentionState, else RETAIN). */
  restoreRetentionState?: ConversationRecord["retentionState"];
  now?: string;
}): Promise<ConversationPurgeJob> {
  const now = params.now ?? new Date().toISOString();
  const job = await params.catalog.getPurgeJob(params.dataPlaneId, params.jobId);
  if (!job) {
    throw new PurgeCancelError("NOT_FOUND", "purge job not found");
  }
  if (job.status === "SUCCEEDED" || job.status === "CANCELLED") {
    return job;
  }
  if (job.irreversibleStartedAt != null) {
    throw new PurgeCancelError(
      "PURGE_IRREVERSIBLE",
      "irreversibleStartedAt set; cancel forbidden — retry to terminal state",
    );
  }
  const irreversibleDone = job.steps.some(
    (s) => IRREVERSIBLE_PURGE_STEPS.has(s.name) && s.status === "SUCCEEDED",
  );
  if (irreversibleDone) {
    throw new PurgeCancelError(
      "PURGE_IRREVERSIBLE",
      "irreversible step already succeeded; cancel forbidden",
    );
  }

  const cancelled: ConversationPurgeJob = {
    ...job,
    status: "CANCELLED",
    updatedAt: now,
    completedAt: now,
  };
  await params.catalog.savePurgeJob(cancelled);

  const restoreRetention: ConversationRecord["retentionState"] =
    params.restoreRetentionState ?? job.prePurgeRetentionState ?? "RETAIN";
  // Never restore to PURGE_PENDING after cancel.
  const safeRetention = restoreRetention === "PURGE_PENDING" ? "RETAIN" : restoreRetention;

  const record = await params.catalog.getConversation(params.dataPlaneId, job.conversationId);
  if (record && record.retentionState === "PURGE_PENDING") {
    const restored: ConversationRecord = {
      ...record,
      retentionState: safeRetention,
      updatedAt: now,
      etag: createEtag(),
    };
    try {
      await params.catalog.updateConversation(restored, record.etag);
    } catch {
      // concurrent etag — operator reconcile
    }
  }
  return cancelled;
}
