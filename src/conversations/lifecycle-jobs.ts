/**
 * Durable archive/restore jobs (plan §6.3 / CL-P1-01).
 * Concurrent same-requestId calls use atomic claim + lease (no double-execute).
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { authorizeConversationAction } from "./acl.js";
import { createLifecycleJobId, toArchiveArtifactId } from "./ids.js";
import {
  archiveConversation,
  getOrOpenCatalog,
  type ConversationServiceDeps,
  restoreConversation,
} from "./service.js";
import type {
  ConversationLifecycleBindingStep,
  ConversationLifecycleJob,
  ConversationSessionBinding,
} from "./types.js";

/** Default lease for an in-flight archive/restore execution. */
export const LIFECYCLE_JOB_LEASE_MS = 60_000;

/**
 * Test-only hook: invoked after claim, before work. Used to force concurrent
 * callers to observe an active lease (do not set in production).
 */
export const __testHooks: {
  afterClaim: (() => Promise<void>) | null;
} = { afterClaim: null };

function withCatalog(deps: ConversationServiceDeps): ConversationServiceDeps & {
  catalog: NonNullable<ConversationServiceDeps["catalog"]>;
} {
  const catalog = deps.catalog ?? getOrOpenCatalog(deps.cfg, deps.ctx, { dataRoot: deps.dataRoot });
  return { ...deps, catalog };
}

async function sha256File(filePath: string): Promise<{ checksum: string; bytes: number }> {
  const buf = await fs.readFile(filePath);
  return {
    checksum: createHash("sha256").update(buf).digest("hex"),
    bytes: buf.length,
  };
}

export type LifecycleJobResult = {
  job: ConversationLifecycleJob;
  record: Awaited<ReturnType<typeof archiveConversation>>["record"] | null;
  binding: ConversationSessionBinding | null;
  artifactId: string | null;
  checksum: string | null;
  bytes: number | null;
  /** True when this call owns execution; false when observing in-flight or terminal job. */
  claimed: boolean;
};

export class LifecycleIdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "LifecycleIdempotencyConflictError";
  }
}

/**
 * Resolve user-visible primary binding for job receipts / restore sessionKey.
 * Never prefer AGENT_EXECUTION merely because it appears first in bindingSteps
 * (unordered list or step order could leak private execution streams).
 */
function primaryFromJob(
  job: ConversationLifecycleJob,
  bindings: ConversationSessionBinding[],
  recordPrimaryId: string | null | undefined,
): ConversationSessionBinding | null {
  // 1) Catalog primary id (authoritative).
  if (recordPrimaryId) {
    const byId = bindings.find((b) => b.bindingId === recordPrimaryId);
    if (byId) {
      return byId;
    }
  }
  // 2) User-visible roles (PRIMARY / GROUP_PUBLIC) — never AGENT_EXECUTION first.
  const visible = bindings.find((b) => b.role === "PRIMARY" || b.role === "GROUP_PUBLIC");
  if (visible) {
    return visible;
  }
  // 3) Fallback: successful step only when no main binding exists (legacy / single stream).
  const primaryStep =
    job.bindingSteps.find((s) => s.status === "SUCCEEDED" && s.checksum) ??
    job.bindingSteps.find((s) => s.status === "SUCCEEDED");
  if (primaryStep) {
    return (
      bindings.find((b) => b.bindingId === primaryStep.bindingId) ??
      bindings.find((b) => b.sessionId === primaryStep.sessionId) ??
      null
    );
  }
  return bindings[0] ?? null;
}

/** Exported for unit tests (unordered binding regression). */
export function resolvePrimaryBindingForJobReceipt(
  job: ConversationLifecycleJob,
  bindings: ConversationSessionBinding[],
  recordPrimaryId: string | null | undefined,
): ConversationSessionBinding | null {
  return primaryFromJob(job, bindings, recordPrimaryId);
}

function leaseExpiry(nowIso: string, leaseMs = LIFECYCLE_JOB_LEASE_MS): string {
  return new Date(Date.parse(nowIso) + leaseMs).toISOString();
}

function isLeaseActive(job: ConversationLifecycleJob, nowIso: string): boolean {
  if (job.status !== "RUNNING") {
    return false;
  }
  if (!job.leaseExpiresAt) {
    return false;
  }
  return job.leaseExpiresAt >= nowIso;
}

