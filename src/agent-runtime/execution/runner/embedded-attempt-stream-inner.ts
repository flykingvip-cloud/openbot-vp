import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import { isContextCompilerEnabled } from "../../../agents/context-compiler/flag.js";
import { contextCompileTelemetryExtra } from "../../../agents/context-compiler/telemetry.js";
import {
  downgradeOpenAIFunctionCallReasoningPairs,
  validateAnthropicTurns,
  validateGeminiTurns,
} from "../../../agents/pi-embedded-helpers.js";
import { sanitizeSessionHistory } from "../../../agents/pi-embedded-runner/google.js";
import {
  getDmHistoryLimitFromSessionKey,
  limitHistoryTurns,
} from "../../../agents/pi-embedded-runner/history.js";
import { log } from "../../../agents/pi-embedded-runner/logger.js";
import type { EmbeddedRunAttemptParams } from "../../../agents/pi-embedded-runner/run/types.js";
import { applySystemPromptOverrideToSession } from "../../../agents/pi-embedded-runner/system-prompt.js";
import { flushPendingToolResultsAfterIdle } from "../../../agents/pi-embedded-runner/wait-for-idle-before-flush.js";
import { isXaiProvider } from "../../../agents/schema/clean-for-xai.js";
import { sanitizeToolUseResultPairing } from "../../../agents/session-transcript-repair.js";
import { sanitizeToolCallIdsForCloudCodeAssist } from "../../../agents/tool-call-id.js";
import { emitChatInboundStage } from "../../../gateway/chat-inbound-stage-events.js";
import {
  wrapContextCompilerModelBoundary,
  wrapOutboundMessageEstimateGuard,
} from "../../capabilities/index.js";
import { wrapStreamFnEnforceProtocolTextNonExecution } from "../../capabilities/index.js";
import { prependSystemPromptAddition } from "../../context/index.js";
import { wrapStreamFnDecodeXaiToolCallArguments } from "../../model/index.js";
import { wrapStreamFnTrimToolCallNames } from "../../model/index.js";
import type { EmbeddedAttemptState } from "./embedded-attempt-preflight.js";

