import {
  disarmCompletionHold,
  gateAssistantTexts,
  gateReplyText,
  recordExecutionTrace,
  resolveAttemptDelivery,
  runProductionValidatorsForAttempt,
  toHookDeliveryResult,
} from "../../../agents/execution-preflight/index.js";
import { releaseWsSession } from "../../../agents/openai-ws-stream.js";
import { isCloudCodeAssistFormatError } from "../../../agents/pi-embedded-helpers.js";
import { log } from "../../../agents/pi-embedded-runner/logger.js";
import type {
  EmbeddedRunAttemptParams,
  EmbeddedRunAttemptResult,
} from "../../../agents/pi-embedded-runner/run/types.js";
import { describeUnknownError } from "../../../agents/pi-embedded-runner/utils.js";
import { flushPendingToolResultsAfterIdle } from "../../../agents/pi-embedded-runner/wait-for-idle-before-flush.js";
import { linkNativeOutcomesForViolation } from "../../../agents/protocol-violation.js";
import { ingestPatternSampleFromRun } from "../../../gateway/pattern-detection/ingest-from-run.js";
import { recordLifecycleSkillsLoadedOnRun } from "../../../gateway/skill-invocation/index.js";
import { emitAgentEvent } from "../../../infra/agent-events.js";
import { buildAfterTurnRuntimeContext } from "../../capabilities/index.js";
import { invokeContextAfterTurn } from "../../capabilities/index.js";
import { resolveAttemptEndOfRunAttribution } from "../outcomes/attempt-attribution.js";
import { cleanupEmbeddedAttempt } from "./attempt-cleanup.js";
import type { EmbeddedAttemptState } from "./embedded-attempt-preflight.js";
import { clearActiveEmbeddedRun } from "./run-registry.js";

