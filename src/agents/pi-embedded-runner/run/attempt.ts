import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentMessage, StreamFn } from "@earendil-works/pi-agent-core";
import { completeSimple, streamSimple } from "@earendil-works/pi-ai/compat";
import { createAgentSession, DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { renderRunSkillContext } from "../../../agent-runtime/context/index.js";
import { resolveAttemptEndOfRunAttribution } from "../../../agent-runtime/execution/index.js";
import { runExecutionStallContinueLoop } from "../../../agent-runtime/execution/index.js";
import { captureTaskActionBoundary } from "../../../agent-runtime/state/task-action.js";
import { resolveHeartbeatPrompt } from "../../../auto-reply/heartbeat.js";
import { resolveChannelCapabilities } from "../../../config/channel-capabilities.js";
import type { OpenBotConfig } from "../../../config/config.js";
import { isTaskExecutionBindingCurrent } from "../../../conversation-task/session-task-board.js";
import { readSessionTaskBoard } from "../../../conversation-task/session-task-board.js";
import { emitChatInboundStage } from "../../../gateway/chat-inbound-stage-events.js";
import {
  compilerTelemetryToFaultRoundSnapshot,
  recordCollabFaultRoundPartial,
} from "../../../gateway/collaboration-dispatch/fault-round-diagnostic.js";
import { inheritExecutionIdentityRunFields } from "../../../gateway/execution-identity-context.js";
import { ingestPatternSampleFromRun } from "../../../gateway/pattern-detection/ingest-from-run.js";
import { resolveSeatTurnContext } from "../../../gateway/seat-rules/turn-context.js";
import { recordLifecycleSkillsLoadedOnRun } from "../../../gateway/skill-invocation/index.js";
import {
  createLifecycleSkillToolAttributionHandler,
  resolveLifecycleSkillNamesLoaded,
} from "../../../gateway/skill-invocation/lifecycle-tool-attribution.js";
import { emitAgentEvent } from "../../../infra/agent-events.js";
import { getMachineDisplayName } from "../../../infra/machine-name.js";
import { ensureGlobalUndiciStreamTimeouts } from "../../../infra/net/undici-global-dispatcher.js";
import {
  collectConnectedPreferredNodeIds,
  formatOperatorComputerTurnPrompt,
} from "../../../infra/operator-local-computer.js";
import { MAX_IMAGE_BYTES } from "../../../media/constants.js";
import { getGlobalHookRunner } from "../../../plugins/hook-runner-global.js";
import type {
  PluginHookAgentContext,
  PluginHookBeforeAgentStartResult,
  PluginHookBeforePromptBuildResult,
} from "../../../plugins/types.js";
import { isCronSessionKey, isSubagentSessionKey } from "../../../routing/session-key.js";
import { joinPresentTextSegments } from "../../../shared/text/join-segments.js";
import {
  registerVisibleReplyRewriter,
  visibleReplyRewritePrompt,
} from "../../../shared/text/visible-reply-language.js";
import { resolveSignalReactionLevel } from "../../../signal/reaction-level.js";
import { resolveTelegramInlineButtonsScope } from "../../../telegram/inline-buttons.js";
import { resolveTelegramReactionLevel } from "../../../telegram/reaction-level.js";
import { buildTtsSystemPromptHint } from "../../../tts/tts.js";
import { resolveUserPath } from "../../../utils.js";
import { normalizeMessageChannel } from "../../../utils/message-channel.js";
import { isReasoningTagProvider } from "../../../utils/provider-utils.js";
import { resolveOpenClawAgentDir } from "../../agent-paths.js";
import { resolveSessionAgentIds } from "../../agent-scope.js";
import { createAnthropicPayloadLogger } from "../../anthropic-payload-log.js";
import {
  analyzeBootstrapBudget,
  buildBootstrapPromptWarning,
  buildBootstrapTruncationReportMeta,
  buildBootstrapInjectionStats,
} from "../../bootstrap-budget.js";
import { makeBootstrapWarn, resolveBootstrapContextForRun } from "../../bootstrap-files.js";
import { shouldForceEmployeeStewardToolFsWorkspaceOnly } from "../../builtin-steward/employee-isolation.js";
import { createCacheTrace } from "../../cache-trace.js";
import {
  listChannelSupportedActions,
  resolveChannelMessageToolHints,
} from "../../channel-tools.js";
import { loadContextCandidates } from "../../context-compiler/candidates.js";
import { shouldApplyCollabCompileStrategy } from "../../context-compiler/collab-compile-strategy.js";
import { isContextCompilerEnabled } from "../../context-compiler/flag.js";
import {
  createContextCompileState,
  installContextCompilerTransform,
  wrapContextCompilerModelBoundary,
  wrapOutboundMessageEstimateGuard,
} from "../../context-compiler/install.js";
import { resolveContextLane } from "../../context-compiler/lane-budget.js";
import { contextCompileTelemetryExtra } from "../../context-compiler/telemetry.js";
import { ensureCustomApiRegistered } from "../../custom-api-registry.js";
import { DEFAULT_CONTEXT_TOKENS } from "../../defaults.js";
import { resolveOpenClawDocsPath } from "../../docs-path.js";
import { isConstitutionalRuntimeShadowEnabled } from "../../execution-preflight/constitutional-runtime-shadow-gate.js";
import { observeConstitutionalRuntimeShadow } from "../../execution-preflight/constitutional-runtime-shadow-observe.js";
import {
  applyPreflightToTools,
  buildExecutionPreflight,
  armCompletionHold,
  bindGatedReply,
  disarmCompletionHold,
  filterLaneTools,
  gateAssistantTexts,
  gateReplyText,
  preflightEvents,
  recordExecutionTrace,
  resolveAttemptDelivery,
  runProductionValidatorsForAttempt,
  resolveExecutionTaskId,
  toHookDeliveryResult,
  resolveSkillFrontmatter,
} from "../../execution-preflight/index.js";
import {
  dropSupersededStallTexts,
  EMPTY_AFTER_TOOLS_CONTINUE_LIMIT,
  EMPTY_AFTER_TOOLS_CONTINUE_PROMPT,
  EXECUTION_STALL_CONTINUE_LIMIT,
  EXECUTION_STALL_CONTINUE_PROMPT,
  executionContinueKind,
  FALSE_CONFIRM_CONTINUE_LIMIT,
  FALSE_CONFIRM_CONTINUE_PROMPT,
  SILENT_EXEC_CONTINUE_LIMIT,
  RECOVERABLE_TOOL_FAILURE_CONTINUE_LIMIT,
  RECOVERABLE_TOOL_FAILURE_CONTINUE_PROMPT,
  SILENT_EXEC_CONTINUE_PROMPT,
  lastAssistantStopKind,
  lastAssistantStopText,
  latestUserText,
  shouldContinueAfterEmptyToolFinal,
  claimStallContinue,
} from "../../execution-stall-continue.js";
import { isTimeoutError } from "../../failover-error.js";
import { resolveImageSanitizationLimits } from "../../image-sanitization.js";
import { filterClientToolDefinitionsForInboundCeiling } from "../../inbound-tool-policy.js";
import { resolveModelAuthMode } from "../../model-auth.js";
import {
  applyUserVisibleOutputGate,
  detectedToolNamesFromGate,
  PROTOCOL_FAILURE_USER_TEXT,
} from "../../model-output-boundary.js";
import { normalizeProviderId, resolveDefaultModelForAgent } from "../../model-selection.js";
import { supportsModelTools } from "../../model-tool-support.js";
import { createConfiguredOllamaStreamFn } from "../../ollama-stream.js";
import { createOpenAIWebSocketStreamFn, releaseWsSession } from "../../openai-ws-stream.js";
import { resolveOwnerDisplaySetting } from "../../owner-display.js";
import {
  downgradeOpenAIFunctionCallReasoningPairs,
  isCloudCodeAssistFormatError,
  resolveBootstrapMaxChars,
  resolveBootstrapPromptTruncationWarningMode,
  resolveBootstrapTotalMaxChars,
  validateAnthropicTurns,
  validateGeminiTurns,
} from "../../pi-embedded-helpers.js";
import { subscribeEmbeddedPiSession } from "../../pi-embedded-subscribe.js";
import { createPreparedEmbeddedPiSettingsManager } from "../../pi-project-settings.js";
import { createPiModelRuntime } from "../../pi-sdk/model-runtime.js";
import { openSessionManager } from "../../pi-sdk/session.js";
import { applyPiAutoCompactionGuard } from "../../pi-settings.js";
import { toClientToolDefinitions } from "../../pi-tool-definition-adapter.js";
import { createOpenClawCodingTools, resolveToolLoopDetectionConfig } from "../../pi-tools.js";
import { normalizeClientToolNamesForProvider } from "../../pi-tools.schema.js";
import {
  allocateModelResponseAttemptId,
  buildProtocolViolationFact,
  createProtocolBoundaryState,
  isProtocolViolationContinueBlocked,
  linkNativeOutcomesForViolation,
  persistProtocolViolationFact,
  PROTOCOL_VIOLATION_STOP_REASON,
  type ProtocolBoundaryState,
} from "../../protocol-violation.js";
import { wrapStreamFnSanitizeProviderToolNames } from "../../provider-tool-name-stream.js";
import { resolveSandboxContext } from "../../sandbox.js";
import {
  accountComputerTurnPrompt,
  grantAccountComputerBrowserTool,
  resolveAccountComputerWebRoute,
} from "../../sandbox/account-computer-browser-routing.js";
import { tryAttachRunningAccountComputerBrowser } from "../../sandbox/account-computer-running-attach.js";
import { resolveEmbeddedSandboxAccount } from "../../sandbox/account-scope.js";
import { resolveEmbeddedRunSandboxContextParams } from "../../sandbox/account-worker-embedded.js";
import { resolveSandboxConfigForAgent } from "../../sandbox/config.js";
import { resolveEffectiveSandboxWorkspaceDir } from "../../sandbox/effective-workspace.js";
import { resolveSandboxRuntimeStatus } from "../../sandbox/runtime-status.js";
import { isXaiProvider } from "../../schema/clean-for-xai.js";
import { repairSessionFileIfNeeded } from "../../session-file-repair.js";
import { guardSessionManager } from "../../session-tool-result-guard-wrapper.js";
import { sanitizeToolUseResultPairing } from "../../session-transcript-repair.js";
import {
  acquireSessionWriteLock,
  resolveSessionLockMaxHoldFromTimeout,
} from "../../session-write-lock.js";
import { detectRuntimeShell } from "../../shell-utils.js";
import {
  applySkillEnvOverrides,
  applySkillEnvOverridesFromSnapshot,
  resolveSkillsPromptForRun,
} from "../../skills.js";
import { buildSystemPromptParams } from "../../system-prompt-params.js";
import { buildSystemPromptReport } from "../../system-prompt-report.js";
import { sanitizeToolCallIdsForCloudCodeAssist } from "../../tool-call-id.js";
import { resolveEffectiveToolFsWorkspaceOnly } from "../../tool-fs-policy.js";
import { normalizeToolName } from "../../tool-policy.js";
import { listNodes } from "../../tools/nodes-utils.js";
import { resolveTranscriptPolicy } from "../../transcript-policy.js";
import { DEFAULT_BOOTSTRAP_FILENAME } from "../../workspace.js";
import { isRunnerAbortError } from "../abort.js";
import { appendCacheTtlTimestamp, isCacheTtlEligibleProvider } from "../cache-ttl.js";
import type { CompactEmbeddedPiSessionParams } from "../compact.js";
import { buildEmbeddedExtensionFactories } from "../extensions.js";
import { applyExtraParamsToAgent } from "../extra-params.js";
import {
  logToolSchemasForGoogle,
  sanitizeSessionHistory,
  sanitizeToolsForGoogle,
} from "../google.js";
import { getDmHistoryLimitFromSessionKey, limitHistoryTurns } from "../history.js";
import { log } from "../logger.js";
import { buildModelAliasLines } from "../model.js";
import { installReplyLanguageReminder } from "../reply-language-reminder.js";
import {
  clearActiveEmbeddedRun,
  type EmbeddedPiQueueHandle,
  setActiveEmbeddedRun,
} from "../runs.js";
import { buildEmbeddedSandboxInfo } from "../sandbox-info.js";
import { prewarmSessionFile, trackSessionManagerAccess } from "../session-manager-cache.js";
import { prepareSessionManagerForRun } from "../session-manager-init.js";
import { resolveEmbeddedRunSkillEntries } from "../skills-runtime.js";
import { resolveStreamApiKey, wrapStreamFnWithResolvedApiKey } from "../stream-api-key.js";
import {
  applySystemPromptOverrideToSession,
  buildEmbeddedSystemPrompt,
  createSystemPromptOverride,
} from "../system-prompt.js";
import { dropThinkingBlocks } from "../thinking.js";
import { collectAllowedToolNames } from "../tool-name-allowlist.js";
import { installToolResultContextGuard } from "../tool-result-context-guard.js";
import { applyEmbeddedCustomToolPolicy, splitSdkTools } from "../tool-split.js";
import { describeUnknownError, mapThinkingLevel } from "../utils.js";
import { flushPendingToolResultsAfterIdle } from "../wait-for-idle-before-flush.js";
import { waitForCompactionRetryWithAggregateTimeout } from "./compaction-retry-aggregate-timeout.js";
import {
  selectCompactionTimeoutSnapshot,
  shouldFlagCompactionTimeout,
} from "./compaction-timeout.js";
import { buildExecutionPreferenceHint } from "./execution-preference-hint.js";
import {
  observeAttemptSkillPreparation,
  observeAttemptSystemPromptReady,
  observeAttemptToolPreparation,
  wrapCreateToolsForObservation,
} from "./execution-router-baselines.js";
import { pruneProcessedHistoryImages } from "./history-image-prune.js";
import { buildTextOnlyImagePromptGuard, detectAndLoadPromptImages } from "./images.js";
import { resolveEmbeddedAttemptToolsRaw } from "./resolve-embedded-tools.js";
import { rewriteAttemptVisibleReply } from "./rewrite-visible-reply.js";
import type { EmbeddedRunAttemptParams, EmbeddedRunAttemptResult } from "./types.js";

type PromptBuildHookRunner = {
  hasHooks: (hookName: "before_prompt_build" | "before_agent_start") => boolean;
  runBeforePromptBuild: (
    event: { prompt: string; messages: unknown[] },
    ctx: PluginHookAgentContext,
  ) => Promise<PluginHookBeforePromptBuildResult | undefined>;
  runBeforeAgentStart: (
    event: { prompt: string; messages: unknown[] },
    ctx: PluginHookAgentContext,
  ) => Promise<PluginHookBeforeAgentStartResult | undefined>;
};

export function isOllamaCompatProvider(model: {
  provider?: string;
  baseUrl?: string;
  api?: string;
}): boolean {
  const providerId = normalizeProviderId(model.provider ?? "");
  if (providerId === "ollama") {
    return true;
  }
  if (!model.baseUrl) {
    return false;
  }
  try {
    const parsed = new URL(model.baseUrl);
    const hostname = parsed.hostname.toLowerCase();
    const isLocalhost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]";
    if (isLocalhost && parsed.port === "11434") {
      return true;
    }

    // Allow remote/LAN Ollama OpenAI-compatible endpoints when the provider id
    // itself indicates Ollama usage (e.g. "my-ollama").
    const providerHintsOllama = providerId.includes("ollama");
    const isOllamaPort = parsed.port === "11434";
    const isOllamaCompatPath = parsed.pathname === "/" || /^\/v1\/?$/i.test(parsed.pathname);
    return providerHintsOllama && isOllamaPort && isOllamaCompatPath;
  } catch {
    return false;
  }
}

