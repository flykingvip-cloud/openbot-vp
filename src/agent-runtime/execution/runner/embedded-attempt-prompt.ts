import {
  armCompletionHold,
  bindGatedReply,
  resolveAttemptDelivery,
} from "../../../agents/execution-preflight/index.js";
import { isTimeoutError } from "../../../agents/failover-error.js";
import { resolveImageSanitizationLimits } from "../../../agents/image-sanitization.js";
import { log } from "../../../agents/pi-embedded-runner/logger.js";
import { shouldFlagCompactionTimeout } from "../../../agents/pi-embedded-runner/run/compaction-timeout.js";
import { observeAttemptSystemPromptReady } from "../../../agents/pi-embedded-runner/run/execution-router-baselines.js";
import { pruneProcessedHistoryImages } from "../../../agents/pi-embedded-runner/run/history-image-prune.js";
import {
  buildTextOnlyImagePromptGuard,
  detectAndLoadPromptImages,
} from "../../../agents/pi-embedded-runner/run/images.js";
import type { EmbeddedRunAttemptParams } from "../../../agents/pi-embedded-runner/run/types.js";
import { applySystemPromptOverrideToSession } from "../../../agents/pi-embedded-runner/system-prompt.js";
import { subscribeEmbeddedPiSession } from "../../../agents/pi-embedded-subscribe.js";
import {
  createLifecycleSkillToolAttributionHandler,
  resolveLifecycleSkillNamesLoaded,
} from "../../../gateway/skill-invocation/lifecycle-tool-attribution.js";
import { MAX_IMAGE_BYTES } from "../../../media/constants.js";
import { getGlobalHookRunner } from "../../../plugins/hook-runner-global.js";
import { resolvePromptBuildHookResult } from "../../capabilities/index.js";
import { summarizeSessionContext } from "../../context/index.js";
import { composeSystemPromptWithHookContext } from "../../context/index.js";
import { repairTrailingUserTurn } from "../../state/index.js";
import { sessionTaskState } from "../../state/index.js";
import type { EmbeddedAttemptState } from "./embedded-attempt-preflight.js";
import { setActiveEmbeddedRun } from "./run-registry.js";

const getAbortReason = (signal: AbortSignal): unknown => signal.reason;

