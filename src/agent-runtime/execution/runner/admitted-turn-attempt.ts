import {
  isContextOverflowError,
  sanitizeUserFacingText,
} from "../../../agents/pi-embedded-helpers.js";
import { stripHeartbeatToken } from "../../../auto-reply/heartbeat.js";
import { resolveModelFallbackOptions } from "../../../auto-reply/reply/agent-runner-utils.js";
import {
  HEARTBEAT_TOKEN,
  isSilentReplyPrefixText,
  isSilentReplyText,
  SILENT_REPLY_TOKEN,
} from "../../../auto-reply/tokens.js";
import type { ReplyPayload } from "../../../auto-reply/types.js";
import { logVerbose } from "../../../globals.js";
import { emitAgentEvent } from "../../../infra/agent-events.js";
import { runnerExecutorEvidenceContext } from "../../../task-outcome/runtime-from-runner.js";
import { createTurnOutcomeRecorder } from "../outcomes/index.js";
import { createAdmittedCandidateInvoker } from "./admitted-candidate.js";
import type { AdmittedTurnHost } from "./admitted-turn-host.js";
import type { AdmittedTurnLoopState } from "./admitted-turn-state.js";
import { createExecutionLifecycle } from "./execution-lifecycle.js";
import type { AgentRunLoopResult, AgentTurnExecutionParams } from "./turn-contract.js";

export type AdmittedTurnAttemptOutcome =
  | { action: "break" }
  | { action: "return"; result: AgentRunLoopResult };

