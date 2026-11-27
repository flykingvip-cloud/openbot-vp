import crypto from "node:crypto";
import { deliverQueuedReply } from "../../agent-runtime/delivery/index.js";
import {
  assertControlledExecutionStages,
  runQueuedCandidate,
  createUnifiedExecutionLifecycle,
} from "../../agent-runtime/execution/index.js";
import type { EmbeddedPiRunResult } from "../../agent-runtime/execution/index.js";
import { checkTaskActionBoundary } from "../../agent-runtime/state/index.js";
import {
  bindAsyncWaitRecoveryTurn,
  claimQueuedExecution,
  readAsyncWaitJobIntent,
  releaseAsyncWaitRecoveryTurn,
} from "../../agent-runtime/state/index.js";
import {
  incrementRunCompactionCount,
  persistRunSessionUsage,
} from "../../agent-runtime/state/index.js";
import {
  findBlockedFollowupDelivery,
  markFollowupRecoveryDeliveryStarted,
  markFollowupRecoveryDeliverySent,
  planFollowupRecoveryRetry,
  recordFollowupWorkspaceDecision,
  recordBlockedFollowupDelivery,
  resolveBlockedFollowupDeliveryPersistRoot,
  type FollowupDeliveryResumeSnapshot,
} from "../../agent-runtime/state/index.js";
import { bindAdmittedTurnHost } from "../../agent-runtime/wiring/admitted-turn-host.js";
import { confirmPendingTurnDelivery } from "../../agent-runtime/wiring/delivery-confirm.js";
import { replyTurnRuntime } from "../../agent-runtime/wiring/reply-turn.js";
import { resolveRunModelFallbacksOverride } from "../../agents/agent-scope.js";
import { resolveBootstrapWarningSignaturesSeen } from "../../agents/bootstrap-budget.js";
import { lookupContextTokens } from "../../agents/context.js";
import { DEFAULT_CONTEXT_TOKENS } from "../../agents/defaults.js";
import { hasNonzeroUsage, normalizeUsage } from "../../agents/usage.js";
import type { SessionEntry } from "../../config/sessions.js";
import {
  admitOguiDecisionTurn,
  releaseOguiDecisionResume,
  runWithOguiDecisionResume,
} from "../../config/sessions/ogui-decision-engine.js";
import type { TypingMode } from "../../config/types.js";
import { drainUsageOutboxRecord } from "../../gateway/billing/usage-outbox-drain.js";
import { enqueueUsageOutbox } from "../../gateway/billing/usage-outbox-store.js";
import { toRestrictedGatewayClient } from "../../gateway/execution-identity-context.js";
import { buildKnowledgeReplyGatewayClient } from "../../gateway/knowledge/reply-gateway-client.js";
import {
  consumeCapabilityRoutingResult,
  formatCapabilityExecutionSurfaceLog,
} from "../../gateway/model-entitlement/capability-entry-consume.js";
import type { EmployeeModelGateResult } from "../../gateway/model-entitlement/employee-model-gate.js";
import { buildRunContextEstimateParts } from "../../gateway/model-entitlement/run-context-estimate.js";
import { resolveExecutionWorkspace } from "../../gateway/workspace-resolver/execution-workspace.js";
import { logVerbose } from "../../globals.js";
import { registerAgentRunContext } from "../../infra/agent-events.js";
import { defaultRuntime } from "../../runtime.js";
import { resolveTurnContractFromRunMeta } from "../../task-outcome/chat-entry.js";
import { ensureFollowupTurnTaskOutcome } from "../../task-outcome/entrypoint-ensure.js";
import { peekAwaitingDelivery } from "../../task-outcome/pending-delivery.js";
import type { GrowthOutcomeCommitOpts } from "../../task-outcome/runtime-from-runner.js";
import {
  assertRunnerTurnBudgetAllowsModelCall,
  chargeModelCallAgainstTip,
  estimateTipBudgetCostUsdFromUsage,
  recordRunnerTurnOutcome,
  runnerExecutorEvidenceContext,
  TaskBudgetExceededError,
  type ModelCallCloseoutLink,
} from "../../task-outcome/runtime-from-runner.js";
import { isInternalMessageChannel } from "../../utils/message-channel.js";
import { stripHeartbeatToken } from "../heartbeat.js";
import type { OriginatingChannelType } from "../templating.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import { buildCommercialRunCreditUsageInput } from "./agent-run-credit-usage.js";
import {
  classifyFollowupWorkspaceChange,
  loadFollowupRevalidationEvidence,
  resolveWorkspaceRealpath,
  type FollowupWorkspaceClassification,
  type FollowupWorkspaceCurrentEvidence,
  type FollowupWorkspaceSnapshot,
} from "./followup-workspace-change.js";
import {
  resolveOriginAccountId,
  resolveOriginMessageProvider,
  resolveOriginMessageTo,
} from "./origin-routing.js";
import type { FollowupRun } from "./queue.js";
import {
  applyReplyThreading,
  filterMessagingToolDuplicates,
  filterMessagingToolMediaDuplicates,
  shouldSuppressMessagingToolReplies,
} from "./reply-payloads.js";
import { resolveReplyToMode } from "./reply-threading.js";
import { isRoutableChannel, routeReply } from "./route-reply.js";
import { createTypingSignaler } from "./typing-mode.js";
import type { TypingController } from "./typing.js";

function snapshotFromQueued(queued: FollowupRun): FollowupWorkspaceSnapshot {
  return {
    ...queued.run.executionWorkspaceBinding,
    workspaceDir: queued.run.workspaceDir,
  };
}

function resumeSnapshotFromQueued(queued: FollowupRun): FollowupDeliveryResumeSnapshot {
  return {
    deliveryOnly: queued.asyncWaitDeliveryOnly === true,
    payloads: queued.asyncWaitDeliveryPayloads ?? [],
    agentId: queued.run.agentId,
    agentDir: queued.run.agentDir,
    sessionId: queued.run.sessionId,
    sessionKey: queued.run.sessionKey,
    sessionFile: queued.run.sessionFile,
    workspaceDir: queued.run.workspaceDir,
    prompt: queued.prompt,
    messageId: queued.messageId,
    followupItemId: queued.followupItemId,
    originatingChannel: queued.originatingChannel,
    originatingTo: queued.originatingTo,
    originatingAccountId: queued.originatingAccountId,
    originatingThreadId: queued.originatingThreadId,
    provider: queued.run.provider,
    model: queued.run.model,
    deliverableVersion: queued.asyncWaitDeliverableVersion,
    asyncWaitRecoveryBind: queued.asyncWaitRecoveryBind,
  };
}

