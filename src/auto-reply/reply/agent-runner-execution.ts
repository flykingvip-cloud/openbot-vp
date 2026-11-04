import crypto from "node:crypto";
import fs from "node:fs";
import { createAdmittedCandidateInvoker } from "../../agent-runtime/execution/runner/index.js";
import { resolveBootstrapWarningSignaturesSeen } from "../../agents/bootstrap-budget.js";
import {
  buildCliBackendCredentialGuidance,
  isLikelyCredentialError,
} from "../../agents/cli-backend-credential-guidance.js";
import { resolveEmbeddedModelGovernance } from "../../agents/embedded-model-governance.js";
import { retryAllowedForMessage } from "../../agents/execution-preflight/index.js";
import {
  buildModelEntitlementEmptyUserMessage,
  isModelEntitlementEmptyError,
  runWithModelFallback,
} from "../../agents/model-fallback.js";
import { isCliProvider } from "../../agents/model-selection.js";
import {
  isCompactionFailureError,
  isContextOverflowError,
  isLikelyContextOverflowError,
  isTransientHttpError,
  sanitizeUserFacingText,
} from "../../agents/pi-embedded-helpers.js";
import type { EmbeddedPiRunResult } from "../../agents/pi-embedded-runner/types.js";
import { userFacingPreReplyFailure } from "../../agents/sandbox/docker-engine-client.js";
import { isSoftRecoverableEntitlementFailure } from "../../agents/sandbox/user-facing-entitlement-failure.js";
import { noteSkillSmokeClock } from "../../agents/turn-completion/contract.js";
import { normalizeUsage } from "../../agents/usage.js";
import {
  resolveSessionTranscriptPath,
  type SessionEntry,
  updateSessionStore,
} from "../../config/sessions.js";
import { isTaskExecutionBindingCurrent } from "../../conversation-task/session-task-board.js";
import { syncRobotGrowthFromOperationalMetrics } from "../../gateway/agent-growth/operational-growth.js";
import {
  releaseEnterpriseAgentRun,
  tryAcquireEnterpriseAgentRun,
} from "../../gateway/billing/agent-run-governance.js";
import { recordCreditUsage } from "../../gateway/billing/record-credit-usage.js";
import { reportEvolutionOutcomeWriteFailure } from "../../gateway/evolution-control/evolution-loop-log.js";
import {
  buildRunModelSetSnapshot,
  forgetRunModelSet,
  rememberRunModelSet,
  snapshotCreditReportingFromGate,
} from "../../gateway/governance/spawn-snapshot-handoff.js";
import {
  recordAorRoutingExplanation,
  recordAorRunFeedback,
} from "../../gateway/model-entitlement/aor-feedback.js";
import {
  consumeCapabilityRoutingResult,
  type CapabilityOutcomeForTurn,
} from "../../gateway/model-entitlement/capability-entry-consume.js";
import { type EmployeeModelGateResult } from "../../gateway/model-entitlement/employee-model-gate.js";
import { buildRunContextEstimateParts } from "../../gateway/model-entitlement/run-context-estimate.js";
import { resolveExecutionRoutingFromCapabilityPlan } from "../../gateway/model-entitlement/task-capability-plan.js";
import {
  formatPlatformAdmissionEmptyMessage,
  isPlatformAdmissionEmptyError,
} from "../../gateway/models/capability-admission/apply-runtime-admission.js";
import { resolvePlatformModelsMode } from "../../gateway/models/platform-models-config.js";
import { logVerbose } from "../../globals.js";
import { registerAgentRunContext } from "../../infra/agent-events.js";
import { defaultRuntime } from "../../runtime.js";
import { registerRunReplyLanguage } from "../../shared/text/run-reply-language.js";
import { ensureChatTurnTaskOutcome } from "../../task-outcome/chat-entry.js";
import type { ModalityExecutionArtifact } from "../../task-outcome/modality-artifact-evidence.js";
import {
  assessRunnerTurnBudgetGate,
  chargeModelCallAgainstTip,
  recordRunnerTurnOutcome,
  TaskBudgetExceededError,
  type GrowthOutcomeCommitOpts,
  type RunnerTurnFailureReason,
} from "../../task-outcome/runtime-from-runner.js";
import { normalizeTaskOutcomeSubjectRef } from "../../task-outcome/subject-ref.js";
import { isInternalMessageChannel } from "../../utils/message-channel.js";
import { stripHeartbeatToken } from "../heartbeat.js";
import type { TemplateContext } from "../templating.js";
import type { VerboseLevel } from "../thinking.js";
import {
  HEARTBEAT_TOKEN,
  isSilentReplyPrefixText,
  isSilentReplyText,
  SILENT_REPLY_TOKEN,
} from "../tokens.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import {
  buildCommercialRunCreditUsageInput,
  type RuntimeFallbackAttempt,
} from "./agent-run-credit-usage.js";
import { resolveModelFallbackOptions } from "./agent-runner-utils.js";
import { type BlockReplyPipeline } from "./block-reply-pipeline.js";
import { recordHonestCapabilityGap } from "./honest-empty-reply.js";
import { buildUserFacingModelCallFailure } from "./model-call-failure-copy.js";
import type { FollowupRun } from "./queue.js";
import { createReplyMediaPathNormalizer } from "./reply-media-paths.js";
import type { TypingSignaler } from "./typing-mode.js";

export type { RuntimeFallbackAttempt } from "./agent-run-credit-usage.js";