export async function runAdmittedTurnAttempt(args: {
  params: AgentTurnExecutionParams;
  host: AdmittedTurnHost;
  runId: string;
  state: AdmittedTurnLoopState;
  controlledExecution: ReturnType<typeof createExecutionLifecycle>;
  assertOriginalTaskCurrent: () => void;
  assertTipBudgetAllowsModelCall: () => void;
  chargeTipBudgetAfterModelCall: (opts: {
    provider: string;
    model: string;
    usage?: unknown;
  }) => void;
  notifyAgentRunStart: () => void;
  recordGrowthTaskOutcome: ReturnType<typeof createTurnOutcomeRecorder>["commit"];
  outcomeRecorder: ReturnType<typeof createTurnOutcomeRecorder>;
  runtimeEvidence: { capture: (stage: "started" | "completed" | "failed" | "cancelled") => void };
  normalizeReplyMediaPaths: (payload: ReplyPayload) => Promise<ReplyPayload>;
  directlySentBlockKeys: Set<string>;
  chatOutcomeTaskId: string | undefined;
  chatOutcomeScope: import("../../../task-outcome/types.js").TrustedScope | undefined;
  growthAgentIdForEntry: string | undefined;
}): Promise<AdmittedTurnAttemptOutcome> {
  const {
    params,
    host,
    runId,
    state,
    controlledExecution,
    assertOriginalTaskCurrent,
    assertTipBudgetAllowsModelCall,
    chargeTipBudgetAfterModelCall,
    notifyAgentRunStart,
    recordGrowthTaskOutcome,
    outcomeRecorder,
    runtimeEvidence,
    normalizeReplyMediaPaths,
    directlySentBlockKeys,
    chatOutcomeTaskId,
    chatOutcomeScope,
    growthAgentIdForEntry,
  } = args;

  const normalizeStreamingText = (
    payload: ReplyPayload,
  ): { text?: string; skip: boolean; sanitizedEmpty?: boolean } => {
    let text = payload.text;
    if (!params.isHeartbeat && text?.includes("HEARTBEAT_OK")) {
      const stripped = stripHeartbeatToken(text, {
        mode: "message",
      });
      if (stripped.didStrip && !state.didLogHeartbeatStrip) {
        state.didLogHeartbeatStrip = true;
        logVerbose("Stripped stray HEARTBEAT_OK token from reply");
      }
      if (stripped.shouldSkip && (payload.mediaUrls?.length ?? 0) === 0) {
        return { skip: true };
      }
      text = stripped.text;
    }
    if (isSilentReplyText(text, SILENT_REPLY_TOKEN)) {
      return { skip: true };
    }
    if (
      isSilentReplyPrefixText(text, SILENT_REPLY_TOKEN) ||
      isSilentReplyPrefixText(text, HEARTBEAT_TOKEN)
    ) {
      return { skip: true };
    }
    if (!text) {
      // Allow media-only payloads (e.g. tool result screenshots) through.
      if ((payload.mediaUrls?.length ?? 0) > 0) {
        return { text: undefined, skip: false };
      }
      return { skip: true };
    }
    const sanitized = sanitizeUserFacingText(text, {
      errorContext: Boolean(payload.isError),
    });
    if (!sanitized.trim()) {
      return { skip: true, sanitizedEmpty: true };
    }
    return { text: sanitized, skip: false };
  };
  const handlePartialForTyping = async (payload: ReplyPayload): Promise<string | undefined> => {
    if (isSilentReplyPrefixText(payload.text, SILENT_REPLY_TOKEN)) {
      return undefined;
    }
    const { text, skip } = normalizeStreamingText(payload);
    if (skip || !text) {
      return undefined;
    }
    await params.typingSignals.signalTextDelta(text);
    return text;
  };
  const runGatewayClientUser =
    params.followupRun.run.gatewayClientUser ?? params.sessionCtx.GatewayClientUser;
  const runGatewayClientSessionDomain =
    params.followupRun.run.gatewayClientSessionDomain ??
    params.sessionCtx.GatewayClientSessionDomain;
  const runGatewayClientPlatformUserId =
    params.followupRun.run.gatewayClientPlatformUserId ??
    params.sessionCtx.GatewayClientPlatformUserId;
  // Commercial Runtime 统一闸口（P0）：model gate + 并发占槽 + 订阅 snapshot。
  const runContextEstimate = host.model.buildRunContextEstimateParts({
    taskText: params.commandBody,
    sessionEntry: params.getActiveSessionEntry(),
    extraSystemPrompt: params.followupRun.run.extraSystemPrompt,
  });
  const modelGateInput = {
    cfg: params.followupRun.run.config,
    agentId: params.followupRun.run.agentId,
    gatewayClientUser: runGatewayClientUser,
    gatewayClientSessionDomain: runGatewayClientSessionDomain,
    gatewayClientPlatformUserId: runGatewayClientPlatformUserId,
    taskText: params.commandBody,
    contextParts: runContextEstimate.contextParts,
    ...(params.sessionCtx.CollaborationGroupOwnerEntitlement
      ? {
          collaborationGroupOwnerEntitlement: params.sessionCtx.CollaborationGroupOwnerEntitlement,
        }
      : {}),
  };
  const collaborationGroupId = params.sessionCtx.CollaborationGroupId?.trim();
  const prepared = await controlledExecution.prepare({
    config: params.followupRun.run.config,
    authorization: {
      agentId: params.followupRun.run.agentId,
      ...(collaborationGroupId ? { groupId: collaborationGroupId } : {}),
      modelGateInput,
    },
    actorId: runGatewayClientPlatformUserId?.trim()
      ? `platform-user:${runGatewayClientPlatformUserId.trim()}`
      : undefined,
    signal: params.opts?.abortSignal,
  });
  if (prepared.kind === "denied") {
    void recordGrowthTaskOutcome(false, {
      authzDenied: true,
      failureDetail: "enterprise_run_slot_denied",
    });
    return {
      action: "return",
      result: { kind: "final", payload: { text: prepared.message } },
    };
  }
  state.modelGate = prepared.gate;
  if (prepared.capability.capabilityOutcome) {
    state.capabilityOutcomeForTurn = prepared.capability.capabilityOutcome;
  }
  if (prepared.kind === "unavailable") {
    void recordGrowthTaskOutcome(false);
    return {
      action: "return",
      result: { kind: "final", payload: { text: prepared.message } },
    };
  }
  const invokeCandidate = createAdmittedCandidateInvoker(params, runId, {
    assertOriginalTaskCurrent,
    directlySentBlockKeys,
    assertTipBudgetAllowsModelCall,
    chargeTipBudgetAfterModelCall,
    notifyAgentRunStart,
    observeExecution: (stage) => runtimeEvidence.capture(stage),
    // Internal embedded failure is collected on the host event bus.
    // It is not a candidate terminal and is not written as one.
    observeAttempt: (event) => {
      emitAgentEvent({
        runId,
        stream: "execution-attempt",
        data: { kind: event.kind, terminal: false, coverage: "collected" },
      });
    },
    handlePartialForTyping,
    normalizeStreamingText,
    normalizeReplyMediaPaths,
    recordGrowthToolResult: outcomeRecorder.recordToolResult,
    recordCommercialToolStart: (name) => {
      state.commercialToolCallCount += 1;
      state.commercialToolClasses.push(name);
    },
    recordModalityArtifact: (artifact) => {
      outcomeRecorder.recordArtifact(artifact);
    },
    markAutoCompactionCompleted: () => {
      state.autoCompactionCompleted = true;
    },
    getBootstrapWarnings: () => state.bootstrapPromptWarningSignaturesSeen,
    setBootstrapWarnings: (warnings) => {
      state.bootstrapPromptWarningSignaturesSeen = warnings;
    },
    getModelGate: () => state.modelGate,
    identity: {
      user: runGatewayClientUser,
      domain: runGatewayClientSessionDomain,
      platformUserId: runGatewayClientPlatformUserId,
    },
  });
  const fallbackResult = await controlledExecution.infer({
    ...resolveModelFallbackOptions(params.followupRun.run),
    taskText: params.followupRun.prompt || params.commandBody,
    executorEvidence: runnerExecutorEvidenceContext(
      params.followupRun.run.config,
      growthAgentIdForEntry ?? "",
      { taskId: chatOutcomeTaskId, scope: chatOutcomeScope, runId },
    ),
    run: (provider, model, runOptions) => {
      // Notify that model selection is complete (including after fallback).
      // This allows responsePrefix template interpolation with the actual model.
      params.opts?.onModelSelected?.({
        provider,
        model,
        thinkLevel: params.followupRun.run.thinkLevel,
      });

      return invokeCandidate(provider, model, runOptions);
    },
  });
  state.runResult = fallbackResult.result;
  state.fallbackProvider = fallbackResult.provider;
  state.fallbackModel = fallbackResult.model;
  state.fallbackAttempts = Array.isArray(fallbackResult.attempts)
    ? fallbackResult.attempts.map((attempt) => ({
        provider: String(attempt.provider ?? ""),
        model: String(attempt.model ?? ""),
        error: String(attempt.error ?? ""),
        reason: attempt.reason ? String(attempt.reason) : undefined,
        status: typeof attempt.status === "number" ? attempt.status : undefined,
        code: attempt.code ? String(attempt.code) : undefined,
      }))
    : [];
  // P3 任务 14：aor_enhanced 下运行完成后回写 bandit 学习信号（仅在启用 bandit 时）。
  // 用量计费沿用既有 usage 事件，不在此重复计费。
  if (state.modelGate?.aorFeedback) {
    host.accounting.recordAorRunFeedback({
      banditStatePath: state.modelGate?.aorFeedback.banditStatePath,
      provider: fallbackResult.provider,
      model: fallbackResult.model,
      taskTypeId: state.modelGate?.aorFeedback.taskTypeId,
    });
  }
  // P3 收口：写入 AOR 路由解释审计日志（投影 loadAuditExplanations 读取同一文件）。
  if (state.modelGate?.aorRouting) {
    const selectedKey = `${fallbackResult.provider}/${fallbackResult.model}`;
    const explanation = state.modelGate?.aorRouting.explanationByModelId[selectedKey];
    host.accounting.recordAorRoutingExplanation({
      auditLogPath: state.modelGate?.aorRouting.auditLogPath,
      runId,
      taskTypeId: state.modelGate?.aorRouting.taskTypeId,
      strategy: state.modelGate?.aorRouting.strategy,
      provider: fallbackResult.provider,
      model: fallbackResult.model,
      ...(explanation ? { reason: explanation.reason, score: explanation.score } : {}),
    });
  }
  // V2 Phase 3：Credits 计量（ledger + ai_credits 用量双写）。
  if (state.modelGate?.creditReporting) {
    const creditUserId =
      params.sessionCtx.CollaborationGroupOwnerEntitlement?.userEmail?.trim() ||
      params.sessionCtx.CollaborationGroupOwnerEntitlement?.employeeId?.trim() ||
      params.sessionCtx.GatewayClientUser;
    void controlledExecution
      .recordUsage({
        provider: fallbackResult.provider,
        model: fallbackResult.model,
        usage: state.runResult.meta?.agentMeta?.usage,
        creditUserId,
        agentId: params.followupRun.run.agentId,
        durationMs: state.runResult.meta?.durationMs,
        toolCallCount: state.commercialToolCallCount,
        toolClasses: state.commercialToolClasses,
        fallbackAttemptsRaw: fallbackResult.attempts,
      })
      .catch((err) => {
        logVerbose(`credit usage record failed: ${String(err)}`);
      });
  }

  // Some embedded runs surface context overflow as an error payload instead of throwing.
  // Treat those as a session-level failure and auto-recover by starting a fresh session.
  const embeddedError = state.runResult.meta?.error;
  if (
    embeddedError &&
    isContextOverflowError(embeddedError.message) &&
    !state.didResetAfterCompactionFailure &&
    (await params.resetSessionAfterCompactionFailure(embeddedError.message))
  ) {
    state.didResetAfterCompactionFailure = true;
    return {
      action: "return",
      result: {
        kind: "final",
        payload: {
          text: "⚠️ Context limit exceeded. I've reset our conversation to start fresh - please try again.\n\nTo prevent this, increase your compaction buffer by setting `agents.defaults.compaction.reserveTokensFloor` to 20000 or higher in your config.",
        },
      },
    };
  }
  if (embeddedError?.kind === "role_ordering") {
    const didReset = await params.resetSessionAfterRoleOrderingConflict(embeddedError.message);
    if (didReset) {
      return {
        action: "return",
        result: {
          kind: "final",
          payload: {
            text: "⚠️ Message ordering conflict. I've reset the conversation - please try again.",
          },
        },
      };
    }
  }

  return { action: "break" };
}