function currentEvidenceFromBinding(
  boundWorkspace: NonNullable<Awaited<ReturnType<typeof resolveExecutionWorkspace>>>,
  operationAllowed: boolean,
): FollowupWorkspaceCurrentEvidence {
  return {
    resourceId: boundWorkspace.resourceId,
    bindingId: boundWorkspace.bindingId,
    contentVersion: boundWorkspace.contentVersion,
    rootPath: boundWorkspace.rootPath,
    realpath: resolveWorkspaceRealpath(boundWorkspace.rootPath) || boundWorkspace.rootPath,
    tenantId: boundWorkspace.tenantId,
    owner: boundWorkspace.owner,
    lifecycleState: boundWorkspace.lifecycleState,
    bindingState: boundWorkspace.bindingState,
    operationAllowed,
  };
}

function applyWorkspaceContinuation(
  queued: FollowupRun,
  boundWorkspace: NonNullable<Awaited<ReturnType<typeof resolveExecutionWorkspace>>>,
  classification: FollowupWorkspaceClassification,
): void {
  if (classification.pathNormalization || classification.migration) {
    queued.run.workspaceDir = boundWorkspace.rootPath;
  }
  queued.run.executionWorkspaceBinding = {
    resourceId: boundWorkspace.resourceId,
    bindingId: boundWorkspace.bindingId,
    contentVersion: boundWorkspace.contentVersion,
    ...(boundWorkspace.tenantId ? { tenantId: boundWorkspace.tenantId } : {}),
    ...(boundWorkspace.owner ? { owner: boundWorkspace.owner } : {}),
    ...(boundWorkspace.lifecycleState ? { lifecycleState: boundWorkspace.lifecycleState } : {}),
    ...(boundWorkspace.bindingState ? { bindingState: boundWorkspace.bindingState } : {}),
  };
}

async function persistWorkspaceDecision(params: {
  queued: FollowupRun;
  sessionKey?: string;
  classification: FollowupWorkspaceClassification;
  error?: string;
  reasonOverride?: string;
  statusOverride?: "recoverable_wait" | "reauthorization_required" | "denied" | "continued";
  pendingDestination?: FollowupWorkspaceClassification["destination"];
  runId?: string;
  deliveryId?: string;
  taskId?: string;
  id?: string;
  retryCount?: number;
  retryCap?: number;
}): Promise<boolean> {
  try {
    await recordFollowupWorkspaceDecision({
      persistRoot: resolveBlockedFollowupDeliveryPersistRoot(params.queued.run.sessionFile),
      id: params.id,
      classification: params.classification,
      error: params.error ?? params.classification.reason,
      reasonOverride: params.reasonOverride,
      statusOverride: params.statusOverride,
      pendingDestination: params.pendingDestination,
      retryCount: params.retryCount,
      retryCap: params.retryCap,
      sessionKey: params.queued.run.sessionKey ?? params.sessionKey,
      sessionFile: params.queued.run.sessionFile,
      ...(params.queued.asyncWaitRecoveryBind?.jobId
        ? { jobId: params.queued.asyncWaitRecoveryBind.jobId }
        : {}),
      ...(params.runId ? { runId: params.runId } : {}),
      ...(params.deliveryId ? { deliveryId: params.deliveryId } : {}),
      ...(params.taskId ? { taskId: params.taskId } : {}),
      workspaceBinding: snapshotFromQueued(params.queued),
      resume: resumeSnapshotFromQueued(params.queued),
    });
    return true;
  } catch (recordErr) {
    logVerbose(`followup workspace decision record failed: ${String(recordErr)}`);
    return false;
  }
}