export function resolveOllamaCompatNumCtxEnabled(params: {
  config?: OpenBotConfig;
  providerId?: string;
}): boolean {
  const providerId = params.providerId?.trim();
  if (!providerId) {
    return true;
  }
  const providers = params.config?.models?.providers;
  if (!providers) {
    return true;
  }
  const direct = providers[providerId];
  if (direct) {
    return direct.injectNumCtxForOpenAICompat ?? true;
  }
  const normalized = normalizeProviderId(providerId);
  for (const [candidateId, candidate] of Object.entries(providers)) {
    if (normalizeProviderId(candidateId) === normalized) {
      return candidate.injectNumCtxForOpenAICompat ?? true;
    }
  }
  return true;
}

export function shouldInjectOllamaCompatNumCtx(params: {
  model: { api?: string; provider?: string; baseUrl?: string };
  config?: OpenBotConfig;
  providerId?: string;
}): boolean {
  // Restrict to the OpenAI-compatible adapter path only.
  if (params.model.api !== "openai-completions") {
    return false;
  }
  if (!isOllamaCompatProvider(params.model)) {
    return false;
  }
  return resolveOllamaCompatNumCtxEnabled({
    config: params.config,
    providerId: params.providerId,
  });
}

export function wrapOllamaCompatNumCtx(baseFn: StreamFn | undefined, numCtx: number): StreamFn {
  const streamFn = baseFn ?? streamSimple;
  return (model, context, options) =>
    streamFn(model, context, {
      ...options,
      onPayload: (payload: unknown) => {
        if (!payload || typeof payload !== "object") {
          return options?.onPayload?.(payload, model);
        }
        const payloadRecord = payload as Record<string, unknown>;
        if (!payloadRecord.options || typeof payloadRecord.options !== "object") {
          payloadRecord.options = {};
        }
        (payloadRecord.options as Record<string, unknown>).num_ctx = numCtx;
        return options?.onPayload?.(payload, model);
      },
    });
}

function normalizeToolCallNameForDispatch(rawName: string, allowedToolNames?: Set<string>): string {
  const trimmed = rawName.trim();
  if (!trimmed) {
    // Keep whitespace-only placeholders unchanged so they do not collapse to
    // empty names (which can later surface as toolName="" loops).
    return rawName;
  }
  if (!allowedToolNames || allowedToolNames.size === 0) {
    return trimmed;
  }

  const candidateNames = new Set<string>([trimmed, normalizeToolName(trimmed)]);
  const normalizedDelimiter = trimmed.replace(/\//g, ".");
  const segments = normalizedDelimiter
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length > 1) {
    for (let index = 1; index < segments.length; index += 1) {
      const suffix = segments.slice(index).join(".");
      candidateNames.add(suffix);
      candidateNames.add(normalizeToolName(suffix));
    }
  }

  for (const candidate of candidateNames) {
    if (allowedToolNames.has(candidate)) {
      return candidate;
    }
  }

  for (const candidate of candidateNames) {
    const folded = candidate.toLowerCase();
    let caseInsensitiveMatch: string | null = null;
    for (const name of allowedToolNames) {
      if (name.toLowerCase() !== folded) {
        continue;
      }
      if (caseInsensitiveMatch && caseInsensitiveMatch !== name) {
        return candidate;
      }
      caseInsensitiveMatch = name;
    }
    if (caseInsensitiveMatch) {
      return caseInsensitiveMatch;
    }
  }

  return trimmed;
}

function isToolCallBlockType(type: unknown): boolean {
  return type === "toolCall" || type === "toolUse" || type === "functionCall";
}

function normalizeToolCallIdsInMessage(message: unknown): void {
  if (!message || typeof message !== "object") {
    return;
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return;
  }

  const usedIds = new Set<string>();
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const typedBlock = block as { type?: unknown; id?: unknown };
    if (!isToolCallBlockType(typedBlock.type) || typeof typedBlock.id !== "string") {
      continue;
    }
    const trimmedId = typedBlock.id.trim();
    if (!trimmedId) {
      continue;
    }
    usedIds.add(trimmedId);
  }

  let fallbackIndex = 1;
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const typedBlock = block as { type?: unknown; id?: unknown };
    if (!isToolCallBlockType(typedBlock.type)) {
      continue;
    }
    if (typeof typedBlock.id === "string") {
      const trimmedId = typedBlock.id.trim();
      if (trimmedId) {
        if (typedBlock.id !== trimmedId) {
          typedBlock.id = trimmedId;
        }
        usedIds.add(trimmedId);
        continue;
      }
    }

    let fallbackId = "";
    while (!fallbackId || usedIds.has(fallbackId)) {
      fallbackId = `call_auto_${fallbackIndex++}`;
    }
    typedBlock.id = fallbackId;
    usedIds.add(fallbackId);
  }
}

function trimWhitespaceFromToolCallNamesInMessage(
  message: unknown,
  allowedToolNames?: Set<string>,
): void {
  if (!message || typeof message !== "object") {
    return;
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return;
  }
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const typedBlock = block as { type?: unknown; name?: unknown };
    if (!isToolCallBlockType(typedBlock.type) || typeof typedBlock.name !== "string") {
      continue;
    }
    const normalized = normalizeToolCallNameForDispatch(typedBlock.name, allowedToolNames);
    if (normalized !== typedBlock.name) {
      typedBlock.name = normalized;
    }
  }
  normalizeToolCallIdsInMessage(message);
}

function wrapStreamTrimToolCallNames(
  stream: ReturnType<typeof streamSimple>,
  allowedToolNames?: Set<string>,
): ReturnType<typeof streamSimple> {
  const originalResult = stream.result.bind(stream);
  stream.result = async () => {
    const message = await originalResult();
    trimWhitespaceFromToolCallNamesInMessage(message, allowedToolNames);
    return message;
  };

  const originalAsyncIterator = stream[Symbol.asyncIterator].bind(stream);
  (stream as { [Symbol.asyncIterator]: typeof originalAsyncIterator })[Symbol.asyncIterator] =
    function () {
      const iterator = originalAsyncIterator();
      return {
        async next() {
          const result = await iterator.next();
          if (!result.done && result.value && typeof result.value === "object") {
            const event = result.value as {
              partial?: unknown;
              message?: unknown;
            };
            trimWhitespaceFromToolCallNamesInMessage(event.partial, allowedToolNames);
            trimWhitespaceFromToolCallNamesInMessage(event.message, allowedToolNames);
          }
          return result;
        },
        async return(value?: unknown) {
          return iterator.return?.(value) ?? { done: true as const, value: undefined };
        },
        async throw(error?: unknown) {
          return iterator.throw?.(error) ?? { done: true as const, value: undefined };
        },
      };
    };

  return stream;
}

export function wrapStreamFnTrimToolCallNames(
  baseFn: StreamFn,
  allowedToolNames?: Set<string>,
): StreamFn {
  return (model, context, options) => {
    const maybeStream = baseFn(model, context, options);
    if (maybeStream && typeof maybeStream === "object" && "then" in maybeStream) {
      return Promise.resolve(maybeStream).then((stream) =>
        wrapStreamTrimToolCallNames(stream, allowedToolNames),
      );
    }
    return wrapStreamTrimToolCallNames(maybeStream, allowedToolNames);
  };
}

export type ProtocolBodyBoundaryResult =
  | { status: "none" }
  | { status: "stripped-mixed" }
  | { status: "terminated"; classification: string };

export type EnforceProtocolTextContext = {
  runId: string;
  attemptOrTurnId: string;
  sessionId?: string;
  agentId?: string;
  provider?: string;
  model?: string;
  allowedToolNames?: Set<string>;
  boundaryState?: ProtocolBoundaryState;
};

/**
 * Body protocol text is never promoted to executable tool calls.
 * Pure-body violations terminate with protocol_violation; mixed messages keep
 * adapter-normalized native calls and only strip/record the body markup.
 */
export function enforceProtocolTextNonExecutionInMessage(
  message: unknown,
  ctx?: EnforceProtocolTextContext,
): ProtocolBodyBoundaryResult {
  if (!message || typeof message !== "object") {
    return { status: "none" };
  }
  const typedMessage = message as {
    content?: unknown;
    stopReason?: unknown;
  };
  if (!Array.isArray(typedMessage.content)) {
    return { status: "none" };
  }
  const content = typedMessage.content as Array<Record<string, unknown>>;
  const hasNativeToolCall = content.some((block) => isToolCallBlockType(block?.type));

  const textBlocks = content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
  const gated = applyUserVisibleOutputGate(textBlocks);
  if (!gated.detected) {
    return { status: "none" };
  }

  const detectedNames = detectedToolNamesFromGate(gated);
  const allowed = ctx?.allowedToolNames;
  let classification:
    | "pure_body"
    | "mixed_native_and_body"
    | "incomplete_body"
    | "unknown_tool_name_in_body"
    | "no_tools_available" = hasNativeToolCall ? "mixed_native_and_body" : "pure_body";
  if (!hasNativeToolCall) {
    if (gated.incomplete) {
      classification = "incomplete_body";
    } else if (!allowed || allowed.size === 0) {
      classification = "no_tools_available";
    } else if (
      detectedNames.some((name) => !allowed.has(normalizeToolCallNameForDispatch(name, allowed)))
    ) {
      classification = "unknown_tool_name_in_body";
    }
  }

  const nonTextBlocks = content.filter((block) => block?.type !== "text");

  const recordFact = (
    terminated: boolean,
    displayOutcome: "failure_copy" | "stripped_partial" | "stripped_empty",
    nativeExecutionStatus: "none" | "requested",
  ) => {
    if (!ctx) {
      return;
    }
    const fact = buildProtocolViolationFact({
      runId: ctx.runId,
      attemptOrTurnId: ctx.attemptOrTurnId,
      sessionId: ctx.sessionId,
      agentId: ctx.agentId,
      provider: ctx.provider,
      model: ctx.model,
      protocol: gated.protocol,
      classification,
      allowedToolNames: allowed ?? [],
      detectedToolNames: detectedNames,
      rawText: textBlocks,
      displayOutcome,
      nativeExecutionStatus,
      terminated,
    });
    persistProtocolViolationFact(fact);
    if (ctx.boundaryState) {
      ctx.boundaryState.lastFact = fact;
      if (terminated) {
        ctx.boundaryState.terminated = true;
      }
    }
    emitAgentEvent({
      runId: ctx.runId,
      stream: "lifecycle",
      data: {
        event: "protocol_violation",
        eventId: fact.eventId,
        classification: fact.classification,
        protocol: fact.protocol,
        terminated,
        nativeExecutionStatus: fact.nativeExecutionStatus,
        detectedToolNames: fact.detectedToolNames,
        ...(terminated ? { stopReason: PROTOCOL_VIOLATION_STOP_REASON } : {}),
      },
    });
  };

  if (hasNativeToolCall) {
    const visible = gated.visibleText.trim();
    typedMessage.content = [
      ...nonTextBlocks,
      ...(visible ? [{ type: "text", text: gated.visibleText }] : []),
    ];
    // Mixed: never pretreat native as executed; empty stripped body is stripped_empty
    // (not failure_copy — failure copy is only for pure-body terminate).
    recordFact(false, visible ? "stripped_partial" : "stripped_empty", "requested");
    return { status: "stripped-mixed" };
  }

  // Pure body: never synthesize toolCall; explicit failure + terminate (§4 / §7.1).
  typedMessage.content = [...nonTextBlocks, { type: "text", text: PROTOCOL_FAILURE_USER_TEXT }];
  typedMessage.stopReason = PROTOCOL_VIOLATION_STOP_REASON;
  recordFact(true, "failure_copy", "none");
  return { status: "terminated", classification };
}

function wrapStreamEnforceProtocolTextNonExecution(
  stream: ReturnType<typeof streamSimple>,
  ctx: EnforceProtocolTextContext,
): ReturnType<typeof streamSimple> {
  const originalResult = stream.result.bind(stream);
  stream.result = async () => {
    const message = await originalResult();
    enforceProtocolTextNonExecutionInMessage(message, ctx);
    return message;
  };
  return stream;
}

export function wrapStreamFnEnforceProtocolTextNonExecution(
  baseFn: StreamFn,
  ctx: EnforceProtocolTextContext,
): StreamFn {
  return (model, context, options) => {
    // One attemptOrTurnId per model-response stream invocation; multi-callback
    // within the same stream reuses it via the closed-over perResponseCtx.
    const attemptOrTurnId = ctx.boundaryState
      ? allocateModelResponseAttemptId(ctx.boundaryState)
      : ctx.attemptOrTurnId;
    const perResponseCtx: EnforceProtocolTextContext = { ...ctx, attemptOrTurnId };
    const maybeStream = baseFn(model, context, options);
    if (maybeStream && typeof maybeStream === "object" && "then" in maybeStream) {
      return Promise.resolve(maybeStream).then((stream) =>
        wrapStreamEnforceProtocolTextNonExecution(stream, perResponseCtx),
      );
    }
    return wrapStreamEnforceProtocolTextNonExecution(maybeStream, perResponseCtx);
  };
}

// ---------------------------------------------------------------------------
// xAI / Grok: decode HTML entities in tool call arguments
// ---------------------------------------------------------------------------