export type AgentRunLoopResult =
  | {
      kind: "success";
      runId: string;
      runResult: EmbeddedPiRunResult;
      fallbackProvider?: string;
      fallbackModel?: string;
      fallbackAttempts: RuntimeFallbackAttempt[];
      didLogHeartbeatStrip: boolean;
      autoCompactionCompleted: boolean;
      /** Payload keys sent directly (not via pipeline) during tool flush. */
      directlySentBlockKeys?: Set<string>;
      /** True when this turn already invoked tools. Empty Layer C may then emit a process sentence. */
      didUseTools?: boolean;
      /**
       * Commit growth/operational outcome after delivery classification.
       * Must be called exactly once on the success path (agent-runner).
       * Pass explicit acceptance/delivery from a resolved contract to close success;
       * bare success or processPlaceholder leaves the task incomplete.
       */
      commitGrowthOutcome: (
        success: boolean,
        opts?: GrowthOutcomeCommitOpts,
      ) => void | Promise<void>;
    }
  | { kind: "final"; payload: ReplyPayload };

export type AgentTurnExecutionParams = {
  commandBody: string;
  followupRun: FollowupRun;
  sessionCtx: TemplateContext;
  opts?: GetReplyOptions;
  typingSignals: TypingSignaler;
  blockReplyPipeline: BlockReplyPipeline | null;
  blockStreamingEnabled: boolean;
  blockReplyChunking?: {
    minChars: number;
    maxChars: number;
    breakPreference: "paragraph" | "newline" | "sentence";
    flushOnParagraph?: boolean;
  };
  resolvedBlockStreamingBreak: "text_end" | "message_end";
  applyReplyToMode: (payload: ReplyPayload) => ReplyPayload;
  shouldEmitToolResult: () => boolean;
  shouldEmitToolOutput: () => boolean;
  pendingToolTasks: Set<Promise<void>>;
  resetSessionAfterCompactionFailure: (reason: string) => Promise<boolean>;
  resetSessionAfterRoleOrderingConflict: (reason: string) => Promise<boolean>;
  isHeartbeat: boolean;
  sessionKey?: string;
  getActiveSessionEntry: () => SessionEntry | undefined;
  activeSessionStore?: Record<string, SessionEntry>;
  storePath?: string;
  resolvedVerboseLevel: VerboseLevel;
};