/** Lifecycle skill attribution, before_prompt_build, role-order repair, image load, through prompt-end log. */
export async function runEmbeddedAttemptPrompt(
  params: EmbeddedRunAttemptParams,
  s: EmbeddedAttemptState,
): Promise<void> {
  s.lifecycleSkillNamesLoaded = resolveLifecycleSkillNamesLoaded(
    s.skillEntries.map((entry) => entry.skill.name),
  );

  const onAgentEventWithSkillAttribution = createLifecycleSkillToolAttributionHandler(
    {
      agentId: params.agentId?.trim() ?? "",
      runId: params.runId,
      sessionKey: params.sessionKey ?? null,
      loadedSkillNames: s.lifecycleSkillNamesLoaded,
    },
    { onAgentEvent: params.onAgentEvent },
  );

  const gateVisibleReply = Boolean(
    s.executionPreflight.deliveryBlockedUntil ||
    s.executionPreflight.requiredValidators.length > 0 ||
    s.executionPreflight.decisionCode === "validator_unavailable",
  );
  const completionHoldKeys = [
    s.executionPreflight.sessionId,
    params.sessionKey ?? "",
    params.sessionId ?? "",
    s.sandboxSessionKey ?? "",
  ];
  if (gateVisibleReply) {
    armCompletionHold({
      keys: completionHoldKeys,
      preflight: s.executionPreflight,
      workspaceDir: s.effectiveWorkspace,
    });
  }
  const heldEvidence = () =>
    resolveAttemptDelivery({
      preflight: s.executionPreflight,
      workspaceDir: s.effectiveWorkspace,
    });
  s.subscription = subscribeEmbeddedPiSession({
    session: s.activeSession,
    runId: params.runId,
    hookRunner: getGlobalHookRunner() ?? undefined,
    verboseLevel: params.verboseLevel,
    reasoningMode: params.reasoningLevel ?? "off",
    toolResultFormat: params.toolResultFormat,
    shouldEmitToolResult: params.shouldEmitToolResult,
    shouldEmitToolOutput: params.shouldEmitToolOutput,
    onToolResult: params.onToolResult,
    onReasoningStream: params.onReasoningStream,
    onReasoningEnd: params.onReasoningEnd,
    onBlockReply: gateVisibleReply
      ? bindGatedReply(params.onBlockReply, heldEvidence)
      : params.onBlockReply,
    onBlockReplyFlush: params.onBlockReplyFlush,
    onBlockReplyDiscard: params.onBlockReplyDiscard,
    blockReplyBreak: params.blockReplyBreak,
    blockReplyChunking: params.blockReplyChunking,
    onPartialReply: gateVisibleReply
      ? bindGatedReply(params.onPartialReply, heldEvidence)
      : params.onPartialReply,
    onAssistantMessageStart: params.onAssistantMessageStart,
    onAgentEvent: onAgentEventWithSkillAttribution,
    enforceFinalTag: params.enforceFinalTag,
    config: params.config,
    sessionKey: s.sandboxSessionKey,
    sessionId: params.sessionId,
    agentId: s.sessionAgentId,
  });

  const phaseValue1 = s.subscription;
  s.assistantTexts = phaseValue1.assistantTexts;
  s.toolMetas = phaseValue1.toolMetas;
  s.unsubscribe = phaseValue1.unsubscribe;
  s.waitForCompactionRetry = phaseValue1.waitForCompactionRetry;
  s.isCompactionInFlight = phaseValue1.isCompactionInFlight;
  s.flushPendingCompactionEnd = phaseValue1.flushPendingCompactionEnd;
  s.getMessagingToolSentTexts = phaseValue1.getMessagingToolSentTexts;
  s.getMessagingToolSentMediaUrls = phaseValue1.getMessagingToolSentMediaUrls;
  s.getMessagingToolSentTargets = phaseValue1.getMessagingToolSentTargets;
  s.getSuccessfulCronAdds = phaseValue1.getSuccessfulCronAdds;
  s.didSendViaMessagingTool = phaseValue1.didSendViaMessagingTool;
  s.getLastToolError = phaseValue1.getLastToolError;
  s.getUsageTotals = phaseValue1.getUsageTotals;
  s.getCompactionCount = phaseValue1.getCompactionCount;

  s.queueHandle = {
    queueMessage: async (text: string) => {
      await s.activeSession.steer(text);
    },
    isStreaming: () => s.activeSession.isStreaming,
    isCompacting: () => s.subscription.isCompacting(),
    abort: s.abortRun,
  };
  setActiveEmbeddedRun(params.sessionId, s.queueHandle, params.sessionKey);

  s.abortWarnTimer = undefined;
  s.isProbeSession = params.sessionId?.startsWith("probe-") ?? false;
  s.abortTimer = setTimeout(
    () => {
      if (!s.isProbeSession) {
        log.warn(
          `embedded run timeout: runId=${params.runId} sessionId=${params.sessionId} timeoutMs=${params.timeoutMs}`,
        );
      }
      if (
        shouldFlagCompactionTimeout({
          isTimeout: true,
          isCompactionPendingOrRetrying: s.subscription.isCompacting(),
          isCompactionInFlight: s.activeSession.isCompacting,
        })
      ) {
        s.timedOutDuringCompaction = true;
      }
      s.abortRun(true);
      if (!s.abortWarnTimer) {
        s.abortWarnTimer = setTimeout(() => {
          if (!s.activeSession.isStreaming) {
            return;
          }
          if (!s.isProbeSession) {
            log.warn(
              `embedded run abort still streaming: runId=${params.runId} sessionId=${params.sessionId}`,
            );
          }
        }, 10_000);
      }
    },
    Math.max(1, params.timeoutMs),
  );

  s.messagesSnapshot = [];
  s.sessionIdUsed = s.activeSession.sessionId;
  s.onAbort = () => {
    const reason = params.abortSignal ? getAbortReason(params.abortSignal) : undefined;
    const timeout = reason ? isTimeoutError(reason) : false;
    if (
      shouldFlagCompactionTimeout({
        isTimeout: timeout,
        isCompactionPendingOrRetrying: s.subscription.isCompacting(),
        isCompactionInFlight: s.activeSession.isCompacting,
      })
    ) {
      s.timedOutDuringCompaction = true;
    }
    s.abortRun(timeout, reason);
  };
  if (params.abortSignal) {
    if (params.abortSignal.aborted) {
      s.onAbort();
    } else {
      params.abortSignal.addEventListener("abort", s.onAbort, {
        once: true,
      });
    }
  }

  // Hook runner was already obtained earlier before tool creation
  s.hookAgentId = s.sessionAgentId;

  s.promptError = null;
  s.promptErrorSource = null;
  s.prePromptMessageCount = s.activeSession.messages.length;
  // Register first, then synchronously recheck: earlier stops are durable in the
  // task board; later stops can now reach this existing active-run abort handle.
  if (
    params.taskExecutionBinding &&
    !sessionTaskState.bindingCurrent(params.sessionFile, params.taskExecutionBinding)
  ) {
    s.abortRun(false, new Error("Original task stopped before active-run registration"));
  }

  if (s.runAbortController.signal.aborted) {
    throw s.makeAbortError(s.runAbortController.signal);
  }
  s.promptStartedAt = Date.now();

  // Run before_prompt_build hooks to allow plugins to inject prompt context.
  // Legacy compatibility: before_agent_start is also checked for context fields.
  let effectivePrompt = params.prompt;
  const hookCtx = {
    agentId: s.hookAgentId,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    workspaceDir: params.workspaceDir,
    messageProvider: params.messageProvider ?? undefined,
    trigger: params.trigger,
    channelId: params.messageChannel ?? params.messageProvider ?? undefined,
  };
  const hookResult = await resolvePromptBuildHookResult({
    prompt: params.prompt,
    messages: s.activeSession.messages,
    hookCtx,
    hookRunner: s.hookRunner,
    legacyBeforeAgentStartResult: params.legacyBeforeAgentStartResult,
  });
  {
    if (hookResult?.prependContext) {
      effectivePrompt = `${hookResult.prependContext}\n\n${params.prompt}`;
      log.debug(`hooks: prepended context to prompt (${hookResult.prependContext.length} chars)`);
    }
    const legacySystemPrompt =
      typeof hookResult?.systemPrompt === "string" ? hookResult.systemPrompt.trim() : "";
    if (legacySystemPrompt) {
      applySystemPromptOverrideToSession(s.activeSession, legacySystemPrompt);
      s.systemPromptText = legacySystemPrompt;
      log.debug(`hooks: applied systemPrompt override (${legacySystemPrompt.length} chars)`);
    }
    const prependedOrAppendedSystemPrompt = composeSystemPromptWithHookContext({
      baseSystemPrompt: s.systemPromptText,
      prependSystemContext: hookResult?.prependSystemContext,
      appendSystemContext: hookResult?.appendSystemContext,
    });
    if (prependedOrAppendedSystemPrompt) {
      const prependSystemLen = hookResult?.prependSystemContext?.trim().length ?? 0;
      const appendSystemLen = hookResult?.appendSystemContext?.trim().length ?? 0;
      applySystemPromptOverrideToSession(s.activeSession, prependedOrAppendedSystemPrompt);
      s.systemPromptText = prependedOrAppendedSystemPrompt;
      log.debug(
        `hooks: applied prependSystemContext/appendSystemContext (${prependSystemLen}+${appendSystemLen} chars)`,
      );
    }
  }

  const textOnlyImageGuard = buildTextOnlyImagePromptGuard({
    prompt: effectivePrompt,
    model: params.model,
    imageToolAvailable: s.tools.some((tool) => tool.name === "image"),
  });
  if (textOnlyImageGuard) {
    effectivePrompt = `${textOnlyImageGuard}\n\n${effectivePrompt}`;
  }

  log.debug(`embedded run prompt start: runId=${params.runId} sessionId=${params.sessionId}`);
  s.cacheTrace?.recordStage("prompt:before", {
    prompt: effectivePrompt,
    messages: s.activeSession.messages,
  });

  // Repair orphaned trailing user messages so new prompts don't violate role ordering.
  // Collaboration rounds skip this: the gateway already persisted the shared user turn,
  // and SessionManager user writes are suppressed (skipUserTranscriptPersist).
  const repairedMessages = repairTrailingUserTurn(
    s.sessionManager,
    params.skipUserTranscriptPersist === true,
  );
  if (repairedMessages) {
    s.activeSession.agent.state.messages = repairedMessages;
    log.warn(
      `Removed orphaned user message to prevent consecutive user turns. runId=${params.runId} sessionId=${params.sessionId}`,
    );
  }

  try {
    // Idempotent cleanup for legacy sessions with persisted image payloads.
    // Called each run; only mutates already-answered user turns that still carry image blocks.
    const didPruneImages = pruneProcessedHistoryImages(s.activeSession.messages);
    if (didPruneImages) {
      s.activeSession.agent.state.messages = s.activeSession.messages;
    }

    // Detect and load images referenced in the prompt for vision-capable models.
    // Images are prompt-local only (pi-like behavior).
    const imageResult = await detectAndLoadPromptImages({
      prompt: effectivePrompt,
      workspaceDir: s.effectiveWorkspace,
      model: params.model,
      existingImages: params.images,
      maxBytes: MAX_IMAGE_BYTES,
      maxDimensionPx: resolveImageSanitizationLimits(params.config).maxDimensionPx,
      workspaceOnly: s.effectiveFsWorkspaceOnly,
      // Enforce sandbox path restrictions when sandbox is enabled
      sandbox:
        s.sandbox?.enabled && s.sandbox?.fsBridge
          ? { root: s.sandbox.workspaceDir, bridge: s.sandbox.fsBridge }
          : undefined,
    });

    s.cacheTrace?.recordStage("prompt:images", {
      prompt: effectivePrompt,
      messages: s.activeSession.messages,
      note: `images: prompt=${imageResult.images.length}`,
    });

    // Diagnostic: log context sizes before prompt to help debug early overflow errors.
    if (log.isEnabled("debug")) {
      const msgCount = s.activeSession.messages.length;
      const systemLen = s.systemPromptText?.length ?? 0;
      const promptLen = effectivePrompt.length;
      const sessionSummary = summarizeSessionContext(s.activeSession.messages);
      log.debug(
        `[context-diag] pre-prompt: sessionKey=${params.sessionKey ?? params.sessionId} ` +
          `messages=${msgCount} roleCounts=${sessionSummary.roleCounts} ` +
          `historyTextChars=${sessionSummary.totalTextChars} ` +
          `maxMessageTextChars=${sessionSummary.maxMessageTextChars} ` +
          `historyImageBlocks=${sessionSummary.totalImageBlocks} ` +
          `systemPromptChars=${systemLen} promptChars=${promptLen} ` +
          `promptImages=${imageResult.images.length} ` +
          `provider=${params.provider}/${params.modelId} sessionFile=${params.sessionFile}`,
      );
    }

    if (s.hookRunner?.hasHooks("llm_input")) {
      s.hookRunner
        .runLlmInput(
          {
            runId: params.runId,
            sessionId: params.sessionId,
            provider: params.provider,
            model: params.modelId,
            systemPrompt: s.systemPromptText,
            prompt: effectivePrompt,
            historyMessages: s.activeSession.messages,
            imagesCount: imageResult.images.length,
          },
          {
            agentId: s.hookAgentId,
            sessionKey: params.sessionKey,
            sessionId: params.sessionId,
            workspaceDir: params.workspaceDir,
            messageProvider: params.messageProvider ?? undefined,
          },
        )
        .catch((err) => {
          log.warn(`llm_input hook failed: ${String(err)}`);
        });
    }

    observeAttemptSystemPromptReady({
      runId: params.runId,
      sessionKey: params.sessionKey,
    });
    // Only pass images option if there are actually images to pass
    // This avoids potential issues with models that don't expect the images parameter
    if (imageResult.images.length > 0) {
      await s.abortable(s.activeSession.prompt(effectivePrompt, { images: imageResult.images }));
    } else {
      await s.abortable(s.activeSession.prompt(effectivePrompt));
    }
  } catch (err) {
    s.promptError = err;
    s.promptErrorSource = "prompt";
  } finally {
    log.debug(
      `embedded run prompt end: runId=${params.runId} sessionId=${params.sessionId} durationMs=${Date.now() - s.promptStartedAt}`,
    );
  }
}
