import { disarmCompletionHold } from "../../../agents/execution-preflight/completion-hold.js";
import type { ConstitutionalRuntimeShadowDeps } from "../../../agents/execution-preflight/constitutional-runtime-shadow-deps.js";
import type { HookDeliveryResult } from "../../../agents/execution-preflight/hook-delivery.js";
import {
  formatAssistantErrorText,
  isCompactionFailureError,
  isLikelyContextOverflowError,
} from "../../../agents/pi-embedded-helpers.js";
import { log } from "../../../agents/pi-embedded-runner/logger.js";
import {
  sessionLikelyHasOversizedToolResults,
  truncateOversizedToolResultsInSession,
} from "../../../agents/pi-embedded-runner/tool-result-truncation.js";
import { describeUnknownError } from "../../../agents/pi-embedded-runner/utils.js";
import { normalizeUsage, type UsageLike } from "../../../agents/usage.js";
import type { resolveContextEngine } from "../../../context-engine/index.js";
import { inheritExecutionIdentityRunFields } from "../../../gateway/execution-identity-context.js";
import { sameRunInheritedContextWindowTokens } from "../../model/rule-adaptation/context-cap-selection.js";
import { MAX_OVERFLOW_COMPACTION_ATTEMPTS } from "../../policy/index.js";
import {
  buildErrorAgentMeta,
  createUsageAccumulator,
  mergeUsageIntoAccumulator,
} from "../outcomes/usage-summary.js";
import { recoverContextOverflow } from "../recovery/context-overflow.js";
import { runEmbeddedAttempt } from "./embedded-attempt.js";
import type { RunEmbeddedPiAgentParams } from "./embedded-request.js";
import type { EmbeddedRunLoopOutcome, EmbeddedRunSession } from "./embedded-run-auth.js";

export type EmbeddedRunLoopState = {
  overflowCompactionAttempts: number;
  toolResultTruncationAttempted: boolean;
  bootstrapPromptWarningSignaturesSeen: string[];
  usageAccumulator: ReturnType<typeof createUsageAccumulator>;
  lastRunPromptUsage: ReturnType<typeof normalizeUsage> | undefined;
  autoCompactionCount: number;
  runLoopIterations: number;
  authRetryPending: boolean;
  lastTurnTotal: number | undefined;
  lastAttemptTaskId: string;
  lastHookDelivery: HookDeliveryResult | undefined;
};

export type EmbeddedRunAttemptCarry = {
  attempt: Awaited<ReturnType<typeof runEmbeddedAttempt>>;
  aborted: boolean;
  promptError: unknown;
  timedOut: boolean;
  timedOutDuringCompaction: boolean;
  sessionIdUsed: string;
  lastAssistant: Awaited<ReturnType<typeof runEmbeddedAttempt>>["lastAssistant"];
  activeErrorContext: { provider: string; model: string };
  formattedAssistantErrorText: string | undefined;
  assistantErrorText: string | undefined;
};

export type EmbeddedRunAttemptIterationResult =
  | Exclude<EmbeddedRunLoopOutcome, { action: "next" }>
  | ({ action: "next" } & EmbeddedRunAttemptCarry);

