import fs from "node:fs";
import path from "node:path";
/**
 * Resume durable followup workspace waits from the existing gateway-boot
 * recoverer. Scan, bounded revalidation, re-enqueue, and update wait records
 * all live here so process start can call one entry.
 */
import { listAgentIds } from "../../../agents/agent-scope.js";
import {
  classifyFollowupWorkspaceChange,
  loadFollowupRevalidationEvidence,
  resolveWorkspaceRealpath,
  type FollowupReauthorizationGrant,
  type FollowupWorkspaceCurrentEvidence,
  type FollowupWorkspaceSnapshot,
} from "../../../auto-reply/reply/followup-workspace-change.js";
import {
  enqueueFollowupRun,
  hasFollowupDrainCallback,
  kickFollowupDrainIfIdle,
} from "../../../auto-reply/reply/queue.js";
import type { FollowupRun } from "../../../auto-reply/reply/queue.js";
import { getExistingFollowupQueue } from "../../../auto-reply/reply/queue/state.js";
import type { OriginatingChannelType } from "../../../auto-reply/templating.js";
import type { OpenBotConfig } from "../../../config/config.js";
import { resolveSessionTranscriptsDirForAgent } from "../../../config/sessions/paths.js";
import { resolveExecutionWorkspace } from "../../../gateway/workspace-resolver/execution-workspace.js";
import type { AsyncWaitRecoveryLog } from "./async-wait-job-recovery.js";
import { getAsyncWaitRecoveryFollowupConsumerEnsure } from "./async-wait-recovery-enqueue.js";
import {
  BLOCKED_FOLLOWUP_DELIVERY_DIRNAME,
  canAutoRevalidateFollowupRecovery,
  claimFollowupRecoveryForResume,
  findBlockedFollowupDelivery,
  followupDeliveryIdempotencyKey,
  followupRecoveryClaimBlocksEnqueue,
  incrementFollowupRecoveryRetry,
  listRecoverableFollowupDeliveries,
  markFollowupRecoveryClaimEnqueued,
  planFollowupRecoveryRetry,
  recordFollowupWorkspaceDecision,
  releaseFollowupRecoveryClaim,
  type BlockedFollowupDeliveryRecord,
} from "./blocked-followup-delivery.js";

export type FollowupWorkspaceWaitRecoveryResult = {
  persistRootsScanned: number;
  recordsSeen: number;
  revalidated: number;
  enqueued: number;
  stillWaiting: number;
  retryExhausted: number;
  awaitingReauthorization: number;
  skipped: number;
};

export type ResumeFollowupDeliveryAfterReauthorizationResult = {
  ok: boolean;
  reason: string;
  enqueued: boolean;
  record?: BlockedFollowupDeliveryRecord;
};

function findBlockedFollowupDeliveryPersistRoots(sessionsRoot: string, maxDepth = 4): string[] {
  const root = sessionsRoot.trim();
  if (!root || !fs.existsSync(root)) {
    return [];
  }
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.name === BLOCKED_FOLLOWUP_DELIVERY_DIRNAME) {
        out.push(dir);
        continue;
      }
      if (depth < maxDepth) {
        walk(full, depth + 1);
      }
    }
  };
  walk(root, 0);
  return out;
}

export function collectBlockedFollowupDeliveryPersistRoots(cfg: OpenBotConfig): string[] {
  const roots = new Set<string>();
  for (const agentId of listAgentIds(cfg)) {
    let sessionsRoot: string;
    try {
      sessionsRoot = resolveSessionTranscriptsDirForAgent(agentId);
    } catch {
      continue;
    }
    for (const persistRoot of findBlockedFollowupDeliveryPersistRoots(sessionsRoot)) {
      roots.add(persistRoot);
    }
  }
  return [...roots];
}

function snapshotFromRecord(record: BlockedFollowupDeliveryRecord): FollowupWorkspaceSnapshot {
  return {
    ...record.workspaceBinding,
    workspaceDir: record.resume?.workspaceDir || record.workspaceBinding?.workspaceDir,
  };
}

function currentFromBinding(
  bound: NonNullable<Awaited<ReturnType<typeof resolveExecutionWorkspace>>>,
  operationAllowed: boolean,
): FollowupWorkspaceCurrentEvidence {
  return {
    resourceId: bound.resourceId,
    bindingId: bound.bindingId,
    contentVersion: bound.contentVersion,
    rootPath: bound.rootPath,
    realpath: resolveWorkspaceRealpath(bound.rootPath) || bound.rootPath,
    tenantId: bound.tenantId,
    owner: bound.owner,
    lifecycleState: bound.lifecycleState,
    bindingState: bound.bindingState,
    operationAllowed,
  };
}