/** Context-engine after-turn, agent_end, skill attribution, client-tool recording, result payloads. */
export async function runEmbeddedAttemptCloseout(
  params: EmbeddedRunAttemptParams,
  s: EmbeddedAttemptState,
): Promise<EmbeddedRunAttemptResult> {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- phase bag temp */
  let __d: any;
  // Let the active context engine run its post-turn lifecycle.
  if (params.contextEngine) {
    const afterTurnRuntimeContext = buildAfterTurnRuntimeContext({
      attempt: params,
      workspaceDir: s.effectiveWorkspace,
      agentDir: s.agentDir,
    });

    await invokeContextAfterTurn(params.contextEngine, {
      sessionId: s.sessionIdUsed,
      sessionFile: params.sessionFile,
      messages: s.messagesSnapshot,
      prePromptMessageCount: s.prePromptMessageCount,
      tokenBudget: params.contextTokenBudget,
      runtimeContext: afterTurnRuntimeContext,
      warn: (message) => log.warn(message),
    });
  }

  s.cacheTrace?.recordStage("session:after", {
    messages: s.messagesSnapshot,
    note: s.timedOutDuringCompaction
      ? "compaction timeout"
      : s.promptError
        ? "prompt error"
        : undefined,
  });
  s.anthropicPayloadLogger?.recordUsage(s.messagesSnapshot, s.promptError);

  // Run agent_end hooks to allow plugins to analyze the conversation
  // This is fire-and-forget, so we don't await
  // Run even on compaction timeout so plugins can log/cleanup
  if (s.hookRunner?.hasHooks("agent_end")) {
    s.hookRunner
      .runAgentEnd(
        {
          messages: s.messagesSnapshot,
          success: !s.aborted && !s.promptError,
          error: s.promptError ? describeUnknownError(s.promptError) : undefined,
          durationMs: Date.now() - s.promptStartedAt,
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
        log.warn(`agent_end hook failed: ${err}`);
      });
  }

  const lastAssistant = s.messagesSnapshot
    .slice()
    .toReversed()
    .find((m) => m.role === "assistant");

  const toolMetasNormalized = s.toolMetas
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
    s.protocolBoundaryState.lastFact?.nativeExecutionStatus === "requested" &&
    toolMetasNormalized.length > 0
  ) {
    try {
      linkNativeOutcomesForViolation({
        parentFact: s.protocolBoundaryState.lastFact,
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

  if (s.hookRunner?.hasHooks("llm_output")) {
    s.hookRunner
      .runLlmOutput(
        {
          runId: params.runId,
          sessionId: params.sessionId,
          provider: params.provider,
          model: params.modelId,
          assistantTexts: s.assistantTexts,
          lastAssistant,
          usage: s.getUsageTotals(),
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
        log.warn(`llm_output hook failed: ${String(err)}`);
      });
  }

  // End-of-run fallback: unique-owner / explicit skill only (mid-run uses toolCallId).
  // Per-tool success comes from toolMetas (not lastToolError).
  // askOutcome P1: run-level success is unproven here — do not invent it.
  // Known run failure → failure; otherwise outcome/success stay unknown (null).
  // Still call skill recording so tool attribution is not skipped.
  const { skillOutcome, patternSuccess } = resolveAttemptEndOfRunAttribution({
    aborted: s.aborted,
    timedOut: s.timedOut,
    promptError: s.promptError,
    lastAssistantErrorMessage: lastAssistant?.errorMessage,
  });
  if (params.agentId?.trim() && s.lifecycleSkillNamesLoaded.length > 0) {
    const outcome = skillOutcome;
    const usage = s.getUsageTotals?.() as { totalDurationMs?: number } | undefined;
    const latencyMs =
      typeof usage?.totalDurationMs === "number" ? usage.totalDurationMs : undefined;
    try {
      recordLifecycleSkillsLoadedOnRun({
        agentId: params.agentId,
        runId: params.runId,
        skillNames: s.lifecycleSkillNamesLoaded,
        outcome,
        latencyMs,
        sessionKey: params.sessionKey ?? null,
        toolsUsed: toolMetasNormalized.map((entry) => ({
          toolName: entry.toolName,
          success: entry.success,
          toolCallId: entry.toolCallId,
        })),
        assistantTexts: Array.isArray(s.assistantTexts) ? s.assistantTexts : [],
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
    preflight: s.executionPreflight,
    workspaceDir: s.effectiveWorkspace,
  });
  const deliveryEvidence = resolveAttemptDelivery({
    preflight: s.executionPreflight,
    workspaceDir: s.effectiveWorkspace,
  });
  recordExecutionTrace({
    taskId: s.executionPreflight.taskId,
    sessionId: s.executionPreflight.sessionId,
    attemptNumber: s.executionPreflight.attemptNumber,
    intentClass: s.executionPreflight.intentClass,
    decisionStage: "delivery",
    decisionCode: deliveryEvidence.decisionCode,
    deliveryOutcome: deliveryEvidence.allowedToDeliver ? "allowed" : "blocked",
    ...(s.executionPreflight.primarySkill
      ? { primarySkill: s.executionPreflight.primarySkill }
      : {}),
  });
  const contractGatesDelivery =
    s.executionPreflight.deliveryBlockedUntil ||
    s.executionPreflight.requiredValidators.length > 0 ||
    s.executionPreflight.decisionCode === "validator_unavailable";
  const gatedAssistantTexts = contractGatesDelivery
    ? gateAssistantTexts(s.assistantTexts, deliveryEvidence)
    : s.assistantTexts;
  if (params.runId) {
    emitAgentEvent({
      runId: params.runId,
      stream: "lifecycle",
      data: {
        event: deliveryEvidence.allowedToDeliver ? "delivery_allowed" : "delivery_blocked",
        taskId: deliveryEvidence.gateInput.taskId,
        sessionId: s.executionPreflight.sessionId,
        attemptNumber: s.executionPreflight.attemptNumber,
        intentClass: s.executionPreflight.intentClass,
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
        ...(s.executionPreflight.primarySkill
          ? { primarySkill: s.executionPreflight.primarySkill }
          : {}),
      },
    });
  }

  return {
    aborted: s.aborted,
    timedOut: s.timedOut,
    timedOutDuringCompaction: s.timedOutDuringCompaction,
    promptError: s.promptError,
    sessionIdUsed: s.sessionIdUsed,
    bootstrapPromptWarningSignaturesSeen: s.bootstrapPromptWarning.warningSignaturesSeen,
    bootstrapPromptWarningSignature: s.bootstrapPromptWarning.signature,
    systemPromptReport: s.systemPromptReport,
    messagesSnapshot: s.messagesSnapshot,
    assistantTexts: gatedAssistantTexts,
    toolMetas: toolMetasNormalized,
    lastAssistant,
    lastToolError: s.getLastToolError?.(),
    didSendViaMessagingTool: s.didSendViaMessagingTool(),
    messagingToolSentTexts: contractGatesDelivery
      ? s.getMessagingToolSentTexts().map((text) => gateReplyText(text, deliveryEvidence) ?? text)
      : s.getMessagingToolSentTexts(),
    messagingToolSentMediaUrls: s.getMessagingToolSentMediaUrls(),
    messagingToolSentTargets: s.getMessagingToolSentTargets(),
    successfulCronAdds: s.getSuccessfulCronAdds(),
    cloudCodeAssistFormatError: Boolean(
      lastAssistant?.errorMessage && isCloudCodeAssistFormatError(lastAssistant.errorMessage),
    ),
    attemptUsage: s.getUsageTotals(),
    compactionCount: s.getCompactionCount(),
    // Client tool call detected (OpenResponses hosted tools)
    clientToolCall: s.clientToolCallDetected ?? undefined,
    taskId: s.executionTaskId,
    hookDelivery: toHookDeliveryResult({
      preflight: s.executionPreflight,
      evidence: deliveryEvidence,
    }),
  };
}

/** Session teardown: idle wait, flush tool results, dispose, release lock. */
export async function cleanupEmbeddedAttemptSession(
  params: EmbeddedRunAttemptParams,
  s: EmbeddedAttemptState,
): Promise<void> {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- phase bag temp */
  let __d: any;
  // In-attempt keys drop here. The retained task context stays so a cron
  // result or subagent relay after this return can still see the receipt.
  disarmCompletionHold([
    s.executionPreflight.sessionId,
    params.sessionKey ?? "",
    params.sessionId ?? "",
    s.sandboxSessionKey ?? "",
  ]);
  // Always tear down the session (and release the lock) before we leave this attempt.
  //
  // BUGFIX: Wait for the agent to be truly idle before flushing pending tool results.
  // pi-agent-core's auto-retry resolves waitForRetry() on assistant message receipt,
  // *before* tool execution completes in the retried agent loop. Without this wait,
  // flushPendingToolResults() fires while tools are still executing, inserting
  // synthetic "missing tool result" errors and causing silent agent failures.
  // See: https://github.com/openclaw/openclaw/issues/8643
  await cleanupEmbeddedAttempt({
    removeContextCompiler: () => s.removeContextCompiler?.(),
    removeToolResultGuard: () => s.removeToolResultContextGuard?.(),
    removeReplyReminder: () => s.removeReplyLanguageReminder?.(),
    removeReplyRewriter: () => s.removeVisibleReplyRewriter?.(),
    flushToolResults: () =>
      flushPendingToolResultsAfterIdle({
        agent: s.session?.agent,
        sessionManager: s.sessionManager,
        clearPendingOnTimeout: true,
      }),
    disposeSession: () => s.session?.dispose(),
    releaseWebSocket: () => releaseWsSession(params.sessionId),
    releaseLock: () => s.sessionLock.release(),
  });
}

/** Mid-run subscription cleanup (paired with prompt/continue/closeout try in main). */
export function cleanupEmbeddedAttemptSubscription(
  params: EmbeddedRunAttemptParams,
  s: EmbeddedAttemptState,
): void {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- phase bag temp */
  let __d: any;
  clearTimeout(s.abortTimer);
  if (s.abortWarnTimer) {
    clearTimeout(s.abortWarnTimer);
  }
  // If the run terminates while compaction is still in flight (abort /
  // timeout / error), emit a paired compaction "end" so the UI's
  // "Compacting context…" indicator clears instead of hanging forever.
  try {
    s.flushPendingCompactionEnd();
  } catch (err) {
    log.warn(`flushPendingCompactionEnd failed: ${String(err)}`);
  }
  if (!s.isProbeSession && (s.aborted || s.timedOut) && !s.timedOutDuringCompaction) {
    log.debug(
      `run cleanup: runId=${params.runId} sessionId=${params.sessionId} aborted=${s.aborted} timedOut=${s.timedOut}`,
    );
  }
  try {
    s.unsubscribe();
  } catch (err) {
    // unsubscribe() should never throw; if it does, it indicates a serious bug.
    // Log at error level to ensure visibility, but don't rethrow in finally block
    // as it would mask any exception from the try block above.
    log.error(
      `CRITICAL: unsubscribe failed, possible resource leak: runId=${params.runId} ${String(err)}`,
    );
  }
  clearActiveEmbeddedRun(params.sessionId, s.queueHandle, params.sessionKey);
  params.abortSignal?.removeEventListener?.("abort", s.onAbort);
}