/** Inner streamFn wraps through estimate guard, history tool_use repair, abort promise. */
export async function runEmbeddedAttemptStreamInner(
  params: EmbeddedRunAttemptParams,
  s: EmbeddedAttemptState,
): Promise<void> {
  if (!s.sessionManager) {
    throw new Error("Attempt session must be prepared before stream-inner");
  }

  // Mistral (and other strict providers) reject tool call IDs that don't match their
  // format requirements (e.g. [a-zA-Z0-9]{9}). sanitizeSessionHistory only processes
  // historical messages at attempt start, but the agent loop's internal tool call →
  // tool result cycles bypass that path. Wrap streamFn so every outbound request
  // sees sanitized tool call IDs.
  if (s.transcriptPolicy.sanitizeToolCallIds && s.transcriptPolicy.toolCallIdMode) {
    const inner = s.activeSession.agent.streamFunction;
    const mode = s.transcriptPolicy.toolCallIdMode;
    s.activeSession.agent.streamFunction = (model, context, options) => {
      const ctx = context as unknown as { messages?: unknown };
      const messages = ctx?.messages;
      if (!Array.isArray(messages)) {
        return inner(model, context, options);
      }
      const sanitized = sanitizeToolCallIdsForCloudCodeAssist(messages as AgentMessage[], mode);
      if (sanitized === messages) {
        return inner(model, context, options);
      }
      const nextContext = {
        ...(context as unknown as Record<string, unknown>),
        messages: sanitized,
      } as unknown;
      return inner(model, nextContext as typeof context, options);
    };
  }

  if (params.model.api === "openai-responses" || params.model.api === "openai-codex-responses") {
    const inner = s.activeSession.agent.streamFunction;
    s.activeSession.agent.streamFunction = (model, context, options) => {
      const ctx = context as unknown as { messages?: unknown };
      const messages = ctx?.messages;
      if (!Array.isArray(messages)) {
        return inner(model, context, options);
      }
      const sanitized = downgradeOpenAIFunctionCallReasoningPairs(messages as AgentMessage[]);
      if (sanitized === messages) {
        return inner(model, context, options);
      }
      const nextContext = {
        ...(context as unknown as Record<string, unknown>),
        messages: sanitized,
      } as unknown;
      return inner(model, nextContext as typeof context, options);
    };
  }

  // Some models emit tool names with surrounding whitespace (e.g. " read ").
  // pi-agent-core dispatches tool calls with exact string matching, so normalize
  // names on the live response stream before tool execution.
  s.activeSession.agent.streamFunction = wrapStreamFnTrimToolCallNames(
    s.activeSession.agent.streamFunction,
    s.allowedToolNames,
  );
  s.activeSession.agent.streamFunction = wrapStreamFnEnforceProtocolTextNonExecution(
    s.activeSession.agent.streamFunction,
    {
      runId: params.runId,
      // Seed only — wrapStreamFn allocates `${attemptId}:mrN` per model response.
      attemptOrTurnId: `${params.runId}:attempt`,
      sessionId: params.sessionId,
      agentId: s.sessionAgentId,
      provider: params.provider,
      model: params.modelId,
      allowedToolNames: s.allowedToolNames,
      boundaryState: s.protocolBoundaryState,
    },
  );

  if (isXaiProvider(params.provider, params.modelId)) {
    s.activeSession.agent.streamFunction = wrapStreamFnDecodeXaiToolCallArguments(
      s.activeSession.agent.streamFunction,
    );
  }

  if (s.anthropicPayloadLogger) {
    s.activeSession.agent.streamFunction = s.anthropicPayloadLogger.wrapStreamFn(
      s.activeSession.agent.streamFunction,
    );
  }

  if (isContextCompilerEnabled()) {
    s.activeSession.agent.streamFunction = wrapContextCompilerModelBoundary({
      streamFn: s.activeSession.agent.streamFunction,
      state: s.contextCompileState,
      runId: params.runId,
      onProviderBoundary: (telemetry) => {
        emitChatInboundStage({
          runId: params.runId,
          stage: "context_provider_boundary",
          sessionKey: params.sessionKey,
          extra: contextCompileTelemetryExtra(telemetry),
        });
      },
    });
  }

  // Outermost: pi-ai estimateMessageTokens runs before HTTP and throws
  // `reading 'length'` on assistant string content (api-proxy-deepseek
  // `content` + `reasoning_content`, and compiler string digests).
  s.activeSession.agent.streamFunction = wrapOutboundMessageEstimateGuard(
    s.activeSession.agent.streamFunction ?? streamSimple,
  );

  try {
    const prior = await sanitizeSessionHistory({
      messages: s.activeSession.messages,
      modelApi: params.model.api,
      modelId: params.modelId,
      provider: params.provider,
      allowedToolNames: s.allowedToolNames,
      config: params.config,
      sessionManager: s.sessionManager,
      sessionId: params.sessionId,
      policy: s.transcriptPolicy,
    });
    s.cacheTrace?.recordStage("session:sanitized", { messages: prior });
    const validatedGemini = s.transcriptPolicy.validateGeminiTurns
      ? validateGeminiTurns(prior)
      : prior;
    const validated = s.transcriptPolicy.validateAnthropicTurns
      ? validateAnthropicTurns(validatedGemini)
      : validatedGemini;
    const truncated = limitHistoryTurns(
      validated,
      getDmHistoryLimitFromSessionKey(params.sessionKey, params.config),
    );
    // Re-run tool_use/tool_result pairing repair after truncation, since
    // limitHistoryTurns can orphan tool_result blocks by removing the
    // assistant message that contained the matching tool_use.
    const limited = s.transcriptPolicy.repairToolUseResultPairing
      ? sanitizeToolUseResultPairing(truncated)
      : truncated;
    s.cacheTrace?.recordStage("session:limited", { messages: limited });
    if (limited.length > 0) {
      s.activeSession.agent.state.messages = limited;
    }

    if (params.contextEngine) {
      try {
        const assembled = await params.contextEngine.assemble({
          sessionId: params.sessionId,
          messages: s.activeSession.messages,
          tokenBudget: params.contextTokenBudget,
        });
        if (assembled.messages !== s.activeSession.messages) {
          // Planner trim can re-break toolCall/toolResult pairing; repair again
          // before the provider request (mirrors post-limitHistoryTurns sanitize).
          const repaired = s.transcriptPolicy.repairToolUseResultPairing
            ? sanitizeToolUseResultPairing(assembled.messages)
            : assembled.messages;
          s.activeSession.agent.state.messages = repaired;
        }
        if (assembled.systemPromptAddition) {
          s.systemPromptText = prependSystemPromptAddition({
            systemPrompt: s.systemPromptText,
            systemPromptAddition: assembled.systemPromptAddition,
          });
          applySystemPromptOverrideToSession(s.activeSession, s.systemPromptText);
          log.debug(
            `context engine: prepended system prompt addition (${assembled.systemPromptAddition.length} chars)`,
          );
        }
      } catch (assembleErr) {
        log.warn(`context engine assemble failed, using pipeline messages: ${String(assembleErr)}`);
      }
    }
  } catch (err) {
    await flushPendingToolResultsAfterIdle({
      agent: s.activeSession?.agent,
      sessionManager: s.sessionManager,
      clearPendingOnTimeout: true,
    });
    s.activeSession.dispose();
    throw err;
  }

  s.aborted = Boolean(params.abortSignal?.aborted);
  s.timedOut = false;
  s.timedOutDuringCompaction = false;
  const getAbortReason = (signal: AbortSignal): unknown =>
    "reason" in signal ? (signal as { reason?: unknown }).reason : undefined;
  const makeTimeoutAbortReason = (): Error => {
    const err = new Error("request timed out");
    err.name = "TimeoutError";
    return err;
  };
  s.makeAbortError = (signal: AbortSignal): Error => {
    const reason = getAbortReason(signal);
    const err = reason ? new Error("aborted", { cause: reason }) : new Error("aborted");
    err.name = "AbortError";
    return err;
  };
  s.abortRun = (isTimeout = false, reason?: unknown) => {
    s.aborted = true;
    if (isTimeout) {
      s.timedOut = true;
    }
    if (isTimeout) {
      s.runAbortController.abort(reason ?? makeTimeoutAbortReason());
    } else {
      s.runAbortController.abort(reason);
    }
    void s.activeSession.abort();
  };
  s.abortable = <T>(promise: Promise<T>): Promise<T> => {
    const signal = s.runAbortController.signal;
    if (signal.aborted) {
      return Promise.reject(s.makeAbortError(signal));
    }
    return new Promise<T>((resolve, reject) => {
      s.onAbort = () => {
        signal.removeEventListener("abort", s.onAbort);
        reject(s.makeAbortError(signal));
      };
      signal.addEventListener("abort", s.onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", s.onAbort);
          resolve(value);
        },
        (err) => {
          signal.removeEventListener("abort", s.onAbort);
          reject(err);
        },
      );
    });
  };
}
