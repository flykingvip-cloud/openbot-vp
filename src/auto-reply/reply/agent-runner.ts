import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ReplyDeliveryResult } from "../../agent-runtime/delivery/index.js";
import { replyTurnRuntime } from "../../agent-runtime/wiring/reply-turn.js";
import { lookupContextTokens } from "../../agents/context.js";
import { DEFAULT_CONTEXT_TOKENS } from "../../agents/defaults.js";
import { resolveModelAuthMode } from "../../agents/model-auth.js";
import { isCliProvider } from "../../agents/model-selection.js";
import { hasNonzeroUsage } from "../../agents/usage.js";
import {
  resolveAgentIdFromSessionKey,
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  resolveSessionTranscriptPath,
  resolveSessionTranscriptPathInDir,
  type SessionEntry,
  updateSessionStore,
  updateSessionStoreEntry,
} from "../../config/sessions.js";
import type { TypingMode } from "../../config/types.js";
import { isEnterpriseRuntimeModelId } from "../../gateway/enterprise-model/ids.js";
import { tryResolveCapabilityGapsFromUsage } from "../../gateway/evolution-control/capability-gap-ingest.js";
import { logVerbose } from "../../globals.js";
import { emitAgentEvent } from "../../infra/agent-events.js";
import { emitDiagnosticEvent, isDiagnosticsEnabled } from "../../infra/diagnostic-events.js";
import { generateSecureUuid } from "../../infra/secure-random.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { defaultRuntime } from "../../runtime.js";
import { enforceVisibleReplyLanguage } from "../../shared/text/visible-reply-language.js";
import { resolveTurnContractFromRunMeta } from "../../task-outcome/chat-entry.js";
import type { GrowthOutcomeCommitOpts } from "../../task-outcome/runtime-from-runner.js";
import { stripInlineDirectiveTagsForDisplay } from "../../utils/directive-tags.js";
import { estimateUsageCost, resolveModelCostConfig } from "../../utils/usage-format.js";
import {
  buildFallbackClearedNotice,
  buildFallbackNotice,
  resolveFallbackTransition,
} from "../fallback-state.js";
import type { OriginatingChannelType, TemplateContext } from "../templating.js";
import { resolveResponseUsageMode, type VerboseLevel } from "../thinking.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import {
  createShouldEmitToolOutput,
  createShouldEmitToolResult,
  finalizeWithFollowup,
  isAudioPayload,
  signalTypingIfNeeded,
} from "./agent-runner-helpers.js";
import { runMemoryFlushIfNeeded } from "./agent-runner-memory.js";
import {
  appendUnscheduledReminderNote,
  hasSessionRelatedCronJobs,
  hasUnbackedReminderCommitment,
} from "./agent-runner-reminder-guard.js";
import { appendUsageLine, formatResponseUsageLine } from "./agent-runner-utils.js";
import { createAudioAsVoiceBuffer, createBlockReplyPipeline } from "./block-reply-pipeline.js";
import { resolveEffectiveBlockStreamingConfig } from "./block-streaming.js";
import { runCollaborationLearningBackflowSafely } from "./collaboration-learning-backflow.js";
import { createFollowupRunner } from "./followup-runner.js";
import {
  parseCapabilityGapMarker,
  recordHonestCapabilityGap,
  stripCapabilityGapMarkers,
} from "./honest-empty-reply.js";
import { resolveOriginMessageProvider, resolveOriginMessageTo } from "./origin-routing.js";
import { readPostCompactionContext } from "./post-compaction-context.js";
import { enqueueFollowupRun, type FollowupRun, type QueueSettings } from "./queue.js";
import { createReplyMediaPathNormalizer } from "./reply-media-paths.js";
import { createReplyToModeFilterForChannel, resolveReplyToMode } from "./reply-threading.js";
import { sanitizeTurnVisibleReply } from "./turn-reply-language.js";
import { createTypingSignaler } from "./typing-mode.js";
import type { TypingController } from "./typing.js";

const BLOCK_REPLY_SEND_TIMEOUT_MS = 15_000;

