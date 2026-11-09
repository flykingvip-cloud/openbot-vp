import crypto from "node:crypto";
import { resolveBootstrapWarningSignaturesSeen } from "../../../agents/bootstrap-budget.js";
import { isContextOverflowError } from "../../../agents/pi-embedded-helpers.js";
import { createReplyMediaPathNormalizer } from "../../../auto-reply/reply/reply-media-paths.js";
import {
  createRunCostCollector,
  snapshotRunCostPricing,
} from "../../../observation/run-cost-collector.js";
import { createRuntimeEvidenceObserver } from "../../../observation/runtime-evidence.js";
import {
  TaskBudgetExceededError,
  type ModelCallCloseoutLink,
} from "../../../task-outcome/runtime-from-runner.js";
import { isInternalMessageChannel } from "../../../utils/message-channel.js";
import { createTurnOutcomeRecorder } from "../outcomes/index.js";
import { runAdmittedTurnAttempt } from "./admitted-turn-attempt.js";
import type { AdmittedTurnHost } from "./admitted-turn-host.js";
import { runAdmittedTurnRecovery } from "./admitted-turn-recovery.js";
import type { AdmittedTurnLoopState } from "./admitted-turn-state.js";
import { assertControlledExecutionStages } from "./controlled-execution.js";
import type { EmbeddedPiRunResult } from "./embedded-result.js";
import { createExecutionLifecycle } from "./execution-lifecycle.js";
import type { AgentRunLoopResult, AgentTurnExecutionParams } from "./turn-contract.js";

/**
 * Chat scene adapter over the unique controlled execution use-case.
 * Owns task binding, tip budget, candidate params, recovery loops and deferred
 * delivery/outcome recording. Must not invent a parallel prepare/infer/dispose
 * loop or call model fallback outside createExecutionLifecycle.
 */