export async function runAgentTurnWithFallback(
  params: AgentTurnExecutionParams,
): Promise<AgentRunLoopResult> {
  const assertOriginalTaskCurrent = () => {
    const binding = params.followupRun.run.taskCompletionBinding;
    if (binding && !isTaskExecutionBindingCurrent(params.followupRun.run.sessionFile, binding)) {
      throw new Error("Original task was paused, closed or replaced before provider startup");
    }
  };
  const TRANSIENT_HTTP_RETRY_DELAY_MS = 2_500;
  const SOFT_ENTITLEMENT_RETRY_DELAY_MS = 400;
  let didLogHeartbeatStrip = false;
  let autoCompactionCompleted = false;
  // Track payloads sent directly (not via pipeline) during tool flush to avoid duplicates.
  const directlySentBlockKeys = new Set<string>();

  const runId = params.opts?.runId ?? crypto.randomUUID();
  // askOutcome R83：入口创建/恢复真实 taskId（禁止收尾用 runId 补造）。
  const growthAgentIdForEntry = params.followupRun.run.agentId;
  let chatOutcomeTaskId: string | undefined;
  let chatOutcomeScope: import("../../task-outcome/types.js").TrustedScope | undefined;
  if (!params.isHeartbeat && growthAgentIdForEntry) {
    const subjectRef = (
      params.followupRun.run.gatewayClientPlatformUserId ??
      params.sessionCtx.GatewayClientPlatformUserId ??
      params.followupRun.run.gatewayClientUser ??
      params.sessionCtx.GatewayClientUser ??
      params.sessionKey ??
      "anonymous"
    )
      .toString()
      .trim();
    const tenantId =
      params.followupRun.run.executionIdentity?.enterpriseId?.trim() ||
      params.followupRun.run.executionIdentity?.collaborationOwnerEntitlement?.tenantId?.trim() ||
      undefined;
    const opened = ensureChatTurnTaskOutcome(params.followupRun.run.config, {
      agentId: growthAgentIdForEntry,
      runId,
      sessionKey: params.sessionKey,
      subjectRef: normalizeTaskOutcomeSubjectRef(subjectRef),
      ...(tenantId ? { tenantId } : {}),
    });
    if (opened.ok) {
      chatOutcomeTaskId = opened.taskId;
      chatOutcomeScope = opened.scope;
    }
  }
  // askOutcome P0：turn 收尾走统一 TaskOutcome（fire-and-forget，绝不影响回复）。
  // 心跳不算任务；run 成功不再直接记任务成功 / evolution success（挂起验收）。
  // 工具成功率仍在 turn 内内存累加、收尾一次落盘。
  let growthToolTotal = 0;
  let growthToolSucceeded = 0;
  const modalityArtifacts: ModalityExecutionArtifact[] = [];
  const growthStartedAt = Date.now();
  /** Tip budget wall-clock start = task entry time (not first closeout spend). */
  const tipBudgetStartedAtMs = growthStartedAt;
  let tipBudgetChargedThisTurn = false;
  let tipBudgetModelCallSeq = 0;
  const assertTipBudgetAllowsModelCall = (): void => {
    if (!chatOutcomeTaskId || !chatOutcomeScope || params.isHeartbeat || !growthAgentIdForEntry) {
      return;
    }
    const gate = assessRunnerTurnBudgetGate(params.followupRun.run.config, growthAgentIdForEntry, {
      taskId: chatOutcomeTaskId,
      scope: chatOutcomeScope,
      startedAtMs: tipBudgetStartedAtMs,
    });
    if (!gate.allowed) {
      throw new TaskBudgetExceededError(chatOutcomeTaskId, gate.exhaustion);
    }
  };
  const chargeTipBudgetAfterModelCall = (opts: {
    provider: string;
    model: string;
    usage?: unknown;
  }): void => {
    if (!chatOutcomeTaskId || !chatOutcomeScope || params.isHeartbeat || !growthAgentIdForEntry) {
      return;
    }
    tipBudgetModelCallSeq += 1;
    chargeModelCallAgainstTip(params.followupRun.run.config, growthAgentIdForEntry, {
      taskId: chatOutcomeTaskId,
      scope: chatOutcomeScope,
      runId,
      callSeq: tipBudgetModelCallSeq,
      usage: opts.usage,
      provider: opts.provider,
      model: opts.model,
    });
    tipBudgetChargedThisTurn = true;
  };
  let modelGate: EmployeeModelGateResult | undefined;
  let capabilityOutcomeForTurn: CapabilityOutcomeForTurn | undefined;
  const recordGrowthToolResult = (isError: boolean): void => {
    growthToolTotal += 1;
    if (!isError) {
      growthToolSucceeded += 1;
    }
  };
  const classifyFailureReason = (opts?: {
    aborted?: boolean;
    authzDenied?: boolean;
    languageFiltered?: boolean;
    providerFault?: boolean;
    timeout?: boolean;
    prepareFailed?: boolean;
    message?: string;
    explicit?: RunnerTurnFailureReason;
  }): RunnerTurnFailureReason => {
    if (opts?.explicit) {
      return opts.explicit;
    }
    if (opts?.aborted || params.opts?.abortSignal?.aborted) {
      return "user_cancelled";
    }
    if (opts?.authzDenied) {
      return "authz_denied";
    }
    if (opts?.languageFiltered) {
      return "user_filtered";
    }
    if (opts?.prepareFailed) {
      return "prepare_failed";
    }
    if (opts?.timeout || /timeout|ETIMEDOUT|timed out/i.test(opts?.message ?? "")) {
      return "timeout";
    }
    if (opts?.providerFault) {
      return "provider_fault";
    }
    return "run_failed";
  };

  const recordGrowthTaskOutcome = (
    success: boolean,
    opts?: GrowthOutcomeCommitOpts & {
      aborted?: boolean;
      authzDenied?: boolean;
      languageFiltered?: boolean;
      providerFault?: boolean;
      timeout?: boolean;
      prepareFailed?: boolean;
      errorMessage?: string;
    },
  ): void | Promise<void> => {
    if (params.isHeartbeat) {
      return;
    }
    const growthAgentId = params.followupRun.run.agentId;
    if (!growthAgentId) {
      return;
    }
    const toolsTotal = growthToolTotal;
    const toolsSucceeded = growthToolSucceeded;
    const artifactsForTurn = [...modalityArtifacts];
    growthToolTotal = 0;
    growthToolSucceeded = 0;
    modalityArtifacts.length = 0;
    const tenantId = modelGate?.tenantId?.trim();
    // askOutcome R83: requires entry taskId; never invent run:${runId} at finish.
    if (!chatOutcomeTaskId || !chatOutcomeScope) {
      reportEvolutionOutcomeWriteFailure({
        runId,
        agentId: growthAgentId,
        tenantId: tenantId ?? null,
        taskId: null,
        reason: "chat_entry_task_missing",
      });
      return;
    }
    const failureReason = !success
      ? classifyFailureReason({
          explicit: opts?.failureReason,
          aborted: opts?.aborted,
          authzDenied: opts?.authzDenied,
          languageFiltered: opts?.languageFiltered,
          providerFault: opts?.providerFault,
          timeout: opts?.timeout,
          prepareFailed: opts?.prepareFailed,
          message: opts?.errorMessage ?? opts?.failureDetail,
        })
      : undefined;
    return recordRunnerTurnOutcome(params.followupRun.run.config, growthAgentId, {
      success,
      toolsTotal,
      toolsSucceeded,
      runId,
      taskId: chatOutcomeTaskId,
      scope: chatOutcomeScope,
      latencyMs: Math.max(0, Date.now() - growthStartedAt),
      ...(tenantId ? { tenantId } : {}),
      ...(capabilityOutcomeForTurn ? { capabilityOutcome: capabilityOutcomeForTurn } : {}),
      ...(artifactsForTurn.length > 0 ? { modalityArtifacts: artifactsForTurn } : {}),
      ...(failureReason ? { failureReason } : {}),
      ...(opts?.failureDetail ? { failureDetail: opts.failureDetail } : {}),
      ...(opts?.acceptance ? { acceptance: opts.acceptance } : {}),
      ...(opts?.delivery ? { delivery: opts.delivery } : {}),
      ...(opts?.deliveryId ? { deliveryId: opts.deliveryId } : {}),
      ...(opts?.acceptanceEvidence ? { acceptanceEvidence: opts.acceptanceEvidence } : {}),
      ...(opts?.processPlaceholder ? { processPlaceholder: true } : {}),
      ...(opts?.allowRetry !== undefined ? { allowRetry: opts.allowRetry } : {}),
      ...(opts?.adoptedAssetIds && opts.adoptedAssetIds.length > 0
        ? { adoptedAssetIds: opts.adoptedAssetIds }
        : {}),
      ...(tipBudgetChargedThisTurn || opts?.skipBudgetCharge ? { skipBudgetCharge: true } : {}),
    })
      .then(async () => {
        await syncRobotGrowthFromOperationalMetrics(params.followupRun.run.config, growthAgentId);
      })
      .catch((error: unknown) => {
        // Evolution / TaskOutcome write must stay observable. The user-facing
        // reply path is already decided and is not rewritten here.
        reportEvolutionOutcomeWriteFailure({
          runId,
          agentId: growthAgentId,
          tenantId: tenantId ?? null,
          taskId: chatOutcomeTaskId ?? null,
          reason: error instanceof Error ? error.message : "evolution_outcome_write_failed",
        });
      });
  };
  const normalizeReplyMediaPaths = createReplyMediaPathNormalizer({
    cfg: params.followupRun.run.config,
    sessionKey: params.sessionKey,
    workspaceDir: params.followupRun.run.workspaceDir,
    gatewayClientUser:
      params.followupRun.run.gatewayClientUser ?? params.sessionCtx.GatewayClientUser,
    gatewayClientPlatformUserId:
      params.followupRun.run.gatewayClientPlatformUserId ??
      params.sessionCtx.GatewayClientPlatformUserId,
    gatewayClientSessionEnterpriseId:
      params.followupRun.run.executionIdentity?.enterpriseId ??
      params.sessionCtx.CollaborationTenantId ??
      params.sessionCtx.GatewayClientSessionEnterpriseId,
    executionIdentity: params.followupRun.run.executionIdentity,
  });
  let didNotifyAgentRunStart = false;
  const notifyAgentRunStart = () => {
    if (didNotifyAgentRunStart) {
      return;
    }
    didNotifyAgentRunStart = true;
    params.opts?.onAgentRunStart?.(runId);
  };
  const shouldSurfaceToControlUi = isInternalMessageChannel(
    params.followupRun.run.messageProvider ??
      params.sessionCtx.Surface ??
      params.sessionCtx.Provider,
  );
  if (params.sessionKey) {
    const smokeStartedAtMs = noteSkillSmokeClock({
      sessionKey: params.sessionKey,
      userText: params.commandBody,
      nowMs: Date.now(),
    });
    registerAgentRunContext(runId, {
      sessionKey: params.sessionKey,
      verboseLevel: params.resolvedVerboseLevel,
      isHeartbeat: params.isHeartbeat,
      isControlUiVisible: shouldSurfaceToControlUi,
      turnCompletion: {
        userText: params.commandBody,
        workspaceDir: params.followupRun.run.workspaceDir,
        ...(smokeStartedAtMs != null ? { smokeStartedAtMs } : {}),
      },
    });
    registerRunReplyLanguage(runId, params.opts?.expectedReplyLanguage ?? null);
  }
  let runResult: EmbeddedPiRunResult;
  let fallbackProvider = params.followupRun.run.provider;
  let fallbackModel = params.followupRun.run.model;
  let fallbackAttempts: RuntimeFallbackAttempt[] = [];
  let didResetAfterCompactionFailure = false;
  let didRetryTransientHttpError = false;
  let didRetrySoftEntitlement = false;
  let commercialToolCallCount = 0;
  const commercialToolClasses: string[] = [];
  let bootstrapPromptWarningSignaturesSeen = resolveBootstrapWarningSignaturesSeen(
    params.getActiveSessionEntry()?.systemPromptReport,
  );

  let enterpriseRunSlotHeld = false;
  let commercialAuthDecisionId: string | undefined;
  let commercialSubscriptionId: string | undefined;
  let commercialPlanId: string | undefined;
  let commercialPlanVersionId: string | undefined;
  let commercialSubscriptionSnapshotId: string | undefined;
  try {
    while (true) {
      commercialToolCallCount = 0;
      commercialToolClasses.length = 0;
      try {
        const normalizeStreamingText = (
          payload: ReplyPayload,
        ): { text?: string; skip: boolean; sanitizedEmpty?: boolean } => {
          let text = payload.text;
          if (!params.isHeartbeat && text?.includes("HEARTBEAT_OK")) {
            const stripped = stripHeartbeatToken(text, {
              mode: "message",
            });
            if (stripped.didStrip && !didLogHeartbeatStrip) {
              didLogHeartbeatStrip = true;
              logVerbose("Stripped stray HEARTBEAT_OK token from reply");
            }
            if (stripped.shouldSkip && (payload.mediaUrls?.length ?? 0) === 0) {
              return { skip: true };
            }
            text = stripped.text;
          }
          if (isSilentReplyText(text, SILENT_REPLY_TOKEN)) {
            return { skip: true };
          }
          if (
            isSilentReplyPrefixText(text, SILENT_REPLY_TOKEN) ||
            isSilentReplyPrefixText(text, HEARTBEAT_TOKEN)
          ) {
            return { skip: true };
          }
          if (!text) {
            // Allow media-only payloads (e.g. tool result screenshots) through.
            if ((payload.mediaUrls?.length ?? 0) > 0) {
              return { text: undefined, skip: false };
            }
            return { skip: true };
          }
          const sanitized = sanitizeUserFacingText(text, {
            errorContext: Boolean(payload.isError),
          });
          if (!sanitized.trim()) {
            return { skip: true, sanitizedEmpty: true };
          }
          return { text: sanitized, skip: false };
        };
        const handlePartialForTyping = async (
          payload: ReplyPayload,
        ): Promise<string | undefined> => {
          if (isSilentReplyPrefixText(payload.text, SILENT_REPLY_TOKEN)) {
            return undefined;
          }
          const { text, skip } = normalizeStreamingText(payload);
          if (skip || !text) {
            return undefined;
          }
          await params.typingSignals.signalTextDelta(text);
          return text;
        };
        const runGatewayClientUser =
          params.followupRun.run.gatewayClientUser ?? params.sessionCtx.GatewayClientUser;
        const runGatewayClientSessionDomain =
          params.followupRun.run.gatewayClientSessionDomain ??
          params.sessionCtx.GatewayClientSessionDomain;
        const runGatewayClientPlatformUserId =
          params.followupRun.run.gatewayClientPlatformUserId ??
          params.sessionCtx.GatewayClientPlatformUserId;
        // Commercial Runtime 统一闸口（P0）：model gate + 并发占槽 + 订阅 snapshot。
        const runContextEstimate = buildRunContextEstimateParts({
          taskText: params.commandBody,
          sessionEntry: params.getActiveSessionEntry(),
          extraSystemPrompt: params.followupRun.run.extraSystemPrompt,
        });
        const modelGateInput = {
          cfg: params.followupRun.run.config,
          agentId: params.followupRun.run.agentId,
          gatewayClientUser: runGatewayClientUser,
          gatewayClientSessionDomain: runGatewayClientSessionDomain,
          gatewayClientPlatformUserId: runGatewayClientPlatformUserId,
          taskText: params.commandBody,
          contextParts: runContextEstimate.contextParts,
          ...(params.sessionCtx.CollaborationGroupOwnerEntitlement
            ? {
                collaborationGroupOwnerEntitlement:
                  params.sessionCtx.CollaborationGroupOwnerEntitlement,
              }
            : {}),
        };
        if (!enterpriseRunSlotHeld) {
          const collaborationGroupId = params.sessionCtx.CollaborationGroupId?.trim();
          const runSlot = await tryAcquireEnterpriseAgentRun({
            runId,
            agentId: params.followupRun.run.agentId,
            ...(collaborationGroupId ? { groupId: collaborationGroupId } : {}),
            modelGateInput,
          });
          if (!runSlot.skipped && !runSlot.acquired) {
            void recordGrowthTaskOutcome(false, {
              authzDenied: true,
              failureDetail: "enterprise_run_slot_denied",
            });
            return {
              kind: "final",
              payload: {
                text: runSlot.message,
              },
            };
          }
          if (runSlot.acquired) {
            if (runSlot.modelGate) {
              modelGate = runSlot.modelGate;
            }
            enterpriseRunSlotHeld = true;
            commercialAuthDecisionId = runSlot.authorizationDecisionId;
            commercialSubscriptionId = runSlot.subscriptionId;
            commercialPlanId = runSlot.planId;
            commercialPlanVersionId = runSlot.planVersionId;
            commercialSubscriptionSnapshotId = runSlot.subscriptionSnapshotId;
          }
        }
        const actorId = runGatewayClientPlatformUserId?.trim()
          ? `platform-user:${runGatewayClientPlatformUserId.trim()}`
          : undefined;
        // P3-1: explicit mode (default shadow) + preexisting hard-filter when allowlist is an array.
        const executionRouting = resolveExecutionRoutingFromCapabilityPlan({
          allowlist: modelGate?.allowlist,
          preferredModelOrder: modelGate?.preferredModelOrder,
          capabilityPlan: modelGate?.capabilityPlan,
        });
        const consumedCapability = consumeCapabilityRoutingResult({
          planFailure: executionRouting.planFailure,
          outcomeClaim: executionRouting.outcomeClaim,
          executionSurface: executionRouting.executionSurface,
          capabilityPlan: executionRouting.capabilityPlan,
        });
        if (consumedCapability.capabilityOutcome) {
          capabilityOutcomeForTurn = consumedCapability.capabilityOutcome;
        }
        if (executionRouting.planFailure.kind === "no_executable_candidates") {
          void recordGrowthTaskOutcome(false);
          return {
            kind: "final",
            payload: {
              text: executionRouting.planFailure.message,
            },
          };
        }
        const embeddedModelGovernance = resolveEmbeddedModelGovernance({
          gateStatus: enterpriseRunSlotHeld ? "acquired" : "skipped",
          allowlist: executionRouting.allowlist,
          tenantId: modelGate?.tenantId,
          commercialAuthorizationId: commercialAuthDecisionId,
          actorId,
        });
        const parentSnapshot = buildRunModelSetSnapshot({
          runId,
          allowlist: executionRouting.allowlist,
          governanceMode: embeddedModelGovernance.governanceMode,
          commercialAuthorizationId: commercialAuthDecisionId,
          tenantId: modelGate?.tenantId,
          actorId,
          preferredModelOrder: executionRouting.preferredModelOrder,
          platformModelsMode:
            modelGate?.effectiveRouting?.mode ??
            resolvePlatformModelsMode(params.followupRun.run.config),
          ...(modelGate?.effectiveRouting?.selectorStrategy
            ? { selectorStrategy: modelGate?.effectiveRouting.selectorStrategy }
            : {}),
          // P4-1: parent billing context for child runs, only while this run holds the gate.
          creditReporting: enterpriseRunSlotHeld
            ? snapshotCreditReportingFromGate({
                modelGate,
                subscriptionId: commercialSubscriptionId,
                subscriptionSnapshotId: commercialSubscriptionSnapshotId,
                planId: commercialPlanId,
                planVersionId: commercialPlanVersionId,
              })
            : undefined,
        });
        if (parentSnapshot) {
          rememberRunModelSet(runId, parentSnapshot);
        }
        const invokeCandidate = createAdmittedCandidateInvoker(params, runId, {
          assertOriginalTaskCurrent,
          directlySentBlockKeys,
          assertTipBudgetAllowsModelCall,
          chargeTipBudgetAfterModelCall,
          notifyAgentRunStart,
          handlePartialForTyping,
          normalizeStreamingText,
          normalizeReplyMediaPaths,
          recordGrowthToolResult,
          recordCommercialToolStart: (name) => {
            commercialToolCallCount += 1;
            commercialToolClasses.push(name);
          },
          recordModalityArtifact: (artifact) => {
            modalityArtifacts.push(artifact);
          },
          markAutoCompactionCompleted: () => {
            autoCompactionCompleted = true;
          },
          getBootstrapWarnings: () => bootstrapPromptWarningSignaturesSeen,
          setBootstrapWarnings: (warnings) => {
            bootstrapPromptWarningSignaturesSeen = warnings;
          },
          getModelGate: () => modelGate,
          identity: {
            user: runGatewayClientUser,
            domain: runGatewayClientSessionDomain,
            platformUserId: runGatewayClientPlatformUserId,
          },
        });
        const fallbackResult = await runWithModelFallback({
          ...resolveModelFallbackOptions(params.followupRun.run),
          ...embeddedModelGovernance,
          ...(executionRouting.preferredModelOrder
            ? { preferredModelOrder: executionRouting.preferredModelOrder }
            : {}),
          runtimeAdmission: {
            taskText: params.followupRun.prompt || params.commandBody,
          },
          runId,
          run: (provider, model, runOptions) => {
            // Notify that model selection is complete (including after fallback).
            // This allows responsePrefix template interpolation with the actual model.
            params.opts?.onModelSelected?.({
              provider,
              model,
              thinkLevel: params.followupRun.run.thinkLevel,
            });

            return invokeCandidate(provider, model, runOptions);
          },
        });
        runResult = fallbackResult.result;
        fallbackProvider = fallbackResult.provider;
        fallbackModel = fallbackResult.model;
        fallbackAttempts = Array.isArray(fallbackResult.attempts)
          ? fallbackResult.attempts.map((attempt) => ({
              provider: String(attempt.provider ?? ""),
              model: String(attempt.model ?? ""),
              error: String(attempt.error ?? ""),
              reason: attempt.reason ? String(attempt.reason) : undefined,
              status: typeof attempt.status === "number" ? attempt.status : undefined,
              code: attempt.code ? String(attempt.code) : undefined,
            }))
          : [];
        // P3 任务 14：aor_enhanced 下运行完成后回写 bandit 学习信号（仅在启用 bandit 时）。
        // 用量计费沿用既有 usage 事件，不在此重复计费。
        if (modelGate?.aorFeedback) {
          recordAorRunFeedback({
            banditStatePath: modelGate?.aorFeedback.banditStatePath,
            provider: fallbackResult.provider,
            model: fallbackResult.model,
            taskTypeId: modelGate?.aorFeedback.taskTypeId,
          });
        }
        // P3 收口：写入 AOR 路由解释审计日志（投影 loadAuditExplanations 读取同一文件）。
        if (modelGate?.aorRouting) {
          const selectedKey = `${fallbackResult.provider}/${fallbackResult.model}`;
          const explanation = modelGate?.aorRouting.explanationByModelId[selectedKey];
          recordAorRoutingExplanation({
            auditLogPath: modelGate?.aorRouting.auditLogPath,
            runId,
            taskTypeId: modelGate?.aorRouting.taskTypeId,
            strategy: modelGate?.aorRouting.strategy,
            provider: fallbackResult.provider,
            model: fallbackResult.model,
            ...(explanation ? { reason: explanation.reason, score: explanation.score } : {}),
          });
        }
        // V2 Phase 3：Credits 计量（ledger + ai_credits 用量双写）。
        if (modelGate?.creditReporting) {
          const tokenUsage = normalizeUsage(runResult.meta?.agentMeta?.usage);
          const creditUserId =
            params.sessionCtx.CollaborationGroupOwnerEntitlement?.userEmail?.trim() ||
            params.sessionCtx.CollaborationGroupOwnerEntitlement?.employeeId?.trim() ||
            params.sessionCtx.GatewayClientUser;
          void recordCreditUsage(
            buildCommercialRunCreditUsageInput({
              enterpriseId: modelGate?.creditReporting.enterpriseId,
              policyId: modelGate?.creditReporting.policyId,
              runId,
              provider: fallbackResult.provider,
              model: fallbackResult.model,
              creditUserId,
              agentId: params.followupRun.run.agentId,
              authorizationDecisionId: commercialAuthDecisionId,
              subscriptionId: commercialSubscriptionId,
              planId: commercialPlanId,
              planVersionId: commercialPlanVersionId,
              subscriptionSnapshotId: commercialSubscriptionSnapshotId,
              durationMs: runResult.meta?.durationMs,
              toolCallCount: commercialToolCallCount,
              toolClasses: commercialToolClasses,
              fallbackAttemptsRaw: fallbackResult.attempts,
              tokenUsage,
            }),
          ).catch((err) => {
            logVerbose(`credit usage record failed: ${String(err)}`);
          });
        }

        // Some embedded runs surface context overflow as an error payload instead of throwing.
        // Treat those as a session-level failure and auto-recover by starting a fresh session.
        const embeddedError = runResult.meta?.error;
        if (
          embeddedError &&
          isContextOverflowError(embeddedError.message) &&
          !didResetAfterCompactionFailure &&
          (await params.resetSessionAfterCompactionFailure(embeddedError.message))
        ) {
          didResetAfterCompactionFailure = true;
          return {
            kind: "final",
            payload: {
              text: "⚠️ Context limit exceeded. I've reset our conversation to start fresh - please try again.\n\nTo prevent this, increase your compaction buffer by setting `agents.defaults.compaction.reserveTokensFloor` to 20000 or higher in your config.",
            },
          };
        }
        if (embeddedError?.kind === "role_ordering") {
          const didReset = await params.resetSessionAfterRoleOrderingConflict(
            embeddedError.message,
          );
          if (didReset) {
            return {
              kind: "final",
              payload: {
                text: "⚠️ Message ordering conflict. I've reset the conversation - please try again.",
              },
            };
          }
        }

        break;
      } catch (err) {
        if (err instanceof TaskBudgetExceededError) {
          void recordGrowthTaskOutcome(false, {
            failureReason: "other",
            failureDetail: err.message.slice(0, 200),
            skipBudgetCharge: tipBudgetChargedThisTurn,
          });
          return {
            kind: "final",
            payload: {
              text: "⚠️ 任务预算已耗尽，已停止继续调用模型。请缩小范围或开新任务后再试。",
            },
          };
        }
        if (isModelEntitlementEmptyError(err)) {
          return {
            kind: "final",
            payload: {
              text: `⚠️ ${buildModelEntitlementEmptyUserMessage(modelGate?.entitlementHint)}`,
            },
          };
        }
        if (isPlatformAdmissionEmptyError(err)) {
          return {
            kind: "final",
            payload: {
              text: `⚠️ ${formatPlatformAdmissionEmptyMessage(err.decision)}`,
            },
          };
        }
        const message = err instanceof Error ? err.message : String(err);
        const isContextOverflow = isLikelyContextOverflowError(message);
        const isCompactionFailure = isCompactionFailureError(message);
        const isSessionCorruption = /function call turn comes immediately after/i.test(message);
        const isRoleOrderingError = /incorrect role information|roles must alternate/i.test(
          message,
        );
        const isTransientHttp = isTransientHttpError(message);

        // CLI 后端凭证引导（Task 10/R3.4）：失败来自 CLI 后端且像"缺失/无效 API Key"时，
        // 在对话内给出"去平台/企业控制台配置凭证"的一次性引导，绝不要求用户本机命令行登录。
        if (
          isCliProvider(fallbackProvider, params.followupRun.run.config) &&
          isLikelyCredentialError(message)
        ) {
          return {
            kind: "final",
            payload: { text: buildCliBackendCredentialGuidance(fallbackProvider) },
          };
        }

        if (
          isCompactionFailure &&
          !didResetAfterCompactionFailure &&
          (await params.resetSessionAfterCompactionFailure(message))
        ) {
          didResetAfterCompactionFailure = true;
          return {
            kind: "final",
            payload: {
              text: "⚠️ Context limit exceeded during compaction. I've reset our conversation to start fresh - please try again.\n\nTo prevent this, increase your compaction buffer by setting `agents.defaults.compaction.reserveTokensFloor` to 20000 or higher in your config.",
            },
          };
        }
        if (isRoleOrderingError) {
          const didReset = await params.resetSessionAfterRoleOrderingConflict(message);
          if (didReset) {
            return {
              kind: "final",
              payload: {
                text: "⚠️ Message ordering conflict. I've reset the conversation - please try again.",
              },
            };
          }
        }

        // Auto-recover from Gemini session corruption by resetting the session
        if (
          isSessionCorruption &&
          params.sessionKey &&
          params.activeSessionStore &&
          params.storePath
        ) {
          const sessionKey = params.sessionKey;
          const corruptedSessionId = params.getActiveSessionEntry()?.sessionId;
          defaultRuntime.error(
            `Session history corrupted (Gemini function call ordering). Resetting session: ${params.sessionKey}`,
          );

          try {
            // Delete transcript file if it exists
            if (corruptedSessionId) {
              const transcriptPath = resolveSessionTranscriptPath(corruptedSessionId);
              try {
                fs.unlinkSync(transcriptPath);
              } catch {
                // Ignore if file doesn't exist
              }
            }

            // Keep the in-memory snapshot consistent with the on-disk store reset.
            delete params.activeSessionStore[sessionKey];

            // Remove session entry from store using a fresh, locked snapshot.
            await updateSessionStore(params.storePath, (store) => {
              delete store[sessionKey];
            });
          } catch (cleanupErr) {
            defaultRuntime.error(
              `Failed to reset corrupted session ${params.sessionKey}: ${String(cleanupErr)}`,
            );
          }

          return {
            kind: "final",
            payload: {
              text: "⚠️ Session history was corrupted. I've reset the conversation - please try again!",
            },
          };
        }

        if (isSoftRecoverableEntitlementFailure(message) && !didRetrySoftEntitlement) {
          didRetrySoftEntitlement = true;
          // lease-mismatch / stale-snapshot: refresh and self-advance once.
          // Never ask the user to 「重新发送」as fuel for a soft runtime stop.
          defaultRuntime.error(
            `Soft entitlement stop before reply (${message}). Self-advancing once in ${SOFT_ENTITLEMENT_RETRY_DELAY_MS}ms.`,
          );
          await new Promise<void>((resolve) => {
            setTimeout(resolve, SOFT_ENTITLEMENT_RETRY_DELAY_MS);
          });
          continue;
        }

        if (isTransientHttp && !didRetryTransientHttpError && retryAllowedForMessage(message)) {
          // Pre-retry budget gate: do not spend another model call when already exhausted.
          try {
            assertTipBudgetAllowsModelCall();
          } catch (gateErr) {
            if (gateErr instanceof TaskBudgetExceededError) {
              void recordGrowthTaskOutcome(false, {
                failureReason: "other",
                failureDetail: gateErr.message.slice(0, 200),
                skipBudgetCharge: tipBudgetChargedThisTurn,
              });
              return {
                kind: "final",
                payload: {
                  text: "⚠️ 任务预算已耗尽，已停止继续调用模型。请缩小范围或开新任务后再试。",
                },
              };
            }
            throw gateErr;
          }
          didRetryTransientHttpError = true;
          // Retry the full runWithModelFallback() cycle — transient errors
          // (502/521/etc.) typically affect the whole provider, so falling
          // back to an alternate model first would not help. Instead we wait
          // and retry the complete primary→fallback chain.
          defaultRuntime.error(
            `Transient HTTP provider error before reply (${message}). Retrying once in ${TRANSIENT_HTTP_RETRY_DELAY_MS}ms.`,
          );
          await new Promise<void>((resolve) => {
            setTimeout(resolve, TRANSIENT_HTTP_RETRY_DELAY_MS);
          });
          continue;
        }

        defaultRuntime.error(`Embedded agent failed before reply: ${message}`);
        const dockerFailure = userFacingPreReplyFailure(message);
        const isInfraStartupFailure =
          dockerFailure != null ||
          /EEXIST|Requested model .+ not supported|workspace_authorization_failed/i.test(message);
        const safeMessage = isTransientHttp
          ? sanitizeUserFacingText(message, { errorContext: true })
          : message;
        const trimmedMessage = safeMessage.replace(/\.\s*$/, "");
        const modelCallFailure = buildUserFacingModelCallFailure(
          message,
          params.opts?.expectedReplyLanguage,
        );
        const fallbackText = modelCallFailure
          ? `⚠️ ${modelCallFailure}`
          : dockerFailure
            ? dockerFailure
            : isContextOverflow
              ? "⚠️ Context overflow — prompt too large for this model. Try a shorter message or a larger-context model."
              : isRoleOrderingError
                ? "⚠️ Message ordering conflict - please try again. If this persists, use /new to start a fresh session."
                : isInfraStartupFailure
                  ? "这一轮没能完成回复。请再试一次，或 @ 对应助手。"
                  : `⚠️ Agent failed before reply: ${trimmedMessage}.\nLogs: openbot logs --follow`;

        void recordGrowthTaskOutcome(false, {
          aborted: Boolean(params.opts?.abortSignal?.aborted),
          providerFault: isTransientHttp || isInfraStartupFailure,
          prepareFailed: isInfraStartupFailure,
          errorMessage: message,
          failureDetail: trimmedMessage.slice(0, 200),
        });
        if (!params.opts?.abortSignal?.aborted && !isInfraStartupFailure && !isTransientHttp) {
          try {
            recordHonestCapabilityGap({
              runId,
              agentId: params.followupRun.run.agentId ?? null,
              tenantId: modelGate?.tenantId?.trim() || null,
              sessionKey: params.followupRun.run.sessionKey ?? null,
              chatType: params.sessionCtx.ChatType ?? null,
              reason: isContextOverflow ? "context_overflow" : "unresolved_run_error",
              category: isContextOverflow ? "perception" : "tool",
              detail: trimmedMessage.slice(0, 160),
              userLanguageSummary: fallbackText.slice(0, 160),
              sourceKind: "run_error",
            });
          } catch {
            // evolution store must never fail the reply
          }
        }
        return {
          kind: "final",
          payload: {
            text: fallbackText,
          },
        };
      }
    }

    // Agent Growth OS：嵌入式运行完成但结果为 context overflow 错误（无正文回复）→ 记录失败。
    const finalEmbeddedError = runResult?.meta?.error;
    const hasPayloadText = runResult?.payloads?.some((p) => p.text?.trim());
    if (
      finalEmbeddedError &&
      isContextOverflowError(finalEmbeddedError.message) &&
      !hasPayloadText
    ) {
      void recordGrowthTaskOutcome(false, {
        failureReason: "run_failed",
        failureDetail: "context_overflow",
      });
      return {
        kind: "final",
        payload: {
          text: "⚠️ Context overflow — this conversation is too large for the model. Use /new to start a fresh session.",
        },
      };
    }

    const didUseTools = commercialToolCallCount > 0 || growthToolTotal > 0;
    // Defer success/failure until agent-runner classifies delivery (honest-empty /
    // abort / reaction). Same decideHonestEmptyReply drives both fallback and outcome.
    return {
      kind: "success",
      runId,
      runResult,
      fallbackProvider,
      fallbackModel,
      fallbackAttempts,
      didLogHeartbeatStrip,
      autoCompactionCompleted,
      directlySentBlockKeys: directlySentBlockKeys.size > 0 ? directlySentBlockKeys : undefined,
      didUseTools,
      commitGrowthOutcome: recordGrowthTaskOutcome,
    };
  } finally {
    if (enterpriseRunSlotHeld) {
      void releaseEnterpriseAgentRun(runId);
      forgetRunModelSet(runId);
    }
  }
}