export function createFollowupRunner(params: {
  opts?: GetReplyOptions;
  typing: TypingController;
  typingMode: TypingMode;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  defaultModel: string;
  agentCfgContextTokens?: number;
}): (queued: FollowupRun) => Promise<void> {
  const {
    opts,
    typing,
    typingMode,
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    defaultModel,
    agentCfgContextTokens,
  } = params;
  const typingSignals = createTypingSignaler({
    typing,
    mode: typingMode,
    isHeartbeat: opts?.isHeartbeat === true,
  });

  /**
   * Sends followup payloads, routing to the originating channel if set.
   *
   * When originatingChannel/originatingTo are set on the queued run,
   * replies are routed directly to that provider instead of using the
   * session's current dispatcher. This ensures replies go back to
   * where the message originated.
   */
  const sendFollowupPayloads = async (
    payloads: ReplyPayload[],
    queued: FollowupRun,
    taskResult = false,
  ) => {
    return deliverQueuedReply(
      {
        payloads,
        taskBoundary:
          taskResult && queued.run.taskCompletionBinding
            ? {
                sessionFile: queued.run.sessionFile,
                binding: queued.run.taskCompletionBinding,
                constraints: queued.run.taskCompletionBinding.constraints ?? [],
              }
            : undefined,
        originatingChannel: queued.originatingChannel,
        originatingTo: queued.originatingTo,
        originatingAccountId: queued.originatingAccountId,
        originatingThreadId: queued.originatingThreadId,
        run: {
          sessionKey: queued.run.sessionKey,
          cfg: queued.run.config,
          messageProvider: queued.run.messageProvider,
        },
      },
      {
        routeReply,
        isRoutableChannel,
        onBlockReply: opts?.onBlockReply,
        signalTextDelta: (text) => typingSignals.signalTextDelta(text),
        log: logVerbose,
        assertTaskCurrent: (boundary) => {
          const refusal = checkTaskActionBoundary(boundary);
          if (refusal) {
            throw new Error(refusal);
          }
        },
      },
    );
  };

  return async (queued: FollowupRun) => {
    // Delivery-only retries resend original payloads and do not mutate the workspace,
    // so they revalidate with read permission. A read_only binding must not block resend.
    const requiredOperation = queued.asyncWaitDeliveryOnly ? "read" : "write";
    let boundWorkspace: Awaited<ReturnType<typeof resolveExecutionWorkspace>> = null;
    let resolveError: string | undefined;
    try {
      boundWorkspace = await resolveExecutionWorkspace({
        cfg: queued.run.config,
        agentId: queued.run.agentId,
        client: queued.run.executionIdentity
          ? toRestrictedGatewayClient(queued.run.executionIdentity)
          : buildKnowledgeReplyGatewayClient(queued.run),
        groupId: queued.run.executionIdentity?.collaborationGroupId,
        operation: requiredOperation,
      });
    } catch (err) {
      resolveError = err instanceof Error ? err.message : String(err);
    }

    const lookupRunIdForDecision =
      queued.asyncWaitRecoveryBind?.boundRunId?.trim() ||
      queued.run.taskCompletionBinding?.executionAttempt?.trim() ||
      "";
    const pendingForDecision = lookupRunIdForDecision
      ? peekAwaitingDelivery({
          runId: lookupRunIdForDecision,
          ...(queued.asyncWaitRecoveryBind?.boundDeliveryId
            ? { deliveryId: queued.asyncWaitRecoveryBind.boundDeliveryId }
            : {}),
        })
      : undefined;
    const decisionRunId = pendingForDecision?.runId || lookupRunIdForDecision;
    const decisionDeliveryId =
      queued.asyncWaitRecoveryBind?.boundDeliveryId?.trim() ||
      pendingForDecision?.deliveryId ||
      (decisionRunId ? `delivery:${decisionRunId}:visible` : "");
    const decisionTaskId = pendingForDecision?.taskId;
    const hasDeliveryIdentity = Boolean(decisionRunId || decisionDeliveryId);
    let existingRecovery = undefined as ReturnType<typeof findBlockedFollowupDelivery> | undefined;
    if (queued.run.sessionFile) {
      try {
        existingRecovery = findBlockedFollowupDelivery(
          resolveBlockedFollowupDeliveryPersistRoot(queued.run.sessionFile),
          {
            ...(queued.asyncWaitRecoveryBind?.jobId
              ? { jobId: queued.asyncWaitRecoveryBind.jobId }
              : {}),
            ...(decisionRunId ? { runId: decisionRunId } : {}),
            ...(decisionDeliveryId ? { deliveryId: decisionDeliveryId } : {}),
          },
        );
      } catch {
        existingRecovery = undefined;
      }
    }

    const settleNonContinue = async (
      classification: FollowupWorkspaceClassification,
    ): Promise<void> => {
      const existing = existingRecovery;
      const retryCount =
        classification.destination === "recoverable_wait" && existing?.status === "recoverable_wait"
          ? (existing.retryCount ?? 0) + 1
          : (existing?.retryCount ?? 0);
      const persistDecision = async (opts?: {
        reasonOverride?: string;
        statusOverride?: "recoverable_wait" | "reauthorization_required" | "denied" | "continued";
        pendingDestination?: FollowupWorkspaceClassification["destination"];
        error?: string;
      }): Promise<boolean> =>
        persistWorkspaceDecision({
          queued,
          sessionKey,
          classification,
          runId: decisionRunId,
          deliveryId: decisionDeliveryId,
          taskId: decisionTaskId,
          id: existing?.id,
          retryCount,
          retryCap: existing?.retryCap,
          ...opts,
        });

      let recorded = false;
      if (classification.destination === "denied" && hasDeliveryIdentity) {
        try {
          await confirmPendingTurnDelivery({
            cfg: queued.run.config,
            ...(decisionRunId ? { runId: decisionRunId } : {}),
            ...(decisionDeliveryId ? { deliveryId: decisionDeliveryId } : {}),
            ...(decisionTaskId ? { taskId: decisionTaskId } : {}),
            sessionKey: queued.run.sessionKey ?? sessionKey,
            status: "failed",
            error: classification.reason,
          });
          recorded = await persistDecision({
            statusOverride: "denied",
          });
        } catch (confirmErr) {
          logVerbose(`async-wait delivery-only failure confirm failed: ${String(confirmErr)}`);
          recorded = await persistDecision({
            reasonOverride: "failure_receipt_write_failed",
            statusOverride: "recoverable_wait",
            pendingDestination: "denied",
            error: classification.reason,
          });
        }
      } else if (classification.destination === "denied" && !hasDeliveryIdentity) {
        recorded = await persistDecision({
          reasonOverride: "missing_delivery_identity",
          statusOverride: "recoverable_wait",
          pendingDestination: "denied",
          error: classification.reason,
        });
      } else {
        recorded = await persistDecision();
      }

      if (queued.asyncWaitDeliveryOnly) {
        typing.markRunComplete();
        typing.markDispatchIdle();
      }
      // Drop the queue item only after the destination is durably recorded.
      // Never send against a new unverified binding. If even the durable
      // state cannot be saved, rethrow so drain keeps the item for a later
      // bounded persist retry.
      if (!recorded) {
        throw new Error(classification.reason);
      }
    };

    if (boundWorkspace) {
      const evidence = await loadFollowupRevalidationEvidence({
        resourceId: queued.run.executionWorkspaceBinding?.resourceId || boundWorkspace.resourceId,
        sessionFile: queued.run.sessionFile,
        saved: snapshotFromQueued(queued),
        current: currentEvidenceFromBinding(boundWorkspace, true),
      });
      const classification = classifyFollowupWorkspaceChange({
        saved: snapshotFromQueued(queued),
        current: currentEvidenceFromBinding(boundWorkspace, true),
        savedRealpath: resolveWorkspaceRealpath(queued.run.workspaceDir),
        requiredOperation,
        verifiedMigration: evidence.verifiedMigration,
        savedCatalogLifecycle: evidence.savedCatalogLifecycle,
        savedCatalogOwner: evidence.savedCatalogOwner,
        savedCatalogTenantId: evidence.savedCatalogTenantId,
        trustedTenantId: boundWorkspace.tenantId,
        reauthorizationGrant: existingRecovery?.reauthorizationGrant,
      });

      // Prior authorization or denial records must not auto-continue
      // unless a reauthorization grant is already on the durable record.
      if (
        existingRecovery &&
        (existingRecovery.status === "reauthorization_required" ||
          existingRecovery.status === "denied")
      ) {
        const plan = planFollowupRecoveryRetry(existingRecovery);
        const granted =
          existingRecovery.status === "reauthorization_required" &&
          Boolean(existingRecovery.reauthorizationGrant?.actorIdentity);
        if (!granted && (plan.action === "await_reauthorization" || plan.action === "closed")) {
          await settleNonContinue({
            ...classification,
            destination:
              existingRecovery.status === "denied" ? "denied" : "reauthorization_required",
            reason: existingRecovery.reason,
            code: existingRecovery.status === "denied" ? "denied" : "reauthorization_required",
            askUser: existingRecovery.status === "reauthorization_required",
            askUserDetail: existingRecovery.reauthorization?.detail,
            reauthorization: existingRecovery.reauthorization,
          });
          return;
        }
      }

      if (classification.destination === "continue") {
        const mustRecordContinuation =
          Boolean(existingRecovery) ||
          classification.code !== "unchanged" ||
          Boolean(classification.contentVersionChange) ||
          Boolean(classification.pathNormalization) ||
          Boolean(classification.migration);
        if (mustRecordContinuation) {
          const continued = await persistWorkspaceDecision({
            queued,
            sessionKey,
            classification,
            runId: decisionRunId,
            deliveryId: decisionDeliveryId,
            taskId: decisionTaskId,
            id: existingRecovery?.id,
            ...(queued.asyncWaitDeliveryOnly
              ? { statusOverride: "recoverable_wait" as const }
              : {}),
          });
          if (!continued && (classification.code !== "unchanged" || existingRecovery)) {
            // Version, migration, or a prior wait/reauth record should be
            // recorded as continued so a successful send cannot stay waiting.
            if (queued.asyncWaitDeliveryOnly) {
              typing.markRunComplete();
              typing.markDispatchIdle();
            }
            throw new Error(classification.reason);
          }
        }
        applyWorkspaceContinuation(queued, boundWorkspace, classification);
      } else {
        await settleNonContinue(classification);
        return;
      }
    } else if (resolveError) {
      const evidence = await loadFollowupRevalidationEvidence({
        resourceId: queued.run.executionWorkspaceBinding?.resourceId,
        sessionFile: queued.run.sessionFile,
        saved: snapshotFromQueued(queued),
      });
      const classification = classifyFollowupWorkspaceChange({
        saved: snapshotFromQueued(queued),
        current: null,
        resolveError,
        requiredOperation,
        verifiedMigration: evidence.verifiedMigration,
        savedCatalogLifecycle: evidence.savedCatalogLifecycle,
        savedCatalogOwner: evidence.savedCatalogOwner,
        savedCatalogTenantId: evidence.savedCatalogTenantId,
        reauthorizationGrant: existingRecovery?.reauthorizationGrant,
      });
      if (classification.destination === "continue") {
        throw new Error(resolveError);
      }
      await settleNonContinue(classification);
      return;
    }
    // Agent run correlation id (may differ across retries of the same queue item).
    const runId = crypto.randomUUID();
    // Package2 delivery-only retry: skip business claim/model; resend ORIGINAL payloads.
    if (queued.asyncWaitDeliveryOnly) {
      try {
        const lookupRunId =
          queued.asyncWaitRecoveryBind?.boundRunId?.trim() ||
          queued.run.taskCompletionBinding?.executionAttempt?.trim() ||
          "";
        const pending = lookupRunId
          ? peekAwaitingDelivery({
              runId: lookupRunId,
              ...(queued.asyncWaitRecoveryBind?.boundDeliveryId
                ? { deliveryId: queued.asyncWaitRecoveryBind.boundDeliveryId }
                : {}),
            })
          : undefined;
        const deliveryRunId = pending?.runId || lookupRunId || runId;
        const deliveryId =
          queued.asyncWaitRecoveryBind?.boundDeliveryId?.trim() ||
          pending?.deliveryId ||
          `delivery:${deliveryRunId}:visible`;
        const taskId = pending?.taskId;
        // Prefer queued payloads (from durable recovery intent); never a placeholder.
        let retryPayloads = (queued.asyncWaitDeliveryPayloads ?? []).filter(
          (p) => p && (p.text || p.mediaUrl || (p.mediaUrls && p.mediaUrls.length > 0)),
        );
        if (retryPayloads.length === 0 && queued.asyncWaitRecoveryBind?.jobId) {
          const intent = readAsyncWaitJobIntent(
            queued.run.sessionFile,
            queued.asyncWaitRecoveryBind.jobId,
          );
          retryPayloads = (intent?.recovery?.boundPayloads ?? []).filter(
            (p) => p && (p.text || p.mediaUrl || (p.mediaUrls && p.mediaUrls.length > 0)),
          );
        }
        if (retryPayloads.length === 0) {
          logVerbose(
            "async-wait delivery-only retry refused: original payloads missing — not confirming delivered",
          );
          await confirmPendingTurnDelivery({
            cfg: queued.run.config,
            runId: deliveryRunId,
            deliveryId,
            ...(taskId ? { taskId } : {}),
            sessionKey: queued.run.sessionKey ?? sessionKey,
            status: "failed",
            error: "original_payloads_missing",
          });
        } else {
          const persistRoot = resolveBlockedFollowupDeliveryPersistRoot(queued.run.sessionFile);
          let record = findBlockedFollowupDelivery(persistRoot, {
            runId: deliveryRunId,
            deliveryId,
            jobId: queued.asyncWaitRecoveryBind?.jobId,
          });
          if (!record) {
            record = await recordBlockedFollowupDelivery({
              persistRoot,
              reason: "delivery_receipt_pending",
              error: "",
              runId: deliveryRunId,
              deliveryId,
              taskId,
              sessionFile: queued.run.sessionFile,
              sessionKey: queued.run.sessionKey ?? sessionKey,
              jobId: queued.asyncWaitRecoveryBind?.jobId,
              status: "recoverable_wait",
            });
          }
          const dispatching = await markFollowupRecoveryDeliveryStarted({ persistRoot, record });
          const delivered = await sendFollowupPayloads(retryPayloads, queued, true);
          let confirmStatus: "delivered" | "failed" | "delivery_unknown" =
            delivered === "none" ? "failed" : delivered;
          if (confirmStatus === "failed" || delivered === "none") {
            // Keep retryable for another delivery-only attempt.
            confirmStatus = "delivery_unknown";
          }
          await confirmPendingTurnDelivery({
            cfg: queued.run.config,
            runId: deliveryRunId,
            deliveryId,
            ...(taskId ? { taskId } : {}),
            sessionKey: queued.run.sessionKey ?? sessionKey,
            status: confirmStatus,
          });
          if (confirmStatus === "delivered") {
            await markFollowupRecoveryDeliverySent({ persistRoot, record: dispatching });
          }
        }
      } catch (err) {
        logVerbose(`async-wait delivery-only retry failed: ${String(err)}`);
      } finally {
        typing.markRunComplete();
        typing.markDispatchIdle();
      }
      return;
    }
    // Claim the original queued task before creating outcome/admission/provider side effects.
    // Collaboration plans retain their own admission when no session-task binding exists.
    try {
      const claimed = claimQueuedExecution({
        sessionFile: queued.run.sessionFile,
        runId,
        prompt: queued.prompt,
        binding: queued.run.taskCompletionBinding,
        continuationTicket: queued.taskBoardContinueTicket,
        asyncWaitRecovery: queued.asyncWaitRecoveryBind,
        sessionId: queued.run.sessionId,
        collaboration: Boolean(queued.run.collaborationRoundInvoked),
        privatePlan: Boolean(queued.run.privateRunBag),
      });
      if (claimed.kind === "rejected") {
        try {
          if (claimed.reason === "invalid_binding") {
            await sendFollowupPayloads(
              [
                {
                  text: "这条排队请求的任务身份已失效或尚未绑定，未继续执行。请确认当前任务后重新发送。",
                },
              ],
              queued,
            );
          }
        } finally {
          typing.markRunComplete();
          typing.markDispatchIdle();
        }
        return;
      }
      queued.prompt = claimed.prompt;
      queued.run.taskCompletionBinding = claimed.binding;
    } catch (error) {
      logVerbose(`followup task binding claim failed: ${String(error)}`);
      typing.markRunComplete();
      typing.markDispatchIdle();
      return;
    }
    // askOutcome W1: TaskOutcome identity is the enqueue-stable followupItemId.
    const followupItemId =
      queued.followupItemId?.trim() || (queued.followupItemId = crypto.randomUUID());
    let followupOutcomeTaskId: string | undefined;
    let followupOutcomeScope: import("../../task-outcome/types.js").TrustedScope | undefined;
    let followupCapabilityOutcome:
      | import("../../task-outcome/runtime-from-runner.js").RunnerTurnOutcomeInput["capabilityOutcome"]
      | undefined;
    let followupRunSucceeded: boolean | undefined;
    let followupFailureReason:
      | import("../../task-outcome/runtime-from-runner.js").RunnerTurnFailureReason
      | undefined;
    let followupFailureDetail: string | undefined;
    let followupOutcomeCloseoutDone = false;
    let preparedDelivery:
      | { runId: string; deliveryId: string; taskId: string; agentId: string }
      | undefined;
    /** Real usage-derived USD when the pre-call gate did not already charge this item. */
    let tipBudgetCostUsd: number | undefined;
    let followupBudgetCharged = false;
    let followupBudgetCallSeq = 0;
    const modelCallLinks: ModelCallCloseoutLink[] = [];
    let parentTaskId: string | undefined;
    const submitFollowupOutcomeCloseout = async (overrides?: {
      success?: boolean;
      failureReason?: import("../../task-outcome/runtime-from-runner.js").RunnerTurnFailureReason;
      failureDetail?: string;
      force?: boolean;
      outcome?: GrowthOutcomeCommitOpts;
    }) => {
      if (followupOutcomeCloseoutDone) {
        return;
      }
      if (!followupOutcomeTaskId || !followupOutcomeScope || !queued.run.agentId) {
        return;
      }
      // Skip non-run early exits (ogui pause/ack, empty queue path, etc.) unless forced.
      const shouldClose =
        overrides?.force === true ||
        overrides?.success !== undefined ||
        followupRunSucceeded !== undefined ||
        followupFailureReason !== undefined ||
        followupCapabilityOutcome !== undefined;
      if (!shouldClose) {
        return;
      }
      followupOutcomeCloseoutDone = true;
      const success = overrides?.success ?? followupRunSucceeded ?? false;
      const failureReason = overrides?.failureReason ?? followupFailureReason;
      const failureDetail = overrides?.failureDetail ?? followupFailureDetail;
      // tip runId stays agent correlation; taskId is stable followupItemId child.
      try {
        await recordRunnerTurnOutcome(queued.run.config, queued.run.agentId, {
          success,
          runId,
          taskId: followupOutcomeTaskId,
          scope: followupOutcomeScope,
          entrypoint: "chat",
          ...overrides?.outcome,
          ...(followupBudgetCharged ? { skipBudgetCharge: true } : {}),
          ...(!followupBudgetCharged && tipBudgetCostUsd != null
            ? { costUsd: tipBudgetCostUsd }
            : {}),
          ...(failureReason && !success
            ? { failureReason, ...(failureDetail ? { failureDetail } : {}) }
            : {}),
          ...(followupCapabilityOutcome ? { capabilityOutcome: followupCapabilityOutcome } : {}),
          ...(modelCallLinks.length > 0 ? { modelCallLinks } : {}),
        });
      } catch (err) {
        logVerbose(`followup unified recordRunnerTurnOutcome failed: ${String(err)}`);
      }
    };
    if (queued.run.agentId) {
      const subjectRaw = (
        queued.run.gatewayClientPlatformUserId ??
        queued.run.gatewayClientUser ??
        queued.run.sessionKey ??
        sessionKey ??
        "followup"
      )
        .toString()
        .trim();
      const subjectRef =
        subjectRaw.startsWith("platform-user:") || subjectRaw.includes(":")
          ? subjectRaw
          : `subject:${subjectRaw}`;
      const tenantId =
        queued.run.executionIdentity?.enterpriseId?.trim() ||
        queued.run.executionIdentity?.collaborationOwnerEntitlement?.tenantId?.trim() ||
        undefined;
      parentTaskId =
        queued.parentTaskId?.trim() || queued.run.collaborationTaskId?.trim() || undefined;
      const opened = ensureFollowupTurnTaskOutcome(queued.run.config, {
        agentId: queued.run.agentId,
        runId: followupItemId,
        sessionKey: queued.run.sessionKey ?? sessionKey,
        subjectRef,
        ...(tenantId ? { tenantId } : {}),
        ...(parentTaskId ? { parentTaskId } : {}),
      });
      if (opened.ok) {
        followupOutcomeTaskId = opened.taskId;
        followupOutcomeScope = opened.scope;
      } else {
        logVerbose(`followup task-outcome entry failed: ${opened.code} ${opened.message}`);
      }
    }
    // Followup scene adapter: queue/OGUI/delivery stay here; stage order is controlled.
    const controlledExecution = createUnifiedExecutionLifecycle({
      mode: "turn",
      runId,
      host: bindAdmittedTurnHost(),
    });
    assertControlledExecutionStages(controlledExecution, "Followup host");
    let oguiResume:
      | { storePath: string; sessionKey: string; decisionId: string; resumeRef: string }
      | undefined;
    let oguiModelPrompt: string | undefined;
    let oguiResumeSettled = false;
    try {
      if (queued.run.oguiDecisionRun) {
        const admission = await admitOguiDecisionTurn({
          binding: queued.run.oguiDecisionRun,
          inboundText: queued.prompt,
          ingress: "queue",
          phase: "run",
        });
        if (admission.action === "pause" || admission.action === "ack") {
          await sendFollowupPayloads([{ text: admission.text ?? "" }], queued);
          return;
        }
        if (admission.action === "resume" && admission.decisionId && admission.resumeRef) {
          const binding = queued.run.oguiDecisionRun;
          queued.run.oguiDecisionRun = {
            ...binding,
            decisionId: admission.decisionId,
            resumeRef: admission.resumeRef,
          };
          oguiResume = {
            storePath: binding.storePath,
            sessionKey: binding.sessionKey,
            decisionId: admission.decisionId,
            resumeRef: admission.resumeRef,
          };
          if (admission.acceptedPrompt) {
            oguiModelPrompt = admission.acceptedPrompt;
          }
        }
      }
      const shouldSurfaceToControlUi = isInternalMessageChannel(
        resolveOriginMessageProvider({
          originatingChannel: queued.originatingChannel,
          provider: queued.run.messageProvider,
        }),
      );
      if (queued.run.sessionKey) {
        registerAgentRunContext(runId, {
          sessionKey: queued.run.sessionKey,
          verboseLevel: queued.run.verboseLevel,
          isControlUiVisible: shouldSurfaceToControlUi,
        });
      }
      let autoCompactionCompleted = false;
      let runResult: EmbeddedPiRunResult;
      let fallbackProvider = queued.run.provider;
      let fallbackModel = queued.run.model;
      let modelGate: EmployeeModelGateResult | undefined;
      let consumedCapability: ReturnType<typeof consumeCapabilityRoutingResult> | undefined;
      const activeSessionEntry =
        (sessionKey ? sessionStore?.[sessionKey] : undefined) ?? sessionEntry;
      let bootstrapPromptWarningSignaturesSeen = resolveBootstrapWarningSignaturesSeen(
        activeSessionEntry?.systemPromptReport,
      );
      try {
        // P5（model-entitlement-chain §6.5）：协作小组 / followup 多 bot 回合按 bot 归属席位
        // 接入 Commercial Runtime 统一闸口（P0）。
        const runContextEstimate = buildRunContextEstimateParts({
          taskText: queued.prompt,
          sessionEntry: activeSessionEntry,
          extraSystemPrompt: queued.run.extraSystemPrompt,
        });
        const modelGateInput = {
          cfg: queued.run.config,
          agentId: queued.run.agentId,
          gatewayClientUser: queued.run.gatewayClientUser,
          gatewayClientSessionDomain: queued.run.gatewayClientSessionDomain,
          taskText: queued.prompt,
          contextParts: runContextEstimate.contextParts,
        };
        const prepared = await controlledExecution.prepare({
          config: queued.run.config,
          authorization: {
            agentId: queued.run.agentId,
            ...(queued.run.groupId ? { groupId: queued.run.groupId } : {}),
            modelGateInput,
          },
          signal: opts?.abortSignal,
        });
        if (prepared.kind === "denied") {
          logVerbose(`followup commercial gate blocked: ${prepared.message}`);
          return;
        }
        modelGate = prepared.gate;
        consumedCapability = prepared.capability;
        logVerbose(
          `followup ${formatCapabilityExecutionSurfaceLog(consumedCapability.executionSurface)}`,
        );
        if (prepared.kind === "unavailable") {
          if (consumedCapability.capabilityOutcome) {
            followupCapabilityOutcome = consumedCapability.capabilityOutcome;
          }
          await submitFollowupOutcomeCloseout({
            success: false,
            failureReason: "prepare_failed",
            failureDetail: prepared.message,
          });
          logVerbose(`followup capability plan: ${prepared.message}`);
          return;
        }
        const runFallback = () =>
          controlledExecution.infer({
            cfg: queued.run.config,
            provider: queued.run.provider,
            model: queued.run.model,
            taskText: queued.prompt,
            signal: opts?.abortSignal,
            agentDir: queued.run.agentDir,
            executorEvidence: runnerExecutorEvidenceContext(queued.run.config, queued.run.agentId, {
              taskId: followupOutcomeTaskId,
              scope: followupOutcomeScope,
              runId,
            }),
            fallbacksOverride: resolveRunModelFallbacksOverride({
              cfg: queued.run.config,
              agentId: queued.run.agentId,
              sessionKey: queued.run.sessionKey,
            }),
            run: (provider, model, runOptions) =>
              runQueuedCandidate(
                {
                  queued,
                  provider,
                  model,
                  runId,
                  modelGate,
                  runOptions,
                  modelPrompt: oguiModelPrompt,
                  abortSignal: opts?.abortSignal,
                  suppressToolErrorWarnings: opts?.suppressToolErrorWarnings,
                  bootstrapWarnings: bootstrapPromptWarningSignaturesSeen,
                },
                {
                  assertBudget: () => {
                    if (followupOutcomeTaskId && followupOutcomeScope && queued.run.agentId) {
                      assertRunnerTurnBudgetAllowsModelCall(queued.run.config, queued.run.agentId, {
                        taskId: followupOutcomeTaskId,
                        scope: followupOutcomeScope,
                        ...(parentTaskId
                          ? { parentTaskId, parentAgentId: queued.run.agentId }
                          : {}),
                      });
                    }
                  },
                  onCompaction: () => {
                    autoCompactionCompleted = true;
                  },
                  recordWarnings: (warnings) => {
                    bootstrapPromptWarningSignaturesSeen = warnings;
                  },
                  recordUsage: (identity) => {
                    if (identity.pricingSource !== "transport") {
                      return;
                    }
                    if (followupOutcomeTaskId && followupOutcomeScope && queued.run.agentId) {
                      followupBudgetCallSeq += 1;
                      const charged = chargeModelCallAgainstTip(
                        queued.run.config,
                        queued.run.agentId,
                        {
                          taskId: followupOutcomeTaskId,
                          scope: followupOutcomeScope,
                          runId,
                          callSeq: followupBudgetCallSeq,
                          usage: identity.usage,
                          provider: identity.transportProvider,
                          model: identity.transportModel,
                          ...(parentTaskId
                            ? { parentTaskId, parentAgentId: queued.run.agentId }
                            : {}),
                        },
                      );
                      followupBudgetCharged = true;
                      if (charged.modelCallLink) {
                        modelCallLinks.push(charged.modelCallLink);
                      }
                      if (charged.evidence === "known" && charged.costUsd && charged.costUsd > 0) {
                        tipBudgetCostUsd = (tipBudgetCostUsd ?? 0) + charged.costUsd;
                      }
                    }
                  },
                },
              ),
          });
        const fallbackResult = oguiResume
          ? await runWithOguiDecisionResume({
              storePath: oguiResume.storePath,
              sessionKey: oguiResume.sessionKey,
              decisionId: oguiResume.decisionId,
              resumeRef: oguiResume.resumeRef,
              lifecycleEnabled: true,
              run: runFallback,
            })
          : await runFallback();
        oguiResumeSettled = true;
        runResult = fallbackResult.result;
        fallbackProvider = fallbackResult.provider;
        fallbackModel = fallbackResult.model;

        // Mirror chat path: durable Credits/providerCost outbox for enterprise runs.
        // Outer provider/model stay as selected (may be ent/...), so BYOK ledger skips platform debit.
        if (modelGate?.creditReporting && hasNonzeroUsage(runResult.meta?.agentMeta?.usage)) {
          try {
            const tokenUsage = normalizeUsage(runResult.meta?.agentMeta?.usage);
            const usagePayload = buildCommercialRunCreditUsageInput({
              enterpriseId: modelGate?.creditReporting.enterpriseId,
              policyId: modelGate?.creditReporting.policyId,
              runId,
              provider: fallbackProvider,
              model: fallbackModel,
              agentId: queued.run.agentId,
              durationMs: runResult.meta?.durationMs,
              toolCallCount: 0,
              toolClasses: [],
              fallbackAttemptsRaw: fallbackResult.attempts,
              tokenUsage,
            });
            const receipt = await enqueueUsageOutbox(usagePayload);
            await drainUsageOutboxRecord(receipt).catch((err) => {
              logVerbose(`followup credit usage drain deferred: ${String(err)}`);
            });
          } catch (err) {
            logVerbose(`followup credit usage outbox enqueue failed: ${String(err)}`);
            throw err;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        defaultRuntime.error?.(`Followup agent failed before reply: ${message}`);
        followupRunSucceeded = false;
        if (err instanceof TaskBudgetExceededError) {
          followupFailureReason = "budget_exceeded";
          followupBudgetCharged = true;
        } else {
          followupFailureReason = "run_failed";
        }
        followupFailureDetail = message;
        return;
      }

      const usage = runResult.meta?.agentMeta?.usage;
      const promptTokens = runResult.meta?.agentMeta?.promptTokens;
      const modelUsed = runResult.meta?.agentMeta?.model ?? fallbackModel ?? defaultModel;
      if (!followupBudgetCharged) {
        tipBudgetCostUsd = estimateTipBudgetCostUsdFromUsage({
          usage,
          provider: fallbackProvider,
          model: modelUsed,
          config: queued.run.config,
        });
      }
      const contextTokensUsed =
        agentCfgContextTokens ??
        lookupContextTokens(modelUsed) ??
        sessionEntry?.contextTokens ??
        DEFAULT_CONTEXT_TOKENS;

      if (storePath && sessionKey) {
        await persistRunSessionUsage({
          storePath,
          sessionKey,
          usage,
          lastCallUsage: runResult.meta?.agentMeta?.lastCallUsage,
          promptTokens,
          modelUsed,
          providerUsed: fallbackProvider,
          contextTokensUsed,
          systemPromptReport: runResult.meta?.systemPromptReport,
          logLabel: "followup",
        });
      }

      if (consumedCapability?.capabilityOutcome) {
        followupCapabilityOutcome = consumedCapability.capabilityOutcome;
      }
      // Ordinary run finished the embedded turn; unified closeout in finally records tip.
      followupRunSucceeded = true;
      const payloadArray = runResult.payloads ?? [];
      if (payloadArray.length === 0) {
        return;
      }
      const sanitizedPayloads = payloadArray.flatMap((payload) => {
        const text = payload.text;
        if (!text || !text.includes("HEARTBEAT_OK")) {
          return [payload];
        }
        const stripped = stripHeartbeatToken(text, { mode: "message" });
        const hasMedia = Boolean(payload.mediaUrl) || (payload.mediaUrls?.length ?? 0) > 0;
        if (stripped.shouldSkip && !hasMedia) {
          return [];
        }
        return [{ ...payload, text: stripped.text }];
      });
      const replyToChannel = resolveOriginMessageProvider({
        originatingChannel: queued.originatingChannel,
        provider: queued.run.messageProvider,
      }) as OriginatingChannelType | undefined;
      const replyToMode = resolveReplyToMode(
        queued.run.config,
        replyToChannel,
        queued.originatingAccountId,
        queued.originatingChatType,
      );

      const replyTaggedPayloads: ReplyPayload[] = applyReplyThreading({
        payloads: sanitizedPayloads,
        replyToMode,
        replyToChannel,
      });

      const dedupedPayloads = filterMessagingToolDuplicates({
        payloads: replyTaggedPayloads,
        sentTexts: runResult.messagingToolSentTexts ?? [],
      });
      const mediaFilteredPayloads = filterMessagingToolMediaDuplicates({
        payloads: dedupedPayloads,
        sentMediaUrls: runResult.messagingToolSentMediaUrls ?? [],
      });
      const suppressMessagingToolReplies = shouldSuppressMessagingToolReplies({
        messageProvider: resolveOriginMessageProvider({
          originatingChannel: queued.originatingChannel,
          provider: queued.run.messageProvider,
        }),
        messagingToolSentTargets: runResult.messagingToolSentTargets,
        originatingTo: resolveOriginMessageTo({
          originatingTo: queued.originatingTo,
        }),
        accountId: resolveOriginAccountId({
          originatingAccountId: queued.originatingAccountId,
          accountId: queued.run.agentAccountId,
        }),
      });
      const finalPayloads = suppressMessagingToolReplies ? [] : mediaFilteredPayloads;

      if (finalPayloads.length === 0) {
        return;
      }

      if (autoCompactionCompleted) {
        const count = await incrementRunCompactionCount({
          sessionEntry,
          sessionStore,
          sessionKey,
          storePath,
          lastCallUsage: runResult.meta?.agentMeta?.lastCallUsage,
          contextTokensUsed,
        });
        if (queued.run.verboseLevel && queued.run.verboseLevel !== "off") {
          const suffix = typeof count === "number" ? ` (count ${count})` : "";
          finalPayloads.unshift({
            text: `🧹 Auto-compaction complete${suffix}.`,
          });
        }
      }

      if (followupOutcomeTaskId && followupOutcomeScope && queued.run.agentId) {
        await replyTurnRuntime.delivery.prepareVisibleDelivery(queued.run.config, {
          workspaceDir: queued.run.workspaceDir,
          agentId: queued.run.agentId,
          runId,
          outcomeTaskId: followupOutcomeTaskId,
          sessionKey: queued.run.sessionKey ?? sessionKey,
          sessionFile: queued.run.sessionFile,
          completionBinding: queued.run.taskCompletionBinding,
          contract: resolveTurnContractFromRunMeta(runResult.meta),
          commitOutcome: (success, outcome) => submitFollowupOutcomeCloseout({ success, outcome }),
          payloads: finalPayloads,
          ...(queued.originatingChannel && queued.originatingTo
            ? {
                target: {
                  channel: queued.originatingChannel,
                  to: queued.originatingTo,
                  ...(queued.originatingAccountId
                    ? { accountId: queued.originatingAccountId }
                    : {}),
                  ...(queued.originatingThreadId !== undefined
                    ? { threadId: queued.originatingThreadId }
                    : {}),
                },
                authorization: {
                  ...(queued.run.sessionKey ? { sessionKey: queued.run.sessionKey } : {}),
                  ...(queued.originatingAccountId
                    ? { accountId: queued.originatingAccountId }
                    : {}),
                  channel: queued.originatingChannel,
                  to: queued.originatingTo,
                },
              }
            : {}),
          publishPending: (identity) => {
            preparedDelivery = identity;
            if (
              queued.asyncWaitRecoveryBind?.jobId &&
              queued.asyncWaitRecoveryBind?.claimToken &&
              queued.run.taskCompletionBinding?.taskId
            ) {
              const bound = bindAsyncWaitRecoveryTurn({
                sessionFile: queued.run.sessionFile,
                taskId: queued.run.taskCompletionBinding.taskId,
                jobId: queued.asyncWaitRecoveryBind.jobId,
                claimToken: queued.asyncWaitRecoveryBind.claimToken,
                runId: identity.runId,
                sessionId: queued.run.sessionId,
                deliveryId: identity.deliveryId,
                outcomeTaskId: identity.taskId,
                executionAttempt: identity.runId,
                deliverableVersion:
                  queued.run.taskCompletionBinding.deliverableVersion ?? identity.runId,
                // Persist original visible payloads for delivery-only retry.
                payloads: finalPayloads,
                ...(queued.run.executionWorkspaceBinding
                  ? { boundWorkspace: queued.run.executionWorkspaceBinding }
                  : {}),
              });
              if (!bound.accepted) {
                logVerbose(
                  `async-wait delivery bind rejected: ${bound.reason} — payloads not recorded on intent`,
                );
              }
            }
          },
        });
      }
      const delivered = await sendFollowupPayloads(finalPayloads, queued, true);
      if (preparedDelivery) {
        // Package2 recovery: transport failure must stay retryable (delivery_unknown),
        // not terminal "failed" — otherwise delivery-only cannot upgrade the receipt.
        let confirmStatus: "delivered" | "failed" | "delivery_unknown" =
          delivered === "none" ? "failed" : delivered;
        if (queued.asyncWaitRecoveryBind && (confirmStatus === "failed" || delivered === "none")) {
          confirmStatus = "delivery_unknown";
        }
        await confirmPendingTurnDelivery({
          cfg: queued.run.config,
          ...preparedDelivery,
          sessionKey: queued.run.sessionKey ?? sessionKey,
          status: confirmStatus,
        });
      }
    } catch (err) {
      if (preparedDelivery) {
        await confirmPendingTurnDelivery({
          cfg: queued.run.config,
          ...preparedDelivery,
          sessionKey: queued.run.sessionKey ?? sessionKey,
          status: "failed",
          error: String(err),
        });
      }
      followupRunSucceeded = false;
      followupFailureReason = "run_failed";
      followupFailureDetail = err instanceof Error ? err.message : String(err);
      // Do not rethrow: followup drain must continue; typing cleanup runs in finally.
      defaultRuntime.error?.(`Followup turn failed: ${followupFailureDetail}`);
    } finally {
      // askOutcome W1: unified closeout for ordinary success / preflight fail / exception.
      // Missing evidence → leave acceptance/delivery pending (no invent not_required).
      await submitFollowupOutcomeCloseout();
      // Package2: if recovery turn ended without delivery, release holder so Gateway-alive
      // PID cannot leave permanent active_exec after auth/provider/prepare failure.
      if (
        queued.asyncWaitRecoveryBind?.jobId?.trim() &&
        queued.asyncWaitRecoveryBind?.claimToken?.trim()
      ) {
        try {
          const liveIntent = readAsyncWaitJobIntent(
            queued.run.sessionFile,
            queued.asyncWaitRecoveryBind.jobId,
          );
          if (
            liveIntent?.recovery?.stage === "turn_bound" &&
            !liveIntent.recovery.boundDeliveryId
          ) {
            releaseAsyncWaitRecoveryTurn({
              sessionFile: queued.run.sessionFile,
              jobId: queued.asyncWaitRecoveryBind.jobId,
              claimToken: queued.asyncWaitRecoveryBind.claimToken,
              runId,
            });
          }
        } catch (releaseErr) {
          logVerbose(`async-wait recovery turn release failed: ${String(releaseErr)}`);
        }
      }
      if (oguiResume && !oguiResumeSettled) {
        await releaseOguiDecisionResume({
          storePath: oguiResume.storePath,
          sessionKey: oguiResume.sessionKey,
          decisionId: oguiResume.decisionId,
          resumeRef: oguiResume.resumeRef,
          lifecycleEnabled: true,
        });
      }
      try {
        await controlledExecution.dispose();
      } finally {
        // Both signals are required for the typing controller to clean up.
        // The main inbound dispatch path calls markDispatchIdle() from the
        // buffered dispatcher's finally block, but followup turns bypass the
        // dispatcher entirely — so we must fire both signals here.  Without
        // this, NO_REPLY / empty-payload followups leave the typing indicator
        // stuck (the keepalive loop keeps sending "typing" to Telegram
        // indefinitely until the TTL expires).
        typing.markRunComplete();
        typing.markDispatchIdle();
      }
    }
  };
}
