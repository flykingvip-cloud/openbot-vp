import { randomBytes } from "node:crypto";
import { markAuthProfileGood, markAuthProfileUsed } from "../../../agents/auth-profiles.js";
import { latestUserText } from "../../../agents/execution-stall-continue.js";
import { FailoverError, resolveFailoverStatus } from "../../../agents/failover-error.js";
import {
  formatAssistantErrorText,
  formatBillingErrorMessage,
  classifyFailoverReason,
  isAuthAssistantError,
  isBillingAssistantError,
  isFailoverAssistantError,
  isRateLimitAssistantError,
  isTimeoutErrorMessage,
  parseImageDimensionError,
  pickFallbackThinkingLevel,
} from "../../../agents/pi-embedded-helpers.js";
import { log } from "../../../agents/pi-embedded-runner/logger.js";
import { createFailoverDecisionLogger } from "../../../agents/pi-embedded-runner/run/failover-observation.js";
import { derivePromptTokens, normalizeUsage, type UsageLike } from "../../../agents/usage.js";
import { buildEmbeddedRunPayloads, type EmbeddedPayloadFormatting } from "../../delivery/index.js";
import { toNormalizedUsage } from "../outcomes/usage-summary.js";
import { retainEmbeddedFailureUsage } from "./embedded-failure-usage.js";
import type { RunEmbeddedPiAgentParams } from "./embedded-request.js";
import type { EmbeddedPiAgentMeta } from "./embedded-result.js";
import type { EmbeddedRunAttemptCarry } from "./embedded-run-attempt.js";
import type { EmbeddedRunLoopState } from "./embedded-run-attempt.js";
import type { EmbeddedRunLoopOutcome, EmbeddedRunSession } from "./embedded-run-auth.js";