const HTML_ENTITY_RE = /&(?:amp|lt|gt|quot|apos|#39|#x[0-9a-f]+|#\d+);/i;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gi, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

export function decodeHtmlEntitiesInObject(obj: unknown): unknown {
  if (typeof obj === "string") {
    return HTML_ENTITY_RE.test(obj) ? decodeHtmlEntities(obj) : obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(decodeHtmlEntitiesInObject);
  }
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = decodeHtmlEntitiesInObject(val);
    }
    return result;
  }
  return obj;
}

function decodeXaiToolCallArgumentsInMessage(message: unknown): void {
  if (!message || typeof message !== "object") {
    return;
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return;
  }
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const typedBlock = block as { type?: unknown; arguments?: unknown };
    if (typedBlock.type !== "toolCall" || !typedBlock.arguments) {
      continue;
    }
    if (typeof typedBlock.arguments === "object") {
      typedBlock.arguments = decodeHtmlEntitiesInObject(typedBlock.arguments);
    }
  }
}

function wrapStreamDecodeXaiToolCallArguments(
  stream: ReturnType<typeof streamSimple>,
): ReturnType<typeof streamSimple> {
  const originalResult = stream.result.bind(stream);
  stream.result = async () => {
    const message = await originalResult();
    decodeXaiToolCallArgumentsInMessage(message);
    return message;
  };

  const originalAsyncIterator = stream[Symbol.asyncIterator].bind(stream);
  (stream as { [Symbol.asyncIterator]: typeof originalAsyncIterator })[Symbol.asyncIterator] =
    function () {
      const iterator = originalAsyncIterator();
      return {
        async next() {
          const result = await iterator.next();
          if (!result.done && result.value && typeof result.value === "object") {
            const event = result.value as { partial?: unknown; message?: unknown };
            decodeXaiToolCallArgumentsInMessage(event.partial);
            decodeXaiToolCallArgumentsInMessage(event.message);
          }
          return result;
        },
        async return(value?: unknown) {
          return iterator.return?.(value) ?? { done: true as const, value: undefined };
        },
        async throw(error?: unknown) {
          return iterator.throw?.(error) ?? { done: true as const, value: undefined };
        },
      };
    };
  return stream;
}

function wrapStreamFnDecodeXaiToolCallArguments(baseFn: StreamFn): StreamFn {
  return (model, context, options) => {
    const maybeStream = baseFn(model, context, options);
    if (maybeStream && typeof maybeStream === "object" && "then" in maybeStream) {
      return Promise.resolve(maybeStream).then((stream) =>
        wrapStreamDecodeXaiToolCallArguments(stream),
      );
    }
    return wrapStreamDecodeXaiToolCallArguments(maybeStream);
  };
}

export async function resolvePromptBuildHookResult(params: {
  prompt: string;
  messages: unknown[];
  hookCtx: PluginHookAgentContext;
  hookRunner?: PromptBuildHookRunner | null;
  legacyBeforeAgentStartResult?: PluginHookBeforeAgentStartResult;
}): Promise<PluginHookBeforePromptBuildResult> {
  const promptBuildResult = params.hookRunner?.hasHooks("before_prompt_build")
    ? await params.hookRunner
        .runBeforePromptBuild(
          {
            prompt: params.prompt,
            messages: params.messages,
          },
          params.hookCtx,
        )
        .catch((hookErr: unknown) => {
          log.warn(`before_prompt_build hook failed: ${String(hookErr)}`);
          return undefined;
        })
    : undefined;
  const legacyResult =
    params.legacyBeforeAgentStartResult ??
    (params.hookRunner?.hasHooks("before_agent_start")
      ? await params.hookRunner
          .runBeforeAgentStart(
            {
              prompt: params.prompt,
              messages: params.messages,
            },
            params.hookCtx,
          )
          .catch((hookErr: unknown) => {
            log.warn(
              `before_agent_start hook (legacy prompt build path) failed: ${String(hookErr)}`,
            );
            return undefined;
          })
      : undefined);
  return {
    systemPrompt: promptBuildResult?.systemPrompt ?? legacyResult?.systemPrompt,
    prependContext: joinPresentTextSegments([
      promptBuildResult?.prependContext,
      legacyResult?.prependContext,
    ]),
    prependSystemContext: joinPresentTextSegments([
      promptBuildResult?.prependSystemContext,
      legacyResult?.prependSystemContext,
    ]),
    appendSystemContext: joinPresentTextSegments([
      promptBuildResult?.appendSystemContext,
      legacyResult?.appendSystemContext,
    ]),
  };
}

export function composeSystemPromptWithHookContext(params: {
  baseSystemPrompt?: string;
  prependSystemContext?: string;
  appendSystemContext?: string;
}): string | undefined {
  const prependSystem = params.prependSystemContext?.trim();
  const appendSystem = params.appendSystemContext?.trim();
  if (!prependSystem && !appendSystem) {
    return undefined;
  }
  return joinPresentTextSegments(
    [params.prependSystemContext, params.baseSystemPrompt, params.appendSystemContext],
    { trim: true },
  );
}

export function resolvePromptModeForSession(sessionKey?: string): "minimal" | "full" {
  if (!sessionKey) {
    return "full";
  }
  return isSubagentSessionKey(sessionKey) || isCronSessionKey(sessionKey) ? "minimal" : "full";
}

export function resolveAttemptFsWorkspaceOnly(params: {
  config?: OpenBotConfig;
  sessionAgentId: string;
  sessionKey?: string;
  /** Collaboration rounds must keep exec/tool cwd inside the group workspace root. */
  collaborationRoundInvoked?: boolean;
}): boolean {
  if (params.collaborationRoundInvoked) {
    return true;
  }
  if (
    shouldForceEmployeeStewardToolFsWorkspaceOnly({
      sessionKey: params.sessionKey,
      agentId: params.sessionAgentId,
    })
  ) {
    return true;
  }
  return resolveEffectiveToolFsWorkspaceOnly({
    cfg: params.config,
    agentId: params.sessionAgentId,
  });
}

export function prependSystemPromptAddition(params: {
  systemPrompt: string;
  systemPromptAddition?: string;
}): string {
  if (!params.systemPromptAddition) {
    return params.systemPrompt;
  }
  return `${params.systemPromptAddition}\n\n${params.systemPrompt}`;
}

/** Build runtime context passed into context-engine afterTurn hooks. */
export function buildAfterTurnRuntimeContext(params: {
  attempt: Pick<
    EmbeddedRunAttemptParams,
    | "sessionKey"
    | "messageChannel"
    | "messageProvider"
    | "agentAccountId"
    | "config"
    | "skillsSnapshot"
    | "senderIsOwner"
    | "provider"
    | "modelId"
    | "thinkLevel"
    | "reasoningLevel"
    | "bashElevated"
    | "extraSystemPrompt"
    | "ownerNumbers"
    | "authProfileId"
    | "inboundToolCeiling"
    | "skillPolicy"
    | "executionIdentity"
    | "gatewayClientUser"
    | "gatewayClientSessionDomain"
    | "gatewayClientPlatformUserId"
    | "gatewayClientSessionEnterpriseId"
    | "gatewayClientSessionMembershipId"
  >;
  workspaceDir: string;
  agentDir: string;
}): Partial<CompactEmbeddedPiSessionParams> {
  return {
    sessionKey: params.attempt.sessionKey,
    messageChannel: params.attempt.messageChannel,
    messageProvider: params.attempt.messageProvider,
    agentAccountId: params.attempt.agentAccountId,
    authProfileId: params.attempt.authProfileId,
    workspaceDir: params.workspaceDir,
    agentDir: params.agentDir,
    config: params.attempt.config,
    skillsSnapshot: params.attempt.skillsSnapshot,
    senderIsOwner: params.attempt.senderIsOwner,
    provider: params.attempt.provider,
    model: params.attempt.modelId,
    thinkLevel: params.attempt.thinkLevel,
    reasoningLevel: params.attempt.reasoningLevel,
    bashElevated: params.attempt.bashElevated,
    extraSystemPrompt: params.attempt.extraSystemPrompt,
    ownerNumbers: params.attempt.ownerNumbers,
    inboundToolCeiling: params.attempt.inboundToolCeiling,
    skillPolicy: params.attempt.skillPolicy,
    ...inheritExecutionIdentityRunFields(params.attempt),
  };
}

function summarizeMessagePayload(msg: AgentMessage): { textChars: number; imageBlocks: number } {
  const content = (msg as { content?: unknown }).content;
  if (typeof content === "string") {
    return { textChars: content.length, imageBlocks: 0 };
  }
  if (!Array.isArray(content)) {
    return { textChars: 0, imageBlocks: 0 };
  }

  let textChars = 0;
  let imageBlocks = 0;
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const typedBlock = block as { type?: unknown; text?: unknown };
    if (typedBlock.type === "image") {
      imageBlocks++;
      continue;
    }
    if (typeof typedBlock.text === "string") {
      textChars += typedBlock.text.length;
    }
  }

  return { textChars, imageBlocks };
}

function summarizeSessionContext(messages: AgentMessage[]): {
  roleCounts: string;
  totalTextChars: number;
  totalImageBlocks: number;
  maxMessageTextChars: number;
} {
  const roleCounts = new Map<string, number>();
  let totalTextChars = 0;
  let totalImageBlocks = 0;
  let maxMessageTextChars = 0;

  for (const msg of messages) {
    const role = typeof msg.role === "string" ? msg.role : "unknown";
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);

    const payload = summarizeMessagePayload(msg);
    totalTextChars += payload.textChars;
    totalImageBlocks += payload.imageBlocks;
    if (payload.textChars > maxMessageTextChars) {
      maxMessageTextChars = payload.textChars;
    }
  }

  return {
    roleCounts:
      [...roleCounts.entries()]
        .toSorted((a, b) => a[0].localeCompare(b[0]))
        .map(([role, count]) => `${role}:${count}`)
        .join(",") || "none",
    totalTextChars,
    totalImageBlocks,
    maxMessageTextChars,
  };
}