function isValidReauthorizationGrant(
  grant: FollowupReauthorizationGrant | null | undefined,
): grant is FollowupReauthorizationGrant {
  return Boolean(
    grant &&
    (grant.kind === "tenant" || grant.kind === "owner" || grant.kind === "permission") &&
    grant.actorIdentity.trim() &&
    typeof grant.grantedAtMs === "number" &&
    Number.isFinite(grant.grantedAtMs),
  );
}

async function resolveCurrentEvidence(params: {
  record: BlockedFollowupDeliveryRecord;
  cfg?: OpenBotConfig;
}): Promise<{
  current: FollowupWorkspaceCurrentEvidence | null;
  resolveError?: string;
}> {
  const agentId = params.record.resume?.agentId?.trim();
  if (!params.cfg || !agentId) {
    return { current: null, resolveError: "workspace_binding_required:trusted_identity_missing" };
  }
  try {
    const bound = await resolveExecutionWorkspace({
      cfg: params.cfg,
      agentId,
      operation: "read",
    });
    if (!bound) {
      return { current: null, resolveError: "workspace_binding_required:workspace_resolution" };
    }
    return { current: currentFromBinding(bound, true) };
  } catch (err) {
    return {
      current: null,
      resolveError: err instanceof Error ? err.message : String(err),
    };
  }
}

function visiblePayloads(
  record: BlockedFollowupDeliveryRecord,
): NonNullable<FollowupRun["asyncWaitDeliveryPayloads"]> {
  return (record.resume?.payloads ?? []).filter(
    (payload) =>
      payload &&
      (payload.text || payload.mediaUrl || (payload.mediaUrls && payload.mediaUrls.length > 0)),
  );
}

function followupRunFromRecord(params: {
  record: BlockedFollowupDeliveryRecord;
  cfg?: OpenBotConfig;
}): FollowupRun | null {
  const record = params.record;
  const payloads = visiblePayloads(record);
  const sessionKey = record.resume?.sessionKey || record.sessionKey;
  const sessionFile = record.resume?.sessionFile || record.sessionFile;
  const workspaceDir = record.resume?.workspaceDir || record.workspaceBinding?.workspaceDir;
  if (!sessionKey || !sessionFile || !workspaceDir || payloads.length === 0) {
    return null;
  }
  const bind =
    record.resume?.asyncWaitRecoveryBind ??
    (record.jobId
      ? {
          jobId: record.jobId,
          claimToken: `followup-wait-recovery:${record.id}`,
          ...(record.runId ? { boundRunId: record.runId } : {}),
          ...(record.deliveryId ? { boundDeliveryId: record.deliveryId } : {}),
        }
      : undefined);
  const originatingChannel = record.resume?.originatingChannel as
    | OriginatingChannelType
    | undefined;
  const binding = record.workspaceBinding;
  return {
    prompt: record.resume?.prompt || "followup_workspace_wait_recovery",
    messageId: followupDeliveryIdempotencyKey(record),
    summaryLine: "followup_workspace_wait_recovery",
    enqueuedAt: Date.now(),
    asyncWaitDeliveryOnly: true,
    asyncWaitDeliveryPayloads: payloads,
    ...(record.resume?.followupItemId ? { followupItemId: record.resume.followupItemId } : {}),
    ...(bind ? { asyncWaitRecoveryBind: bind } : {}),
    ...(record.resume?.deliverableVersion
      ? { asyncWaitDeliverableVersion: record.resume.deliverableVersion }
      : {}),
    ...(originatingChannel ? { originatingChannel } : {}),
    ...(record.resume?.originatingTo ? { originatingTo: record.resume.originatingTo } : {}),
    ...(record.resume?.originatingAccountId
      ? { originatingAccountId: record.resume.originatingAccountId }
      : {}),
    ...(record.resume?.originatingThreadId != null && record.resume.originatingThreadId !== ""
      ? { originatingThreadId: record.resume.originatingThreadId }
      : {}),
    run: {
      agentId: record.resume?.agentId || "main",
      agentDir: record.resume?.agentDir || "",
      sessionId: record.resume?.sessionId || sessionKey,
      sessionKey,
      sessionFile,
      workspaceDir,
      config: params.cfg ?? ({} as OpenBotConfig),
      provider: record.resume?.provider || "unknown",
      model: record.resume?.model || "unknown",
      timeoutMs: 120_000,
      blockReplyBreak: "message_end",
      ...(binding?.resourceId && binding.bindingId && binding.contentVersion
        ? {
            executionWorkspaceBinding: {
              resourceId: binding.resourceId,
              bindingId: binding.bindingId,
              contentVersion: binding.contentVersion,
              ...(binding.tenantId ? { tenantId: binding.tenantId } : {}),
              ...(binding.owner ? { owner: binding.owner } : {}),
              ...(binding.lifecycleState ? { lifecycleState: binding.lifecycleState } : {}),
              ...(binding.bindingState ? { bindingState: binding.bindingState } : {}),
            },
          }
        : {}),
    },
  };
}

