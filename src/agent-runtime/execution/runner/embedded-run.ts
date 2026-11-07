import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { resolveOpenClawAgentDir } from "../../../agents/agent-paths.js";
import { hasConfiguredModelFallbacks } from "../../../agents/agent-scope.js";
import {
  isProfileInCooldown,
  type AuthProfileFailureReason,
  markAuthProfileFailure,
  markAuthProfileGood,
  markAuthProfileUsed,
  resolveProfilesUnavailableReason,
} from "../../../agents/auth-profiles.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../../../agents/defaults.js";
import {
  disarmCompletionHold,
  finalizeDeliveryContext,
} from "../../../agents/execution-preflight/completion-hold.js";
import type { ConstitutionalRuntimeShadowDeps } from "../../../agents/execution-preflight/constitutional-runtime-shadow-deps.js";
import { parseConstitutionalRuntimeShadowFlag } from "../../../agents/execution-preflight/constitutional-runtime-shadow-gate.js";
import { NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK } from "../../../agents/execution-preflight/constitutional-runtime-shadow-sink.js";
import type { HookDeliveryResult } from "../../../agents/execution-preflight/hook-delivery.js";
import { latestUserText } from "../../../agents/execution-stall-continue.js";
import { FailoverError, resolveFailoverStatus } from "../../../agents/failover-error.js";
import { ensureAuthProfileStore, getApiKeyForModel } from "../../../agents/model-auth.js";
import { ensureOpenClawModelsJson } from "../../../agents/models-config.js";
import {
  formatBillingErrorMessage,
  classifyFailoverReason,
  formatAssistantErrorText,
  isAuthAssistantError,
  isBillingAssistantError,
  isCompactionFailureError,
  isLikelyContextOverflowError,
  isFailoverAssistantError,
  isFailoverErrorMessage,
  parseImageSizeError,
  parseImageDimensionError,
  isRateLimitAssistantError,
  isTimeoutErrorMessage,
  pickFallbackThinkingLevel,
  type FailoverReason,
} from "../../../agents/pi-embedded-helpers.js";
import { resolveGlobalLane, resolveSessionLane } from "../../../agents/pi-embedded-runner/lanes.js";
import { log } from "../../../agents/pi-embedded-runner/logger.js";
import { createFailoverDecisionLogger } from "../../../agents/pi-embedded-runner/run/failover-observation.js";
import {
  sessionLikelyHasOversizedToolResults,
  truncateOversizedToolResultsInSession,
} from "../../../agents/pi-embedded-runner/tool-result-truncation.js";
import { describeUnknownError } from "../../../agents/pi-embedded-runner/utils.js";
import { ensureRuntimePluginsLoaded } from "../../../agents/runtime-plugins.js";
import { derivePromptTokens, normalizeUsage, type UsageLike } from "../../../agents/usage.js";
import { redactRunIdentifier, resolveRunWorkspaceDir } from "../../../agents/workspace-run.js";
import type { ThinkLevel } from "../../../auto-reply/thinking.js";
import {
  ensureContextEnginesInitialized,
  resolveContextEngine,
} from "../../../context-engine/index.js";
import { inheritExecutionIdentityRunFields } from "../../../gateway/execution-identity-context.js";
import { computeBackoff, sleepWithAbort } from "../../../infra/backoff.js";
import { generateSecureToken } from "../../../infra/secure-random.js";
import { getGlobalHookRunner } from "../../../plugins/hook-runner-global.js";
import { enqueueCommandInLane } from "../../../process/command-queue.js";
import { isMarkdownCapableMessageChannel } from "../../../utils/message-channel.js";
import { resolveModelHookResult } from "../../capabilities/index.js";
import { buildEmbeddedRunPayloads } from "../../delivery/index.js";
import { applyProviderCredential } from "../../model/index.js";
import { prepareEmbeddedModel } from "../../model/index.js";
import { createCopilotTokenRefresh } from "../../model/index.js";
import { createAuthProfileRotation, resolveRunAuthProfileCandidates } from "../../model/index.js";
import {
  OVERLOAD_FAILOVER_BACKOFF_POLICY,
  MAX_OVERFLOW_COMPACTION_ATTEMPTS,
  resolveMaxRunRetryIterations,
} from "../../policy/index.js";
import { sessionTaskState } from "../../state/index.js";
import { embeddedPayloadFormatting } from "../../wiring/embedded-payloads.js";
import {
  createUsageAccumulator,
  mergeUsageIntoAccumulator,
  toNormalizedUsage,
  buildErrorAgentMeta,
} from "../outcomes/usage-summary.js";
import { recoverContextOverflow } from "../recovery/context-overflow.js";
import { runEmbeddedAttempt } from "./embedded-attempt.js";
import { cleanupEmbeddedRun } from "./embedded-cleanup.js";
import type { RunEmbeddedPiAgentParams } from "./embedded-request.js";
import type { EmbeddedPiAgentMeta, EmbeddedPiRunResult } from "./embedded-result.js";

