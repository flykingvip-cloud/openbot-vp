import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { amendActiveTask } from "../../agent-runtime/command/amend-active-task.js";
import { controlCurrentTask } from "../../agent-runtime/command/current-task-control.js";
import { queryCurrentTaskStatus } from "../../agent-runtime/command/task-status.js";
import { resolveAgentDir } from "../../agents/agent-scope.js";
import { lookupContextTokens } from "../../agents/context.js";
import { DEFAULT_CONTEXT_TOKENS } from "../../agents/defaults.js";
import { resolveModelAuthMode } from "../../agents/model-auth.js";
import { isCliProvider } from "../../agents/model-selection.js";
import { abortEmbeddedPiRun, queueEmbeddedPiMessage } from "../../agents/pi-embedded.js";
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
import {
  applyIncomingUserMessage,
  activeConstraintTexts,
  commitSameTaskConstraint,
  isOwnerCurrentTaskControlUtterance,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
} from "../../conversation-task/session-task-board.js";
import {
  isTaskBoardContinueInternalPrompt,
  scheduleTaskBoardContinueWake,
} from "../../conversation-task/task-board-continue.js";
import {
  classifyTurnRelation,
  isOwnerExecutionBarrierUtterance,
  shouldPersistOwnerConstraint,
} from "../../conversation-task/turn-relation.js";
import { isEnterpriseRuntimeModelId } from "../../gateway/enterprise-model/ids.js";
import { tryResolveCapabilityGapsFromUsage } from "../../gateway/evolution-control/capability-gap-ingest.js";
import { emitAgentEvent } from "../../infra/agent-events.js";
import { emitDiagnosticEvent, isDiagnosticsEnabled } from "../../infra/diagnostic-events.js";
import { generateSecureUuid } from "../../infra/secure-random.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { defaultRuntime } from "../../runtime.js";
import { enforceVisibleReplyLanguage } from "../../shared/text/visible-reply-language.js";
import { shapeAdmittedComplexTaskReply } from "../../task-orchestration/complex-task-loop.js";
import {
  chatTurnTaskId,
  resolveChatTurnCloseGates,
  resolveTurnContractFromRunMeta,
} from "../../task-outcome/chat-entry.js";
import { registerAwaitingDelivery } from "../../task-outcome/pending-delivery.js";
import {
  TASK_OUTCOME_STORE_DIRNAME,
  type GrowthOutcomeCommitOpts,
} from "../../task-outcome/runtime-from-runner.js";
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
import { runAgentTurnWithFallback } from "./agent-runner-execution.js";
import {
  createShouldEmitToolOutput,
  createShouldEmitToolResult,
  finalizeWithFollowup,
  isAudioPayload,
  signalTypingIfNeeded,
} from "./agent-runner-helpers.js";
import { runMemoryFlushIfNeeded } from "./agent-runner-memory.js";
import { buildReplyPayloads } from "./agent-runner-payloads.js";
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
  classifySilentTurnGrowthOutcome,
  decideHonestEmptyReply,
  formatHonestEmptyReply,
  parseCapabilityGapMarker,
  recordHonestCapabilityGap,
  stripCapabilityGapMarkers,
} from "./honest-empty-reply.js";
import { abortMidTaskAsideLanes, runMidTaskAsideReplyLane } from "./mid-task-aside-reply-lane.js";
import { resolveMidTaskAsideDisposition } from "./mid-task-aside.js";
import { formatAmendConstraintAck } from "./mid-task-dialogue.js";
import { resolveOriginMessageProvider, resolveOriginMessageTo } from "./origin-routing.js";
import { readPostCompactionContext } from "./post-compaction-context.js";
import { resolveActiveRunQueueAction, shouldAttemptCollectAmendSteer } from "./queue-policy.js";
import { clearSessionQueues } from "./queue.js";
import { enqueueFollowupRun, type FollowupRun, type QueueSettings } from "./queue.js";
import { createReplyMediaPathNormalizer } from "./reply-media-paths.js";
import { createReplyToModeFilterForChannel, resolveReplyToMode } from "./reply-threading.js";
import { incrementRunCompactionCount, persistRunSessionUsage } from "./session-run-accounting.js";
import { formatTurnProcessPlaceholder, sanitizeTurnVisibleReply } from "./turn-reply-language.js";
import { createTypingSignaler } from "./typing-mode.js";
import type { TypingController } from "./typing.js";

const BLOCK_REPLY_SEND_TIMEOUT_MS = 15_000;