function ensureFollowupConsumer(params: { cfg?: OpenBotConfig; sessionKey: string }): void {
  if (hasFollowupDrainCallback(params.sessionKey)) {
    return;
  }
  if (!params.cfg) {
    return;
  }
  getAsyncWaitRecoveryFollowupConsumerEnsure()?.({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
  });
}

function isIdempotentDeliveryQueued(sessionKey: string, messageId: string): boolean {
  const queued = getExistingFollowupQueue(sessionKey);
  return Boolean(queued?.items.some((item) => item.messageId?.trim() === messageId));
}

function enqueueOriginalDelivery(params: {
  record: BlockedFollowupDeliveryRecord;
  cfg?: OpenBotConfig;
}): "enqueued" | "duplicate" | "failed" {
  const run = followupRunFromRecord(params);
  const sessionKey = run?.run.sessionKey;
  const messageId = run?.messageId?.trim();
  if (!run || !sessionKey || !messageId) {
    return "failed";
  }
  if (isIdempotentDeliveryQueued(sessionKey, messageId)) {
    return "duplicate";
  }
  ensureFollowupConsumer({ cfg: params.cfg, sessionKey });
  // Durable claim and the live queue already prevent a second delivery.
  // Do not use the recent message-id cache as the only/primary dedupe: it
  // embeds no send-success proof and would block a bounded retry of the
  // same idempotency identity after a failed enqueue or send.
  const enqueued = enqueueFollowupRun(
    sessionKey,
    run,
    { mode: "followup", debounceMs: 0, cap: 20 },
    "none",
  );
  if (enqueued) {
    if (hasFollowupDrainCallback(sessionKey)) {
      kickFollowupDrainIfIdle(sessionKey);
    }
    return "enqueued";
  }
  if (isIdempotentDeliveryQueued(sessionKey, messageId)) {
    return "duplicate";
  }
  return "failed";
}