// Avoid Anthropic's refusal test token poisoning session transcripts.
const ANTHROPIC_MAGIC_STRING_TRIGGER_REFUSAL = "ANTHROPIC_MAGIC_STRING_TRIGGER_REFUSAL";
const ANTHROPIC_MAGIC_STRING_REPLACEMENT = "ANTHROPIC MAGIC STRING TRIGGER REFUSAL (redacted)";

function scrubAnthropicRefusalMagic(prompt: string): string {
  if (!prompt.includes(ANTHROPIC_MAGIC_STRING_TRIGGER_REFUSAL)) {
    return prompt;
  }
  return prompt.replaceAll(
    ANTHROPIC_MAGIC_STRING_TRIGGER_REFUSAL,
    ANTHROPIC_MAGIC_STRING_REPLACEMENT,
  );
}

function createCompactionDiagId(): string {
  return `ovf-${Date.now().toString(36)}-${generateSecureToken(4)}`;
}

function resolveActiveErrorContext(params: {
  lastAssistant: { provider?: string; model?: string } | undefined;
  provider: string;
  model: string;
}): { provider: string; model: string } {
  return {
    provider: params.lastAssistant?.provider ?? params.provider,
    model: params.lastAssistant?.model ?? params.model,
  };
}

export async function runEmbeddedPiAgent(
  params: RunEmbeddedPiAgentParams,
): Promise<EmbeddedPiRunResult> {
  // Constitutional runtime shadow (default off). The only environment read for
  // this feature: parsed once per invocation, before any profile or attempt
  // loop, into one frozen object that every attempt of this run receives. The
  // raw string is not kept, no environment object reaches an attempt, and run
  // params cannot supply or change it.
  const constitutionalRuntimeShadowDeps = Object.freeze<ConstitutionalRuntimeShadowDeps>({
    runtimeShadowEnabled: parseConstitutionalRuntimeShadowFlag(
      process.env.OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW,
    ),
    sink: NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK,
    now: performance.now.bind(performance),
  });
  const assertExecutionCurrent = () => {
    if (
      params.taskExecutionBinding &&
      !sessionTaskState.bindingCurrent(params.sessionFile, params.taskExecutionBinding)
    ) {
      throw new Error(
        "Original task was paused, closed, revised or replaced before execution startup",
      );
    }
  };
  assertExecutionCurrent();
  const sessionLane = resolveSessionLane(params.sessionKey?.trim() || params.sessionId);
  const globalLane = resolveGlobalLane(params.lane);
  const enqueueGlobal =
    params.enqueue ?? ((task, opts) => enqueueCommandInLane(globalLane, task, opts));
  const enqueueSession =
    params.enqueue ?? ((task, opts) => enqueueCommandInLane(sessionLane, task, opts));
  const channelHint = params.messageChannel ?? params.messageProvider;
  const resolvedToolResultFormat =
    params.toolResultFormat ??
    (channelHint
      ? isMarkdownCapableMessageChannel(channelHint)
        ? "markdown"
        : "plain"
      : "markdown");
  const isProbeSession = params.sessionId?.startsWith("probe-") ?? false;

  return enqueueSession(() =>
    enqueueGlobal(async () => {
      assertExecutionCurrent();
      const started = Date.now();
      const workspaceResolution = resolveRunWorkspaceDir({
        workspaceDir: params.workspaceDir,
        sessionKey: params.sessionKey,
        agentId: params.agentId,
        config: params.config,
        userId:
          params.gatewayClientPlatformUserId?.trim() ||
          params.executionIdentity?.platformUserId?.trim() ||
          undefined,
        tenantId:
          params.gatewayClientSessionEnterpriseId?.trim() ||
          params.executionIdentity?.enterpriseId?.trim() ||
          undefined,
      });
      const resolvedWorkspace = workspaceResolution.workspaceDir;
      const redactedSessionId = redactRunIdentifier(params.sessionId);
      const redactedSessionKey = redactRunIdentifier(params.sessionKey);
      const redactedWorkspace = redactRunIdentifier(resolvedWorkspace);
      if (workspaceResolution.usedFallback) {
        log.warn(
          `[workspace-fallback] caller=runEmbeddedPiAgent reason=${workspaceResolution.fallbackReason} run=${params.runId} session=${redactedSessionId} sessionKey=${redactedSessionKey} agent=${workspaceResolution.agentId} workspace=${redactedWorkspace}`,
        );
      }
      ensureRuntimePluginsLoaded({
        config: params.config,
        workspaceDir: resolvedWorkspace,
      });
      const prevCwd = process.cwd();

      let provider = (params.provider ?? DEFAULT_PROVIDER).trim() || DEFAULT_PROVIDER;
      let modelId = (params.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
      const agentDir = params.agentDir ?? resolveOpenClawAgentDir();
      const fallbackConfigured = hasConfiguredModelFallbacks({
        cfg: params.config,
        agentId: params.agentId,
        sessionKey: params.sessionKey,
      });
      await ensureOpenClawModelsJson(params.config, agentDir);

      // Run before_model_resolve hooks early so plugins can override the
      // provider/model before await resolveModel().
      //
      // Legacy compatibility: before_agent_start is also checked for override
      // fields if present. New hook takes precedence when both are set.
      const hookRunner = getGlobalHookRunner();
      const hookCtx = {
        agentId: workspaceResolution.agentId,
        sessionKey: params.sessionKey,
        sessionId: params.sessionId,
        workspaceDir: resolvedWorkspace,
        messageProvider: params.messageProvider ?? undefined,
        trigger: params.trigger,
        channelId: params.messageChannel ?? params.messageProvider ?? undefined,
      };
      const { modelResolveOverride, legacyBeforeAgentStartResult } = await resolveModelHookResult({
        prompt: params.prompt,
        hookCtx,
        hookRunner,
        warn: (message) => log.warn(message),
      });
      if (modelResolveOverride?.providerOverride) {
        provider = modelResolveOverride.providerOverride;
        log.info(`[hooks] provider overridden to ${provider}`);
      }
      if (modelResolveOverride?.modelOverride) {
        modelId = modelResolveOverride.modelOverride;
        log.info(`[hooks] model overridden to ${modelId}`);
      }

      const { authStorage, modelRegistry, authOverride, ctxInfo, effectiveModel } =
        await prepareEmbeddedModel({
          config: params.config,
          provider,
          modelId,
          agentDir,
          providerAuthOverride: params.providerAuthOverride,
          log,
        });

      const authStore = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
      const { lockedProfileId, profileCandidates } = resolveRunAuthProfileCandidates({
        config: params.config,
        store: authStore,
        provider,
        authProfileId: params.authProfileId,
        authProfileIdSource: params.authProfileIdSource,
      });

      const initialThinkLevel = params.thinkLevel ?? "off";
      let thinkLevel = initialThinkLevel;
      const attemptedThinking = new Set<ThinkLevel>();
      let lastProfileId: string | undefined;
      const copilotRefresh = createCopilotTokenRefresh({
        enabled: effectiveModel.provider === "github-copilot",
        setRuntimeApiKey: (token) => authStorage.setRuntimeApiKey(effectiveModel.provider, token),
        describeError: describeUnknownError,
        log,
      });

      const resolveAuthProfileFailoverReason = (params: {
        allInCooldown: boolean;
        message: string;
        profileIds?: Array<string | undefined>;
      }): FailoverReason => {
        if (params.allInCooldown) {
          const profileIds = (params.profileIds ?? profileCandidates).filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          );
          return (
            resolveProfilesUnavailableReason({
              store: authStore,
              profileIds,
            }) ?? "rate_limit"
          );
        }
        const classified = classifyFailoverReason(params.message);
        return classified ?? "auth";
      };

      const throwAuthProfileFailover = (params: {
        allInCooldown: boolean;
        message?: string;
        error?: unknown;
      }): never => {
        const fallbackMessage = `No available auth profile for ${provider} (all in cooldown or unavailable).`;
        const message =
          params.message?.trim() ||
          (params.error ? describeUnknownError(params.error).trim() : "") ||
          fallbackMessage;
        const reason = resolveAuthProfileFailoverReason({
          allInCooldown: params.allInCooldown,
          message,
          profileIds: profileCandidates,
        });
        if (fallbackConfigured) {
          throw new FailoverError(message, {
            reason,
            provider,
            model: modelId,
            status: resolveFailoverStatus(reason),
            cause: params.error,
          });
        }
        if (params.error instanceof Error) {
          throw params.error;
        }
        throw new Error(message);
      };

      const resolveApiKeyForCandidate = async (candidate?: string) => {
        return getApiKeyForModel({
          model: effectiveModel,
          cfg: params.config,
          profileId: candidate,
          store: authStore,
          agentDir,
          ...(authOverride?.apiKey
            ? {
                authOverride: {
                  apiKey: authOverride.apiKey,
                  ...(authOverride.source ? { source: authOverride.source } : {}),
                },
              }
            : {}),
        });
      };

      const applyApiKeyInfo = async (candidate?: string): Promise<void> => {
        const credential = await resolveApiKeyForCandidate(candidate);
        lastProfileId = await applyProviderCredential({
          provider: effectiveModel.provider,
          candidate,
          credential,
          setRuntimeApiKey: (provider, token) => authStorage.setRuntimeApiKey(provider, token),
          copilotRefresh,
        });
      };

      const authRotation = createAuthProfileRotation({
        candidates: profileCandidates,
        lockedProfileId,
        inCooldown: (candidate) => isProfileInCooldown(authStore, candidate),
        apply: applyApiKeyInfo,
      });
      const advanceAuthProfile = async (): Promise<boolean> => {
        const advanced = await authRotation.advance();
        if (advanced) {
          thinkLevel = initialThinkLevel;
          attemptedThinking.clear();
        }
        return advanced;
      };

      try {
        const autoProfileCandidates = profileCandidates.filter(
          (candidate): candidate is string =>
            typeof candidate === "string" && candidate.length > 0 && candidate !== lockedProfileId,
        );
        const allAutoProfilesInCooldown =
          autoProfileCandidates.length > 0 &&
          autoProfileCandidates.every((candidate) => isProfileInCooldown(authStore, candidate));
        const unavailableReason = allAutoProfilesInCooldown
          ? (resolveProfilesUnavailableReason({
              store: authStore,
              profileIds: autoProfileCandidates,
            }) ?? "rate_limit")
          : null;
        const allowTransientCooldownProbe =
          params.allowTransientCooldownProbe === true &&
          allAutoProfilesInCooldown &&
          (unavailableReason === "rate_limit" ||
            unavailableReason === "overloaded" ||
            unavailableReason === "billing");
        const initialized = await authRotation.initialize({
          allowTransientCooldownProbe,
          onProbe: () =>
            log.warn(
              "probing cooldowned auth profile for " +
                provider +
                "/" +
                modelId +
                " due to " +
                (unavailableReason ?? "transient") +
                " unavailability",
            ),
        });
        if (!initialized) {
          throwAuthProfileFailover({ allInCooldown: true });
        }
      } catch (err) {
        if (err instanceof FailoverError) {
          throw err;
        }
        if (authRotation.current === lockedProfileId) {
          throwAuthProfileFailover({ allInCooldown: false, error: err });
        }
        const advanced = await advanceAuthProfile();
        if (!advanced) {
          throwAuthProfileFailover({ allInCooldown: false, error: err });
        }
      }

      const maybeRefreshCopilotForAuthError = async (
        errorText: string,
        retried: boolean,
      ): Promise<boolean> => {
        if (!copilotRefresh.enabled || retried) {
          return false;
        }
        if (!isFailoverErrorMessage(errorText)) {
          return false;
        }
        if (classifyFailoverReason(errorText) !== "auth") {
          return false;
        }
        try {
          await copilotRefresh.refresh("auth-error");
          copilotRefresh.schedule();
          return true;
        } catch {
          return false;
        }
      };

      const MAX_RUN_LOOP_ITERATIONS = resolveMaxRunRetryIterations(profileCandidates.length);
      let overflowCompactionAttempts = 0;
      let toolResultTruncationAttempted = false;
      let bootstrapPromptWarningSignaturesSeen =
        params.bootstrapPromptWarningSignaturesSeen ??
        (params.bootstrapPromptWarningSignature ? [params.bootstrapPromptWarningSignature] : []);
      const usageAccumulator = createUsageAccumulator();
      let lastRunPromptUsage: ReturnType<typeof normalizeUsage> | undefined;
      let autoCompactionCount = 0;
      let runLoopIterations = 0;
      let overloadFailoverAttempts = 0;
      const maybeMarkAuthProfileFailure = async (failure: {
        profileId?: string;
        reason?: AuthProfileFailureReason | null;
        config?: RunEmbeddedPiAgentParams["config"];
        agentDir?: RunEmbeddedPiAgentParams["agentDir"];
      }) => {
        const { profileId, reason } = failure;
        if (!profileId || !reason || reason === "timeout") {
          return;
        }
        await markAuthProfileFailure({
          store: authStore,
          profileId,
          reason,
          cfg: params.config,
          agentDir,
          runId: params.runId,
        });
      };
      const resolveAuthProfileFailureReason = (
        failoverReason: FailoverReason | null,
      ): AuthProfileFailureReason | null => {
        // Timeouts are transport/model-path failures, not auth health signals,
        // so they should not persist auth-profile failure state.
        if (!failoverReason || failoverReason === "timeout") {
          return null;
        }
        return failoverReason;
      };
      const maybeBackoffBeforeOverloadFailover = async (reason: FailoverReason | null) => {
        if (reason !== "overloaded") {
          return;
        }
        overloadFailoverAttempts += 1;
        const delayMs = computeBackoff(OVERLOAD_FAILOVER_BACKOFF_POLICY, overloadFailoverAttempts);
        log.warn(
          `overload backoff before failover for ${provider}/${modelId}: attempt=${overloadFailoverAttempts} delayMs=${delayMs}`,
        );
        try {
          await sleepWithAbort(delayMs, params.abortSignal);
        } catch (err) {
          if (params.abortSignal?.aborted) {
            const abortErr = new Error("Operation aborted", { cause: err });
            abortErr.name = "AbortError";
            throw abortErr;
          }
          throw err;
        }
      };
      // Resolve the context engine once and reuse across retries to avoid
      // repeated initialization/connection overhead per attempt.
      ensureContextEnginesInitialized();
      const contextEngine = await resolveContextEngine(params.config);
      try {
        let authRetryPending = false;
        // Hoisted so the retry-limit error path can use the most recent API total.
        let lastTurnTotal: number | undefined;
        let lastAttemptTaskId = "";
        let lastHookDelivery: HookDeliveryResult | undefined;
        const releaseRunTask = (outcome: "failed" | "cancelled") => {
          const taskId = lastAttemptTaskId.trim() || params.runId?.trim() || "";
          if (!taskId) {
            return;
          }
          finalizeDeliveryContext({ taskId, outcome });
        };
        while (true) {
          assertExecutionCurrent();
          if (runLoopIterations >= MAX_RUN_LOOP_ITERATIONS) {
            const message =
              `Exceeded retry limit after ${runLoopIterations} attempts ` +
              `(max=${MAX_RUN_LOOP_ITERATIONS}).`;
            log.error(
              `[run-retry-limit] sessionKey=${params.sessionKey ?? params.sessionId} ` +
                `provider=${provider}/${modelId} attempts=${runLoopIterations} ` +
                `maxAttempts=${MAX_RUN_LOOP_ITERATIONS}`,
            );
            releaseRunTask("failed");
            return {
              payloads: [
                {
                  text:
                    "Request failed after repeated internal retries. " +
                    "Please try again, or use /new to start a fresh session.",
                  isError: true,
                },
              ],
              meta: {
                durationMs: Date.now() - started,
                agentMeta: buildErrorAgentMeta({
                  sessionId: params.sessionId,
                  provider,
                  model: effectiveModel.id,
                  usageAccumulator,
                  lastRunPromptUsage,
                  lastTurnTotal,
                }),
                error: { kind: "retry_limit", message },
              },
            };
          }
          runLoopIterations += 1;
          const copilotAuthRetry = authRetryPending;
          authRetryPending = false;
          attemptedThinking.add(thinkLevel);
          await fs.mkdir(resolvedWorkspace, { recursive: true });

          const prompt =
            provider === "anthropic" ? scrubAnthropicRefusalMagic(params.prompt) : params.prompt;

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
            agentDir,
            config: params.config,
            contextEngine,
            contextTokenBudget: ctxInfo.tokens,
            skillsSnapshot: params.skillsSnapshot,
            prompt,
            images: params.images,
            disableTools: params.disableTools,
            omitHeartbeatPrompt: params.omitHeartbeatPrompt,
            skillPolicy: params.skillPolicy,
            inboundToolCeiling: params.inboundToolCeiling,
            knowledgeConsumeRefs: params.knowledgeConsumeRefs,
            mentionedPluginToolAllowlist: params.mentionedPluginToolAllowlist,
            provider,
            modelId,
            model: effectiveModel,
            authProfileId: lastProfileId,
            authProfileIdSource: lockedProfileId ? "user" : "auto",
            authStorage,
            modelRegistry,
            agentId: workspaceResolution.agentId,
            legacyBeforeAgentStartResult,
            thinkLevel,
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
            bootstrapPromptWarningSignaturesSeen,
            bootstrapPromptWarningSignature:
              bootstrapPromptWarningSignaturesSeen[bootstrapPromptWarningSignaturesSeen.length - 1],
            // Last, after every spread: nothing spread above can replace the per-run deps.
            constitutionalRuntimeShadowDeps,
          });
          // The attempt finally already drops its in-attempt keys. Repeat the
          // release here so a caller that observes this return never still
          // holds the attempt lock. Retained task context stays for a later send.
          disarmCompletionHold([params.sessionId, params.sessionKey ?? ""]);

          const {
            aborted,
            promptError,
            timedOut,
            timedOutDuringCompaction,
            sessionIdUsed,
            lastAssistant,
          } = attempt;
          lastAttemptTaskId = attempt.taskId?.trim() || params.runId?.trim() || "";
          // A compaction retry can return before it has its own delivery evidence.
          // Keep the evidence already captured for this attempt chain.
          if (attempt.hookDelivery) {
            lastHookDelivery = attempt.hookDelivery;
          }
          bootstrapPromptWarningSignaturesSeen =
            attempt.bootstrapPromptWarningSignaturesSeen ??
            (attempt.bootstrapPromptWarningSignature
              ? Array.from(
                  new Set([
                    ...bootstrapPromptWarningSignaturesSeen,
                    attempt.bootstrapPromptWarningSignature,
                  ]),
                )
              : bootstrapPromptWarningSignaturesSeen);
          const lastAssistantUsage = normalizeUsage(lastAssistant?.usage as UsageLike);
          const attemptUsage = attempt.attemptUsage ?? lastAssistantUsage;
          mergeUsageIntoAccumulator(usageAccumulator, attemptUsage);
          // Keep prompt size from the latest model call so session totalTokens
          // reflects current context usage, not accumulated tool-loop usage.
          lastRunPromptUsage = lastAssistantUsage ?? attemptUsage;
          lastTurnTotal = lastAssistantUsage?.total ?? attemptUsage?.total;
          const attemptCompactionCount = Math.max(0, attempt.compactionCount ?? 0);
          autoCompactionCount += attemptCompactionCount;
          const activeErrorContext = resolveActiveErrorContext({
            lastAssistant,
            provider,
            model: modelId,
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
                provider,
                modelId,
                ctxInfo,
                createDiagId: createCompactionDiagId,
                overflowCompactionAttempts,
                toolResultTruncationAttempted,
                autoCompactionCount,
                MAX_OVERFLOW_COMPACTION_ATTEMPTS,
                compact: async ({ diagId, attemptNumber }) => {
                  return await contextEngine.compact({
                    sessionId: params.sessionId,
                    sessionFile: params.sessionFile,
                    tokenBudget: ctxInfo.tokens,
                    force: true,
                    compactionTarget: "budget",
                    runtimeContext: {
                      sessionKey: params.sessionKey,
                      messageChannel: params.messageChannel,
                      messageProvider: params.messageProvider,
                      agentAccountId: params.agentAccountId,
                      authProfileId: lastProfileId,
                      workspaceDir: resolvedWorkspace,
                      agentDir,
                      config: params.config,
                      skillsSnapshot: params.skillsSnapshot,
                      senderIsOwner: params.senderIsOwner,
                      provider,
                      model: modelId,
                      runId: params.runId,
                      thinkLevel,
                      reasoningLevel: params.reasoningLevel,
                      bashElevated: params.bashElevated,
                      extraSystemPrompt: params.extraSystemPrompt,
                      ownerNumbers: params.ownerNumbers,
                      inboundToolCeiling: params.inboundToolCeiling,
                      skillPolicy: params.skillPolicy,
                      ...inheritExecutionIdentityRunFields(params),
                      trigger: "overflow",
                      diagId,
                      attempt: attemptNumber,
                      maxAttempts: MAX_OVERFLOW_COMPACTION_ATTEMPTS,
                    },
                  });
                },
              });
            overflowCompactionAttempts = recovery.overflowCompactionAttempts;
            toolResultTruncationAttempted = recovery.toolResultTruncationAttempted;
            autoCompactionCount = recovery.autoCompactionCount;
            if (recovery.action === "retry") {
              continue;
            }
            const errorText = contextOverflowError.text;
            const kind = recovery.kind;
            releaseRunTask("failed");
            return {
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
                  provider,
                  model: effectiveModel.id,
                  usageAccumulator,
                  lastRunPromptUsage,
                  lastAssistant,
                  lastTurnTotal,
                }),
                systemPromptReport: attempt.systemPromptReport,
                error: { kind, message: errorText },
              },
            };
          }

          if (promptError && !aborted) {
            const errorText = describeUnknownError(promptError);
            if (await maybeRefreshCopilotForAuthError(errorText, copilotAuthRetry)) {
              authRetryPending = true;
              continue;
            }
            // Handle role ordering errors with a user-friendly message
            if (/incorrect role information|roles must alternate/i.test(errorText)) {
              releaseRunTask("failed");
              return {
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
                    provider,
                    model: effectiveModel.id,
                    usageAccumulator,
                    lastRunPromptUsage,
                    lastAssistant,
                    lastTurnTotal,
                  }),
                  systemPromptReport: attempt.systemPromptReport,
                  error: { kind: "role_ordering", message: errorText },
                },
              };
            }
            // Handle image size errors with a user-friendly message (no retry needed)
            const imageSizeError = parseImageSizeError(errorText);
            if (imageSizeError) {
              releaseRunTask("failed");
              const maxMb = imageSizeError.maxMb;
              const maxMbLabel =
                typeof maxMb === "number" && Number.isFinite(maxMb) ? `${maxMb}` : null;
              const maxBytesHint = maxMbLabel ? ` (max ${maxMbLabel}MB)` : "";
              return {
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
                    provider,
                    model: effectiveModel.id,
                    usageAccumulator,
                    lastRunPromptUsage,
                    lastAssistant,
                    lastTurnTotal,
                  }),
                  systemPromptReport: attempt.systemPromptReport,
                  error: { kind: "image_size", message: errorText },
                },
              };
            }
            const promptFailoverReason = classifyFailoverReason(errorText);
            const promptProfileFailureReason =
              resolveAuthProfileFailureReason(promptFailoverReason);
            await maybeMarkAuthProfileFailure({
              profileId: lastProfileId,
              reason: promptProfileFailureReason,
            });
            const promptFailoverFailure = isFailoverErrorMessage(errorText);
            // Capture the failing profile before auth-profile rotation mutates `lastProfileId`.
            const failedPromptProfileId = lastProfileId;
            const logPromptFailoverDecision = createFailoverDecisionLogger({
              stage: "prompt",
              runId: params.runId,
              rawError: errorText,
              failoverReason: promptFailoverReason,
              profileFailureReason: promptProfileFailureReason,
              provider,
              model: modelId,
              profileId: failedPromptProfileId,
              fallbackConfigured,
              aborted,
            });
            if (
              promptFailoverFailure &&
              promptFailoverReason !== "timeout" &&
              (await advanceAuthProfile())
            ) {
              logPromptFailoverDecision("rotate_profile");
              await maybeBackoffBeforeOverloadFailover(promptFailoverReason);
              continue;
            }
            const fallbackThinking = pickFallbackThinkingLevel({
              message: errorText,
              attempted: attemptedThinking,
            });
            if (fallbackThinking) {
              log.warn(
                `unsupported thinking level for ${provider}/${modelId}; retrying with ${fallbackThinking}`,
              );
              thinkLevel = fallbackThinking;
              continue;
            }
            // Throw FailoverError for prompt-side failover reasons when fallbacks
            // are configured so outer model fallback can continue on overload,
            // rate-limit, auth, or billing failures.
            if (fallbackConfigured && promptFailoverFailure) {
              const status = resolveFailoverStatus(promptFailoverReason ?? "unknown");
              logPromptFailoverDecision("fallback_model", { status });
              await maybeBackoffBeforeOverloadFailover(promptFailoverReason);
              throw new FailoverError(errorText, {
                reason: promptFailoverReason ?? "unknown",
                provider,
                model: modelId,
                profileId: lastProfileId,
                status,
              });
            }
            if (promptFailoverFailure || promptFailoverReason) {
              logPromptFailoverDecision("surface_error");
            }
            throw promptError;
          }

          const fallbackThinking = pickFallbackThinkingLevel({
            message: lastAssistant?.errorMessage,
            attempted: attemptedThinking,
          });
          if (fallbackThinking && !aborted) {
            log.warn(
              `unsupported thinking level for ${provider}/${modelId}; retrying with ${fallbackThinking}`,
            );
            thinkLevel = fallbackThinking;
            continue;
          }

          const authFailure = isAuthAssistantError(lastAssistant);
          const rateLimitFailure = isRateLimitAssistantError(lastAssistant);
          const billingFailure = isBillingAssistantError(lastAssistant);
          const failoverFailure = isFailoverAssistantError(lastAssistant);
          const assistantFailoverReason = classifyFailoverReason(lastAssistant?.errorMessage ?? "");
          const assistantProfileFailureReason =
            resolveAuthProfileFailureReason(assistantFailoverReason);
          const cloudCodeAssistFormatError = attempt.cloudCodeAssistFormatError;
          const imageDimensionError = parseImageDimensionError(lastAssistant?.errorMessage ?? "");
          // Capture the failing profile before auth-profile rotation mutates `lastProfileId`.
          const failedAssistantProfileId = lastProfileId;
          const logAssistantFailoverDecision = createFailoverDecisionLogger({
            stage: "assistant",
            runId: params.runId,
            rawError: lastAssistant?.errorMessage?.trim(),
            failoverReason: assistantFailoverReason,
            profileFailureReason: assistantProfileFailureReason,
            provider: activeErrorContext.provider,
            model: activeErrorContext.model,
            profileId: failedAssistantProfileId,
            fallbackConfigured,
            timedOut,
            aborted,
          });

          if (
            authFailure &&
            (await maybeRefreshCopilotForAuthError(
              lastAssistant?.errorMessage ?? "",
              copilotAuthRetry,
            ))
          ) {
            authRetryPending = true;
            continue;
          }
          if (imageDimensionError && lastProfileId) {
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
              `Profile ${lastProfileId} rejected image payload${details ? ` (${details})` : ""}.`,
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
            if (lastProfileId) {
              const reason = timedOut ? "timeout" : assistantProfileFailureReason;
              // Skip cooldown for timeouts: a timeout is model/network-specific,
              // not an auth issue. Marking the profile would poison fallback models
              // on the same provider (e.g. gpt-5.3 timeout blocks gpt-5.2).
              await maybeMarkAuthProfileFailure({
                profileId: lastProfileId,
                reason,
              });
              if (timedOut && !isProbeSession) {
                log.warn(`Profile ${lastProfileId} timed out. Trying next account...`);
              }
              if (cloudCodeAssistFormatError) {
                log.warn(
                  `Profile ${lastProfileId} hit Cloud Code Assist format error. Tool calls will be sanitized on retry.`,
                );
              }
            }

            const rotated = await advanceAuthProfile();
            if (rotated) {
              logAssistantFailoverDecision("rotate_profile");
              await maybeBackoffBeforeOverloadFailover(assistantFailoverReason);
              continue;
            }

            if (fallbackConfigured) {
              await maybeBackoffBeforeOverloadFailover(assistantFailoverReason);
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
                      ? formatBillingErrorMessage(
                          activeErrorContext.provider,
                          activeErrorContext.model,
                        )
                      : authFailure
                        ? "LLM request unauthorized."
                        : "LLM request failed.");
              const status =
                resolveFailoverStatus(assistantFailoverReason ?? "unknown") ??
                (isTimeoutErrorMessage(message) ? 408 : undefined);
              logAssistantFailoverDecision("fallback_model", { status });
              throw new FailoverError(message, {
                reason: assistantFailoverReason ?? "unknown",
                provider: activeErrorContext.provider,
                model: activeErrorContext.model,
                profileId: lastProfileId,
                status,
              });
            }
            logAssistantFailoverDecision("surface_error");
          }

          const usage = toNormalizedUsage(usageAccumulator);
          if (usage && lastTurnTotal && lastTurnTotal > 0) {
            usage.total = lastTurnTotal;
          }
          // Extract the last individual API call's usage for context-window
          // utilization display. The accumulated `usage` sums input tokens
          // across all calls (tool-use loops, compaction retries), which
          // overstates the actual context size. `lastCallUsage` reflects only
          // the final call, giving an accurate snapshot of current context.
          const lastCallUsage = normalizeUsage(lastAssistant?.usage as UsageLike);
          const promptTokens = derivePromptTokens(lastRunPromptUsage);
          const agentMeta: EmbeddedPiAgentMeta = {
            sessionId: sessionIdUsed,
            provider: lastAssistant?.provider ?? provider,
            model: lastAssistant?.model ?? effectiveModel.id,
            usage,
            lastCallUsage: lastCallUsage ?? undefined,
            promptTokens,
            compactionCount: autoCompactionCount > 0 ? autoCompactionCount : undefined,
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
            };
          }

          log.debug(
            `embedded run done: runId=${params.runId} sessionId=${params.sessionId} durationMs=${Date.now() - started} aborted=${aborted}`,
          );
          if (aborted) {
            releaseRunTask("cancelled");
          }
          if (lastProfileId) {
            await markAuthProfileGood({
              store: authStore,
              provider,
              profileId: lastProfileId,
              agentDir: params.agentDir,
            });
            await markAuthProfileUsed({
              store: authStore,
              profileId: lastProfileId,
              agentDir: params.agentDir,
            });
          }
          return {
            payloads: payloads.length ? payloads : undefined,
            meta: {
              durationMs: Date.now() - started,
              agentMeta,
              aborted,
              taskId: lastAttemptTaskId || undefined,
              ...(lastHookDelivery ? { hookDelivery: lastHookDelivery } : {}),
              hookValidatorsRequired: lastHookDelivery?.validatorsRequired === true,
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
          };
        }
      } finally {
        await cleanupEmbeddedRun({
          disposeContext: () => contextEngine.dispose?.(),
          stopCredentialRefresh: () => copilotRefresh.stop(),
          restoreWorkingDirectory: () => process.chdir(prevCwd),
        });
      }
    }),
  );
}