export async function runAdmittedTurn(
  params: AgentTurnExecutionParams,
  host: AdmittedTurnHost,
): Promise<AgentRunLoopResult> {
  const assertOriginalTaskCurrent = () => {
    const binding = params.followupRun.run.taskCompletionBinding;
    if (params.followupRun.run.executionAdmitted && !binding) {
      throw new Error("Admitted execution request requires its original task binding");
    }
    if (
      binding &&
      !host.task.isTaskExecutionBindingCurrent(params.followupRun.run.sessionFile, binding)
    ) {
      throw new Error("Original task was paused, closed or replaced before provider startup");
    }
  };
  // Reject an obsolete admitted request before creating outcome or billing state.
  assertOriginalTaskCurrent();
  const TRANSIENT_HTTP_RETRY_DELAY_MS = 2_500;
  const SOFT_ENTITLEMENT_RETRY_DELAY_MS = 400;
  // Track payloads sent directly (not via pipeline) during tool flush to avoid duplicates.
  const directlySentBlockKeys = new Set<string>();

  const runId = params.opts?.runId ?? crypto.randomUUID();
  // askOutcome R83：入口创建/恢复真实 taskId（禁止收尾用 runId 补造）。
  const growthAgentIdForEntry = params.followupRun.run.agentId;
  let chatOutcomeTaskId: string | undefined;
  let chatOutcomeScope: import("../../../task-outcome/types.js").TrustedScope | undefined;
  if (!params.isHeartbeat && growthAgentIdForEntry) {
    const subjectRef = (
      params.followupRun.run.gatewayClientPlatformUserId ??
      params.sessionCtx.GatewayClientPlatformUserId ??
      params.followupRun.run.gatewayClientUser ??
      params.sessionCtx.GatewayClientUser ??
      params.sessionKey ??
      "anonymous"
    )
      .toString()
      .trim();
    const tenantId =
      params.followupRun.run.executionIdentity?.enterpriseId?.trim() ||
      params.followupRun.run.executionIdentity?.collaborationOwnerEntitlement?.tenantId?.trim() ||
      undefined;
    const opened = host.task.ensureChatTurnTaskOutcome(params.followupRun.run.config, {
      agentId: growthAgentIdForEntry,
      runId,
      sessionKey: params.sessionKey,
      subjectRef: host.task.normalizeTaskOutcomeSubjectRef(subjectRef),
      ...(tenantId ? { tenantId } : {}),
    });
    if (opened.ok) {
      chatOutcomeTaskId = opened.taskId;
      chatOutcomeScope = opened.scope;
    }
  }
  // askOutcome P0：turn 收尾走统一 TaskOutcome（fire-and-forget，绝不影响回复）。
  // 心跳不算任务；run 成功不再直接记任务成功 / evolution success（挂起验收）。
  // 工具成功率仍在 turn 内内存累加、收尾一次落盘。
  const growthStartedAt = Date.now();
  /** Tip budget wall-clock start = task entry time (not first closeout spend). */
  const tipBudgetStartedAtMs = growthStartedAt;
  let tipBudgetModelCallSeq = 0;
  const modelCallLinks: ModelCallCloseoutLink[] = [];
  const state: AdmittedTurnLoopState = {
    didLogHeartbeatStrip: false,
    autoCompactionCompleted: false,
    commercialToolCallCount: 0,
    commercialToolClasses: [],
    bootstrapPromptWarningSignaturesSeen: resolveBootstrapWarningSignaturesSeen(
      params.getActiveSessionEntry()?.systemPromptReport,
    ),
    modelGate: undefined,
    capabilityOutcomeForTurn: undefined,
    runResult: undefined as unknown as EmbeddedPiRunResult,
    fallbackProvider: params.followupRun.run.provider,
    fallbackModel: params.followupRun.run.model,
    fallbackAttempts: [],
    didResetAfterCompactionFailure: false,
    didRetryTransientHttpError: false,
    didRetrySoftEntitlement: false,
    tipBudgetChargedThisTurn: false,
  };
  const assertTipBudgetAllowsModelCall = (): void => {
    if (!chatOutcomeTaskId || !chatOutcomeScope || params.isHeartbeat || !growthAgentIdForEntry) {
      return;
    }
    const gate = host.budget.assessRunnerTurnBudgetGate(
      params.followupRun.run.config,
      growthAgentIdForEntry,
      {
        taskId: chatOutcomeTaskId,
        scope: chatOutcomeScope,
        startedAtMs: tipBudgetStartedAtMs,
      },
    );
    if (!gate.allowed) {
      throw new TaskBudgetExceededError(chatOutcomeTaskId, gate.exhaustion);
    }
  };
  const costEvidence = createRunCostCollector({
    cfg: params.followupRun.run.config,
    agentId: growthAgentIdForEntry,
    taskId: chatOutcomeTaskId,
    scope: chatOutcomeScope,
    runId,
    provenance: "live",
  });
  const chargeTipBudgetAfterModelCall = (opts: {
    provider: string;
    model: string;
    usage?: unknown;
  }): void => {
    if (!chatOutcomeTaskId || !chatOutcomeScope || params.isHeartbeat || !growthAgentIdForEntry) {
      return;
    }
    tipBudgetModelCallSeq += 1;
    costEvidence.beginCall(tipBudgetModelCallSeq);
    const nowMs = Date.now();
    const pricing = costEvidence.isEnabled()
      ? snapshotRunCostPricing(params.followupRun.run.config, opts.provider, opts.model)
      : null;
    const receipt = host.budget.chargeModelCallAgainstTip(
      params.followupRun.run.config,
      growthAgentIdForEntry,
      {
        taskId: chatOutcomeTaskId,
        scope: chatOutcomeScope,
        runId,
        callSeq: tipBudgetModelCallSeq,
        nowMs,
        usage: opts.usage,
        provider: opts.provider,
        model: opts.model,
      },
    );
    if (receipt.modelCallLink) {
      modelCallLinks.push(receipt.modelCallLink);
    }
    costEvidence.capture({ ...opts, callSeq: tipBudgetModelCallSeq, nowMs, pricing, receipt });
    state.tipBudgetChargedThisTurn = true;
  };
  const runtimeEvidence = createRuntimeEvidenceObserver({
    agentId: growthAgentIdForEntry,
    source: { provenance: "live", collector: "runtime_execution" },
    taskId: chatOutcomeTaskId,
    scope: chatOutcomeScope,
    runId,
  });
  const outcomeRecorder = createTurnOutcomeRecorder({
    costEvidence,
    runtimeEvidence,
    config: params.followupRun.run.config,
    agentId: params.followupRun.run.agentId,
    isHeartbeat: params.isHeartbeat,
    runId,
    startedAtMs: growthStartedAt,
    abortSignal: params.opts?.abortSignal,
    readContext: () => ({
      taskId: chatOutcomeTaskId,
      scope: chatOutcomeScope,
      tenantId: state.modelGate?.tenantId,
      capabilityOutcome: state.capabilityOutcomeForTurn,
      budgetCharged: state.tipBudgetChargedThisTurn,
      modelCallLinks,
    }),
  });
  const recordGrowthTaskOutcome = outcomeRecorder.commit;
  const normalizeReplyMediaPaths = createReplyMediaPathNormalizer({
    cfg: params.followupRun.run.config,
    sessionKey: params.sessionKey,
    workspaceDir: params.followupRun.run.workspaceDir,
    gatewayClientUser:
      params.followupRun.run.gatewayClientUser ?? params.sessionCtx.GatewayClientUser,
    gatewayClientPlatformUserId:
      params.followupRun.run.gatewayClientPlatformUserId ??
      params.sessionCtx.GatewayClientPlatformUserId,
    gatewayClientSessionEnterpriseId:
      params.followupRun.run.executionIdentity?.enterpriseId ??
      params.sessionCtx.CollaborationTenantId ??
      params.sessionCtx.GatewayClientSessionEnterpriseId,
    executionIdentity: params.followupRun.run.executionIdentity,
  });
  let didNotifyAgentRunStart = false;
  const notifyAgentRunStart = () => {
    if (didNotifyAgentRunStart) {
      return;
    }
    didNotifyAgentRunStart = true;
    params.opts?.onAgentRunStart?.(runId);
  };
  const shouldSurfaceToControlUi = isInternalMessageChannel(
    params.followupRun.run.messageProvider ??
      params.sessionCtx.Surface ??
      params.sessionCtx.Provider,
  );
  if (params.sessionKey) {
    const smokeStartedAtMs = host.observability.noteSkillSmokeClock({
      sessionKey: params.sessionKey,
      userText: params.commandBody,
      nowMs: Date.now(),
    });
    host.observability.registerAgentRunContext(runId, {
      sessionKey: params.sessionKey,
      verboseLevel: params.resolvedVerboseLevel,
      isHeartbeat: params.isHeartbeat,
      isControlUiVisible: shouldSurfaceToControlUi,
      turnCompletion: {
        userText: params.commandBody,
        workspaceDir: params.followupRun.run.workspaceDir,
        ...(smokeStartedAtMs != null ? { smokeStartedAtMs } : {}),
      },
    });
    host.observability.registerRunReplyLanguage(runId, params.opts?.expectedReplyLanguage ?? null);
  }

  const controlledExecution = createExecutionLifecycle(runId, host);
  assertControlledExecutionStages(controlledExecution, "Chat admitted turn");
  try {
    while (true) {
      state.commercialToolCallCount = 0;
      state.commercialToolClasses.length = 0;
      try {
        const attemptOutcome = await runAdmittedTurnAttempt({
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
        });
        if (attemptOutcome.action === "return") {
          return attemptOutcome.result;
        }
        break;
      } catch (err) {
        const recoveryOutcome = await runAdmittedTurnRecovery({
          err,
          params,
          host,
          runId,
          state,
          recordGrowthTaskOutcome,
          assertTipBudgetAllowsModelCall,
          transientHttpRetryDelayMs: TRANSIENT_HTTP_RETRY_DELAY_MS,
          softEntitlementRetryDelayMs: SOFT_ENTITLEMENT_RETRY_DELAY_MS,
        });
        if (recoveryOutcome.action === "continue") {
          continue;
        }
        return recoveryOutcome.result;
      }
    }

    // Agent Growth OS：嵌入式运行完成但结果为 context overflow 错误（无正文回复）→ 记录失败。
    const finalEmbeddedError = state.runResult?.meta?.error;
    const hasPayloadText = state.runResult?.payloads?.some((p) => p.text?.trim());
    if (
      finalEmbeddedError &&
      isContextOverflowError(finalEmbeddedError.message) &&
      !hasPayloadText
    ) {
      void recordGrowthTaskOutcome(false, {
        failureReason: "run_failed",
        failureDetail: "context_overflow",
      });
      return {
        kind: "final",
        payload: {
          text: "⚠️ Context overflow — this conversation is too large for the model. Use /new to start a fresh session.",
        },
      };
    }

    const didUseTools = state.commercialToolCallCount > 0 || outcomeRecorder.hasToolResults();
    // Defer success/failure until agent-runner classifies delivery (honest-empty /
    // abort / reaction). Same decideHonestEmptyReply drives both fallback and outcome.
    return {
      kind: "success",
      runId,
      runResult: state.runResult,
      fallbackProvider: state.fallbackProvider,
      fallbackModel: state.fallbackModel,
      fallbackAttempts: state.fallbackAttempts,
      didLogHeartbeatStrip: state.didLogHeartbeatStrip,
      autoCompactionCompleted: state.autoCompactionCompleted,
      directlySentBlockKeys: directlySentBlockKeys.size > 0 ? directlySentBlockKeys : undefined,
      didUseTools,
      commitGrowthOutcome: recordGrowthTaskOutcome,
    };
  } finally {
    await controlledExecution.dispose();
  }
}