async function revalidateAndMaybeEnqueue(params: {
  persistRoot: string;
  record: BlockedFollowupDeliveryRecord;
  cfg?: OpenBotConfig;
  allowReauthorizationResume: boolean;
  grant?: FollowupReauthorizationGrant | null;
}): Promise<"enqueued" | "waiting" | "exhausted" | "reauthorization" | "closed" | "skipped"> {
  const plan = planFollowupRecoveryRetry(params.record);
  if (plan.action === "closed") {
    return "closed";
  }
  if (plan.action === "await_reauthorization" && !params.allowReauthorizationResume) {
    return "reauthorization";
  }
  if (plan.action === "hold" && !params.allowReauthorizationResume) {
    return "exhausted";
  }
  if (!params.allowReauthorizationResume && !canAutoRevalidateFollowupRecovery(params.record)) {
    return "exhausted";
  }

  // If a prior scan already claimed or enqueued this delivery, do not increment
  // retry or enqueue again. A released or stale claim falls through and retries
  // with the same idempotency identity.
  if (!params.allowReauthorizationResume && followupRecoveryClaimBlocksEnqueue(params.record)) {
    return params.record.status === "continued" || params.record.claim?.deliverySentAtMs
      ? "closed"
      : "enqueued";
  }

  const retried = params.allowReauthorizationResume
    ? params.record
    : await incrementFollowupRecoveryRetry({
        persistRoot: params.persistRoot,
        record: params.record,
      });
  const saved = snapshotFromRecord(retried);
  const resolved = await resolveCurrentEvidence({ record: retried, cfg: params.cfg });
  const evidence = await loadFollowupRevalidationEvidence({
    resourceId: saved.resourceId,
    sessionFile: retried.sessionFile || retried.resume?.sessionFile,
    saved,
    current: resolved.current,
  });
  const classification = classifyFollowupWorkspaceChange({
    saved,
    current: resolved.current,
    savedRealpath: resolveWorkspaceRealpath(saved.workspaceDir),
    resolveError: resolved.resolveError,
    requiredOperation: "read",
    verifiedMigration: evidence.verifiedMigration,
    savedCatalogLifecycle: evidence.savedCatalogLifecycle,
    savedCatalogOwner: evidence.savedCatalogOwner,
    savedCatalogTenantId: evidence.savedCatalogTenantId,
    trustedTenantId: resolved.current?.tenantId || saved.tenantId,
    reauthorizationGrant: params.grant ?? retried.reauthorizationGrant,
  });

  if (classification.destination === "continue") {
    const claimed = await claimFollowupRecoveryForResume({
      persistRoot: params.persistRoot,
      record: retried,
    });
    if (!claimed.ok) {
      if (claimed.reason === "already_claimed" || claimed.reason === "already_sent") {
        return claimed.reason === "already_sent" ? "closed" : "enqueued";
      }
      return "skipped";
    }
    const enqueued = enqueueOriginalDelivery({ record: claimed.record, cfg: params.cfg });
    if (enqueued === "failed") {
      const released = await releaseFollowupRecoveryClaim({
        persistRoot: params.persistRoot,
        record: claimed.record,
        claimToken: claimed.claimToken,
      });
      await recordFollowupWorkspaceDecision({
        persistRoot: params.persistRoot,
        id: released.id,
        classification: {
          ...classification,
          destination: "recoverable_wait",
          reason: "followup_workspace_recoverable_wait:resume_enqueue_failed",
          code: "missing_evidence",
          missingItems: [
            ...(classification.missingItems ?? []),
            "resume_enqueue",
            ...(visiblePayloads(released).length === 0 ? ["original_payloads"] : []),
          ],
          askUser: false,
        },
        statusOverride: "recoverable_wait",
        retryCount: released.retryCount,
        retryCap: released.retryCap,
        sessionKey: released.sessionKey,
        sessionFile: released.sessionFile,
        jobId: released.jobId,
        runId: released.runId,
        deliveryId: released.deliveryId,
        taskId: released.taskId,
        workspaceBinding: released.workspaceBinding,
        resume: released.resume,
        reauthorizationGrant: params.grant ?? released.reauthorizationGrant,
        claim: released.claim,
        deliveryIdempotencyKey: followupDeliveryIdempotencyKey(released),
      });
      return released.retryExhausted ? "exhausted" : "waiting";
    }
    await markFollowupRecoveryClaimEnqueued({
      persistRoot: params.persistRoot,
      record: claimed.record,
      claimToken: claimed.claimToken,
    });
    // The followup runner records `continued` after it revalidates and before
    // (or as) it resends the original payloads. Leave the wait record in place
    // until that happens so a failed enqueue/send cannot look resolved. The
    // durable claim plus stable idempotency key prevent a second scan from
    // sending again in this window.
    return "enqueued";
  }

  await recordFollowupWorkspaceDecision({
    persistRoot: params.persistRoot,
    id: retried.id,
    classification,
    retryCount: retried.retryCount,
    retryCap: retried.retryCap,
    sessionKey: retried.sessionKey,
    sessionFile: retried.sessionFile,
    jobId: retried.jobId,
    runId: retried.runId,
    deliveryId: retried.deliveryId,
    taskId: retried.taskId,
    workspaceBinding: retried.workspaceBinding,
    resume: retried.resume,
    reauthorizationGrant: params.grant ?? retried.reauthorizationGrant,
  });
  if (classification.destination === "reauthorization_required") {
    return "reauthorization";
  }
  if (classification.destination === "denied") {
    return "closed";
  }
  return retried.retryExhausted ? "exhausted" : "waiting";
}

/**
 * Production entry used by recoverAsyncWaitJobsAtGatewayBoot: restart scan,
 * bounded revalidation, re-enqueue of the original delivery-only followup,
 * and wait-record updates. Not a test-only shortcut.
 */