export async function runEmbeddedRunAttemptIteration(args: {
  session: EmbeddedRunSession;
  loop: EmbeddedRunLoopState;
  params: RunEmbeddedPiAgentParams;
  prompt: string;
  resolvedWorkspace: string;
  workspaceAgentId: string;
  resolvedToolResultFormat: "markdown" | "plain";
  constitutionalRuntimeShadowDeps: ConstitutionalRuntimeShadowDeps;
  contextEngine: Awaited<ReturnType<typeof resolveContextEngine>>;
  started: number;
  releaseRunTask: (outcome: "failed" | "cancelled") => void;
  createCompactionDiagId: () => string;
  resolveActiveErrorContext: (params: {
    lastAssistant: { provider?: string; model?: string } | undefined;
    provider: string;
    model: string;
  }) => { provider: string; model: string };
}): Promise<EmbeddedRunAttemptIterationResult> {
  const {
    session,
    loop,
    params,
    prompt,
    resolvedWorkspace,
    workspaceAgentId,
    resolvedToolResultFormat,
    constitutionalRuntimeShadowDeps,
    contextEngine,
    started,
    releaseRunTask,
    createCompactionDiagId,
    resolveActiveErrorContext,
  } = args;
  const inheritedContextWindowTokens = sameRunInheritedContextWindowTokens(
    session.contextCapSelection,
  );
  const attempt = await runEmbeddedAttempt({
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    trigger: params.trigger,
    memoryFlushWritePath: params.memoryFlushWritePath,
    messageChannel: params.messageChannel,
    messageProvider: params.messageProvider,
    agentAccountId: params.agentAccountId,
    messageTo: params.messageTo,
    messageThreadId: params.messageThreadId,
    groupId: params.groupId,
    groupChannel: params.groupChannel,
    groupSpace: params.groupSpace,
    spawnedBy: params.spawnedBy,
    senderId: params.senderId,
    senderName: params.senderName,
    senderUsername: params.senderUsername,
    senderE164: params.senderE164,
    senderIsOwner: params.senderIsOwner,
    ...inheritExecutionIdentityRunFields(params),
    currentChannelId: params.currentChannelId,
    currentThreadTs: params.currentThreadTs,
    currentMessageId: params.currentMessageId,
    replyToMode: params.replyToMode,
    hasRepliedRef: params.hasRepliedRef,
    sessionFile: params.sessionFile,
    skipUserTranscriptPersist: params.skipUserTranscriptPersist,
    collaborationRoundInvoked: params.collaborationRoundInvoked,
    deliveryToolSideEffect: params.deliveryToolSideEffect,
    privateRunBag: params.privateRunBag,
    workspaceDir: resolvedWorkspace,
    agentDir: session.agentDir,
    config: params.config,
    contextEngine,
    contextTokenBudget: session.ctxInfo.tokens,
    ...(inheritedContextWindowTokens !== undefined ? { inheritedContextWindowTokens } : {}),
    skillsSnapshot: params.skillsSnapshot,
    prompt,
    images: params.images,
    disableTools: params.disableTools,
    omitHeartbeatPrompt: params.omitHeartbeatPrompt,
    skillPolicy: params.skillPolicy,
    inboundToolCeiling: params.inboundToolCeiling,
    knowledgeConsumeRefs: params.knowledgeConsumeRefs,
    mentionedPluginToolAllowlist: params.mentionedPluginToolAllowlist,
    provider: session.provider,
    modelId: session.modelId,
    model: session.effectiveModel,
    authProfileId: session.lastProfileId,
    authProfileIdSource: session.lockedProfileId ? "user" : "auto",
    authStorage: session.authStorage,
    modelRegistry: session.modelRegistry,
    agentId: workspaceAgentId,
    legacyBeforeAgentStartResult: session.legacyBeforeAgentStartResult,
    thinkLevel: session.thinkLevel,
    verboseLevel: params.verboseLevel,
    reasoningLevel: params.reasoningLevel,
    toolResultFormat: resolvedToolResultFormat,
    execOverrides: params.execOverrides,
    bashElevated: params.bashElevated,
    timeoutMs: params.timeoutMs,
    runId: params.runId,
    abortSignal: params.abortSignal,
    taskExecutionBinding: params.taskExecutionBinding,
    shouldEmitToolResult: params.shouldEmitToolResult,
    shouldEmitToolOutput: params.shouldEmitToolOutput,
    onPartialReply: params.onPartialReply,
    onAssistantMessageStart: params.onAssistantMessageStart,
    onBlockReply: params.onBlockReply,
    onBlockReplyFlush: params.onBlockReplyFlush,
    onBlockReplyDiscard: params.onBlockReplyDiscard,
    blockReplyBreak: params.blockReplyBreak,
    blockReplyChunking: params.blockReplyChunking,
    onReasoningStream: params.onReasoningStream,
    onReasoningEnd: params.onReasoningEnd,
    onToolResult: params.onToolResult,
    onAgentEvent: params.onAgentEvent,
    extraSystemPrompt: params.extraSystemPrompt,
    organizationContext: params.organizationContext,
    inputProvenance: params.inputProvenance,
    streamParams: params.streamParams,
    ownerNumbers: params.ownerNumbers,
    enforceFinalTag: params.enforceFinalTag,
    bootstrapPromptWarningSignaturesSeen: loop.bootstrapPromptWarningSignaturesSeen,
    bootstrapPromptWarningSignature:
      loop.bootstrapPromptWarningSignaturesSeen[
        loop.bootstrapPromptWarningSignaturesSeen.length - 1
      ],
    // Last, after every spread: nothing spread above can replace the per-run deps.
    constitutionalRuntimeShadowDeps,
  });
  // The attempt finally already drops its in-attempt keys. Repeat the
  // release here so a caller that observes this return never still
  // holds the attempt lock. Retained task context stays for a later send.
  disarmCompletionHold([params.sessionId, params.sessionKey ?? ""]);

  const { aborted, promptError, timedOut, timedOutDuringCompaction, sessionIdUsed, lastAssistant } =
    attempt;
  loop.lastAttemptTaskId = attempt.taskId?.trim() || params.runId?.trim() || "";
  // A compaction retry can return before it has its own delivery evidence.
  // Keep the evidence already captured for this attempt chain.
  if (attempt.hookDelivery) {
    loop.lastHookDelivery = attempt.hookDelivery;
  }
  loop.bootstrapPromptWarningSignaturesSeen =
    attempt.bootstrapPromptWarningSignaturesSeen ??
    (attempt.bootstrapPromptWarningSignature
      ? Array.from(
          new Set([
            ...loop.bootstrapPromptWarningSignaturesSeen,
            attempt.bootstrapPromptWarningSignature,
          ]),
        )
      : loop.bootstrapPromptWarningSignaturesSeen);
  const lastAssistantUsage = normalizeUsage(lastAssistant?.usage as UsageLike);
  const attemptUsage = attempt.attemptUsage ?? lastAssistantUsage;
  mergeUsageIntoAccumulator(loop.usageAccumulator, attemptUsage);
  // Keep prompt size from the latest model call so session totalTokens
  // reflects current context usage, not accumulated tool-loop usage.
  loop.lastRunPromptUsage = lastAssistantUsage ?? attemptUsage;
  loop.lastTurnTotal = lastAssistantUsage?.total ?? attemptUsage?.total;
  const attemptCompactionCount = Math.max(0, attempt.compactionCount ?? 0);
  loop.autoCompactionCount += attemptCompactionCount;
  const activeErrorContext = resolveActiveErrorContext({
    lastAssistant,
    provider: session.provider,
    model: session.modelId,
  });
  const formattedAssistantErrorText = lastAssistant
    ? formatAssistantErrorText(lastAssistant, {
        cfg: params.config,
        sessionKey: params.sessionKey ?? params.sessionId,
        provider: activeErrorContext.provider,
        model: activeErrorContext.model,
      })
    : undefined;
  const assistantErrorText =
    lastAssistant?.stopReason === "error"
      ? lastAssistant.errorMessage?.trim() || formattedAssistantErrorText
      : undefined;

  const contextOverflowError = !aborted
    ? (() => {
        if (promptError) {
          const errorText = describeUnknownError(promptError);
          if (isLikelyContextOverflowError(errorText)) {
            return { text: errorText, source: "promptError" as const };
          }
          // Prompt submission failed with a non-overflow error. Do not
          // inspect prior assistant errors from history for this attempt.
          return null;
        }
        if (assistantErrorText && isLikelyContextOverflowError(assistantErrorText)) {
          return { text: assistantErrorText, source: "assistantError" as const };
        }
        return null;
      })()
    : null;

  if (contextOverflowError) {
    const recovery: Awaited<ReturnType<typeof recoverContextOverflow>> =
      await recoverContextOverflow({
        ports: {
          log,
          isCompactionFailureError,
          hasOversized: sessionLikelyHasOversizedToolResults,
          truncate: truncateOversizedToolResultsInSession,
        },
        contextOverflowError,
        attempt,
        attemptCompactionCount,
        params,
        provider: session.provider,
        modelId: session.modelId,
        ctxInfo: session.ctxInfo,
        createDiagId: createCompactionDiagId,
        overflowCompactionAttempts: loop.overflowCompactionAttempts,
        toolResultTruncationAttempted: loop.toolResultTruncationAttempted,
        autoCompactionCount: loop.autoCompactionCount,
        MAX_OVERFLOW_COMPACTION_ATTEMPTS,
        compact: async ({ diagId, attemptNumber }) => {
          return await contextEngine.compact({
            sessionId: params.sessionId,
            sessionFile: params.sessionFile,
            tokenBudget: session.ctxInfo.tokens,
            force: true,
            compactionTarget: "budget",
            runtimeContext: {
              sessionKey: params.sessionKey,
              messageChannel: params.messageChannel,
              messageProvider: params.messageProvider,
              agentAccountId: params.agentAccountId,
              authProfileId: session.lastProfileId,
              workspaceDir: resolvedWorkspace,
              agentDir: session.agentDir,
              config: params.config,
              skillsSnapshot: params.skillsSnapshot,
              senderIsOwner: params.senderIsOwner,
              provider: session.provider,
              model: session.modelId,
              runId: params.runId,
              thinkLevel: session.thinkLevel,
              reasoningLevel: params.reasoningLevel,
              bashElevated: params.bashElevated,
              extraSystemPrompt: params.extraSystemPrompt,
              ownerNumbers: params.ownerNumbers,
              inboundToolCeiling: params.inboundToolCeiling,
              skillPolicy: params.skillPolicy,
              ...inheritExecutionIdentityRunFields(params),
              ...(inheritedContextWindowTokens !== undefined
                ? { inheritedContextWindowTokens }
                : {}),
              trigger: "overflow",
              diagId,
              attempt: attemptNumber,
              maxAttempts: MAX_OVERFLOW_COMPACTION_ATTEMPTS,
            },
          });
        },
      });
    loop.overflowCompactionAttempts = recovery.overflowCompactionAttempts;
    loop.toolResultTruncationAttempted = recovery.toolResultTruncationAttempted;
    loop.autoCompactionCount = recovery.autoCompactionCount;
    if (recovery.action === "retry") {
      return { action: "continue" as const };
    }
    const errorText = contextOverflowError.text;
    const kind = recovery.kind;
    releaseRunTask("failed");
    return {
      action: "return" as const,
      result: {
        payloads: [
          {
            text:
              "Context overflow: prompt too large for the model. " +
              "Try /reset (or /new) to start a fresh session, or use a larger-context model.",
            isError: true,
          },
        ],
        meta: {
          durationMs: Date.now() - started,
          agentMeta: buildErrorAgentMeta({
            sessionId: sessionIdUsed,
            provider: session.provider,
            model: session.effectiveModel.id,
            usageAccumulator: loop.usageAccumulator,
            lastRunPromptUsage: loop.lastRunPromptUsage,
            lastAssistant,
            lastTurnTotal: loop.lastTurnTotal,
          }),
          systemPromptReport: attempt.systemPromptReport,
          error: { kind, message: errorText },
        },
      },
    };
  }

  return {
    action: "next" as const,
    attempt,
    aborted,
    promptError,
    timedOut,
    timedOutDuringCompaction,
    sessionIdUsed,
    lastAssistant,
    activeErrorContext,
    formattedAssistantErrorText,
    assistantErrorText,
  };
}