function emptyJobFields(params: {
  jobId: string;
  kind: "archive" | "restore";
  dataPlaneId: string;
  conversationId: string;
  requestId: string;
  requestedBy: string;
  etagAtStart: string | null;
  targetLifecycle: "ACTIVE" | "CLOSED" | null;
  now: string;
}): ConversationLifecycleJob {
  return {
    schemaVersion: 1,
    jobId: params.jobId,
    kind: params.kind,
    dataPlaneId: params.dataPlaneId,
    conversationId: params.conversationId,
    requestId: params.requestId,
    requestedBy: params.requestedBy,
    status: "PENDING",
    etagAtStart: params.etagAtStart,
    targetLifecycle: params.targetLifecycle,
    bindingSteps: [],
    resultChecksum: null,
    resultArtifactId: null,
    resultBytes: null,
    lastErrorCode: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    claimGeneration: 0,
    createdAt: params.now,
    updatedAt: params.now,
    completedAt: null,
  };
}

async function materializeResult(
  catalog: NonNullable<ConversationServiceDeps["catalog"]>,
  dataPlaneId: string,
  job: ConversationLifecycleJob,
  claimed: boolean,
): Promise<LifecycleJobResult> {
  const record = await catalog.getConversation(dataPlaneId, job.conversationId);
  const bindings = await catalog.listBindings(dataPlaneId, job.conversationId);
  const primary = primaryFromJob(job, bindings, record?.primaryBindingId);
  return {
    job,
    record,
    binding: primary,
    artifactId: job.resultArtifactId,
    checksum: job.resultChecksum,
    bytes: job.resultBytes,
    claimed,
  };
}

/**
 * Ensure job row exists, then atomically claim execution lease.
 * - SUCCEEDED → return as-is (no claim)
 * - RUNNING + active lease → return as-is (no re-execute)
 * - PENDING | FAILED_RETRYABLE | expired RUNNING → CAS claim
 */
async function ensureAndClaimJob(params: {
  catalog: NonNullable<ConversationServiceDeps["catalog"]>;
  deps: ConversationServiceDeps;
  kind: "archive" | "restore";
  conversationId: string;
  requestId: string;
  etag?: string;
  targetLifecycle?: "ACTIVE" | "CLOSED" | null;
  now: string;
}): Promise<
  | { mode: "terminal" | "inflight"; result: LifecycleJobResult }
  | { mode: "execute"; job: ConversationLifecycleJob; isFirstCreate: boolean }
> {
  const { catalog, deps, kind, conversationId, requestId, now } = params;
  const dataPlaneId = deps.ctx.dataPlaneId;
  let existing = await catalog.findLifecycleJobByRequestId(dataPlaneId, conversationId, requestId);

  if (existing && existing.kind !== kind) {
    throw new LifecycleIdempotencyConflictError(
      `requestId already used for kind=${existing.kind}, cannot use for ${kind}`,
    );
  }

  // Freeze targetLifecycle on first create; any later call with a different value is conflict
  // (including after SUCCEEDED — same requestId must not change intent).
  if (existing?.kind === "restore") {
    const frozen = existing.targetLifecycle;
    const incoming = params.targetLifecycle ?? null;
    if (frozen != null && incoming != null && frozen !== incoming) {
      throw new LifecycleIdempotencyConflictError(
        `targetLifecycle frozen as ${frozen}; cannot change to ${incoming} for same requestId`,
      );
    }
  }

  if (existing?.status === "SUCCEEDED") {
    return {
      mode: "terminal",
      result: await materializeResult(catalog, dataPlaneId, existing, false),
    };
  }

  if (existing && isLeaseActive(existing, now)) {
    return {
      mode: "inflight",
      result: await materializeResult(catalog, dataPlaneId, existing, false),
    };
  }

  let isFirstCreate = false;
  if (!existing) {
    isFirstCreate = true;
    const created = emptyJobFields({
      jobId: createLifecycleJobId(),
      kind,
      dataPlaneId,
      conversationId,
      requestId,
      requestedBy: deps.ctx.principalId,
      etagAtStart: params.etag ?? null,
      targetLifecycle: kind === "restore" ? (params.targetLifecycle ?? null) : null,
      now,
    });
    try {
      await catalog.saveLifecycleJob(created);
      existing = created;
    } catch {
      // Unique requestId race — another creator won; load and continue claim path.
      existing = await catalog.findLifecycleJobByRequestId(dataPlaneId, conversationId, requestId);
      if (!existing) {
        throw new Error("lifecycle job create race unresolved");
      }
      isFirstCreate = false;
      if (existing.status === "SUCCEEDED") {
        return {
          mode: "terminal",
          result: await materializeResult(catalog, dataPlaneId, existing, false),
        };
      }
      if (isLeaseActive(existing, now)) {
        return {
          mode: "inflight",
          result: await materializeResult(catalog, dataPlaneId, existing, false),
        };
      }
    }
  }

  const leaseOwner = randomUUID();
  const leaseExpiresAt = leaseExpiry(now);
  const nextJob: ConversationLifecycleJob = {
    ...existing,
    status: "RUNNING",
    leaseOwner,
    leaseExpiresAt,
    claimGeneration: (existing.claimGeneration ?? 0) + 1,
    lastErrorCode: null,
    updatedAt: now,
    completedAt: null,
  };

  const claimed = await catalog.claimLifecycleJob({
    dataPlaneId,
    jobId: existing.jobId,
    leaseOwner,
    leaseExpiresAt,
    now,
    nextJob,
  });

  if (!claimed) {
    // Lost race — another worker holds lease or finished.
    const again = await catalog.findLifecycleJobByRequestId(dataPlaneId, conversationId, requestId);
    if (!again) {
      throw new Error("lifecycle job disappeared during claim");
    }
    if (again.status === "SUCCEEDED") {
      return {
        mode: "terminal",
        result: await materializeResult(catalog, dataPlaneId, again, false),
      };
    }
    return {
      mode: "inflight",
      result: await materializeResult(catalog, dataPlaneId, again, false),
    };
  }

  return { mode: "execute", job: claimed, isFirstCreate };
}