export async function runEmbeddedRunResult(args: {
  session: EmbeddedRunSession;
  loop: EmbeddedRunLoopState;
  params: RunEmbeddedPiAgentParams;
  carry: EmbeddedRunAttemptCarry;
  started: number;
  copilotAuthRetry: boolean;
  isProbeSession: boolean;
  resolvedToolResultFormat: "markdown" | "plain";
  releaseRunTask: (outcome: "failed" | "cancelled") => void;
  embeddedPayloadFormatting: EmbeddedPayloadFormatting;
}): Promise<Exclude<EmbeddedRunLoopOutcome, { action: "next" }>> {
  const {
    session,
    loop,
    params,
    carry,
    started,
    copilotAuthRetry,
    isProbeSession,
    resolvedToolResultFormat,
    releaseRunTask,
    embeddedPayloadFormatting,
  } = args;
  const {
    attempt,
    aborted,
    timedOut,
    timedOutDuringCompaction,
    sessionIdUsed,
    lastAssistant,
    activeErrorContext,
  } = carry;
  const fallbackThinking = pickFallbackThinkingLevel({
    message: lastAssistant?.errorMessage,
    attempted: session.attemptedThinking,
  });
  if (fallbackThinking && !aborted) {
    log.warn(
      `unsupported thinking level for ${session.provider}/${session.modelId}; retrying with ${fallbackThinking}`,
    );
    session.thinkLevel = fallbackThinking;
    return { action: "continue" as const };
  }

  const authFailure = isAuthAssistantError(lastAssistant);
  const rateLimitFailure = isRateLimitAssistantError(lastAssistant);
  const billingFailure = isBillingAssistantError(lastAssistant);
  const failoverFailure = isFailoverAssistantError(lastAssistant);
  const assistantFailoverReason = classifyFailoverReason(lastAssistant?.errorMessage ?? "");
  const assistantProfileFailureReason =
    session.resolveAuthProfileFailureReason(assistantFailoverReason);
  const cloudCodeAssistFormatError = attempt.cloudCodeAssistFormatError;
  const imageDimensionError = parseImageDimensionError(lastAssistant?.errorMessage ?? "");
  // Capture the failing profile before auth-profile rotation mutates `session.lastProfileId`.
  const failedAssistantProfileId = session.lastProfileId;
  const logAssistantFailoverDecision = createFailoverDecisionLogger({
    stage: "assistant",
    runId: params.runId,
    rawError: lastAssistant?.errorMessage?.trim(),
    failoverReason: assistantFailoverReason,
    profileFailureReason: assistantProfileFailureReason,
    provider: activeErrorContext.provider,
    model: activeErrorContext.model,
    profileId: failedAssistantProfileId,
    fallbackConfigured: session.fallbackConfigured,
    timedOut,
    aborted,
  });

  if (
    authFailure &&
    (await session.maybeRefreshCopilotForAuthError(
      lastAssistant?.errorMessage ?? "",
      copilotAuthRetry,
    ))
  ) {
    loop.authRetryPending = true;
    return { action: "continue" as const };
  }
  if (imageDimensionError && session.lastProfileId) {
    const details = [
      imageDimensionError.messageIndex !== undefined
        ? `message=${imageDimensionError.messageIndex}`
        : null,
      imageDimensionError.contentIndex !== undefined
        ? `content=${imageDimensionError.contentIndex}`
        : null,
      imageDimensionError.maxDimensionPx !== undefined
        ? `limit=${imageDimensionError.maxDimensionPx}px`
        : null,
    ]
      .filter(Boolean)
      .join(" ");
    log.warn(
      `Profile ${session.lastProfileId} rejected image payload${details ? ` (${details})` : ""}.`,
    );
  }

  // First-token timeout still rotates to another account/model. After tools
  // already ran, rotation/fallback would replay a bloated turn; surface the
  // existing timeout payload instead. Compaction timeouts stay excluded.
  const timedOutAfterTools = timedOut && attempt.toolMetas.length > 0;
  const shouldRotate =
    !timedOutAfterTools &&
    ((!aborted && failoverFailure) || (timedOut && !timedOutDuringCompaction));

  if (shouldRotate) {
    if (session.lastProfileId) {
      const reason = timedOut ? "timeout" : assistantProfileFailureReason;
      // Skip cooldown for timeouts: a timeout is model/network-specific,
      // not an auth issue. Marking the profile would poison fallback models
      // on the same session.provider (e.g. gpt-5.3 timeout blocks gpt-5.2).
      await session.maybeMarkAuthProfileFailure({
        profileId: session.lastProfileId,
        reason,
      });
      if (timedOut && !isProbeSession) {
        log.warn(`Profile ${session.lastProfileId} timed out. Trying next account...`);
      }
      if (cloudCodeAssistFormatError) {
        log.warn(
          `Profile ${session.lastProfileId} hit Cloud Code Assist format error. Tool calls will be sanitized on retry.`,
        );
      }
    }

    const rotated = await session.advanceAuthProfile();
    if (rotated) {
      logAssistantFailoverDecision("rotate_profile");
      await session.maybeBackoffBeforeOverloadFailover(assistantFailoverReason);
      return { action: "continue" as const };
    }

    if (session.fallbackConfigured) {
      await session.maybeBackoffBeforeOverloadFailover(assistantFailoverReason);
      // Prefer formatted error message (user-friendly) over raw errorMessage
      const message =
        (lastAssistant
          ? formatAssistantErrorText(lastAssistant, {
              cfg: params.config,
              sessionKey: params.sessionKey ?? params.sessionId,
              provider: activeErrorContext.provider,
              model: activeErrorContext.model,
            })
          : undefined) ||
        lastAssistant?.errorMessage?.trim() ||
        (timedOut
          ? "LLM request timed out."
          : rateLimitFailure
            ? "LLM request rate limited."
            : billingFailure
              ? formatBillingErrorMessage(activeErrorContext.provider, activeErrorContext.model)
              : authFailure
                ? "LLM request unauthorized."
                : "LLM request failed.");
      const status =
        resolveFailoverStatus(assistantFailoverReason ?? "unknown") ??
        (isTimeoutErrorMessage(message) ? 408 : undefined);
      logAssistantFailoverDecision("fallback_model", { status });
      throw retainEmbeddedFailureUsage(
        new FailoverError(message, {
          reason: assistantFailoverReason ?? "unknown",
          provider: activeErrorContext.provider,
          model: activeErrorContext.model,
          profileId: session.lastProfileId,
          status,
        }),
        {
          runId: params.runId,
          provider: params.provider ?? session.provider,
          model: params.model ?? session.modelId,
        },
        toNormalizedUsage(loop.usageAccumulator),
      );
    }
    logAssistantFailoverDecision("surface_error");
  }

  const usage = toNormalizedUsage(loop.usageAccumulator);
  if (usage && loop.lastTurnTotal && loop.lastTurnTotal > 0) {
    usage.total = loop.lastTurnTotal;
  }
  // Extract the last individual API call's usage for context-window
  // utilization display. The accumulated `usage` sums input tokens
  // across all calls (tool-use loops, compaction retries), which
  // overstates the actual context size. `lastCallUsage` reflects only
  // the final call, giving an accurate snapshot of current context.
  const lastCallUsage = normalizeUsage(lastAssistant?.usage as UsageLike);
  const promptTokens = derivePromptTokens(loop.lastRunPromptUsage);
  const agentMeta: EmbeddedPiAgentMeta = {
    sessionId: sessionIdUsed,
    provider: lastAssistant?.provider ?? session.provider,
    model: lastAssistant?.model ?? session.effectiveModel.id,
    usage,
    lastCallUsage: lastCallUsage ?? undefined,
    promptTokens,
    compactionCount: loop.autoCompactionCount > 0 ? loop.autoCompactionCount : undefined,
  };

  const payloads = buildEmbeddedRunPayloads(
    {
      assistantTexts: attempt.assistantTexts,
      toolMetas: attempt.toolMetas,
      lastAssistant: attempt.lastAssistant,
      lastToolError: attempt.lastToolError,
      config: params.config,
      sessionKey: params.sessionKey ?? params.sessionId,
      provider: activeErrorContext.provider,
      model: activeErrorContext.model,
      verboseLevel: params.verboseLevel,
      reasoningLevel: params.reasoningLevel,
      toolResultFormat: resolvedToolResultFormat,
      suppressToolErrorWarnings: params.suppressToolErrorWarnings,
      inlineToolResultsAllowed: false,
      didSendViaMessagingTool: attempt.didSendViaMessagingTool,
      didSendDeterministicApprovalPrompt: attempt.didSendDeterministicApprovalPrompt,
      planSpeakContext: latestUserText(attempt.messagesSnapshot),
    },
    embeddedPayloadFormatting,
  );

  // Timeout aborts can leave the run without any assistant payloads.
  // Emit an explicit timeout error instead of silently completing, so
  // callers do not lose the turn as an orphaned user message.
  if (timedOut && !timedOutDuringCompaction && payloads.length === 0) {
    if (aborted) {
      releaseRunTask("cancelled");
    }
    return {
      action: "return" as const,
      result: {
        payloads: [
          {
            text:
              "Request timed out before a response was generated. " +
              "Please try again, or increase `agents.defaults.timeoutSeconds` in your config.",
            isError: true,
          },
        ],
        meta: {
          durationMs: Date.now() - started,
          agentMeta,
          aborted,
          systemPromptReport: attempt.systemPromptReport,
        },
        didSendViaMessagingTool: attempt.didSendViaMessagingTool,
        didSendReaction: attempt.didSendReaction,
        didSendDeterministicApprovalPrompt: attempt.didSendDeterministicApprovalPrompt,
        messagingToolSentTexts: attempt.messagingToolSentTexts,
        messagingToolSentMediaUrls: attempt.messagingToolSentMediaUrls,
        messagingToolSentTargets: attempt.messagingToolSentTargets,
        successfulCronAdds: attempt.successfulCronAdds,
        toolMetas: attempt.toolMetas,
      },
    };
  }

  log.debug(
    `embedded run done: runId=${params.runId} sessionId=${params.sessionId} durationMs=${Date.now() - started} aborted=${aborted}`,
  );
  if (aborted) {
    releaseRunTask("cancelled");
  }
  if (session.lastProfileId) {
    await markAuthProfileGood({
      store: session.authStore,
      provider: session.provider,
      profileId: session.lastProfileId,
      agentDir: params.agentDir,
    });
    await markAuthProfileUsed({
      store: session.authStore,
      profileId: session.lastProfileId,
      agentDir: params.agentDir,
    });
  }
  return {
    action: "return" as const,
    result: {
      payloads: payloads.length ? payloads : undefined,
      meta: {
        durationMs: Date.now() - started,
        agentMeta,
        aborted,
        taskId: loop.lastAttemptTaskId || undefined,
        ...(loop.lastHookDelivery ? { hookDelivery: loop.lastHookDelivery } : {}),
        hookValidatorsRequired: loop.lastHookDelivery?.validatorsRequired === true,
        systemPromptReport: attempt.systemPromptReport,
        // Handle client tool calls (OpenResponses hosted tools)
        // Propagate the LLM stop reason so callers (lifecycle events,
        // ACP bridge) can distinguish end_turn from max_tokens.
        stopReason: attempt.clientToolCall
          ? "tool_calls"
          : (lastAssistant?.stopReason as string | undefined),
        pendingToolCalls: attempt.clientToolCall
          ? [
              {
                id: randomBytes(5).toString("hex").slice(0, 9),
                name: attempt.clientToolCall.name,
                arguments: JSON.stringify(attempt.clientToolCall.params),
              },
            ]
          : undefined,
      },
      didSendViaMessagingTool: attempt.didSendViaMessagingTool,
      didSendReaction: attempt.didSendReaction,
      didSendDeterministicApprovalPrompt: attempt.didSendDeterministicApprovalPrompt,
      messagingToolSentTexts: attempt.messagingToolSentTexts,
      messagingToolSentMediaUrls: attempt.messagingToolSentMediaUrls,
      messagingToolSentTargets: attempt.messagingToolSentTargets,
      successfulCronAdds: attempt.successfulCronAdds,
      toolMetas: attempt.toolMetas,
    },
  };

  throw new Error("unreachable embedded-run result path");
}