export async function runReplyAgent(params: {
  commandBody: string;
  followupRun: FollowupRun;
  queueKey: string;
  resolvedQueue: QueueSettings;
  shouldSteer: boolean;
  shouldFollowup: boolean;
  isActive: boolean;
  isStreaming: boolean;
  opts?: GetReplyOptions;
  typing: TypingController;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  defaultModel: string;
  agentCfgContextTokens?: number;
  resolvedVerboseLevel: VerboseLevel;
  isNewSession: boolean;
  blockStreamingEnabled: boolean;
  blockReplyChunking?: {
    minChars: number;
    maxChars: number;
    breakPreference: "paragraph" | "newline" | "sentence";
    flushOnParagraph?: boolean;
  };
  resolvedBlockStreamingBreak: "text_end" | "message_end";
  sessionCtx: TemplateContext;
  shouldInjectGroupIntro: boolean;
  typingMode: TypingMode;
}): Promise<ReplyPayload | ReplyPayload[] | undefined> {
  const {
    commandBody,
    followupRun,
    queueKey,
    resolvedQueue,
    shouldFollowup,
    isActive,
    opts,
    typing,
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    defaultModel,
    agentCfgContextTokens,
    resolvedVerboseLevel,
    isNewSession,
    blockStreamingEnabled,
    blockReplyChunking,
    resolvedBlockStreamingBreak,
    sessionCtx,
    shouldInjectGroupIntro,
    typingMode,
  } = params;

  let completionBinding = followupRun.run.taskCompletionBinding;
  let activeSessionEntry = sessionEntry;
  const activeSessionStore = sessionStore;
  let activeIsNewSession = isNewSession;

  const isHeartbeat = opts?.isHeartbeat === true;
  const typingSignals = createTypingSignaler({
    typing,
    mode: typingMode,
    isHeartbeat,
  });

  const shouldEmitToolResult = createShouldEmitToolResult({
    sessionKey,
    storePath,
    resolvedVerboseLevel,
  });
  const shouldEmitToolOutput = createShouldEmitToolOutput({
    sessionKey,
    storePath,
    resolvedVerboseLevel,
  });

  const pendingToolTasks = new Set<Promise<void>>();
  const blockReplyTimeoutMs = opts?.blockReplyTimeoutMs ?? BLOCK_REPLY_SEND_TIMEOUT_MS;

  const replyToChannel = resolveOriginMessageProvider({
    originatingChannel: sessionCtx.OriginatingChannel,
    provider: sessionCtx.Surface ?? sessionCtx.Provider,
  }) as OriginatingChannelType | undefined;
  const replyToMode = resolveReplyToMode(
    followupRun.run.config,
    replyToChannel,
    sessionCtx.AccountId,
    sessionCtx.ChatType,
  );
  const applyReplyToMode = createReplyToModeFilterForChannel(replyToMode, replyToChannel);
  const cfg = followupRun.run.config;
  const normalizeReplyMediaPaths = createReplyMediaPathNormalizer({
    cfg,
    sessionKey,
    workspaceDir: followupRun.run.workspaceDir,
    gatewayClientUser: followupRun.run.gatewayClientUser ?? sessionCtx.GatewayClientUser,
    gatewayClientPlatformUserId:
      followupRun.run.gatewayClientPlatformUserId ?? sessionCtx.GatewayClientPlatformUserId,
    gatewayClientSessionEnterpriseId:
      followupRun.run.executionIdentity?.enterpriseId ??
      sessionCtx.CollaborationTenantId ??
      sessionCtx.GatewayClientSessionEnterpriseId,
    executionIdentity: followupRun.run.executionIdentity,
  });
  const blockReplyCoalescing =
    blockStreamingEnabled && opts?.onBlockReply
      ? resolveEffectiveBlockStreamingConfig({
          cfg,
          provider: sessionCtx.Provider,
          accountId: sessionCtx.AccountId,
          chunking: blockReplyChunking,
        }).coalescing
      : undefined;
  const blockReplyPipeline =
    blockStreamingEnabled && opts?.onBlockReply
      ? createBlockReplyPipeline({
          onBlockReply: opts.onBlockReply,
          timeoutMs: blockReplyTimeoutMs,
          coalescing: blockReplyCoalescing,
          buffer: createAudioAsVoiceBuffer({ isAudioPayload }),
        })
      : null;
  const touchActiveSessionEntry = async () => {
    if (!activeSessionEntry || !activeSessionStore || !sessionKey) {
      return;
    }
    const updatedAt = Date.now();
    activeSessionEntry.updatedAt = updatedAt;
    activeSessionStore[sessionKey] = activeSessionEntry;
    if (storePath) {
      await updateSessionStoreEntry({
        storePath,
        sessionKey,
        update: async () => ({ updatedAt }),
      });
    }
  };

  // Missing provenance is human ingress, as at the public interaction entrance.
  if (
    replyTurnRuntime.isHumanInteractionIngress({
      provenanceKind: followupRun.run.inputProvenance?.kind,
      heartbeat: isHeartbeat,
      birthTurn: opts?.growthBirthTurn === true,
      collaborationRound: followupRun.run.collaborationRoundInvoked === true,
    }) &&
    !followupRun.run.executionAdmitted
  ) {
    typing.cleanup();
    return { text: "该请求尚未通过交互层的执行准入，本次未启动任务执行。" };
  }

  // Interaction has already answered queries and committed changes/controls.
  // Execution selects resources only; never classify this text a second time.
  const queueAction = followupRun.run.executionAdmitted
    ? "run-now"
    : replyTurnRuntime.execution.resolveQueueAction({
        isActive,
        isHeartbeat,
        shouldFollowup,
        queueMode: resolvedQueue.mode,
      });
  if (queueAction !== "run-now") {
    if (queueAction === "enqueue-followup") {
      enqueueFollowupRun(queueKey, followupRun, resolvedQueue);
      await touchActiveSessionEntry();
    }
    typing.cleanup();
    return undefined;
  }

  await typingSignals.signalRunStart();

  // Outer turn id (P3-2). Used only as the memory flush `parentRunId` and as the
  // `opts.runId` handed to runAgentTurnWithFallback (its rememberRunModelSet key).
  // Not written into RPC params. Generated the same way runAgentTurnWithFallback
  // generated it before P3-2. Lifecycle events after the turn use `outcomeRunId`.
  const runId = opts?.runId ?? crypto.randomUUID();

  const makeRunFollowupTurn = () =>
    createFollowupRunner({
      opts,
      typing,
      typingMode,
      sessionEntry: activeSessionEntry,
      sessionStore: activeSessionStore,
      sessionKey,
      storePath,
      defaultModel,
      agentCfgContextTokens,
    });

  const requiresTaskBinding =
    !followupRun.run.turnExecutionAdmission &&
    (followupRun.run.executionAdmitted === true ||
      Boolean(completionBinding) ||
      (!followupRun.run.collaborationRoundInvoked &&
        !followupRun.run.privateRunBag &&
        Boolean(replyTurnRuntime.state.read(followupRun.run.sessionFile).current)));
  if (requiresTaskBinding) {
    try {
      completionBinding = replyTurnRuntime.state.startExecution(
        followupRun.run.sessionFile,
        completionBinding,
        runId,
      );
      if (!completionBinding) {
        typing.markRunComplete();
        typing.markDispatchIdle();
        return finalizeWithFollowup(
          { text: "这条请求的任务身份已失效或尚未绑定，未继续执行。请确认当前任务后重新发送。" },
          queueKey,
          makeRunFollowupTurn(),
        );
      }
      followupRun.run.taskCompletionBinding = completionBinding;
      opts?.onTaskExecutionBound?.(completionBinding, {
        sessionFile: followupRun.run.sessionFile,
      });
    } catch (error) {
      typing.markRunComplete();
      typing.markDispatchIdle();
      finalizeWithFollowup(undefined, queueKey, makeRunFollowupTurn());
      throw error;
    }
  }
  activeSessionEntry = await runMemoryFlushIfNeeded({
    cfg,
    followupRun,
    promptForEstimate: followupRun.prompt,
    sessionCtx,
    opts,
    defaultModel,
    agentCfgContextTokens,
    resolvedVerboseLevel,
    sessionEntry: activeSessionEntry,
    sessionStore: activeSessionStore,
    sessionKey,
    storePath,
    isHeartbeat,
    parentRunId: runId,
    onMemoryFlushCompleted: async (event) => {
      await runCollaborationLearningBackflowSafely(event);
    },
  });

  const runFollowupTurn = makeRunFollowupTurn();

  const maybeScheduleTaskBoardContinue = (payloads: ReplyPayload[] | undefined) => {
    if (isHeartbeat || followupRun.run.turnExecutionAdmission) {
      return;
    }
    if (replyTurnRuntime.execution.isTaskBoardContinueInternalPrompt(commandBody)) {
      return;
    }
    const assistantText = (payloads ?? [])
      .map((payload) => (typeof payload.text === "string" ? payload.text.trim() : ""))
      .filter(Boolean)
      .join("\n\n");
    replyTurnRuntime.execution.scheduleTaskBoardContinueWake({
      sessionFile: followupRun.run.sessionFile,
      assistantText,
      isHeartbeat,
      toolsDisabled: followupRun.run.disableTools === true,
      enqueue: (prompt, messageId, ticket) =>
        enqueueFollowupRun(
          queueKey,
          {
            ...followupRun,
            prompt,
            messageId,
            summaryLine: "task_board_continue",
            taskBoardContinueTicket: { taskId: ticket.taskId, focusRevision: ticket.focusRevision },
            enqueuedAt: Date.now(),
            followupItemId: undefined,
          },
          resolvedQueue,
          "message-id",
        ),
    });
  };

  let responseUsageLine: string | undefined;
  type SessionResetOptions = {
    failureLabel: string;
    buildLogMessage: (nextSessionId: string) => string;
    cleanupTranscripts?: boolean;
  };
  const resetSession = async ({
    failureLabel,
    buildLogMessage,
    cleanupTranscripts,
  }: SessionResetOptions): Promise<boolean> => {
    if (!sessionKey || !activeSessionStore || !storePath) {
      return false;
    }
    const prevEntry = activeSessionStore[sessionKey] ?? activeSessionEntry;
    if (!prevEntry) {
      return false;
    }
    const prevSessionId = cleanupTranscripts ? prevEntry.sessionId : undefined;
    const nextSessionId = generateSecureUuid();
    const nextEntry = replyTurnRuntime.prepareReplacementSessionEntry(
      prevEntry,
      nextSessionId,
      Date.now(),
    );
    const agentId = resolveAgentIdFromSessionKey(sessionKey);
    const nextSessionFile = storePath
      ? resolveSessionTranscriptPathInDir(
          nextSessionId,
          path.dirname(storePath),
          sessionCtx.MessageThreadId,
        )
      : resolveSessionTranscriptPath(nextSessionId, agentId, sessionCtx.MessageThreadId);
    nextEntry.sessionFile = nextSessionFile;
    activeSessionStore[sessionKey] = nextEntry;
    try {
      await updateSessionStore(storePath, (store) => {
        store[sessionKey] = nextEntry;
      });
    } catch (err) {
      defaultRuntime.error(
        `Failed to persist session reset after ${failureLabel} (${sessionKey}): ${String(err)}`,
      );
    }
    followupRun.run.sessionId = nextSessionId;
    followupRun.run.sessionFile = nextSessionFile;
    activeSessionEntry = nextEntry;
    activeIsNewSession = true;
    defaultRuntime.error(buildLogMessage(nextSessionId));
    if (cleanupTranscripts && prevSessionId) {
      const transcriptCandidates = new Set<string>();
      const resolved = resolveSessionFilePath(
        prevSessionId,
        prevEntry,
        resolveSessionFilePathOptions({ agentId, storePath }),
      );
      if (resolved) {
        transcriptCandidates.add(resolved);
      }
      transcriptCandidates.add(resolveSessionTranscriptPath(prevSessionId, agentId));
      for (const candidate of transcriptCandidates) {
        try {
          fs.unlinkSync(candidate);
        } catch {
          // Best-effort cleanup.
        }
      }
    }
    return true;
  };
  const resetSessionAfterCompactionFailure = async (reason: string): Promise<boolean> =>
    resetSession({
      failureLabel: "compaction failure",
      buildLogMessage: (nextSessionId) =>
        `Auto-compaction failed (${reason}). Restarting session ${sessionKey} -> ${nextSessionId} and retrying.`,
    });
  const resetSessionAfterRoleOrderingConflict = async (reason: string): Promise<boolean> =>
    resetSession({
      failureLabel: "role ordering conflict",
      buildLogMessage: (nextSessionId) =>
        `Role ordering conflict (${reason}). Restarting session ${sessionKey} -> ${nextSessionId}.`,
      cleanupTranscripts: true,
    });
  // Tracks whether any tool result (e.g. TTS audio, generated image) was handed
  // to delivery, so an empty final reply is not mistaken for a silent turn.
  let toolResultDelivered = false;
  const upstreamOnToolResult = opts?.onToolResult;
  const trackedOnToolResult = upstreamOnToolResult
    ? async (payload: ReplyPayload) => {
        toolResultDelivered = true;
        await upstreamOnToolResult(payload);
      }
    : undefined;
  try {
    const runStartedAt = Date.now();
    const runOutcome = await replyTurnRuntime.execution.runAdmittedTurn({
      commandBody,
      followupRun,
      sessionCtx,
      opts: {
        ...opts,
        runId,
        ...(trackedOnToolResult ? { onToolResult: trackedOnToolResult } : {}),
      },
      typingSignals,
      blockReplyPipeline,
      blockStreamingEnabled,
      blockReplyChunking,
      resolvedBlockStreamingBreak,
      applyReplyToMode,
      shouldEmitToolResult,
      shouldEmitToolOutput,
      pendingToolTasks,
      resetSessionAfterCompactionFailure,
      resetSessionAfterRoleOrderingConflict,
      isHeartbeat,
      sessionKey,
      getActiveSessionEntry: () => activeSessionEntry,
      activeSessionStore,
      storePath,
      resolvedVerboseLevel,
    });

    if (runOutcome.kind === "final") {
      return finalizeWithFollowup(runOutcome.payload, queueKey, runFollowupTurn);
    }

    // Renamed so this block-scoped binding cannot shadow the outer `runId` read above
    // (a same-named `const` here puts the `opts: { ...opts, runId }` read in the TDZ).
    const {
      runId: outcomeRunId,
      runResult,
      fallbackProvider,
      fallbackModel,
      fallbackAttempts,
      directlySentBlockKeys,
      didUseTools,
      commitGrowthOutcome: commitGrowthOutcomeRaw,
    } = runOutcome;
    let { didLogHeartbeatStrip, autoCompactionCompleted } = runOutcome;
    // P2: ensure growth outcome is committed even if later delivery work throws
    // between classify-success and commit (or after a deferred commit site).
    let growthOutcomeCommitted = false;
    const commitGrowthOutcome = (
      success: boolean,
      opts?: GrowthOutcomeCommitOpts,
    ): void | Promise<void> => {
      if (growthOutcomeCommitted) {
        return;
      }
      growthOutcomeCommitted = true;
      return commitGrowthOutcomeRaw(success, opts);
    };

    const resolveTurnContractFromRun = () => {
      // R85f: classify from preflight intent (validatorsRequired / decisionCode /
      // intentClass / primarySkill). Never use Boolean(hookDelivery).
      return resolveTurnContractFromRunMeta(runResult.meta);
    };

    if (
      shouldInjectGroupIntro &&
      activeSessionEntry &&
      activeSessionStore &&
      sessionKey &&
      activeSessionEntry.groupActivationNeedsSystemIntro
    ) {
      const updatedAt = Date.now();
      activeSessionEntry.groupActivationNeedsSystemIntro = false;
      activeSessionEntry.updatedAt = updatedAt;
      activeSessionStore[sessionKey] = activeSessionEntry;
      if (storePath) {
        await updateSessionStoreEntry({
          storePath,
          sessionKey,
          update: async () => ({
            groupActivationNeedsSystemIntro: false,
            updatedAt,
          }),
        });
      }
    }

    const payloadArray = runResult.payloads ?? [];

    if (blockReplyPipeline) {
      await blockReplyPipeline.flush({ force: true });
      blockReplyPipeline.stop();
    }
    if (pendingToolTasks.size > 0) {
      await Promise.allSettled(pendingToolTasks);
    }

    const usage = runResult.meta?.agentMeta?.usage;
    const promptTokens = runResult.meta?.agentMeta?.promptTokens;
    const modelUsed = runResult.meta?.agentMeta?.model ?? fallbackModel ?? defaultModel;
    const providerUsed =
      runResult.meta?.agentMeta?.provider ?? fallbackProvider ?? followupRun.run.provider;
    const verboseEnabled = resolvedVerboseLevel !== "off";
    const selectedProvider = followupRun.run.provider;
    const selectedModel = followupRun.run.model;
    const fallbackStateEntry =
      activeSessionEntry ?? (sessionKey ? activeSessionStore?.[sessionKey] : undefined);
    const fallbackTransition = resolveFallbackTransition({
      selectedProvider,
      selectedModel,
      activeProvider: providerUsed,
      activeModel: modelUsed,
      attempts: fallbackAttempts,
      state: fallbackStateEntry,
    });
    // BYOK runs remap ent/* → upstream transport (e.g. openai + baseUrl). Persist the
    // logical ent/* pin when the selected candidate did not error; if model-fallback
    // abandoned the selection, persist the active provider instead.
    const selectedRuntimeId = `${selectedProvider}/${selectedModel}`;
    const selectionHadError = (fallbackAttempts ?? []).some(
      (attempt) =>
        attempt.provider === selectedProvider &&
        attempt.model === selectedModel &&
        Boolean(attempt.error?.trim()),
    );
    const persistByokSelection =
      isEnterpriseRuntimeModelId(selectedRuntimeId) && !selectionHadError;
    const persistProvider = persistByokSelection ? selectedProvider : providerUsed;
    const persistModel = persistByokSelection ? selectedModel : modelUsed;
    if (fallbackTransition.stateChanged) {
      if (fallbackStateEntry) {
        fallbackStateEntry.fallbackNoticeSelectedModel = fallbackTransition.nextState.selectedModel;
        fallbackStateEntry.fallbackNoticeActiveModel = fallbackTransition.nextState.activeModel;
        fallbackStateEntry.fallbackNoticeReason = fallbackTransition.nextState.reason;
        fallbackStateEntry.updatedAt = Date.now();
        activeSessionEntry = fallbackStateEntry;
      }
      if (sessionKey && fallbackStateEntry && activeSessionStore) {
        activeSessionStore[sessionKey] = fallbackStateEntry;
      }
      if (sessionKey && storePath) {
        await updateSessionStoreEntry({
          storePath,
          sessionKey,
          update: async () => ({
            fallbackNoticeSelectedModel: fallbackTransition.nextState.selectedModel,
            fallbackNoticeActiveModel: fallbackTransition.nextState.activeModel,
            fallbackNoticeReason: fallbackTransition.nextState.reason,
          }),
        });
      }
    }
    const cliSessionId = isCliProvider(providerUsed, cfg)
      ? runResult.meta?.agentMeta?.sessionId?.trim()
      : undefined;
    const contextTokensUsed =
      agentCfgContextTokens ??
      lookupContextTokens(modelUsed) ??
      activeSessionEntry?.contextTokens ??
      DEFAULT_CONTEXT_TOKENS;

    await replyTurnRuntime.state.persistRunSessionUsage({
      storePath,
      sessionKey,
      usage,
      lastCallUsage: runResult.meta?.agentMeta?.lastCallUsage,
      promptTokens,
      modelUsed: persistModel,
      providerUsed: persistProvider,
      contextTokensUsed,
      systemPromptReport: runResult.meta?.systemPromptReport,
      cliSessionId,
    });

    const completeDelivery = (result: ReplyDeliveryResult) =>
      replyTurnRuntime.delivery.completeReplyDelivery(result, {
        runId: outcomeRunId,
        language: opts?.expectedReplyLanguage ?? null,
        readContract: resolveTurnContractFromRun,
        commitOutcome: commitGrowthOutcome,
        recordEmptyGap: (reason) =>
          recordHonestCapabilityGap({
            runId: outcomeRunId,
            agentId: followupRun.run.agentId ?? null,
            tenantId: sessionCtx.GatewayClientSessionEnterpriseId?.trim() || null,
            sessionKey: sessionKey ?? followupRun.run.sessionKey ?? null,
            chatType: sessionCtx.ChatType ?? null,
            reason,
            category: "perception",
            ownerUserId: sessionCtx.GatewayClientPlatformUserId?.trim() || null,
            userLanguageSummary:
              opts?.expectedReplyLanguage === "en"
                ? "silent/empty private turn; missing actionable skill/tool or perception"
                : "私聊静默/空回复；缺可执行技能/工具或可感知输入",
          }),
        considerContinuation: maybeScheduleTaskBoardContinue,
        onPendingAcceptance: (text) => {
          if (replyToChannel !== "webchat" || !sessionKey) {
            return;
          }
          // Model lifecycle end can precede host verification. Persist the
          // host receipt through SessionManager before notifying the same WS
          // egress; never let model prose create an acceptance fact.
          try {
            const messageId = `${outcomeRunId}:acceptance`;
            replyTurnRuntime.persistInteractionMessage({
              sessionFile: followupRun.run.sessionFile,
              sessionId: followupRun.run.sessionId,
              cwd: followupRun.run.workspaceDir,
              messageId,
              role: "assistant",
              text,
            });
            emitAgentEvent({
              runId: outcomeRunId,
              sessionKey,
              stream: "delivery",
              data: { phase: "acceptance_pending", text },
            });
          } catch (error) {
            logVerbose(`pending acceptance feedback could not be persisted: ${String(error)}`);
          }
        },
        finalize: (payload) => finalizeWithFollowup(payload, queueKey, runFollowupTurn),
      });

    // Probe live delivery evidence only when the final payload path is empty.
    const finalizeEmptyDelivery = () =>
      completeDelivery({
        kind: "empty",
        probe: {
          isHeartbeat,
          sessionCtx,
          rawPayloads: payloadArray,
          blockStreamDelivered: Boolean(blockReplyPipeline?.didStream()),
          directlySentBlockCount: directlySentBlockKeys?.size ?? 0,
          toolResultDelivered,
          didSendViaMessagingTool: runResult.didSendViaMessagingTool,
          messagingToolSentTexts: runResult.messagingToolSentTexts,
          messagingToolSentMediaUrls: runResult.messagingToolSentMediaUrls,
          messagingToolSentTargets: runResult.messagingToolSentTargets,
          runAborted: Boolean(runResult.meta?.aborted),
          reactionDelivered: Boolean(runResult.didSendReaction),
        },
      });

    // Drain any late tool/block deliveries before deciding there's "nothing to send".
    // Otherwise, a late typing trigger (e.g. from a tool callback) can outlive the run and
    // keep the typing indicator stuck.
    if (payloadArray.length === 0) {
      return finalizeEmptyDelivery();
    }

    const payloadResult = await replyTurnRuntime.delivery.buildReplyPayloads({
      payloads: payloadArray,
      isHeartbeat,
      didLogHeartbeatStrip,
      blockStreamingEnabled,
      blockReplyPipeline,
      directlySentBlockKeys,
      replyToMode,
      replyToChannel,
      currentMessageId: sessionCtx.MessageSidFull ?? sessionCtx.MessageSid,
      messageProvider: followupRun.run.messageProvider,
      messagingToolSentTexts: runResult.messagingToolSentTexts,
      messagingToolSentMediaUrls: runResult.messagingToolSentMediaUrls,
      messagingToolSentTargets: runResult.messagingToolSentTargets,
      originatingChannel: sessionCtx.OriginatingChannel,
      originatingTo: resolveOriginMessageTo({
        originatingTo: sessionCtx.OriginatingTo,
        to: sessionCtx.To,
      }),
      accountId: sessionCtx.AccountId,
      normalizeMediaPaths: normalizeReplyMediaPaths,
    });
    const { replyPayloads } = payloadResult;
    didLogHeartbeatStrip = payloadResult.didLogHeartbeatStrip;

    if (replyPayloads.length === 0) {
      return finalizeEmptyDelivery();
    }

    // Explicit model refusal / capability marker on a visible reply still records a gap.
    // Best-effort; never close gaps on an unrelated successful reply.
    const gapSessionKey = sessionKey ?? followupRun.run.sessionKey ?? null;
    const gapTenantId = sessionCtx.GatewayClientSessionEnterpriseId?.trim() || null;
    for (const payload of replyPayloads) {
      if (typeof payload.text !== "string") {
        continue;
      }
      try {
        const marker = parseCapabilityGapMarker(payload.text, {
          fromAssistant: true,
          sessionKey: gapSessionKey,
        });
        if (!marker) {
          continue;
        }
        recordHonestCapabilityGap({
          runId: outcomeRunId,
          agentId: followupRun.run.agentId ?? null,
          tenantId: gapTenantId,
          sessionKey: gapSessionKey,
          chatType: sessionCtx.ChatType ?? null,
          reason: marker.detail ?? "explicit_capability_refusal",
          category: marker.category,
          detail: marker.detail,
          userLanguageSummary: marker.detail,
          explicitMarker: true,
          sourceKind: "marker",
          ownerUserId: sessionCtx.GatewayClientPlatformUserId?.trim() || null,
        });
        break;
      } catch {
        // never fail the reply
      }
    }
    // Same visible-reply cleaner as Control UI live/history, with this turn's language.
    const channelReplyLanguage = params.opts?.expectedReplyLanguage ?? null;
    for (const payload of replyPayloads) {
      if (payload.isReasoning || typeof payload.text !== "string" || !payload.text) {
        continue;
      }
      const stripped = stripInlineDirectiveTagsForDisplay(payload.text, channelReplyLanguage).text;
      const also = stripCapabilityGapMarkers(stripped);
      if (also !== payload.text) {
        payload.text = also;
      }
    }

    const successfulCronAdds = runResult.successfulCronAdds ?? 0;
    const hasReminderCommitment = replyPayloads.some(
      (payload) =>
        !payload.isError &&
        typeof payload.text === "string" &&
        hasUnbackedReminderCommitment(payload.text),
    );
    // Suppress the guard note when an existing cron job (created in a prior
    // turn) already covers the commitment — avoids false positives (#32228).
    const coveredByExistingCron =
      hasReminderCommitment && successfulCronAdds === 0
        ? await hasSessionRelatedCronJobs({
            cronStorePath: cfg.cron?.store,
            sessionKey,
          })
        : false;
    const guardedReplyPayloads =
      hasReminderCommitment && successfulCronAdds === 0 && !coveredByExistingCron
        ? appendUnscheduledReminderNote(replyPayloads)
        : replyPayloads;

    const expectedReplyLanguage = params.opts?.expectedReplyLanguage ?? null;
    const languageGuardedReplyPayloads: typeof guardedReplyPayloads = [];
    if (expectedReplyLanguage && guardedReplyPayloads.length > 0) {
      for (const payload of guardedReplyPayloads) {
        if (payload.isError || payload.isReasoning || typeof payload.text !== "string") {
          languageGuardedReplyPayloads.push(payload);
          continue;
        }
        const trimmed = payload.text.trim();
        if (!trimmed) {
          continue;
        }
        const enforced = await enforceVisibleReplyLanguage({
          text: trimmed,
          expectedLanguage: expectedReplyLanguage,
          runId: outcomeRunId,
        });
        const gate = sanitizeTurnVisibleReply({
          text: enforced,
          expectedLanguage: expectedReplyLanguage,
        });
        if (!gate.ok) {
          continue;
        }
        languageGuardedReplyPayloads.push({ ...payload, text: gate.text });
      }
    } else {
      languageGuardedReplyPayloads.push(...guardedReplyPayloads);
    }

    if (languageGuardedReplyPayloads.length === 0 && guardedReplyPayloads.length > 0) {
      return completeDelivery({ kind: "language_filtered", didUseTools });
    }

    const visibleTargetTo = resolveOriginMessageTo({
      originatingTo: sessionCtx.OriginatingTo,
      to: sessionCtx.To,
    });
    const acceptanceStatus = await replyTurnRuntime.delivery.prepareVisibleDelivery(
      followupRun.run.config,
      {
        workspaceDir: followupRun.run.workspaceDir,
        sessionFile: followupRun.run.sessionFile,
        completionBinding,
        agentId: followupRun.run.agentId,
        runId: outcomeRunId,
        sessionKey,
        contract: resolveTurnContractFromRun(),
        commitOutcome: commitGrowthOutcome,
        payloads: languageGuardedReplyPayloads,
        ...(replyToChannel && visibleTargetTo
          ? {
              target: {
                channel: replyToChannel,
                to: visibleTargetTo,
                ...(sessionCtx.AccountId ? { accountId: sessionCtx.AccountId } : {}),
                ...(sessionCtx.MessageThreadId !== undefined && sessionCtx.MessageThreadId !== null
                  ? { threadId: sessionCtx.MessageThreadId }
                  : {}),
                ...((sessionCtx.MessageSidFull ?? sessionCtx.MessageSid)
                  ? { replyToId: String(sessionCtx.MessageSidFull ?? sessionCtx.MessageSid) }
                  : {}),
              },
              authorization: {
                ...(sessionCtx.GatewayClientPlatformUserId?.trim()
                  ? { subjectRef: sessionCtx.GatewayClientPlatformUserId.trim() }
                  : sessionCtx.GatewayClientUser?.trim()
                    ? { subjectRef: String(sessionCtx.GatewayClientUser).trim() }
                    : {}),
                ...(sessionKey ? { sessionKey } : {}),
                ...(sessionCtx.GatewayClientSessionEnterpriseId?.trim()
                  ? { tenantId: sessionCtx.GatewayClientSessionEnterpriseId.trim() }
                  : {}),
                ...(sessionCtx.AccountId ? { accountId: sessionCtx.AccountId } : {}),
                channel: replyToChannel,
                to: visibleTargetTo,
              },
            }
          : {}),
        publishPending: (identity) => {
          if (opts?.pendingTurnDeliveryRef) {
            opts.pendingTurnDeliveryRef.current = identity;
          }
        },
      },
    );
    try {
      const usedIds = (runResult.toolMetas ?? [])
        .map((row) => row.toolName)
        .filter((name): name is string => Boolean(name?.trim()));
      tryResolveCapabilityGapsFromUsage({
        tenantId: gapTenantId,
        agentId: followupRun.run.agentId ?? null,
        sessionKey: gapSessionKey,
        runId: outcomeRunId,
        usedToolOrSkillIds: usedIds,
      });
    } catch {
      // never fail the reply
    }

    await signalTypingIfNeeded(languageGuardedReplyPayloads, typingSignals);

    if (isDiagnosticsEnabled(cfg) && hasNonzeroUsage(usage)) {
      const input = usage.input ?? 0;
      const output = usage.output ?? 0;
      const cacheRead = usage.cacheRead ?? 0;
      const cacheWrite = usage.cacheWrite ?? 0;
      const promptTokens = input + cacheRead + cacheWrite;
      const totalTokens = usage.total ?? promptTokens + output;
      const costConfig = resolveModelCostConfig({
        provider: providerUsed,
        model: modelUsed,
        config: cfg,
      });
      const costUsd = estimateUsageCost({ usage, cost: costConfig });
      emitDiagnosticEvent({
        type: "model.usage",
        sessionKey,
        sessionId: followupRun.run.sessionId,
        channel: replyToChannel,
        provider: providerUsed,
        model: modelUsed,
        usage: {
          input,
          output,
          cacheRead,
          cacheWrite,
          promptTokens,
          total: totalTokens,
        },
        lastCallUsage: runResult.meta?.agentMeta?.lastCallUsage,
        context: {
          limit: contextTokensUsed,
          used: totalTokens,
        },
        costUsd,
        durationMs: Date.now() - runStartedAt,
      });
    }

    const responseUsageRaw =
      activeSessionEntry?.responseUsage ??
      (sessionKey ? activeSessionStore?.[sessionKey]?.responseUsage : undefined);
    const responseUsageMode = resolveResponseUsageMode(responseUsageRaw);
    if (responseUsageMode !== "off" && hasNonzeroUsage(usage)) {
      const authMode = resolveModelAuthMode(providerUsed, cfg);
      const showCost = authMode === "api-key";
      const costConfig = showCost
        ? resolveModelCostConfig({
            provider: providerUsed,
            model: modelUsed,
            config: cfg,
          })
        : undefined;
      let formatted = formatResponseUsageLine({
        usage,
        showCost,
        costConfig,
      });
      if (formatted && responseUsageMode === "full" && sessionKey) {
        formatted = `${formatted} · session \`${sessionKey}\``;
      }
      if (formatted) {
        responseUsageLine = formatted;
      }
    }

    // If verbose is enabled, prepend operational run notices.
    let finalPayloads = languageGuardedReplyPayloads;
    const verboseNotices: ReplyPayload[] = [];

    if (verboseEnabled && activeIsNewSession) {
      verboseNotices.push({ text: `🧭 New session: ${followupRun.run.sessionId}` });
    }

    if (fallbackTransition.fallbackTransitioned) {
      emitAgentEvent({
        runId: outcomeRunId,
        sessionKey,
        stream: "lifecycle",
        data: {
          phase: "fallback",
          selectedProvider,
          selectedModel,
          activeProvider: providerUsed,
          activeModel: modelUsed,
          reasonSummary: fallbackTransition.reasonSummary,
          attemptSummaries: fallbackTransition.attemptSummaries,
          attempts: fallbackAttempts,
        },
      });
      if (verboseEnabled) {
        const fallbackNotice = buildFallbackNotice({
          selectedProvider,
          selectedModel,
          activeProvider: providerUsed,
          activeModel: modelUsed,
          attempts: fallbackAttempts,
        });
        if (fallbackNotice) {
          verboseNotices.push({ text: fallbackNotice });
        }
      }
    }
    if (fallbackTransition.fallbackCleared) {
      emitAgentEvent({
        runId: outcomeRunId,
        sessionKey,
        stream: "lifecycle",
        data: {
          phase: "fallback_cleared",
          selectedProvider,
          selectedModel,
          activeProvider: providerUsed,
          activeModel: modelUsed,
          previousActiveModel: fallbackTransition.previousState.activeModel,
        },
      });
      if (verboseEnabled) {
        verboseNotices.push({
          text: buildFallbackClearedNotice({
            selectedProvider,
            selectedModel,
            previousActiveModel: fallbackTransition.previousState.activeModel,
          }),
        });
      }
    }

    if (autoCompactionCompleted) {
      const count = await replyTurnRuntime.state.incrementRunCompactionCount({
        sessionEntry: activeSessionEntry,
        sessionStore: activeSessionStore,
        sessionKey,
        storePath,
        lastCallUsage: runResult.meta?.agentMeta?.lastCallUsage,
        contextTokensUsed,
      });

      // Inject post-compaction workspace context for the next agent turn
      if (sessionKey) {
        const workspaceDir = process.cwd();
        readPostCompactionContext(workspaceDir, cfg)
          .then((contextContent) => {
            if (contextContent) {
              enqueueSystemEvent(contextContent, { sessionKey });
            }
          })
          .catch(() => {
            // Silent failure — post-compaction context is best-effort
          });
      }

      if (verboseEnabled) {
        const suffix = typeof count === "number" ? ` (count ${count})` : "";
        verboseNotices.push({ text: `🧹 Auto-compaction complete${suffix}.` });
      }
    }
    if (verboseNotices.length > 0) {
      finalPayloads = [...verboseNotices, ...finalPayloads];
    }
    if (responseUsageLine) {
      finalPayloads = appendUsageLine(finalPayloads, responseUsageLine);
    }

    return completeDelivery({
      kind: "visible",
      payloads: finalPayloads,
      acceptanceStatus,
      taskBound: Boolean(completionBinding?.taskId),
    });
  } catch (error) {
    // Keep the followup queue moving even when an unexpected exception escapes
    // the run path; the caller still receives the original error.
    finalizeWithFollowup(undefined, queueKey, runFollowupTurn);
    throw error;
  } finally {
    blockReplyPipeline?.stop();
    typing.markRunComplete();
    // Safety net: the dispatcher's onIdle callback normally fires
    // markDispatchIdle(), but if the dispatcher exits early, errors,
    // or the reply path doesn't go through it cleanly, the second
    // signal never fires and the typing keepalive loop runs forever.
    // Calling this twice is harmless — cleanup() is guarded by the
    // `active` flag.  Same pattern as the followup runner fix (#26881).
    typing.markDispatchIdle();
  }
}