function resolveCollectAmendTurnRelation(
  sessionFile: string | undefined,
  prompt: string,
): "amend" | "aside" | "new_work" | null {
  const file = sessionFile?.trim();
  if (!file) {
    return null;
  }
  const board = readSessionTaskBoard(file);
  const goal = board.current?.goalText?.trim() ?? "";
  if (!goal) {
    return null;
  }
  // Do not concatenate constraint history into the classified string (slice3).
  return classifyTurnRelation(prompt, goal, {
    activeConstraints: activeConstraintTexts(board.current),
  });
}

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
    shouldSteer,
    shouldFollowup,
    isActive,
    isStreaming,
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

  // Owner pause/cancel while A is active: reuse board control + existing abort path.
  // Must stop new business actions on the in-flight run; wakeSuppress alone is not enough.
  if (
    isActive &&
    isOwnerCurrentTaskControlUtterance(followupRun.prompt) &&
    followupRun.run.sessionFile
  ) {
    const sessionFile = followupRun.run.sessionFile.trim();
    const sessionId = followupRun.run.sessionId;
    const control = controlCurrentTask(followupRun.prompt, {
      applyControl: (prompt) =>
        mutateSessionTaskBoard(sessionFile, (board) => {
          const result = applyIncomingUserMessage({ board, incomingText: prompt });
          return { board: result.board, value: result };
        }),
      abortMain: () => {
        abortEmbeddedPiRun(sessionId);
      },
      abortAsides: () => {
        abortMidTaskAsideLanes(sessionId);
      },
      clearPending: () => {
        clearSessionQueues([queueKey, sessionId, followupRun.run.sessionKey]);
      },
    });
    await touchActiveSessionEntry();
    typing.cleanup();
    return [{ text: control.statusLine?.trim() || "已处理任务控制指令。" }];
  }

  // P3: progress / status asks answered from the live task board — no steer,
  // no followup wait. Board is a projection of existing state, not a new controller.
  if (isActive && followupRun.run.sessionFile) {
    const text = queryCurrentTaskStatus(followupRun.prompt, () =>
      readSessionTaskBoard(followupRun.run.sessionFile),
    );
    if (text !== undefined) {
      await touchActiveSessionEntry();
      typing.cleanup();
      return [{ text }];
    }
  }

  // Slice2: board_readonly = projection only; reply_lane = tools-disabled ephemeral
  // embedded turn (distinct sessionId/file) so ordinary asides answer while A stays
  // active — not a second task controller; never mutates the task board.
  if (isActive && followupRun.run.sessionFile) {
    const board = readSessionTaskBoard(followupRun.run.sessionFile);
    if (board.current) {
      const aside = resolveMidTaskAsideDisposition({
        prompt: followupRun.prompt,
        board,
      });
      if (aside.kind === "board_readonly") {
        await touchActiveSessionEntry();
        typing.cleanup();
        return [{ text: aside.reply }];
      }
      if (aside.kind === "reply_lane_pending") {
        const asideRunId = opts?.runId ?? crypto.randomUUID();
        const lane = await runMidTaskAsideReplyLane({
          parentSessionId: followupRun.run.sessionId,
          parentSessionFile: followupRun.run.sessionFile,
          board,
          userPrompt: followupRun.prompt,
          run: followupRun.run,
          runId: asideRunId,
          messageId: (() => {
            const raw = sessionCtx.MessageSidFull ?? sessionCtx.MessageSid;
            return typeof raw === "string" ? raw : undefined;
          })(),
        });
        await touchActiveSessionEntry();
        typing.cleanup();
        return [{ text: lane.text }];
      }
    }
  }

  if (shouldSteer && isStreaming) {
    const steered = queueEmbeddedPiMessage(followupRun.run.sessionId, followupRun.prompt);
    if (steered && !shouldFollowup) {
      await touchActiveSessionEntry();
      typing.cleanup();
      return undefined;
    }
  } else if (
    shouldAttemptCollectAmendSteer({
      isActive,
      isStreaming,
      shouldSteer,
      shouldFollowup,
      queueMode: resolvedQueue.mode,
      turnRelation: resolveCollectAmendTurnRelation(
        followupRun.run.sessionFile,
        followupRun.prompt,
      ),
      persistOwnerConstraint: shouldPersistOwnerConstraint(followupRun.prompt),
    })
  ) {
    const sessionFile = followupRun.run.sessionFile?.trim() ?? "";
    const amendment = amendActiveTask(isOwnerExecutionBarrierUtterance(followupRun.prompt), {
      readTaskId: () =>
        sessionFile ? (readSessionTaskBoard(sessionFile).current?.taskId?.trim() ?? "") : "",
      persist: (expectedTaskId) =>
        Boolean(sessionFile) &&
        commitSameTaskConstraint({
          sessionFile,
          constraintText: followupRun.prompt,
          expectedTaskId,
        }),
      steer: () => queueEmbeddedPiMessage(followupRun.run.sessionId, followupRun.prompt),
    });
    if (amendment.kind !== "defer") {
      await touchActiveSessionEntry();
      typing.cleanup();
      if (amendment.kind === "barrier-rejected") {
        return [
          {
            text: "限制未能写入原任务板（任务可能已切换或写入失败）。尚未视为生效；请重新发送该限制。",
          },
        ];
      }
      if (amendment.kind === "injected") {
        if (!amendment.persisted) {
          return [
            {
              text: "约束已尝试注入当前执行，但未能写入原任务板（任务可能已切换或写入失败）。请重新发送该补充约束；本次不视为完整成功。",
            },
          ];
        }
        return [{ text: formatAmendConstraintAck(followupRun.prompt) }];
      }
      return [
        {
          text: `限制已写入任务板并生效：${followupRun.prompt.replace(/\s+/g, " ").trim().slice(0, 60)}。注入当前执行未成功，后台仍应按板约束停止相关动作；如需确认请再发一次。`,
        },
      ];
    }
  }

  const activeRunQueueAction = resolveActiveRunQueueAction({
    isActive,
    isHeartbeat,
    shouldFollowup,
    queueMode: resolvedQueue.mode,
  });

  if (activeRunQueueAction === "drop") {
    typing.cleanup();
    return undefined;
  }

  if (activeRunQueueAction === "enqueue-followup") {
    enqueueFollowupRun(queueKey, followupRun, resolvedQueue);
    await touchActiveSessionEntry();
    typing.cleanup();
    return undefined;
  }

  await typingSignals.signalRunStart();

  // Outer turn id (P3-2). Used only as the memory flush `parentRunId` and as the
  // `opts.runId` handed to runAgentTurnWithFallback (its rememberRunModelSet key).
  // Not written into RPC params. Generated the same way runAgentTurnWithFallback
  // generated it before P3-2. Lifecycle events after the turn use `outcomeRunId`.
  const runId = opts?.runId ?? crypto.randomUUID();

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

  const runFollowupTurn = createFollowupRunner({
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

  const maybeScheduleTaskBoardContinue = (payloads: ReplyPayload[] | undefined) => {
    if (isHeartbeat) {
      return;
    }
    if (isTaskBoardContinueInternalPrompt(commandBody)) {
      return;
    }
    const assistantText = (payloads ?? [])
      .map((payload) => (typeof payload.text === "string" ? payload.text.trim() : ""))
      .filter(Boolean)
      .join("\n\n");
    scheduleTaskBoardContinueWake({
      sessionFile: followupRun.run.sessionFile,
      assistantText,
      isHeartbeat,
      toolsDisabled: followupRun.run.disableTools === true,
      enqueue: (prompt, messageId) =>
        enqueueFollowupRun(
          queueKey,
          {
            ...followupRun,
            prompt,
            messageId,
            summaryLine: "task_board_continue",
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
    const nextEntry: SessionEntry = {
      ...prevEntry,
      sessionId: nextSessionId,
      updatedAt: Date.now(),
      systemSent: false,
      abortedLastRun: false,
      modelProvider: undefined,
      model: undefined,
      contextTokens: undefined,
      systemPromptReport: undefined,
      fallbackNoticeSelectedModel: undefined,
      fallbackNoticeActiveModel: undefined,
      fallbackNoticeReason: undefined,
    };
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
    const runOutcome = await runAgentTurnWithFallback({
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

    await persistRunSessionUsage({
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

    // Nothing left to deliver. Private user-facing turns get an honest fallback;
    // group / channel / collaboration / system turns may legitimately stay silent.
    const finalizeEmptyDelivery = () => {
      const decision = decideHonestEmptyReply({
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
      });
      const growth = classifySilentTurnGrowthOutcome(decision);
      if (decision.reason === "user_aborted") {
        void commitGrowthOutcome(false, {
          failureReason: "user_cancelled",
          failureDetail: "user_aborted",
        });
      } else if (growth.success) {
        // Silent success means delivery already happened in-run (messaging tool /
        // block stream / reaction). Confirm delivered from resolved contract only.
        const contract = resolveTurnContractFromRun();
        const deliveryId = `delivery:${outcomeRunId}:${decision.reason}`;
        const gates = resolveChatTurnCloseGates({
          deliveryId,
          contract,
          deliveryPhase: "delivered",
          acceptanceVerified: contract.acceptanceVerified === true,
        });
        void commitGrowthOutcome(true, {
          acceptance: gates.acceptance,
          delivery: gates.delivery,
          deliveryId: gates.deliveryId,
        });
      } else {
        void commitGrowthOutcome(false, {
          failureReason: "run_failed",
          failureDetail: decision.reason,
        });
      }
      if (!decision.emit) {
        return finalizeWithFollowup(undefined, queueKey, runFollowupTurn);
      }
      recordHonestCapabilityGap({
        runId: outcomeRunId,
        agentId: followupRun.run.agentId ?? null,
        tenantId: sessionCtx.GatewayClientSessionEnterpriseId?.trim() || null,
        sessionKey: sessionKey ?? followupRun.run.sessionKey ?? null,
        chatType: sessionCtx.ChatType ?? null,
        reason: decision.reason,
        category: "perception",
        ownerUserId: sessionCtx.GatewayClientPlatformUserId?.trim() || null,
        userLanguageSummary:
          opts?.expectedReplyLanguage === "en"
            ? "silent/empty private turn; missing actionable skill/tool or perception"
            : "私聊静默/空回复；缺可执行技能/工具或可感知输入",
      });
      return finalizeWithFollowup(
        { text: formatHonestEmptyReply(opts?.expectedReplyLanguage ?? null) },
        queueKey,
        runFollowupTurn,
      );
    };

    // Drain any late tool/block deliveries before deciding there's "nothing to send".
    // Otherwise, a late typing trigger (e.g. from a tool callback) can outlive the run and
    // keep the typing indicator stuck.
    if (payloadArray.length === 0) {
      return finalizeEmptyDelivery();
    }

    const payloadResult = await buildReplyPayloads({
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
      const fallbackText = didUseTools
        ? formatTurnProcessPlaceholder(expectedReplyLanguage, "lookup")
        : undefined;
      if (!fallbackText) {
        // Language gate filtered all replies with nothing to show — not a success, do not close gaps.
        void commitGrowthOutcome(false, {
          failureReason: "user_filtered",
          failureDetail: "language_gate_empty",
        });
        return finalizeWithFollowup(undefined, queueKey, runFollowupTurn);
      }
      // Process placeholder is not final delivery — leave incomplete (no evolution positive).
      void commitGrowthOutcome(true, { processPlaceholder: true });
      maybeScheduleTaskBoardContinue([{ text: fallbackText }]);
      return finalizeWithFollowup({ text: fallbackText }, queueKey, runFollowupTurn);
    }

    // Visible reply prepared — acceptance from pinned contract; delivery stays
    // awaiting until dispatch confirms the channel send (not "prepared" = delivered).
    {
      const contract = resolveTurnContractFromRun();
      const deliveryId = `delivery:${outcomeRunId}:visible`;
      const gates = resolveChatTurnCloseGates({
        deliveryId,
        contract,
        deliveryPhase: "awaiting",
        acceptanceVerified: contract.acceptanceVerified === true,
      });
      // Await prepare so confirm cannot race ahead of the pending write.
      await commitGrowthOutcome(true, {
        acceptance: gates.acceptance,
        delivery: gates.delivery,
        deliveryId: gates.deliveryId,
      });
      const growthAgentId = followupRun.run.agentId?.trim();
      if (growthAgentId) {
        const persistRoot = path.join(
          resolveAgentDir(followupRun.run.config, growthAgentId),
          TASK_OUTCOME_STORE_DIRNAME,
        );
        const pendingTaskId = chatTurnTaskId({
          agentId: growthAgentId,
          runId: outcomeRunId,
          sessionKey,
        });
        registerAwaitingDelivery({
          taskId: pendingTaskId,
          deliveryId,
          agentId: growthAgentId,
          runId: outcomeRunId,
          persistRoot,
        });
        // R85e: publish stable ids through shared ref so dispatch confirm
        // can locate the task when replyOptions.runId is omitted.
        if (opts?.pendingTurnDeliveryRef) {
          opts.pendingTurnDeliveryRef.current = {
            runId: outcomeRunId,
            deliveryId,
            taskId: pendingTaskId,
            agentId: growthAgentId,
          };
        }
      }
    }
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
      const count = await incrementRunCompactionCount({
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

    finalPayloads = shapeAdmittedComplexTaskReply({
      payloads: finalPayloads,
      userText: commandBody,
      tenantId:
        sessionCtx.GatewayClientSessionEnterpriseId?.trim() ||
        sessionCtx.CollaborationTenantId?.trim() ||
        null,
      surface:
        sessionCtx.CollaborationGroupId?.trim() ||
        sessionCtx.ChatType === "group" ||
        sessionCtx.GroupSubject?.trim()
          ? "group"
          : "direct",
      fromAgentId: sessionCtx.CollaborationBotAgentId,
      sessionFile: followupRun.run.sessionFile,
      sessionKey: sessionKey ?? followupRun.run.sessionKey,
      cfg: followupRun.run.config,
      disableTools: followupRun.run.disableTools === true,
      env: process.env,
    });

    maybeScheduleTaskBoardContinue(finalPayloads);
    return finalizeWithFollowup(
      finalPayloads.length === 1 ? finalPayloads[0] : finalPayloads,
      queueKey,
      runFollowupTurn,
    );
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