export async function runEmbeddedAttempt(
  params: EmbeddedRunAttemptParams,
): Promise<EmbeddedRunAttemptResult> {
  const resolvedWorkspace = resolveUserPath(params.workspaceDir);
  const prevCwd = process.cwd();
  const runAbortController = new AbortController();
  ensureGlobalUndiciStreamTimeouts();

  log.debug(
    `embedded run start: runId=${params.runId} sessionId=${params.sessionId} provider=${params.provider} model=${params.modelId} thinking=${params.thinkLevel} messageChannel=${params.messageChannel ?? params.messageProvider ?? "unknown"}`,
  );

  await fs.mkdir(resolvedWorkspace, { recursive: true });

  const sandboxSessionKey = params.sessionKey?.trim() || params.sessionId;
  let sandbox = await resolveSandboxContext(
    await resolveEmbeddedRunSandboxContextParams({
      config: params.config,
      sessionKey: sandboxSessionKey,
      workspaceDir: resolvedWorkspace,
      agentId: params.agentId,
      gatewayClientUser: params.gatewayClientUser,
      gatewayClientPlatformUserId: params.gatewayClientPlatformUserId,
      gatewayClientSessionEnterpriseId: params.gatewayClientSessionEnterpriseId,
      executionIdentity: params.executionIdentity,
    }),
  );
  // personal_local + sandbox.mode=off: still attach browser to RUNNING 云电脑
  // so 电脑 tab and agent browser are the same shared Chromium (#423).
  if (!sandbox?.accountComputerBrowser) {
    const account = resolveEmbeddedSandboxAccount({
      agentId: params.agentId,
      gatewayClientUser: params.gatewayClientUser,
      gatewayClientPlatformUserId: params.gatewayClientPlatformUserId,
      gatewayClientSessionEnterpriseId: params.gatewayClientSessionEnterpriseId,
      executionIdentity: params.executionIdentity,
    });
    const platformUserId =
      account?.userId ||
      params.gatewayClientPlatformUserId?.trim() ||
      params.executionIdentity?.platformUserId?.trim() ||
      "";
    if (platformUserId && !platformUserId.includes("@")) {
      const attached = await tryAttachRunningAccountComputerBrowser({
        tenantId: account?.tenantId,
        userId: platformUserId,
        config: params.config,
      });
      if (attached) {
        const sandboxCfg = resolveSandboxConfigForAgent(params.config, params.agentId);
        sandbox = {
          enabled: false,
          sessionKey: sandboxSessionKey,
          workspaceDir: resolvedWorkspace,
          agentWorkspaceDir: resolvedWorkspace,
          workspaceAccess: "rw",
          containerName: attached.containerName,
          containerWorkdir: resolvedWorkspace,
          docker: sandboxCfg.docker,
          tools: grantAccountComputerBrowserTool(sandboxCfg.tools),
          browserAllowHostControl: false,
          browser: attached,
          accountComputerBrowser: true,
        };
      }
    }
  }
  const accountComputerRoute =
    sandbox?.accountComputerBrowser === true
      ? resolveAccountComputerWebRoute(params.prompt)
      : undefined;
  const accountComputerTurnPromptText = accountComputerRoute
    ? accountComputerTurnPrompt(accountComputerRoute)
    : undefined;
  const effectiveWorkspace = resolveEffectiveSandboxWorkspaceDir({
    resolvedWorkspace,
    sandbox,
  });
  await fs.mkdir(effectiveWorkspace, { recursive: true });

  let restoreSkillEnv: (() => void) | undefined;
  process.chdir(effectiveWorkspace);
  try {
    const skillContextInput = {
      workspaceDir: effectiveWorkspace,
      config: params.config,
      skillsSnapshot: params.skillsSnapshot,
      agentId: params.agentId,
    };
    const preparedSkillContext = {
      input: skillContextInput,
      selection: resolveEmbeddedRunSkillEntries(skillContextInput),
    };
    const { skillEntries, preferLiveEntries } = preparedSkillContext.selection;
    restoreSkillEnv =
      params.skillsSnapshot && !preferLiveEntries
        ? applySkillEnvOverridesFromSnapshot({
            snapshot: params.skillsSnapshot,
            config: params.config,
          })
        : applySkillEnvOverrides({
            skills: skillEntries ?? [],
            config: params.config,
          });

    const accountSandboxLocations =
      sandbox?.enabled === true && sandbox.containerWorkdir === "/account/workspace";
    const skillsPrompt = renderRunSkillContext(
      preparedSkillContext,
      { runId: params.runId, sessionKey: params.sessionKey, accountSandboxLocations },
      { render: resolveSkillsPromptForRun, observe: observeAttemptSkillPreparation },
    );

    const sessionLabel = params.sessionKey ?? params.sessionId;
    const { bootstrapFiles: hookAdjustedBootstrapFiles, contextFiles } =
      await resolveBootstrapContextForRun({
        workspaceDir: effectiveWorkspace,
        config: params.config,
        sessionKey: params.sessionKey,
        sessionId: params.sessionId,
        warn: makeBootstrapWarn({ sessionLabel, warn: (message) => log.warn(message) }),
        contextMode: params.bootstrapContextMode,
        runKind: params.bootstrapContextRunKind,
      });
    const bootstrapMaxChars = resolveBootstrapMaxChars(params.config);
    const bootstrapTotalMaxChars = resolveBootstrapTotalMaxChars(params.config);
    const bootstrapAnalysis = analyzeBootstrapBudget({
      files: buildBootstrapInjectionStats({
        bootstrapFiles: hookAdjustedBootstrapFiles,
        injectedFiles: contextFiles,
      }),
      bootstrapMaxChars,
      bootstrapTotalMaxChars,
    });
    const bootstrapPromptWarningMode = resolveBootstrapPromptTruncationWarningMode(params.config);
    const bootstrapPromptWarning = buildBootstrapPromptWarning({
      analysis: bootstrapAnalysis,
      mode: bootstrapPromptWarningMode,
      seenSignatures: params.bootstrapPromptWarningSignaturesSeen,
      previousSignature: params.bootstrapPromptWarningSignature,
    });
    const workspaceNotes = hookAdjustedBootstrapFiles.some(
      (file) => file.name === DEFAULT_BOOTSTRAP_FILENAME && !file.missing,
    )
      ? ["Reminder: commit your changes in this workspace after edits."]
      : undefined;

    const agentDir = params.agentDir ?? resolveOpenClawAgentDir();

    const { defaultAgentId, sessionAgentId } = resolveSessionAgentIds({
      sessionKey: params.sessionKey,
      config: params.config,
      agentId: params.agentId,
    });
    const effectiveFsWorkspaceOnly = resolveAttemptFsWorkspaceOnly({
      config: params.config,
      sessionAgentId,
      sessionKey: params.sessionKey,
      collaborationRoundInvoked: params.collaborationRoundInvoked,
    });
    // Check if the model supports native image input
    const modelHasVision = params.model.input?.includes("image") ?? false;
    const operatorEmail = params.executionIdentity?.user?.trim();
    let preferredNodeIds: string[] = [];
    try {
      preferredNodeIds = collectConnectedPreferredNodeIds(await listNodes({}));
    } catch {
      preferredNodeIds = [];
    }
    const seatTurnForExec = await resolveSeatTurnContext({
      cfg: params.config,
      tenantId: params.executionIdentity?.enterpriseId,
      employeeId: params.executionIdentity?.platformUserId,
      ...(operatorEmail ? { operatorUserIdAliases: [operatorEmail] } : {}),
      ...(preferredNodeIds.length > 0 ? { preferredNodeIds } : {}),
      agentId: sessionAgentId,
    });
    const seatExecPreference =
      seatTurnForExec?.bound && seatTurnForExec.execPreference
        ? seatTurnForExec.execPreference
        : undefined;
    const operatorComputerBindingTarget =
      seatTurnForExec?.bound &&
      seatTurnForExec.tenantId &&
      seatTurnForExec.seatId &&
      params.executionIdentity?.platformUserId?.trim()
        ? {
            tenantId: seatTurnForExec.tenantId,
            seatId: seatTurnForExec.seatId,
            operatorUserId: params.executionIdentity.platformUserId.trim(),
          }
        : undefined;
    const toolConstruction = wrapCreateToolsForObservation(() => {
      const created = createOpenClawCodingTools({
        sessionFile: params.sessionFile,
        taskExecutionBinding: params.taskExecutionBinding,
        agentId: sessionAgentId,
        exec: {
          ...params.execOverrides,
          elevated: params.bashElevated,
          ...(seatExecPreference ? { seatExecPreference } : {}),
          ...(seatTurnForExec?.operatorComputerNodeId
            ? { operatorComputerNodeId: seatTurnForExec.operatorComputerNodeId }
            : {}),
          ...(seatTurnForExec?.operatorComputerAlwaysAllowDesktop
            ? { operatorComputerAlwaysAllowDesktop: true }
            : {}),
          ...(operatorComputerBindingTarget ? { operatorComputerBindingTarget } : {}),
        },
        sandbox,
        messageProvider: params.messageChannel ?? params.messageProvider,
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
        sessionKey: sandboxSessionKey,
        sessionId: params.sessionId,
        runId: params.runId,
        agentDir,
        workspaceDir: effectiveWorkspace,
        // A copied-workspace sandbox (`ro` / `none`) runs this attempt in the sandbox
        // copy; subagents spawned from it still inherit the real agent workspace.
        spawnWorkspaceDir:
          sandbox?.enabled && sandbox.workspaceAccess !== "rw" ? resolvedWorkspace : undefined,
        config: params.config,
        abortSignal: runAbortController.signal,
        modelProvider: params.model.provider,
        modelId: params.modelId,
        modelContextWindowTokens: params.model.contextWindow,
        modelAuthMode: resolveModelAuthMode(params.model.provider, params.config),
        currentChannelId: params.currentChannelId,
        currentThreadTs: params.currentThreadTs,
        currentMessageId: params.currentMessageId,
        replyToMode: params.replyToMode,
        hasRepliedRef: params.hasRepliedRef,
        modelHasVision,
        requireExplicitMessageTarget:
          params.requireExplicitMessageTarget ?? isSubagentSessionKey(params.sessionKey),
        disableMessageTool: params.disableMessageTool,
        forceWorkspaceOnly: effectiveFsWorkspaceOnly,
        ...inheritExecutionIdentityRunFields(params),
        inboundToolCeiling: params.inboundToolCeiling,
        knowledgeConsumeRefs: params.knowledgeConsumeRefs,
        mentionedPluginToolAllowlist: params.mentionedPluginToolAllowlist,
        omitToolNames:
          accountComputerRoute === "public_fetch" || accountComputerRoute === "public_search"
            ? ["browser"]
            : undefined,
      });
      return created;
    });
    const toolsRaw = resolveEmbeddedAttemptToolsRaw({
      disableTools: params.disableTools,
      inboundToolCeiling: params.inboundToolCeiling,
      skillPolicy: params.skillPolicy,
      createTools: toolConstruction.createTools,
      // Tip B: live LaneMode mutex via active-mode registry (setLaneMode → deny write).
      agentId: sessionAgentId ?? params.agentId,
    });
    const toolsEnabled = supportsModelTools(params.model);
    const policyTools = sanitizeToolsForGoogle({
      tools: toolsEnabled ? toolsRaw : [],
      provider: params.provider,
    });
    const executionTaskId = resolveExecutionTaskId(params.runId);
    const executionPreflight = buildExecutionPreflight({
      taskId: executionTaskId,
      sessionId: params.sessionId ?? params.sessionKey ?? "session",
      message: params.prompt,
      skills: (skillEntries ?? []).map((entry) => ({
        name: entry.skill.name,
        frontmatter: resolveSkillFrontmatter({
          frontmatter: entry.frontmatter,
          filePath: entry.skill.filePath,
        }),
        disabled: params.skillsSnapshot?.skillBlocklist?.includes(entry.skill.name) === true,
      })),
      policyToolNames: policyTools.map((tool) => tool.name),
      ...(params.inboundToolCeiling?.depth === "retrieve"
        ? { inboundDepth: "retrieve" as const }
        : {}),
      resourceScope: [effectiveWorkspace],
    });
    const tools = applyPreflightToTools(policyTools, executionPreflight, {
      workspaceDir: effectiveWorkspace,
    });
    // Constitutional runtime shadow (default off): observe the finished preflight
    // decision and nothing else. Report-only: it returns nothing, so tools,
    // decisions and delivery stay exactly as computed above. Gate off is one
    // boolean check.
    if (
      isConstitutionalRuntimeShadowEnabled(
        params.constitutionalRuntimeShadowDeps.runtimeShadowEnabled,
      )
    ) {
      try {
        observeConstitutionalRuntimeShadow(
          params.constitutionalRuntimeShadowDeps,
          executionPreflight,
        );
      } catch {
        // Last resort only; observe is total. Nothing here reaches the business path.
      }
    }
    if (params.runId) {
      for (const event of preflightEvents(executionPreflight)) {
        emitAgentEvent({
          runId: params.runId,
          stream: "lifecycle",
          data: {
            event: event.name,
            taskId: event.taskId,
            sessionId: event.sessionId,
            attemptNumber: event.attemptNumber,
            intentClass: executionPreflight.intentClass,
            ...(executionPreflight.primarySkill
              ? { primarySkill: executionPreflight.primarySkill }
              : {}),
            ...(event.decisionCode ? { decisionCode: event.decisionCode } : {}),
            ...(event.skill ? { skill: event.skill } : {}),
          },
        });
      }
    }
    const ceilingClientTools = toolsEnabled
      ? filterClientToolDefinitionsForInboundCeiling(params.clientTools, params.inboundToolCeiling)
      : undefined;
    const providerSafeClientTools = ceilingClientTools
      ? normalizeClientToolNamesForProvider(ceilingClientTools)
      : undefined;
    const clientTools = filterLaneTools(
      providerSafeClientTools,
      executionPreflight,
      (tool) => tool.function.name,
    );
    const attemptToolLanes = {
      constructed: toolsRaw.map((tool) => tool.name),
      afterPolicy: policyTools.map((tool) => tool.name),
      afterPreflight: tools.map((tool) => tool.name),
      client: (clientTools ?? []).map((tool) => tool.function.name),
    };
    const allowedToolNames = collectAllowedToolNames({
      tools,
      clientTools,
    });
    logToolSchemasForGoogle({ tools, provider: params.provider });

    const machineName = await getMachineDisplayName();
    const runtimeChannel = normalizeMessageChannel(params.messageChannel ?? params.messageProvider);
    let runtimeCapabilities = runtimeChannel
      ? (resolveChannelCapabilities({
          cfg: params.config,
          channel: runtimeChannel,
          accountId: params.agentAccountId,
        }) ?? [])
      : undefined;
    if (runtimeChannel === "telegram" && params.config) {
      const inlineButtonsScope = resolveTelegramInlineButtonsScope({
        cfg: params.config,
        accountId: params.agentAccountId ?? undefined,
      });
      if (inlineButtonsScope !== "off") {
        if (!runtimeCapabilities) {
          runtimeCapabilities = [];
        }
        if (
          !runtimeCapabilities.some((cap) => String(cap).trim().toLowerCase() === "inlinebuttons")
        ) {
          runtimeCapabilities.push("inlineButtons");
        }
      }
    }
    const reactionGuidance =
      runtimeChannel && params.config
        ? (() => {
            if (runtimeChannel === "telegram") {
              const resolved = resolveTelegramReactionLevel({
                cfg: params.config,
                accountId: params.agentAccountId ?? undefined,
              });
              const level = resolved.agentReactionGuidance;
              return level ? { level, channel: "Telegram" } : undefined;
            }
            if (runtimeChannel === "signal") {
              const resolved = resolveSignalReactionLevel({
                cfg: params.config,
                accountId: params.agentAccountId ?? undefined,
              });
              const level = resolved.agentReactionGuidance;
              return level ? { level, channel: "Signal" } : undefined;
            }
            return undefined;
          })()
        : undefined;
    const sandboxInfo = buildEmbeddedSandboxInfo(sandbox, params.bashElevated);
    const reasoningTagHint = isReasoningTagProvider(params.provider);
    // Resolve channel-specific message actions for system prompt
    const channelActions = runtimeChannel
      ? listChannelSupportedActions({
          cfg: params.config,
          channel: runtimeChannel,
        })
      : undefined;
    const messageToolHints = runtimeChannel
      ? resolveChannelMessageToolHints({
          cfg: params.config,
          channel: runtimeChannel,
          accountId: params.agentAccountId,
        })
      : undefined;

    const defaultModelRef = resolveDefaultModelForAgent({
      cfg: params.config ?? {},
      agentId: sessionAgentId,
    });
    const defaultModelLabel = `${defaultModelRef.provider}/${defaultModelRef.model}`;
    const { runtimeInfo, userTimezone, userTime, userTimeFormat } = buildSystemPromptParams({
      config: params.config,
      agentId: sessionAgentId,
      workspaceDir: effectiveWorkspace,
      cwd: process.cwd(),
      runtime: {
        host: machineName,
        os: `${os.type()} ${os.release()}`,
        arch: os.arch(),
        node: process.version,
        model: `${params.provider}/${params.modelId}`,
        defaultModel: defaultModelLabel,
        shell: detectRuntimeShell(),
        channel: runtimeChannel,
        capabilities: runtimeCapabilities,
        channelActions,
      },
    });
    const isDefaultAgent = sessionAgentId === defaultAgentId;
    const promptMode = resolvePromptModeForSession(params.sessionKey);
    const docsPath = await resolveOpenClawDocsPath({
      workspaceDir: effectiveWorkspace,
      argv1: process.argv[1],
      cwd: process.cwd(),
      moduleUrl: import.meta.url,
    });
    const ttsHint = params.config ? buildTtsSystemPromptHint(params.config) : undefined;
    const ownerDisplay = resolveOwnerDisplaySetting(params.config);

    let executionPreferenceHint: string | undefined;
    try {
      executionPreferenceHint = buildExecutionPreferenceHint({
        agentId: sessionAgentId,
      });
    } catch {
      executionPreferenceHint = undefined;
    }
    const appendPrompt = buildEmbeddedSystemPrompt({
      workspaceDir: effectiveWorkspace,
      defaultThinkLevel: params.thinkLevel,
      reasoningLevel: params.reasoningLevel ?? "off",
      extraSystemPrompt:
        [
          params.extraSystemPrompt,
          accountComputerTurnPromptText,
          executionPreflight.bindingPrompt,
          seatTurnForExec?.bound
            ? formatOperatorComputerTurnPrompt(seatTurnForExec.operatorComputerNodeId, {
                alwaysAllowDesktop: seatTurnForExec.operatorComputerAlwaysAllowDesktop,
              })
            : undefined,
        ]
          .filter((part) => part?.trim())
          .join("\n\n") || undefined,
      executionPreferenceHint,
      organizationContext: params.organizationContext,
      ownerNumbers: params.ownerNumbers,
      ownerDisplay: ownerDisplay.ownerDisplay,
      ownerDisplaySecret: ownerDisplay.ownerDisplaySecret,
      reasoningTagHint,
      heartbeatPrompt:
        params.omitHeartbeatPrompt || !isDefaultAgent
          ? undefined
          : resolveHeartbeatPrompt(params.config?.agents?.defaults?.heartbeat?.prompt),
      skillsPrompt,
      docsPath: docsPath ?? undefined,
      ttsHint,
      workspaceNotes,
      reactionGuidance,
      promptMode,
      acpEnabled: params.config?.acp?.enabled !== false,
      runtimeInfo,
      messageToolHints,
      sandboxInfo,
      tools,
      modelAliasLines: buildModelAliasLines(params.config),
      userTimezone,
      userTime,
      userTimeFormat,
      contextFiles,
      bootstrapTruncationWarningLines: bootstrapPromptWarning.lines,
      memoryCitationsMode: params.config?.memory?.citations,
    });
    const systemPromptReport = buildSystemPromptReport({
      source: "run",
      generatedAt: Date.now(),
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      provider: params.provider,
      model: params.modelId,
      workspaceDir: effectiveWorkspace,
      bootstrapMaxChars,
      bootstrapTotalMaxChars,
      bootstrapTruncation: buildBootstrapTruncationReportMeta({
        analysis: bootstrapAnalysis,
        warningMode: bootstrapPromptWarningMode,
        warning: bootstrapPromptWarning,
      }),
      sandbox: (() => {
        const runtime = resolveSandboxRuntimeStatus({
          cfg: params.config,
          sessionKey: sandboxSessionKey,
        });
        return { mode: runtime.mode, sandboxed: runtime.sandboxed };
      })(),
      systemPrompt: appendPrompt,
      bootstrapFiles: hookAdjustedBootstrapFiles,
      injectedFiles: contextFiles,
      skillsPrompt,
      tools,
    });
    const systemPromptOverride = createSystemPromptOverride(appendPrompt);
    let systemPromptText = systemPromptOverride();

    const sessionLock = await acquireSessionWriteLock({
      sessionFile: params.sessionFile,
      maxHoldMs: resolveSessionLockMaxHoldFromTimeout({
        timeoutMs: params.timeoutMs,
      }),
    });

    let sessionManager: ReturnType<typeof guardSessionManager> | undefined;
    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    let removeToolResultContextGuard: (() => void) | undefined;
    let removeContextCompiler: (() => void) | undefined;
    let removeReplyLanguageReminder: (() => void) | undefined;
    let removeVisibleReplyRewriter: (() => void) | undefined;
    const protocolBoundaryState = createProtocolBoundaryState(`${params.runId}:attempt`);
    try {
      await repairSessionFileIfNeeded({
        sessionFile: params.sessionFile,
        warn: (message) => log.warn(message),
      });
      const hadSessionFile = await fs
        .stat(params.sessionFile)
        .then(() => true)
        .catch(() => false);

      const transcriptPolicy = resolveTranscriptPolicy({
        modelApi: params.model?.api,
        provider: params.provider,
        modelId: params.modelId,
      });

      await prewarmSessionFile(params.sessionFile);
      sessionManager = guardSessionManager(openSessionManager(params.sessionFile), {
        agentId: sessionAgentId,
        sessionKey: params.sessionKey,
        inputProvenance: params.inputProvenance,
        allowSyntheticToolResults: transcriptPolicy.allowSyntheticToolResults,
        allowedToolNames,
        skipUserTranscriptPersist: params.skipUserTranscriptPersist === true,
        refreshBeforeAppend:
          params.skipUserTranscriptPersist === true && Boolean(params.taskExecutionBinding),
      });
      trackSessionManagerAccess(params.sessionFile);

      if (hadSessionFile && params.contextEngine?.bootstrap) {
        try {
          await params.contextEngine.bootstrap({
            sessionId: params.sessionId,
            sessionFile: params.sessionFile,
          });
        } catch (bootstrapErr) {
          log.warn(`context engine bootstrap failed: ${String(bootstrapErr)}`);
        }
      }

      await prepareSessionManagerForRun({
        preserveUserTranscript: params.skipUserTranscriptPersist === true,
        sessionManager,
        sessionFile: params.sessionFile,
        hadSessionFile,
        sessionId: params.sessionId,
        cwd: effectiveWorkspace,
      });

      const settingsManager = createPreparedEmbeddedPiSettingsManager({
        cwd: effectiveWorkspace,
        agentDir,
        cfg: params.config,
      });
      applyPiAutoCompactionGuard({
        settingsManager,
        contextEngineInfo: params.contextEngine?.info,
      });

      // Sets compaction/pruning runtime state and returns extension factories
      // that must be passed to the resource loader for the safeguard to be active.
      const extensionFactories = buildEmbeddedExtensionFactories({
        cfg: params.config,
        sessionManager,
        provider: params.provider,
        modelId: params.modelId,
        model: params.model,
      });
      // Only create an explicit resource loader when there are extension factories
      // to register; otherwise let createAgentSession use its built-in default.
      let resourceLoader: DefaultResourceLoader | undefined;
      if (extensionFactories.length > 0) {
        resourceLoader = new DefaultResourceLoader({
          cwd: resolvedWorkspace,
          agentDir,
          settingsManager,
          extensionFactories,
        });
        await resourceLoader.reload();
      }

      // Get hook runner early so it's available when creating tools
      const hookRunner = getGlobalHookRunner();

      const { customTools } = splitSdkTools({
        tools,
        sandboxEnabled: !!sandbox?.enabled,
        deliveryToolSideEffect: params.deliveryToolSideEffect,
        cfg: params.config,
        privateRunBag: params.privateRunBag,
      });

      // Add client tools (OpenResponses hosted tools) to customTools
      let clientToolCallDetected: { name: string; params: Record<string, unknown> } | null = null;
      const clientToolLoopDetection = resolveToolLoopDetectionConfig({
        cfg: params.config,
        agentId: sessionAgentId,
      });
      const clientToolDefs = clientTools
        ? toClientToolDefinitions(
            clientTools,
            (toolName, toolParams) => {
              clientToolCallDetected = { name: toolName, params: toolParams };
            },
            {
              agentId: sessionAgentId,
              sessionKey: sandboxSessionKey,
              sessionId: params.sessionId,
              runId: params.runId,
              loopDetection: clientToolLoopDetection,
              taskBoundary: params.taskExecutionBinding
                ? captureTaskActionBoundary(params.sessionFile, params.taskExecutionBinding)
                : undefined,
            },
          )
        : [];

      const allCustomTools = [...customTools, ...clientToolDefs];
      const { tools: filteredCustomTools, allowlist: customToolAllowlist } =
        applyEmbeddedCustomToolPolicy(allCustomTools, params.skillPolicy);
      // Tool baseline after the final custom-tool allowlist, before createAgentSession.
      // afterPolicyCount stays toolsRaw.length: server tools after inbound/skill
      // policy, around provider sanitize, before client tools join this allowlist.
      observeAttemptToolPreparation({
        runId: params.runId,
        sessionKey: params.sessionKey,
        constructedCount: toolConstruction.readConstructedCount(),
        afterPolicyCount: toolsRaw.length,
        exposedAllowlist: customToolAllowlist,
        filteredCustomTools,
      });
      if (params.runId) {
        emitAgentEvent({
          runId: params.runId,
          stream: "lifecycle",
          data: {
            event: "tools_filtered",
            taskId: executionPreflight.taskId,
            sessionId: executionPreflight.sessionId,
            attemptNumber: executionPreflight.attemptNumber,
            constructedTools: attemptToolLanes.constructed,
            afterPolicyTools: attemptToolLanes.afterPolicy,
            afterPreflightTools: attemptToolLanes.afterPreflight,
            clientTools: attemptToolLanes.client,
            passedToSession: customToolAllowlist,
          },
        });
      }

      const { runtime } = await createPiModelRuntime({
        authStorage: params.authStorage,
        agentDir,
      });
      ({ session } = await createAgentSession({
        cwd: resolvedWorkspace,
        agentDir,
        modelRuntime: runtime,
        noTools: "all",
        tools: customToolAllowlist,
        model: params.model,
        thinkingLevel: mapThinkingLevel(params.thinkLevel),
        customTools: filteredCustomTools,
        sessionManager,
        settingsManager,
        resourceLoader,
      }));
      applySystemPromptOverrideToSession(session, systemPromptText);
      if (!session) {
        throw new Error("Embedded agent session missing");
      }
      const activeSession = session;
      const contextCompileState = createContextCompileState();
      if (isContextCompilerEnabled()) {
        const candidates = await loadContextCandidates({
          cfg: params.config,
          workspaceDir: params.workspaceDir,
          agentId: sessionAgentId,
          sessionKey: params.sessionKey,
          sessionEntry: params.sessionEntry,
          userUtterance: params.prompt,
          injectionSource: /heartbeat/iu.test(params.prompt ?? "") ? "heartbeat" : "ledger",
        });
        const collabCompileStrategy = shouldApplyCollabCompileStrategy({
          cfg: params.config,
          sessionKey: params.sessionKey,
        })
          ? { enabled: true as const, retainMemberConclusions: true as const }
          : undefined;
        removeContextCompiler = installContextCompilerTransform({
          agent: activeSession.agent,
          state: contextCompileState,
          lane: resolveContextLane({ depth: params.contextLane }),
          candidates,
          contextWindowTokens: Math.max(
            1,
            Math.floor(
              params.model.contextWindow ?? params.model.maxTokens ?? DEFAULT_CONTEXT_TOKENS,
            ),
          ),
          runId: params.runId,
          ...(collabCompileStrategy ? { collabCompileStrategy } : {}),
          onCompiled: (telemetry) => {
            emitChatInboundStage({
              runId: params.runId,
              stage: "context_compiled",
              sessionKey: params.sessionKey,
              extra: {
                ...contextCompileTelemetryExtra(telemetry),
                taskSummaryPresent: Boolean(candidates.task?.trim()),
              },
            });
            recordCollabFaultRoundPartial(
              {
                runId: params.runId,
                sessionKey: params.sessionKey,
                agentId: sessionAgentId,
                compiler: compilerTelemetryToFaultRoundSnapshot(telemetry),
                taskSummaryPresent: Boolean(candidates.task?.trim()),
              },
              params.config,
            );
          },
        });
      }
      removeToolResultContextGuard = installToolResultContextGuard({
        agent: activeSession.agent,
        contextWindowTokens: Math.max(
          1,
          Math.floor(
            params.model.contextWindow ?? params.model.maxTokens ?? DEFAULT_CONTEXT_TOKENS,
          ),
        ),
      });
      removeReplyLanguageReminder = installReplyLanguageReminder({
        agent: activeSession.agent,
        runId: params.runId,
      });
      const cacheTrace = createCacheTrace({
        cfg: params.config,
        env: process.env,
        runId: params.runId,
        sessionId: activeSession.sessionId,
        sessionKey: params.sessionKey,
        provider: params.provider,
        modelId: params.modelId,
        modelApi: params.model.api,
        workspaceDir: params.workspaceDir,
      });
      const anthropicPayloadLogger = createAnthropicPayloadLogger({
        env: process.env,
        runId: params.runId,
        sessionId: activeSession.sessionId,
        sessionKey: params.sessionKey,
        provider: params.provider,
        modelId: params.modelId,
        modelApi: params.model.api,
        workspaceDir: params.workspaceDir,
      });

      // Ollama native API: bypass SDK's streamSimple and use direct /api/chat calls
      // for reliable streaming + tool calling support (#11828).
      if (params.model.api === "ollama") {
        // Prioritize configured provider baseUrl so Docker/remote Ollama hosts work reliably.
        const providerConfig = params.config?.models?.providers?.[params.model.provider];
        const providerBaseUrl =
          typeof providerConfig?.baseUrl === "string" ? providerConfig.baseUrl : undefined;
        const ollamaStreamFn = createConfiguredOllamaStreamFn({
          model: params.model,
          providerBaseUrl,
        });
        activeSession.agent.streamFunction = ollamaStreamFn;
        ensureCustomApiRegistered(params.model.api, ollamaStreamFn);
      } else if (params.model.api === "openai-responses" && params.provider === "openai") {
        const wsApiKey = await params.authStorage.getApiKey(params.provider);
        if (wsApiKey) {
          activeSession.agent.streamFunction = createOpenAIWebSocketStreamFn(
            wsApiKey,
            params.sessionId,
            {
              signal: runAbortController.signal,
            },
          );
        } else {
          log.warn(`[ws-stream] no API key for provider=${params.provider}; using HTTP transport`);
          activeSession.agent.streamFunction = streamSimple;
        }
      } else {
        // Force a stable streamFn reference so vitest can reliably mock @earendil-works/pi-ai.
        activeSession.agent.streamFunction = streamSimple;
      }

      // Raw `streamSimple` reads the key only from `options.apiKey`; it does not
      // consult OpenBotAuthStorage. run.ts has already resolved+stored the key
      // (setRuntimeApiKey), so bridge it onto the active stream fn — otherwise
      // custom providers (api-proxy-*) throw "No API key for provider" and the
      // assistant turn returns empty even though chat.send succeeded.
      const resolvedStreamApiKey = await resolveStreamApiKey({
        getApiKey: (provider) => params.authStorage.getApiKey(provider),
        modelProvider: params.model.provider,
        provider: params.provider,
      });
      removeVisibleReplyRewriter = registerVisibleReplyRewriter(params.runId, async (text) => {
        const response = await completeSimple(
          params.model,
          {
            messages: [
              {
                role: "user",
                content: visibleReplyRewritePrompt(text),
                timestamp: Date.now(),
              },
            ],
          },
          {
            apiKey: resolvedStreamApiKey,
            maxTokens: 800,
            temperature: 0,
          },
        );
        const rewritten = (Array.isArray(response.content) ? response.content : [])
          .map((block) => {
            if (!block || typeof block !== "object") {
              return "";
            }
            const entry = block as { type?: unknown; text?: unknown };
            return entry.type === "text" && typeof entry.text === "string" ? entry.text : "";
          })
          .join("")
          .trim();
        return rewritten || text;
      });
      // Last choke point before the provider HTTP/SDK call. Later wrappers are
      // outside this one, so they cannot put an illegal function.name back on
      // the wire. Response tool-call names are mapped back to the registered tool.
      activeSession.agent.streamFunction = wrapStreamFnSanitizeProviderToolNames(
        activeSession.agent.streamFunction ?? streamSimple,
      );
      activeSession.agent.streamFunction = wrapStreamFnWithResolvedApiKey(
        activeSession.agent.streamFunction ?? streamSimple,
        resolvedStreamApiKey,
      );

      // Ollama with OpenAI-compatible API needs num_ctx in payload.options.
      // Otherwise Ollama defaults to a 4096 context window.
      const providerIdForNumCtx =
        typeof params.model.provider === "string" && params.model.provider.trim().length > 0
          ? params.model.provider
          : params.provider;
      const shouldInjectNumCtx = shouldInjectOllamaCompatNumCtx({
        model: params.model,
        config: params.config,
        providerId: providerIdForNumCtx,
      });
      if (shouldInjectNumCtx) {
        const numCtx = Math.max(
          1,
          Math.floor(
            params.model.contextWindow ?? params.model.maxTokens ?? DEFAULT_CONTEXT_TOKENS,
          ),
        );
        activeSession.agent.streamFunction = wrapOllamaCompatNumCtx(
          activeSession.agent.streamFunction,
          numCtx,
        );
      }

      applyExtraParamsToAgent(
        activeSession.agent,
        params.config,
        params.provider,
        params.modelId,
        params.streamParams,
        params.thinkLevel,
        sessionAgentId,
      );

      if (cacheTrace) {
        cacheTrace.recordStage("session:loaded", {
          messages: activeSession.messages,
          system: systemPromptText,
          note: "after session create",
        });
        activeSession.agent.streamFunction = cacheTrace.wrapStreamFn(
          activeSession.agent.streamFunction,
        );
      }

      // Copilot/Claude can reject persisted `thinking` blocks (e.g. thinkingSignature:"reasoning_text")
      // on *any* follow-up provider call (including tool continuations). Wrap the stream function
      // so every outbound request sees sanitized messages.
      if (transcriptPolicy.dropThinkingBlocks) {
        const inner = activeSession.agent.streamFunction;
        activeSession.agent.streamFunction = (model, context, options) => {
          const ctx = context as unknown as { messages?: unknown };
          const messages = ctx?.messages;
          if (!Array.isArray(messages)) {
            return inner(model, context, options);
          }
          const sanitized = dropThinkingBlocks(messages as unknown as AgentMessage[]) as unknown;
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

      // Mistral (and other strict providers) reject tool call IDs that don't match their
      // format requirements (e.g. [a-zA-Z0-9]{9}). sanitizeSessionHistory only processes
      // historical messages at attempt start, but the agent loop's internal tool call →
      // tool result cycles bypass that path. Wrap streamFn so every outbound request
      // sees sanitized tool call IDs.
      if (transcriptPolicy.sanitizeToolCallIds && transcriptPolicy.toolCallIdMode) {
        const inner = activeSession.agent.streamFunction;
        const mode = transcriptPolicy.toolCallIdMode;
        activeSession.agent.streamFunction = (model, context, options) => {
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

      if (
        params.model.api === "openai-responses" ||
        params.model.api === "openai-codex-responses"
      ) {
        const inner = activeSession.agent.streamFunction;
        activeSession.agent.streamFunction = (model, context, options) => {
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
      activeSession.agent.streamFunction = wrapStreamFnTrimToolCallNames(
        activeSession.agent.streamFunction,
        allowedToolNames,
      );
      activeSession.agent.streamFunction = wrapStreamFnEnforceProtocolTextNonExecution(
        activeSession.agent.streamFunction,
        {
          runId: params.runId,
          // Seed only — wrapStreamFn allocates `${attemptId}:mrN` per model response.
          attemptOrTurnId: `${params.runId}:attempt`,
          sessionId: params.sessionId,
          agentId: sessionAgentId,
          provider: params.provider,
          model: params.modelId,
          allowedToolNames,
          boundaryState: protocolBoundaryState,
        },
      );

      if (isXaiProvider(params.provider, params.modelId)) {
        activeSession.agent.streamFunction = wrapStreamFnDecodeXaiToolCallArguments(
          activeSession.agent.streamFunction,
        );
      }

      if (anthropicPayloadLogger) {
        activeSession.agent.streamFunction = anthropicPayloadLogger.wrapStreamFn(
          activeSession.agent.streamFunction,
        );
      }

      if (isContextCompilerEnabled()) {
        activeSession.agent.streamFunction = wrapContextCompilerModelBoundary({
          streamFn: activeSession.agent.streamFunction,
          state: contextCompileState,
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
      activeSession.agent.streamFunction = wrapOutboundMessageEstimateGuard(
        activeSession.agent.streamFunction ?? streamSimple,
      );

      try {
        const prior = await sanitizeSessionHistory({
          messages: activeSession.messages,
          modelApi: params.model.api,
          modelId: params.modelId,
          provider: params.provider,
          allowedToolNames,
          config: params.config,
          sessionManager,
          sessionId: params.sessionId,
          policy: transcriptPolicy,
        });
        cacheTrace?.recordStage("session:sanitized", { messages: prior });
        const validatedGemini = transcriptPolicy.validateGeminiTurns
          ? validateGeminiTurns(prior)
          : prior;
        const validated = transcriptPolicy.validateAnthropicTurns
          ? validateAnthropicTurns(validatedGemini)
          : validatedGemini;
        const truncated = limitHistoryTurns(
          validated,
          getDmHistoryLimitFromSessionKey(params.sessionKey, params.config),
        );
        // Re-run tool_use/tool_result pairing repair after truncation, since
        // limitHistoryTurns can orphan tool_result blocks by removing the
        // assistant message that contained the matching tool_use.
        const limited = transcriptPolicy.repairToolUseResultPairing
          ? sanitizeToolUseResultPairing(truncated)
          : truncated;
        cacheTrace?.recordStage("session:limited", { messages: limited });
        if (limited.length > 0) {
          activeSession.agent.state.messages = limited;
        }

        if (params.contextEngine) {
          try {
            const assembled = await params.contextEngine.assemble({
              sessionId: params.sessionId,
              messages: activeSession.messages,
              tokenBudget: params.contextTokenBudget,
            });
            if (assembled.messages !== activeSession.messages) {
              // Planner trim can re-break toolCall/toolResult pairing; repair again
              // before the provider request (mirrors post-limitHistoryTurns sanitize).
              const repaired = transcriptPolicy.repairToolUseResultPairing
                ? sanitizeToolUseResultPairing(assembled.messages)
                : assembled.messages;
              activeSession.agent.state.messages = repaired;
            }
            if (assembled.systemPromptAddition) {
              systemPromptText = prependSystemPromptAddition({
                systemPrompt: systemPromptText,
                systemPromptAddition: assembled.systemPromptAddition,
              });
              applySystemPromptOverrideToSession(activeSession, systemPromptText);
              log.debug(
                `context engine: prepended system prompt addition (${assembled.systemPromptAddition.length} chars)`,
              );
            }
          } catch (assembleErr) {
            log.warn(
              `context engine assemble failed, using pipeline messages: ${String(assembleErr)}`,
            );
          }
        }
      } catch (err) {
        await flushPendingToolResultsAfterIdle({
          agent: activeSession?.agent,
          sessionManager,
          clearPendingOnTimeout: true,
        });
        activeSession.dispose();
        throw err;
      }

      let aborted = Boolean(params.abortSignal?.aborted);
      let timedOut = false;
      let timedOutDuringCompaction = false;
      const getAbortReason = (signal: AbortSignal): unknown =>
        "reason" in signal ? (signal as { reason?: unknown }).reason : undefined;
      const makeTimeoutAbortReason = (): Error => {
        const err = new Error("request timed out");
        err.name = "TimeoutError";
        return err;
      };
      const makeAbortError = (signal: AbortSignal): Error => {
        const reason = getAbortReason(signal);
        const err = reason ? new Error("aborted", { cause: reason }) : new Error("aborted");
        err.name = "AbortError";
        return err;
      };
      const abortRun = (isTimeout = false, reason?: unknown) => {
        aborted = true;
        if (isTimeout) {
          timedOut = true;
        }
        if (isTimeout) {
          runAbortController.abort(reason ?? makeTimeoutAbortReason());
        } else {
          runAbortController.abort(reason);
        }
        void activeSession.abort();
      };
      const abortable = <T>(promise: Promise<T>): Promise<T> => {
        const signal = runAbortController.signal;
        if (signal.aborted) {
          return Promise.reject(makeAbortError(signal));
        }
        return new Promise<T>((resolve, reject) => {
          const onAbort = () => {
            signal.removeEventListener("abort", onAbort);
            reject(makeAbortError(signal));
          };
          signal.addEventListener("abort", onAbort, { once: true });
          promise.then(
            (value) => {
              signal.removeEventListener("abort", onAbort);
              resolve(value);
            },
            (err) => {
              signal.removeEventListener("abort", onAbort);
              reject(err);
            },
          );
        });
      };

      // Lifecycle skill names loaded into this run (for unique-owner attribution).
      const lifecycleSkillNamesLoaded = resolveLifecycleSkillNamesLoaded(
        skillEntries.map((entry) => entry.skill.name),
      );

      const onAgentEventWithSkillAttribution = createLifecycleSkillToolAttributionHandler(
        {
          agentId: params.agentId?.trim() ?? "",
          runId: params.runId,
          sessionKey: params.sessionKey ?? null,
          loadedSkillNames: lifecycleSkillNamesLoaded,
        },
        { onAgentEvent: params.onAgentEvent },
      );

      const gateVisibleReply = Boolean(
        executionPreflight.deliveryBlockedUntil ||
        executionPreflight.requiredValidators.length > 0 ||
        executionPreflight.decisionCode === "validator_unavailable",
      );
      const completionHoldKeys = [
        executionPreflight.sessionId,
        params.sessionKey ?? "",
        params.sessionId ?? "",
        sandboxSessionKey ?? "",
      ];
      if (gateVisibleReply) {
        armCompletionHold({
          keys: completionHoldKeys,
          preflight: executionPreflight,
          workspaceDir: effectiveWorkspace,
        });
      }
      const heldEvidence = () =>
        resolveAttemptDelivery({
          preflight: executionPreflight,
          workspaceDir: effectiveWorkspace,
        });
      const subscription = subscribeEmbeddedPiSession({
        session: activeSession,
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
        sessionKey: sandboxSessionKey,
        sessionId: params.sessionId,
        agentId: sessionAgentId,
      });

      const {
        assistantTexts,
        toolMetas,
        unsubscribe,
        waitForCompactionRetry,
        isCompactionInFlight,
        flushPendingCompactionEnd,
        getMessagingToolSentTexts,
        getMessagingToolSentMediaUrls,
        getMessagingToolSentTargets,
        getSuccessfulCronAdds,
        didSendViaMessagingTool,
        getLastToolError,
        getUsageTotals,
        getCompactionCount,
      } = subscription;

      const queueHandle: EmbeddedPiQueueHandle = {
        queueMessage: async (text: string) => {
          await activeSession.steer(text);
        },
        isStreaming: () => activeSession.isStreaming,
        isCompacting: () => subscription.isCompacting(),
        abort: abortRun,
      };
      setActiveEmbeddedRun(params.sessionId, queueHandle, params.sessionKey);

      let abortWarnTimer: NodeJS.Timeout | undefined;
      const isProbeSession = params.sessionId?.startsWith("probe-") ?? false;
      const abortTimer = setTimeout(
        () => {
          if (!isProbeSession) {
            log.warn(
              `embedded run timeout: runId=${params.runId} sessionId=${params.sessionId} timeoutMs=${params.timeoutMs}`,
            );
          }
          if (
            shouldFlagCompactionTimeout({
              isTimeout: true,
              isCompactionPendingOrRetrying: subscription.isCompacting(),
              isCompactionInFlight: activeSession.isCompacting,
            })
          ) {
            timedOutDuringCompaction = true;
          }
          abortRun(true);
          if (!abortWarnTimer) {
            abortWarnTimer = setTimeout(() => {
              if (!activeSession.isStreaming) {
                return;
              }
              if (!isProbeSession) {
                log.warn(
                  `embedded run abort still streaming: runId=${params.runId} sessionId=${params.sessionId}`,
                );
              }
            }, 10_000);
          }
        },
        Math.max(1, params.timeoutMs),
      );

      let messagesSnapshot: AgentMessage[] = [];
      let sessionIdUsed = activeSession.sessionId;
      const onAbort = () => {
        const reason = params.abortSignal ? getAbortReason(params.abortSignal) : undefined;
        const timeout = reason ? isTimeoutError(reason) : false;
        if (
          shouldFlagCompactionTimeout({
            isTimeout: timeout,
            isCompactionPendingOrRetrying: subscription.isCompacting(),
            isCompactionInFlight: activeSession.isCompacting,
          })
        ) {
          timedOutDuringCompaction = true;
        }
        abortRun(timeout, reason);
      };
      if (params.abortSignal) {
        if (params.abortSignal.aborted) {
          onAbort();
        } else {
          params.abortSignal.addEventListener("abort", onAbort, {
            once: true,
          });
        }
      }

      // Hook runner was already obtained earlier before tool creation
      const hookAgentId = sessionAgentId;

      let promptError: unknown = null;
      let promptErrorSource: "prompt" | "compaction" | null = null;
      const prePromptMessageCount = activeSession.messages.length;
      try {
        // Register first, then synchronously recheck: earlier stops are durable in the
        // task board; later stops can now reach this existing active-run abort handle.
        if (
          params.taskExecutionBinding &&
          !isTaskExecutionBindingCurrent(params.sessionFile, params.taskExecutionBinding)
        ) {
          abortRun(false, new Error("Original task stopped before active-run registration"));
        }

        if (runAbortController.signal.aborted) {
          throw makeAbortError(runAbortController.signal);
        }
        const promptStartedAt = Date.now();

        // Run before_prompt_build hooks to allow plugins to inject prompt context.
        // Legacy compatibility: before_agent_start is also checked for context fields.
        let effectivePrompt = params.prompt;
        const hookCtx = {
          agentId: hookAgentId,
          sessionKey: params.sessionKey,
          sessionId: params.sessionId,
          workspaceDir: params.workspaceDir,
          messageProvider: params.messageProvider ?? undefined,
          trigger: params.trigger,
          channelId: params.messageChannel ?? params.messageProvider ?? undefined,
        };
        const hookResult = await resolvePromptBuildHookResult({
          prompt: params.prompt,
          messages: activeSession.messages,
          hookCtx,
          hookRunner,
          legacyBeforeAgentStartResult: params.legacyBeforeAgentStartResult,
        });
        {
          if (hookResult?.prependContext) {
            effectivePrompt = `${hookResult.prependContext}\n\n${params.prompt}`;
            log.debug(
              `hooks: prepended context to prompt (${hookResult.prependContext.length} chars)`,
            );
          }
          const legacySystemPrompt =
            typeof hookResult?.systemPrompt === "string" ? hookResult.systemPrompt.trim() : "";
          if (legacySystemPrompt) {
            applySystemPromptOverrideToSession(activeSession, legacySystemPrompt);
            systemPromptText = legacySystemPrompt;
            log.debug(`hooks: applied systemPrompt override (${legacySystemPrompt.length} chars)`);
          }
          const prependedOrAppendedSystemPrompt = composeSystemPromptWithHookContext({
            baseSystemPrompt: systemPromptText,
            prependSystemContext: hookResult?.prependSystemContext,
            appendSystemContext: hookResult?.appendSystemContext,
          });
          if (prependedOrAppendedSystemPrompt) {
            const prependSystemLen = hookResult?.prependSystemContext?.trim().length ?? 0;
            const appendSystemLen = hookResult?.appendSystemContext?.trim().length ?? 0;
            applySystemPromptOverrideToSession(activeSession, prependedOrAppendedSystemPrompt);
            systemPromptText = prependedOrAppendedSystemPrompt;
            log.debug(
              `hooks: applied prependSystemContext/appendSystemContext (${prependSystemLen}+${appendSystemLen} chars)`,
            );
          }
        }

        const textOnlyImageGuard = buildTextOnlyImagePromptGuard({
          prompt: effectivePrompt,
          model: params.model,
          imageToolAvailable: tools.some((tool) => tool.name === "image"),
        });
        if (textOnlyImageGuard) {
          effectivePrompt = `${textOnlyImageGuard}\n\n${effectivePrompt}`;
        }

        log.debug(`embedded run prompt start: runId=${params.runId} sessionId=${params.sessionId}`);
        cacheTrace?.recordStage("prompt:before", {
          prompt: effectivePrompt,
          messages: activeSession.messages,
        });

        // Repair orphaned trailing user messages so new prompts don't violate role ordering.
        // Collaboration rounds skip this: the gateway already persisted the shared user turn,
        // and SessionManager user writes are suppressed (skipUserTranscriptPersist).
        const leafEntry = sessionManager.getLeafEntry();
        if (
          params.skipUserTranscriptPersist !== true &&
          leafEntry?.type === "message" &&
          leafEntry.message.role === "user"
        ) {
          if (leafEntry.parentId) {
            sessionManager.branch(leafEntry.parentId);
          } else {
            sessionManager.resetLeaf();
          }
          const sessionContext = sessionManager.buildSessionContext();
          activeSession.agent.state.messages = sessionContext.messages;
          log.warn(
            `Removed orphaned user message to prevent consecutive user turns. ` +
              `runId=${params.runId} sessionId=${params.sessionId}`,
          );
        }

        try {
          // Idempotent cleanup for legacy sessions with persisted image payloads.
          // Called each run; only mutates already-answered user turns that still carry image blocks.
          const didPruneImages = pruneProcessedHistoryImages(activeSession.messages);
          if (didPruneImages) {
            activeSession.agent.state.messages = activeSession.messages;
          }

          // Detect and load images referenced in the prompt for vision-capable models.
          // Images are prompt-local only (pi-like behavior).
          const imageResult = await detectAndLoadPromptImages({
            prompt: effectivePrompt,
            workspaceDir: effectiveWorkspace,
            model: params.model,
            existingImages: params.images,
            maxBytes: MAX_IMAGE_BYTES,
            maxDimensionPx: resolveImageSanitizationLimits(params.config).maxDimensionPx,
            workspaceOnly: effectiveFsWorkspaceOnly,
            // Enforce sandbox path restrictions when sandbox is enabled
            sandbox:
              sandbox?.enabled && sandbox?.fsBridge
                ? { root: sandbox.workspaceDir, bridge: sandbox.fsBridge }
                : undefined,
          });

          cacheTrace?.recordStage("prompt:images", {
            prompt: effectivePrompt,
            messages: activeSession.messages,
            note: `images: prompt=${imageResult.images.length}`,
          });

          // Diagnostic: log context sizes before prompt to help debug early overflow errors.
          if (log.isEnabled("debug")) {
            const msgCount = activeSession.messages.length;
            const systemLen = systemPromptText?.length ?? 0;
            const promptLen = effectivePrompt.length;
            const sessionSummary = summarizeSessionContext(activeSession.messages);
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

          if (hookRunner?.hasHooks("llm_input")) {
            hookRunner
              .runLlmInput(
                {
                  runId: params.runId,
                  sessionId: params.sessionId,
                  provider: params.provider,
                  model: params.modelId,
                  systemPrompt: systemPromptText,
                  prompt: effectivePrompt,
                  historyMessages: activeSession.messages,
                  imagesCount: imageResult.images.length,
                },
                {
                  agentId: hookAgentId,
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
            await abortable(activeSession.prompt(effectivePrompt, { images: imageResult.images }));
          } else {
            await abortable(activeSession.prompt(effectivePrompt));
          }
        } catch (err) {
          promptError = err;
          promptErrorSource = "prompt";
        } finally {
          log.debug(
            `embedded run prompt end: runId=${params.runId} sessionId=${params.sessionId} durationMs=${Date.now() - promptStartedAt}`,
          );
        }

        // Progress-only stops, a repeated 「请确认」 after GO, and an empty
        // final after successful tools otherwise end the run. Each continues
        // a small bounded number of times. Questions, permission, payment,
        // scan, and authorization pauses stay terminal.
        if (
          !promptError &&
          !aborted &&
          !timedOut &&
          !isProtocolViolationContinueBlocked({
            boundaryTerminated: protocolBoundaryState.terminated,
            messages: activeSession.messages,
          })
        ) {
          const toolsDisabled = params.disableTools === true;
          const continuedStalls: string[] = [];
          let stallContinues = 0;
          let falseConfirmContinues = 0;
          let emptyAfterToolsContinues = 0;
          let silentExecContinues = 0;
          let recoverableContinues = 0;
          // Durable ≤2 progress-stall ledger (restart + concurrency safe via wx slots).
          // Quota cycle binds to board taskId so same-task retry shares ≤2 and a
          // new task in the same chat gets an independent quota (resume cannot
          // swap ids: cycle comes from authoritative board current, not user text).
          const stallLedgerSessionKey = (
            params.sessionKey?.trim() ||
            params.sessionId?.trim() ||
            ""
          ).trim();
          let stallQuotaCycleId = "";
          try {
            const boardTaskId = readSessionTaskBoard(params.sessionFile).current?.taskId?.trim();
            if (boardTaskId) {
              stallQuotaCycleId = boardTaskId;
            }
          } catch {
            // Board unavailable — fall through to execution task id.
          }
          if (!stallQuotaCycleId) {
            stallQuotaCycleId = (executionTaskId ?? "").trim();
          }
          const stallLedger =
            stallLedgerSessionKey && params.agentDir?.trim() && stallQuotaCycleId
              ? {
                  ledgerDir: path.join(params.agentDir.trim(), "stall-continue-ledger"),
                  sessionKey: stallLedgerSessionKey,
                  quotaCycleId: stallQuotaCycleId,
                }
              : undefined;
          const continueBudget =
            EXECUTION_STALL_CONTINUE_LIMIT +
            FALSE_CONFIRM_CONTINUE_LIMIT +
            EMPTY_AFTER_TOOLS_CONTINUE_LIMIT +
            SILENT_EXEC_CONTINUE_LIMIT +
            RECOVERABLE_TOOL_FAILURE_CONTINUE_LIMIT;
          await runExecutionStallContinueLoop({
            continueBudget,
            isAbortedOrTimedOut: () => aborted || timedOut,
            getProtocolBlock: () => ({
              boundaryTerminated: protocolBoundaryState.terminated,
              messages: activeSession.messages,
            }),
            resolveContinue: () => {
              const stopText = lastAssistantStopText(activeSession.messages);
              const userText = latestUserText(activeSession.messages);
              const kind = executionContinueKind({
                text: stopText,
                toolsDisabled,
                continuesUsed: stallContinues,
                latestUserText: userText,
                falseConfirmContinuesUsed: falseConfirmContinues,
                silentExecContinuesUsed: silentExecContinues,
                recoverableContinuesUsed: recoverableContinues,
                tools: toolMetas,
                visibleTexts: assistantTexts,
                stallLedger,
              });
              const emptyContinue =
                !kind &&
                shouldContinueAfterEmptyToolFinal({
                  stopKind: lastAssistantStopKind(activeSession.messages),
                  toolsDisabled,
                  continuesUsed: emptyAfterToolsContinues,
                  tools: toolMetas,
                  visibleTexts: assistantTexts,
                });
              return { kind, emptyContinue, stopText };
            },
            sendContinue: async ({ kind }) => {
              if (kind === "progress-stall" && stallLedger) {
                const claim = claimStallContinue(stallLedger);
                if (!claim.allowed) {
                  throw new Error(claim.stopReason ?? "execution_stall_continue_exhausted");
                }
                stallContinues = claim.continuesUsed;
              }
              try {
                await abortable(
                  activeSession.sendCustomMessage(
                    {
                      customType: "openbot:execution-stall-continue",
                      content:
                        kind === "silent-exec"
                          ? SILENT_EXEC_CONTINUE_PROMPT
                          : kind === "false-confirm"
                            ? FALSE_CONFIRM_CONTINUE_PROMPT
                            : kind === "empty-after-tools"
                              ? EMPTY_AFTER_TOOLS_CONTINUE_PROMPT
                              : kind === "recoverable-tool-failure"
                                ? RECOVERABLE_TOOL_FAILURE_CONTINUE_PROMPT
                                : EXECUTION_STALL_CONTINUE_PROMPT,
                      display: false,
                      details: { reason: kind },
                    },
                    { triggerTurn: true },
                  ),
                );
              } catch (err) {
                log.warn(`execution stall continuation failed: ${String(err)}`);
                throw err;
              }
            },
            onContinued: (kind, stopText) => {
              if (kind === "progress-stall") {
                // When durable ledger is active, claim already set stallContinues.
                if (!stallLedger) {
                  stallContinues += 1;
                }
                if (stopText) {
                  continuedStalls.push(stopText);
                }
              } else if (kind === "false-confirm") {
                falseConfirmContinues += 1;
                if (stopText) {
                  continuedStalls.push(stopText);
                }
              } else if (kind === "silent-exec") {
                silentExecContinues += 1;
                if (stopText) {
                  continuedStalls.push(stopText);
                }
              } else if (kind === "recoverable-tool-failure") {
                recoverableContinues += 1;
                if (stopText) {
                  continuedStalls.push(stopText);
                }
              } else {
                emptyAfterToolsContinues += 1;
              }
            },
          });
          if (continuedStalls.length > 0) {
            dropSupersededStallTexts(
              assistantTexts,
              continuedStalls,
              lastAssistantStopText(activeSession.messages),
            );
          }
        }

        try {
          await rewriteAttemptVisibleReply({
            runId: params.runId,
            assistantTexts,
            messages: activeSession.messages,
            sessionFile: params.sessionFile,
            workspaceDir: effectiveWorkspace,
            sessionKey: params.sessionKey,
            ...(params.oguiDecisionRun ? { oguiDecisionRun: params.oguiDecisionRun } : {}),
          });
        } catch (err) {
          log.warn(`visible reply rewrite failed: ${String(err)}`);
        }

        // Capture snapshot before compaction wait so we have complete messages if timeout occurs
        // Check compaction state before and after to avoid race condition where compaction starts during capture
        // Use session state (not subscription) for snapshot decisions - need instantaneous compaction status
        const wasCompactingBefore = activeSession.isCompacting;
        const snapshot = activeSession.messages.slice();
        const wasCompactingAfter = activeSession.isCompacting;
        // Only trust snapshot if compaction wasn't running before or after capture
        const preCompactionSnapshot = wasCompactingBefore || wasCompactingAfter ? null : snapshot;
        const preCompactionSessionId = activeSession.sessionId;
        const COMPACTION_RETRY_AGGREGATE_TIMEOUT_MS = 60_000;

        try {
          // Flush buffered block replies before waiting for compaction so the
          // user receives the assistant response immediately.  Without this,
          // coalesced/buffered blocks stay in the pipeline until compaction
          // finishes — which can take minutes on large contexts (#35074).
          if (params.onBlockReplyFlush) {
            await params.onBlockReplyFlush();
          }

          const compactionRetryWait = await waitForCompactionRetryWithAggregateTimeout({
            waitForCompactionRetry,
            abortable,
            aggregateTimeoutMs: COMPACTION_RETRY_AGGREGATE_TIMEOUT_MS,
            isCompactionStillInFlight: isCompactionInFlight,
          });
          if (compactionRetryWait.timedOut) {
            timedOutDuringCompaction = true;
            if (!isProbeSession) {
              log.warn(
                `compaction retry aggregate timeout (${COMPACTION_RETRY_AGGREGATE_TIMEOUT_MS}ms): ` +
                  `proceeding with pre-compaction state runId=${params.runId} sessionId=${params.sessionId}`,
              );
            }
          }
        } catch (err) {
          if (isRunnerAbortError(err)) {
            if (!promptError) {
              promptError = err;
              promptErrorSource = "compaction";
            }
            if (!isProbeSession) {
              log.debug(
                `compaction wait aborted: runId=${params.runId} sessionId=${params.sessionId}`,
              );
            }
          } else {
            throw err;
          }
        }

        const compactionOccurredThisAttempt = getCompactionCount() > 0;

        // Append cache-TTL timestamp AFTER prompt + compaction retry completes.
        // Previously this was before the prompt, which caused a custom entry to be
        // inserted between compaction and the next prompt — breaking the
        // prepareCompaction() guard that checks the last entry type, leading to
        // double-compaction. See: https://github.com/openclaw/openclaw/issues/9282
        // Skip when timed out during compaction — session state may be inconsistent.
        if (!timedOutDuringCompaction && !compactionOccurredThisAttempt) {
          const shouldTrackCacheTtl =
            params.config?.agents?.defaults?.contextPruning?.mode === "cache-ttl" &&
            isCacheTtlEligibleProvider(params.provider, params.modelId);
          if (shouldTrackCacheTtl) {
            appendCacheTtlTimestamp(sessionManager, {
              timestamp: Date.now(),
              provider: params.provider,
              modelId: params.modelId,
            });
          }
        }

        // If timeout occurred during compaction, use pre-compaction snapshot when available
        // (compaction restructures messages but does not add user/assistant turns).
        const snapshotSelection = selectCompactionTimeoutSnapshot({
          timedOutDuringCompaction,
          preCompactionSnapshot,
          preCompactionSessionId,
          currentSnapshot: activeSession.messages.slice(),
          currentSessionId: activeSession.sessionId,
        });
        if (timedOutDuringCompaction) {
          if (!isProbeSession) {
            log.warn(
              `using ${snapshotSelection.source} snapshot: timed out during compaction runId=${params.runId} sessionId=${params.sessionId}`,
            );
          }
        }
        messagesSnapshot = snapshotSelection.messagesSnapshot;
        sessionIdUsed = snapshotSelection.sessionIdUsed;

        if (promptError && promptErrorSource === "prompt" && !compactionOccurredThisAttempt) {
          try {
            sessionManager.appendCustomEntry("openclaw:prompt-error", {
              timestamp: Date.now(),
              runId: params.runId,
              sessionId: params.sessionId,
              provider: params.provider,
              model: params.modelId,
              api: params.model.api,
              error: describeUnknownError(promptError),
            });
          } catch (entryErr) {
            log.warn(`failed to persist prompt error entry: ${String(entryErr)}`);
          }
        }

        // Let the active context engine run its post-turn lifecycle.
        if (params.contextEngine) {
          const afterTurnRuntimeContext = buildAfterTurnRuntimeContext({
            attempt: params,
            workspaceDir: effectiveWorkspace,
            agentDir,
          });

          if (typeof params.contextEngine.afterTurn === "function") {
            try {
              await params.contextEngine.afterTurn({
                sessionId: sessionIdUsed,
                sessionFile: params.sessionFile,
                messages: messagesSnapshot,
                prePromptMessageCount,
                tokenBudget: params.contextTokenBudget,
                runtimeContext: afterTurnRuntimeContext,
              });
            } catch (afterTurnErr) {
              log.warn(`context engine afterTurn failed: ${String(afterTurnErr)}`);
            }
          } else {
            // Fallback: ingest new messages individually
            const newMessages = messagesSnapshot.slice(prePromptMessageCount);
            if (newMessages.length > 0) {
              if (typeof params.contextEngine.ingestBatch === "function") {
                try {
                  await params.contextEngine.ingestBatch({
                    sessionId: sessionIdUsed,
                    messages: newMessages,
                  });
                } catch (ingestErr) {
                  log.warn(`context engine ingest failed: ${String(ingestErr)}`);
                }
              } else {
                for (const msg of newMessages) {
                  try {
                    await params.contextEngine.ingest({
                      sessionId: sessionIdUsed,
                      message: msg,
                    });
                  } catch (ingestErr) {
                    log.warn(`context engine ingest failed: ${String(ingestErr)}`);
                  }
                }
              }
            }
          }
        }

        cacheTrace?.recordStage("session:after", {
          messages: messagesSnapshot,
          note: timedOutDuringCompaction
            ? "compaction timeout"
            : promptError
              ? "prompt error"
              : undefined,
        });
        anthropicPayloadLogger?.recordUsage(messagesSnapshot, promptError);

        // Run agent_end hooks to allow plugins to analyze the conversation
        // This is fire-and-forget, so we don't await
        // Run even on compaction timeout so plugins can log/cleanup
        if (hookRunner?.hasHooks("agent_end")) {
          hookRunner
            .runAgentEnd(
              {
                messages: messagesSnapshot,
                success: !aborted && !promptError,
                error: promptError ? describeUnknownError(promptError) : undefined,
                durationMs: Date.now() - promptStartedAt,
              },
              {
                agentId: hookAgentId,
                sessionKey: params.sessionKey,
                sessionId: params.sessionId,
                workspaceDir: params.workspaceDir,
                messageProvider: params.messageProvider ?? undefined,
              },
            )
            .catch((err) => {
              log.warn(`agent_end hook failed: ${err}`);
            });
        }
      } finally {
        clearTimeout(abortTimer);
        if (abortWarnTimer) {
          clearTimeout(abortWarnTimer);
        }
        // If the run terminates while compaction is still in flight (abort /
        // timeout / error), emit a paired compaction "end" so the UI's
        // "Compacting context…" indicator clears instead of hanging forever.
        try {
          flushPendingCompactionEnd();
        } catch (err) {
          log.warn(`flushPendingCompactionEnd failed: ${String(err)}`);
        }
        if (!isProbeSession && (aborted || timedOut) && !timedOutDuringCompaction) {
          log.debug(
            `run cleanup: runId=${params.runId} sessionId=${params.sessionId} aborted=${aborted} timedOut=${timedOut}`,
          );
        }
        try {
          unsubscribe();
        } catch (err) {
          // unsubscribe() should never throw; if it does, it indicates a serious bug.
          // Log at error level to ensure visibility, but don't rethrow in finally block
          // as it would mask any exception from the try block above.
          log.error(
            `CRITICAL: unsubscribe failed, possible resource leak: runId=${params.runId} ${String(err)}`,
          );
        }
        clearActiveEmbeddedRun(params.sessionId, queueHandle, params.sessionKey);
        params.abortSignal?.removeEventListener?.("abort", onAbort);
      }

      const lastAssistant = messagesSnapshot
        .slice()
        .toReversed()
        .find((m) => m.role === "assistant");

      const toolMetasNormalized = toolMetas
        .filter(
          (
            entry,
          ): entry is {
            toolName: string;
            meta?: string;
            toolCallId?: string;
            success?: boolean;
            startedAt?: number;
          } => typeof entry.toolName === "string" && entry.toolName.trim().length > 0,
        )
        .map((entry) => ({
          toolName: entry.toolName,
          meta: entry.meta,
          toolCallId: entry.toolCallId,
          success: entry.success !== false,
          startedAt: entry.startedAt,
        }));

      // Linked native outcome rows (requested → rejected/executed) for mixed violations (§7.3.C).
      // Detection fact stays immutable at requested; outcomes are separate linked events.
      if (
        protocolBoundaryState.lastFact?.nativeExecutionStatus === "requested" &&
        toolMetasNormalized.length > 0
      ) {
        try {
          linkNativeOutcomesForViolation({
            parentFact: protocolBoundaryState.lastFact,
            runId: params.runId,
            tools: toolMetasNormalized.map((entry) => ({
              toolName: entry.toolName,
              toolCallId: entry.toolCallId,
              success: entry.success,
            })),
          });
        } catch (err) {
          log.warn(`protocol violation native outcome link failed: ${String(err)}`);
        }
      }

      if (hookRunner?.hasHooks("llm_output")) {
        hookRunner
          .runLlmOutput(
            {
              runId: params.runId,
              sessionId: params.sessionId,
              provider: params.provider,
              model: params.modelId,
              assistantTexts,
              lastAssistant,
              usage: getUsageTotals(),
            },
            {
              agentId: hookAgentId,
              sessionKey: params.sessionKey,
              sessionId: params.sessionId,
              workspaceDir: params.workspaceDir,
              messageProvider: params.messageProvider ?? undefined,
            },
          )
          .catch((err) => {
            log.warn(`llm_output hook failed: ${String(err)}`);
          });
      }

      // End-of-run fallback: unique-owner / explicit skill only (mid-run uses toolCallId).
      // Per-tool success comes from toolMetas (not lastToolError).
      // askOutcome P1: run-level success is unproven here — do not invent it.
      // Known run failure → failure; otherwise outcome/success stay unknown (null).
      // Still call skill recording so tool attribution is not skipped.
      const { skillOutcome, patternSuccess } = resolveAttemptEndOfRunAttribution({
        aborted,
        timedOut,
        promptError,
        lastAssistantErrorMessage: lastAssistant?.errorMessage,
      });
      if (params.agentId?.trim() && lifecycleSkillNamesLoaded.length > 0) {
        const outcome = skillOutcome;
        const usage = getUsageTotals?.() as { totalDurationMs?: number } | undefined;
        const latencyMs =
          typeof usage?.totalDurationMs === "number" ? usage.totalDurationMs : undefined;
        try {
          recordLifecycleSkillsLoadedOnRun({
            agentId: params.agentId,
            runId: params.runId,
            skillNames: lifecycleSkillNamesLoaded,
            outcome,
            latencyMs,
            sessionKey: params.sessionKey ?? null,
            toolsUsed: toolMetasNormalized.map((entry) => ({
              toolName: entry.toolName,
              success: entry.success,
              toolCallId: entry.toolCallId,
            })),
            assistantTexts: Array.isArray(assistantTexts) ? assistantTexts : [],
          });
        } catch {
          // best-effort; never break the run
        }
      }

      if (params.agentId?.trim()) {
        try {
          const toolNames = toolMetasNormalized.map((entry) => entry.toolName).filter(Boolean);
          ingestPatternSampleFromRun({
            agentId: params.agentId,
            runId: params.runId ?? null,
            sessionKey: params.sessionKey ?? null,
            toolsUsed: toolNames,
            // null = unknown clue; false = known failure. Never default true.
            success: patternSuccess,
          });
        } catch {
          // best-effort; never break the run
        }
      }

      runProductionValidatorsForAttempt({
        preflight: executionPreflight,
        workspaceDir: effectiveWorkspace,
      });
      const deliveryEvidence = resolveAttemptDelivery({
        preflight: executionPreflight,
        workspaceDir: effectiveWorkspace,
      });
      recordExecutionTrace({
        taskId: executionPreflight.taskId,
        sessionId: executionPreflight.sessionId,
        attemptNumber: executionPreflight.attemptNumber,
        intentClass: executionPreflight.intentClass,
        decisionStage: "delivery",
        decisionCode: deliveryEvidence.decisionCode,
        deliveryOutcome: deliveryEvidence.allowedToDeliver ? "allowed" : "blocked",
        ...(executionPreflight.primarySkill
          ? { primarySkill: executionPreflight.primarySkill }
          : {}),
      });
      const contractGatesDelivery =
        executionPreflight.deliveryBlockedUntil ||
        executionPreflight.requiredValidators.length > 0 ||
        executionPreflight.decisionCode === "validator_unavailable";
      const gatedAssistantTexts = contractGatesDelivery
        ? gateAssistantTexts(assistantTexts, deliveryEvidence)
        : assistantTexts;
      if (params.runId) {
        emitAgentEvent({
          runId: params.runId,
          stream: "lifecycle",
          data: {
            event: deliveryEvidence.allowedToDeliver ? "delivery_allowed" : "delivery_blocked",
            taskId: deliveryEvidence.gateInput.taskId,
            sessionId: executionPreflight.sessionId,
            attemptNumber: executionPreflight.attemptNumber,
            intentClass: executionPreflight.intentClass,
            decisionStage: "delivery",
            decisionCode: deliveryEvidence.decisionCode,
            deliveryOutcome: deliveryEvidence.allowedToDeliver ? "allowed" : "blocked",
            ...(deliveryEvidence.gateInput.artifactPath
              ? { artifactPath: deliveryEvidence.gateInput.artifactPath }
              : {}),
            ...(deliveryEvidence.gateInput.artifactSha256
              ? { artifactSha256: deliveryEvidence.gateInput.artifactSha256 }
              : {}),
            ...(deliveryEvidence.gateInput.validatorId
              ? { validatorId: deliveryEvidence.gateInput.validatorId }
              : {}),
            ...(deliveryEvidence.gateInput.validatorReceipts
              ? { validatorReceipts: deliveryEvidence.gateInput.validatorReceipts }
              : {}),
            validationResult: deliveryEvidence.gateInput.validationResult,
            ...(executionPreflight.primarySkill
              ? { primarySkill: executionPreflight.primarySkill }
              : {}),
          },
        });
      }

      return {
        aborted,
        timedOut,
        timedOutDuringCompaction,
        promptError,
        sessionIdUsed,
        bootstrapPromptWarningSignaturesSeen: bootstrapPromptWarning.warningSignaturesSeen,
        bootstrapPromptWarningSignature: bootstrapPromptWarning.signature,
        systemPromptReport,
        messagesSnapshot,
        assistantTexts: gatedAssistantTexts,
        toolMetas: toolMetasNormalized,
        lastAssistant,
        lastToolError: getLastToolError?.(),
        didSendViaMessagingTool: didSendViaMessagingTool(),
        messagingToolSentTexts: contractGatesDelivery
          ? getMessagingToolSentTexts().map((text) => gateReplyText(text, deliveryEvidence) ?? text)
          : getMessagingToolSentTexts(),
        messagingToolSentMediaUrls: getMessagingToolSentMediaUrls(),
        messagingToolSentTargets: getMessagingToolSentTargets(),
        successfulCronAdds: getSuccessfulCronAdds(),
        cloudCodeAssistFormatError: Boolean(
          lastAssistant?.errorMessage && isCloudCodeAssistFormatError(lastAssistant.errorMessage),
        ),
        attemptUsage: getUsageTotals(),
        compactionCount: getCompactionCount(),
        // Client tool call detected (OpenResponses hosted tools)
        clientToolCall: clientToolCallDetected ?? undefined,
        taskId: executionTaskId,
        hookDelivery: toHookDeliveryResult({
          preflight: executionPreflight,
          evidence: deliveryEvidence,
        }),
      };
    } finally {
      // In-attempt keys drop here. The retained task context stays so a cron
      // result or subagent relay after this return can still see the receipt.
      disarmCompletionHold([
        executionPreflight.sessionId,
        params.sessionKey ?? "",
        params.sessionId ?? "",
        sandboxSessionKey ?? "",
      ]);
      // Always tear down the session (and release the lock) before we leave this attempt.
      //
      // BUGFIX: Wait for the agent to be truly idle before flushing pending tool results.
      // pi-agent-core's auto-retry resolves waitForRetry() on assistant message receipt,
      // *before* tool execution completes in the retried agent loop. Without this wait,
      // flushPendingToolResults() fires while tools are still executing, inserting
      // synthetic "missing tool result" errors and causing silent agent failures.
      // See: https://github.com/openclaw/openclaw/issues/8643
      removeContextCompiler?.();
      removeToolResultContextGuard?.();
      removeReplyLanguageReminder?.();
      removeVisibleReplyRewriter?.();
      await flushPendingToolResultsAfterIdle({
        agent: session?.agent,
        sessionManager,
        clearPendingOnTimeout: true,
      });
      session?.dispose();
      releaseWsSession(params.sessionId);
      await sessionLock.release();
    }
  } finally {
    restoreSkillEnv?.();
    process.chdir(prevCwd);
  }
}