function stepsFromReceipts(
  conversationId: string,
  receipts: Array<{
    bindingId: string;
    sessionId: string;
    checksum: string;
    bytes: number;
  }>,
  now: string,
): ConversationLifecycleBindingStep[] {
  return receipts.map((r) => ({
    bindingId: r.bindingId,
    sessionId: r.sessionId,
    status: "SUCCEEDED" as const,
    artifactId: toArchiveArtifactId(conversationId, r.sessionId),
    checksum: r.checksum,
    bytes: r.bytes,
    updatedAt: now,
  }));
}

export class LifecycleLeaseLostError extends Error {
  readonly code = "LEASE_LOST";
  constructor(message = "lifecycle lease lost; another worker claimed the job") {
    super(message);
    this.name = "LifecycleLeaseLostError";
  }
}

/**
 * Heartbeat: extend lease while still owner. Returns false if lease lost.
 */
async function heartbeatLease(params: {
  catalog: NonNullable<ConversationServiceDeps["catalog"]>;
  job: ConversationLifecycleJob;
}): Promise<ConversationLifecycleJob | null> {
  const now = new Date().toISOString();
  const owner = params.job.leaseOwner;
  const gen = params.job.claimGeneration ?? 0;
  if (!owner) {
    return null;
  }
  const next: ConversationLifecycleJob = {
    ...params.job,
    leaseExpiresAt: leaseExpiry(now),
    updatedAt: now,
  };
  return params.catalog.renewLifecycleLease({
    dataPlaneId: params.job.dataPlaneId,
    jobId: params.job.jobId,
    expectedLeaseOwner: owner,
    expectedClaimGeneration: gen,
    leaseExpiresAt: next.leaseExpiresAt!,
    now,
    nextJob: next,
  });
}

/**
 * Fenced write of terminal state. Returns null if lease lost (old worker must not report success).
 */
async function fenceComplete(params: {
  catalog: NonNullable<ConversationServiceDeps["catalog"]>;
  job: ConversationLifecycleJob;
  nextJob: ConversationLifecycleJob;
}): Promise<ConversationLifecycleJob | null> {
  const owner = params.job.leaseOwner;
  const gen = params.job.claimGeneration ?? 0;
  if (!owner) {
    return null;
  }
  return params.catalog.completeLifecycleJobFenced({
    dataPlaneId: params.job.dataPlaneId,
    jobId: params.job.jobId,
    expectedLeaseOwner: owner,
    expectedClaimGeneration: gen,
    nextJob: {
      ...params.nextJob,
      // Preserve fence identity fields used only for CAS match on previous row;
      // terminal clears lease after successful fence.
      claimGeneration: gen,
    },
  });
}

