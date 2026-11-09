import { FailoverError, resolveFailoverStatus } from "../../../agents/failover-error.js";
import {
  classifyFailoverReason,
  isFailoverErrorMessage,
  parseImageSizeError,
  pickFallbackThinkingLevel,
} from "../../../agents/pi-embedded-helpers.js";
import { log } from "../../../agents/pi-embedded-runner/logger.js";
import { createFailoverDecisionLogger } from "../../../agents/pi-embedded-runner/run/failover-observation.js";
import { describeUnknownError } from "../../../agents/pi-embedded-runner/utils.js";
import { toNormalizedUsage } from "../outcomes/usage-summary.js";
import { buildErrorAgentMeta } from "../outcomes/usage-summary.js";
import { retainEmbeddedFailureUsage } from "./embedded-failure-usage.js";
import type { RunEmbeddedPiAgentParams } from "./embedded-request.js";
import type { EmbeddedRunAttemptCarry } from "./embedded-run-attempt.js";
import type { EmbeddedRunLoopState } from "./embedded-run-attempt.js";
import type { EmbeddedRunLoopOutcome, EmbeddedRunSession } from "./embedded-run-auth.js";

export async function runEmbeddedRunFailover(args: {
  session: EmbeddedRunSession;
  loop: EmbeddedRunLoopState;
  params: RunEmbeddedPiAgentParams;
  carry: EmbeddedRunAttemptCarry;
  started: number;
  copilotAuthRetry: boolean;
  releaseRunTask: (outcome: "failed" | "cancelled") => void;
}): Promise<EmbeddedRunLoopOutcome> {
  const { session, loop, params, carry, started, copilotAuthRetry, releaseRunTask } = args;
  const { attempt, aborted, promptError, sessionIdUsed, lastAssistant } = carry;
  if (promptError && !aborted) {
    const errorText = describeUnknownError(promptError);
    if (await session.maybeRefreshCopilotForAuthError(errorText, copilotAuthRetry)) {
      loop.authRetryPending = true;
      return { action: "continue" as const };
    }
    // Handle role ordering errors with a user-friendly message
    if (/incorrect role information|roles must alternate/i.test(errorText)) {
      releaseRunTask("failed");
      return {
        action: "return" as const,
        result: {
          payloads: [
            {
              text:
                "Message ordering conflict - please try again. " +
                "If this persists, use /new to start a fresh session.",
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
            error: { kind: "role_ordering", message: errorText },
          },
        },
      };
    }
    // Handle image size errors with a user-friendly message (no retry needed)
    const imageSizeError = parseImageSizeError(errorText);
    if (imageSizeError) {
      releaseRunTask("failed");
      const maxMb = imageSizeError.maxMb;
      const maxMbLabel = typeof maxMb === "number" && Number.isFinite(maxMb) ? `${maxMb}` : null;
      const maxBytesHint = maxMbLabel ? ` (max ${maxMbLabel}MB)` : "";
      return {
        action: "return" as const,
        result: {
          payloads: [
            {
              text:
                `Image too large for the model${maxBytesHint}. ` +
                "Please compress or resize the image and try again.",
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
            error: { kind: "image_size", message: errorText },
          },
        },
      };
    }
    const promptFailoverReason = classifyFailoverReason(errorText);
    const promptProfileFailureReason =
      session.resolveAuthProfileFailureReason(promptFailoverReason);
    await session.maybeMarkAuthProfileFailure({
      profileId: session.lastProfileId,
      reason: promptProfileFailureReason,
    });
    const promptFailoverFailure = isFailoverErrorMessage(errorText);
    // Capture the failing profile before auth-profile rotation mutates `session.lastProfileId`.
    const failedPromptProfileId = session.lastProfileId;
    const logPromptFailoverDecision = createFailoverDecisionLogger({
      stage: "prompt",
      runId: params.runId,
      rawError: errorText,
      failoverReason: promptFailoverReason,
      profileFailureReason: promptProfileFailureReason,
      provider: session.provider,
      model: session.modelId,
      profileId: failedPromptProfileId,
      fallbackConfigured: session.fallbackConfigured,
      aborted,
    });
    if (
      promptFailoverFailure &&
      promptFailoverReason !== "timeout" &&
      (await session.advanceAuthProfile())
    ) {
      logPromptFailoverDecision("rotate_profile");
      await session.maybeBackoffBeforeOverloadFailover(promptFailoverReason);
      return { action: "continue" as const };
    }
    const fallbackThinking = pickFallbackThinkingLevel({
      message: errorText,
      attempted: session.attemptedThinking,
    });
    if (fallbackThinking) {
      log.warn(
        `unsupported thinking level for ${session.provider}/${session.modelId}; retrying with ${fallbackThinking}`,
      );
      session.thinkLevel = fallbackThinking;
      return { action: "continue" as const };
    }
    // Throw FailoverError for prompt-side failover reasons when fallbacks
    // are configured so outer model fallback can continue on overload,
    // rate-limit, auth, or billing failures.
    if (session.fallbackConfigured && promptFailoverFailure) {
      const status = resolveFailoverStatus(promptFailoverReason ?? "unknown");
      logPromptFailoverDecision("fallback_model", { status });
      await session.maybeBackoffBeforeOverloadFailover(promptFailoverReason);
      throw retainEmbeddedFailureUsage(
        new FailoverError(errorText, {
          reason: promptFailoverReason ?? "unknown",
          provider: session.provider,
          model: session.modelId,
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
    if (promptFailoverFailure || promptFailoverReason) {
      logPromptFailoverDecision("surface_error");
    }
    throw retainEmbeddedFailureUsage(
      promptError,
      {
        runId: params.runId,
        provider: params.provider ?? session.provider,
        model: params.model ?? session.modelId,
      },
      toNormalizedUsage(loop.usageAccumulator),
    );
  }

  return { action: "next" as const };

  return { action: "next" as const };
}