export async function recoverFollowupWorkspaceWaitsAtGatewayBoot(params: {
  cfg?: OpenBotConfig;
  persistRoots?: string[];
  log?: AsyncWaitRecoveryLog;
}): Promise<FollowupWorkspaceWaitRecoveryResult> {
  const persistRoots = [
    ...new Set(
      params.persistRoots && params.persistRoots.length > 0
        ? params.persistRoots.map((root) => path.resolve(root))
        : params.cfg
          ? collectBlockedFollowupDeliveryPersistRoots(params.cfg)
          : [],
    ),
  ];
  const result: FollowupWorkspaceWaitRecoveryResult = {
    persistRootsScanned: persistRoots.length,
    recordsSeen: 0,
    revalidated: 0,
    enqueued: 0,
    stillWaiting: 0,
    retryExhausted: 0,
    awaitingReauthorization: 0,
    skipped: 0,
  };
  for (const persistRoot of persistRoots) {
    const records = listRecoverableFollowupDeliveries(persistRoot);
    result.recordsSeen += records.length;
    for (const record of records) {
      try {
        const outcome = await revalidateAndMaybeEnqueue({
          persistRoot,
          record,
          cfg: params.cfg,
          allowReauthorizationResume: false,
        });
        if (outcome === "enqueued") {
          result.revalidated += 1;
          result.enqueued += 1;
        } else if (outcome === "waiting") {
          result.revalidated += 1;
          result.stillWaiting += 1;
        } else if (outcome === "exhausted") {
          result.retryExhausted += 1;
        } else if (outcome === "reauthorization") {
          result.awaitingReauthorization += 1;
        } else {
          result.skipped += 1;
        }
      } catch (err) {
        result.skipped += 1;
        params.log?.warn?.(
          `followup wait recovery failed id=${record.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
  params.log?.info?.(
    `followup wait recovery: roots=${result.persistRootsScanned} seen=${result.recordsSeen} revalidated=${result.revalidated} enqueued=${result.enqueued} waiting=${result.stillWaiting} exhausted=${result.retryExhausted} reauth=${result.awaitingReauthorization} skipped=${result.skipped}`,
  );
  return result;
}

/**
 * User/auth-flow entry after a tenant, ownership, or permission change has
 * been reauthorized. Runs the same revalidation and delivery-only enqueue
 * path used on gateway-boot recovery. Does not continue without a grant.
 */
/**
 * Lower-level resume used by the access-control plane entry
 * `confirmAccessReauthorization`. Production grant / permission-confirmation
 * paths should call that control-plane hook rather than this function
 * directly. Gateway boot must not use this without a grant.
 */
export async function resumeFollowupDeliveryAfterReauthorization(params: {
  persistRoot: string;
  authorization?: FollowupReauthorizationGrant | null;
  id?: string;
  runId?: string;
  deliveryId?: string;
  jobId?: string;
  sessionKey?: string;
  cfg?: OpenBotConfig;
}): Promise<ResumeFollowupDeliveryAfterReauthorizationResult> {
  const record = findBlockedFollowupDelivery(params.persistRoot, {
    id: params.id,
    runId: params.runId,
    deliveryId: params.deliveryId,
    jobId: params.jobId,
    sessionKey: params.sessionKey,
  });
  if (!record) {
    return { ok: false, reason: "followup_reauthorization:record_not_found", enqueued: false };
  }
  if (!isValidReauthorizationGrant(params.authorization)) {
    return {
      ok: false,
      reason: "followup_reauthorization:authorization_evidence_missing",
      enqueued: false,
      record,
    };
  }
  const granted = await recordFollowupWorkspaceDecision({
    persistRoot: params.persistRoot,
    id: record.id,
    classification: {
      destination: "reauthorization_required",
      reason: record.reason,
      code: "reauthorization_required",
      askUser: true,
      askUserDetail: record.reauthorization?.detail,
      reauthorization: record.reauthorization,
    },
    statusOverride: "reauthorization_required",
    retryCount: record.retryCount,
    retryCap: record.retryCap,
    sessionKey: record.sessionKey,
    sessionFile: record.sessionFile,
    jobId: record.jobId,
    runId: record.runId,
    deliveryId: record.deliveryId,
    taskId: record.taskId,
    workspaceBinding: record.workspaceBinding,
    resume: record.resume,
    reauthorizationGrant: params.authorization,
  });
  const outcome = await revalidateAndMaybeEnqueue({
    persistRoot: params.persistRoot,
    record: granted,
    cfg: params.cfg,
    allowReauthorizationResume: true,
    grant: params.authorization,
  });
  const updated = findBlockedFollowupDelivery(params.persistRoot, { id: granted.id }) ?? granted;
  if (outcome === "enqueued") {
    return {
      ok: true,
      reason: "followup_reauthorization:enqueued",
      enqueued: true,
      record: updated,
    };
  }
  return {
    ok: false,
    reason: `followup_reauthorization:${outcome}`,
    enqueued: false,
    record: updated,
  };
}