/**
 * Start or resume archive. Same conversationId + requestId → same job (idempotent).
 * Concurrent callers: only lease holder executes; terminal updates are fenced.
 */
export async function requestArchiveJob(params: {
  deps: ConversationServiceDeps;
  conversationId: string;
  requestId: string;
  etag?: string;
}): Promise<LifecycleJobResult> {
  const deps = withCatalog(params.deps);
  const catalog = deps.catalog;
  const now = new Date().toISOString();
  const gate = await ensureAndClaimJob({
    catalog,
    deps,
    kind: "archive",
    conversationId: params.conversationId,
    requestId: params.requestId,
    etag: params.etag,
    now,
  });
  if (gate.mode !== "execute") {
    return gate.result;
  }

  let job = gate.job;
  const isFirstCreate = gate.isFirstCreate;
  const fence = { owner: job.leaseOwner!, generation: job.claimGeneration ?? 0 };

  if (__testHooks.afterClaim) {
    await __testHooks.afterClaim();
  }

  const heartbeat = setInterval(
    () => {
      void heartbeatLease({ catalog, job }).then((renewed) => {
        if (renewed) {
          job = renewed;
        }
      });
    },
    Math.max(5_000, Math.floor(LIFECYCLE_JOB_LEASE_MS / 3)),
  );

  try {
    const result = await archiveConversation({
      deps,
      conversationId: params.conversationId,
      etag: isFirstCreate ? params.etag : undefined,
    });
    // Renew once more before terminal write.
    const renewed = await heartbeatLease({ catalog, job });
    if (!renewed) {
      throw new LifecycleLeaseLostError();
    }
    job = renewed;

    const stepNow = new Date().toISOString();
    const steps = stepsFromReceipts(params.conversationId, result.bindingReceipts, stepNow);
    const primaryReceipt =
      result.bindingReceipts.find(
        (r) => r.bindingId === result.binding.bindingId || r.sessionId === result.binding.sessionId,
      ) ?? result.bindingReceipts[0];
    const artifactId = toArchiveArtifactId(
      params.conversationId,
      primaryReceipt?.sessionId ?? result.binding.sessionId,
    );
    const terminal: ConversationLifecycleJob = {
      ...job,
      status: "SUCCEEDED",
      bindingSteps: steps,
      resultChecksum: primaryReceipt?.checksum ?? result.checksum,
      resultArtifactId: artifactId,
      resultBytes: primaryReceipt?.bytes ?? result.bytes,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: stepNow,
      completedAt: stepNow,
      lastErrorCode: null,
      claimGeneration: fence.generation,
    };
    const saved = await fenceComplete({ catalog, job, nextJob: terminal });
    if (!saved) {
      throw new LifecycleLeaseLostError();
    }
    return {
      job: saved,
      record: result.record,
      binding: result.binding,
      artifactId,
      checksum: saved.resultChecksum,
      bytes: saved.resultBytes,
      claimed: true,
    };
  } catch (err) {
    if (err instanceof LifecycleLeaseLostError) {
      // Do not rewrite state — another worker owns the job.
      const latest = await catalog.getLifecycleJob(job.dataPlaneId, job.jobId);
      if (latest) {
        return materializeResult(catalog, job.dataPlaneId, latest, false);
      }
      throw err;
    }
    const code = err instanceof Error ? err.message.slice(0, 96) : "ARCHIVE_FAILED";
    const failed: ConversationLifecycleJob = {
      ...job,
      status: "FAILED_RETRYABLE",
      lastErrorCode: code,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: new Date().toISOString(),
      claimGeneration: fence.generation,
    };
    const saved = await fenceComplete({ catalog, job, nextJob: failed });
    if (!saved) {
      // Lease lost mid-failure — do not throw as success; rethrow original for caller retry.
      throw err;
    }
    throw err;
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Start or resume restore. targetLifecycle is frozen on first create.
 */
export async function requestRestoreJob(params: {
  deps: ConversationServiceDeps;
  conversationId: string;
  requestId: string;
  etag?: string;
  targetLifecycle?: "ACTIVE" | "CLOSED";
}): Promise<LifecycleJobResult> {
  const deps = withCatalog(params.deps);
  const catalog = deps.catalog;
  const now = new Date().toISOString();
  const gate = await ensureAndClaimJob({
    catalog,
    deps,
    kind: "restore",
    conversationId: params.conversationId,
    requestId: params.requestId,
    etag: params.etag,
    targetLifecycle: params.targetLifecycle ?? null,
    now,
  });
  if (gate.mode !== "execute") {
    return gate.result;
  }

  let job = gate.job;
  const isFirstCreate = gate.isFirstCreate;
  const fence = { owner: job.leaseOwner!, generation: job.claimGeneration ?? 0 };
  const targetLifecycle =
    job.targetLifecycle === "ACTIVE" || job.targetLifecycle === "CLOSED"
      ? job.targetLifecycle
      : params.targetLifecycle;

  const heartbeat = setInterval(
    () => {
      void heartbeatLease({ catalog, job }).then((renewed) => {
        if (renewed) {
          job = renewed;
        }
      });
    },
    Math.max(5_000, Math.floor(LIFECYCLE_JOB_LEASE_MS / 3)),
  );

  try {
    const result = await restoreConversation({
      deps,
      conversationId: params.conversationId,
      etag: isFirstCreate ? params.etag : undefined,
      targetLifecycle: targetLifecycle ?? undefined,
    });
    const renewed = await heartbeatLease({ catalog, job });
    if (!renewed) {
      throw new LifecycleLeaseLostError();
    }
    job = renewed;

    const stepNow = new Date().toISOString();
    const steps = stepsFromReceipts(params.conversationId, result.bindingReceipts, stepNow);
    const primaryReceipt =
      result.bindingReceipts.find(
        (r) => r.bindingId === result.binding.bindingId || r.sessionId === result.binding.sessionId,
      ) ?? result.bindingReceipts[0];
    const artifactId = toArchiveArtifactId(
      params.conversationId,
      primaryReceipt?.sessionId ?? result.binding.sessionId,
    );
    const terminal: ConversationLifecycleJob = {
      ...job,
      status: "SUCCEEDED",
      bindingSteps: steps,
      resultChecksum: primaryReceipt?.checksum ?? result.checksum,
      resultArtifactId: artifactId,
      resultBytes: primaryReceipt?.bytes ?? null,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: stepNow,
      completedAt: stepNow,
      lastErrorCode: null,
      claimGeneration: fence.generation,
    };
    const saved = await fenceComplete({ catalog, job, nextJob: terminal });
    if (!saved) {
      throw new LifecycleLeaseLostError();
    }
    return {
      job: saved,
      record: result.record,
      binding: result.binding,
      artifactId,
      checksum: saved.resultChecksum,
      bytes: saved.resultBytes,
      claimed: true,
    };
  } catch (err) {
    if (err instanceof LifecycleLeaseLostError) {
      const latest = await catalog.getLifecycleJob(job.dataPlaneId, job.jobId);
      if (latest) {
        return materializeResult(catalog, job.dataPlaneId, latest, false);
      }
      throw err;
    }
    const code = err instanceof Error ? err.message.slice(0, 96) : "RESTORE_FAILED";
    const failed: ConversationLifecycleJob = {
      ...job,
      status: "FAILED_RETRYABLE",
      lastErrorCode: code,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: new Date().toISOString(),
      claimGeneration: fence.generation,
    };
    const saved = await fenceComplete({ catalog, job, nextJob: failed });
    if (!saved) {
      throw err;
    }
    throw err;
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Load lifecycle job with Conversation read ACL (fail closed for cross-user jobId leaks).
 */
export async function getLifecycleJobService(params: {
  deps: ConversationServiceDeps;
  jobId: string;
}): Promise<ConversationLifecycleJob | null> {
  const deps = withCatalog(params.deps);
  const job = await deps.catalog.getLifecycleJob(deps.ctx.dataPlaneId, params.jobId);
  if (!job) {
    return null;
  }
  const record = await deps.catalog.getConversation(deps.ctx.dataPlaneId, job.conversationId);
  if (!record) {
    return null;
  }
  const auth = authorizeConversationAction({
    ctx: deps.ctx,
    record,
    action: "read",
  });
  if (!auth.allowed) {
    return null;
  }
  return job;
}

/** Verify an on-disk transcript exists and return checksum (fail closed). */
export async function requireTranscriptChecksum(filePath: string): Promise<{
  checksum: string;
  bytes: number;
}> {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error("transcript_missing");
  }
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error("transcript_empty");
  }
  return sha256File(filePath);
}
