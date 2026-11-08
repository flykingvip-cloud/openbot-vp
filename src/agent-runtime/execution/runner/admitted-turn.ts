import crypto from "node:crypto";
import { resolveBootstrapWarningSignaturesSeen } from "../../../agents/bootstrap-budget.js";
import {
  buildCliBackendCredentialGuidance,
  isLikelyCredentialError,
} from "../../../agents/cli-backend-credential-guidance.js";
import { retryAllowedForMessage } from "../../../agents/execution-preflight/index.js";
import {
  buildModelEntitlementEmptyUserMessage,
  isModelEntitlementEmptyError,
} from "../../../agents/model-fallback.js";
import { isCliProvider } from "../../../agents/model-selection.js";
import {
  isCompactionFailureError,
  isContextOverflowError,
  isLikelyContextOverflowError,
  isTransientHttpError,
  sanitizeUserFacingText,
} from "../../../agents/pi-embedded-helpers.js";
import { userFacingPreReplyFailure } from "../../../agents/sandbox/docker-engine-client.js";
import { isSoftRecoverableEntitlementFailure } from "../../../agents/sandbox/user-facing-entitlement-failure.js";
import { stripHeartbeatToken } from "../../../auto-reply/heartbeat.js";
import { type RuntimeFallbackAttempt } from "../../../auto-reply/reply/agent-run-credit-usage.js";
import { resolveModelFallbackOptions } from "../../../auto-reply/reply/agent-runner-utils.js";
import { buildUserFacingModelCallFailure } from "../../../auto-reply/reply/model-call-failure-copy.js";
import { createReplyMediaPathNormalizer } from "../../../auto-reply/reply/reply-media-paths.js";
import {
  HEARTBEAT_TOKEN,
  isSilentReplyPrefixText,
  isSilentReplyText,
  SILENT_REPLY_TOKEN,
} from "../../../auto-reply/tokens.js";
import type { ReplyPayload } from "../../../auto-reply/types.js";
import { type CapabilityOutcomeForTurn } from "../../../gateway/model-entitlement/capability-entry-consume.js";
import { type EmployeeModelGateResult } from "../../../gateway/model-entitlement/employee-model-gate.js";
import {
  formatPlatformAdmissionEmptyMessage,
  isPlatformAdmissionEmptyError,
} from "../../../gateway/models/capability-admission/apply-runtime-admission.js";
import { logVerbose } from "../../../globals.js";
import {
  createRunCostCollector,
  snapshotRunCostPricing,
} from "../../../observation/run-cost-collector.js";
import { createRuntimeEvidenceObserver } from "../../../observation/runtime-evidence.js";
import { defaultRuntime } from "../../../runtime.js";
import {
  runnerExecutorEvidenceContext,
  TaskBudgetExceededError,
  type ModelCallCloseoutLink,
} from "../../../task-outcome/runtime-from-runner.js";
import { isInternalMessageChannel } from "../../../utils/message-channel.js";
import { createTurnOutcomeRecorder } from "../outcomes/index.js";
import { createAdmittedCandidateInvoker } from "./admitted-candidate.js";
import type { AdmittedTurnHost } from "./admitted-turn-host.js";
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
  let didLogHeartbeatStrip = false;
  let autoCompactionCompleted = false;
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
  let tipBudgetChargedThisTurn = false;
  let tipBudgetModelCallSeq = 0;
  const modelCallLinks: ModelCallCloseoutLink[] = [];
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
    tipBudgetChargedThisTurn = true;
  };
  let modelGate: EmployeeModelGateResult | undefined;
  let capabilityOutcomeForTurn: CapabilityOutcomeForTurn | undefined;
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
      tenantId: modelGate?.tenantId,
      capabilityOutcome: capabilityOutcomeForTurn,
      budgetCharged: tipBudgetChargedThisTurn,
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
  let runResult: EmbeddedPiRunResult;
  let fallbackProvider = params.followupRun.run.provider;
  let fallbackModel = params.followupRun.run.model;
  let fallbackAttempts: RuntimeFallbackAttempt[] = [];
  let didResetAfterCompactionFailure = false;
  let didRetryTransientHttpError = false;
  let didRetrySoftEntitlement = false;
  let commercialToolCallCount = 0;
  const commercialToolClasses: string[] = [];
  let bootstrapPromptWarningSignaturesSeen = resolveBootstrapWarningSignaturesSeen(
    params.getActiveSessionEntry()?.systemPromptReport,
  );

  const controlledExecution = createExecutionLifecycle(runId, host);
  assertControlledExecutionStages(controlledExecution, "Chat admitted turn");
  try {
    while (true) {
      commercialToolCallCount = 0;
      commercialToolClasses.length = 0;
      try {
        const normalizeStreamingText = (
          payload: ReplyPayload,
        ): { text?: string; skip: boolean; sanitizedEmpty?: boolean } => {
          let text = payload.text;
          if (!params.isHeartbeat && text?.includes("HEARTBEAT_OK")) {
            const stripped = stripHeartbeatToken(text, {
              mode: "message",
            });
            if (stripped.didStrip && !didLogHeartbeatStrip) {
              didLogHeartbeatStrip = true;
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
        const handlePartialForTyping = async (
          payload: ReplyPayload,
        ): Promise<string | undefined> => {
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
                collaborationGroupOwnerEntitlement:
                  params.sessionCtx.CollaborationGroupOwnerEntitlement,
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
          return { kind: "final", payload: { text: prepared.message } };
        }
        modelGate = prepared.gate;
        if (prepared.capability.capabilityOutcome) {
          capabilityOutcomeForTurn = prepared.capability.capabilityOutcome;
        }
        if (prepared.kind === "unavailable") {
          void recordGrowthTaskOutcome(false);
          return { kind: "final", payload: { text: prepared.message } };
        }
        const invokeCandidate = createAdmittedCandidateInvoker(params, runId, {
          assertOriginalTaskCurrent,
          directlySentBlockKeys,
          assertTipBudgetAllowsModelCall,
          chargeTipBudgetAfterModelCall,
          notifyAgentRunStart,
          observeExecution: (stage) => runtimeEvidence.capture(stage),
          handlePartialForTyping,
          normalizeStreamingText,
          normalizeReplyMediaPaths,
          recordGrowthToolResult: outcomeRecorder.recordToolResult,
          recordCommercialToolStart: (name) => {
            commercialToolCallCount += 1;
            commercialToolClasses.push(name);
          },
          recordModalityArtifact: (artifact) => {
            outcomeRecorder.recordArtifact(artifact);
          },
          markAutoCompactionCompleted: () => {
            autoCompactionCompleted = true;
          },
          getBootstrapWarnings: () => bootstrapPromptWarningSignaturesSeen,
          setBootstrapWarnings: (warnings) => {
            bootstrapPromptWarningSignaturesSeen = warnings;
          },
          getModelGate: () => modelGate,
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
        runResult = fallbackResult.result;
        fallbackProvider = fallbackResult.provider;
        fallbackModel = fallbackResult.model;
        fallbackAttempts = Array.isArray(fallbackResult.attempts)
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
        if (modelGate?.aorFeedback) {
          host.accounting.recordAorRunFeedback({
            banditStatePath: modelGate?.aorFeedback.banditStatePath,
            provider: fallbackResult.provider,
            model: fallbackResult.model,
            taskTypeId: modelGate?.aorFeedback.taskTypeId,
          });
        }
        // P3 收口：写入 AOR 路由解释审计日志（投影 loadAuditExplanations 读取同一文件）。
        if (modelGate?.aorRouting) {
          const selectedKey = `${fallbackResult.provider}/${fallbackResult.model}`;
          const explanation = modelGate?.aorRouting.explanationByModelId[selectedKey];
          host.accounting.recordAorRoutingExplanation({
            auditLogPath: modelGate?.aorRouting.auditLogPath,
            runId,
            taskTypeId: modelGate?.aorRouting.taskTypeId,
            strategy: modelGate?.aorRouting.strategy,
            provider: fallbackResult.provider,
            model: fallbackResult.model,
            ...(explanation ? { reason: explanation.reason, score: explanation.score } : {}),
          });
        }
        // V2 Phase 3：Credits 计量（ledger + ai_credits 用量双写）。
        if (modelGate?.creditReporting) {
          const creditUserId =
            params.sessionCtx.CollaborationGroupOwnerEntitlement?.userEmail?.trim() ||
            params.sessionCtx.CollaborationGroupOwnerEntitlement?.employeeId?.trim() ||
            params.sessionCtx.GatewayClientUser;
          void controlledExecution
            .recordUsage({
              provider: fallbackResult.provider,
              model: fallbackResult.model,
              usage: runResult.meta?.agentMeta?.usage,
              creditUserId,
              agentId: params.followupRun.run.agentId,
              durationMs: runResult.meta?.durationMs,
              toolCallCount: commercialToolCallCount,
              toolClasses: commercialToolClasses,
              fallbackAttemptsRaw: fallbackResult.attempts,
            })
            .catch((err) => {
              logVerbose(`credit usage record failed: ${String(err)}`);
            });
        }

        // Some embedded runs surface context overflow as an error payload instead of throwing.
        // Treat those as a session-level failure and auto-recover by starting a fresh session.
        const embeddedError = runResult.meta?.error;
        if (
          embeddedError &&
          isContextOverflowError(embeddedError.message) &&
          !didResetAfterCompactionFailure &&
          (await params.resetSessionAfterCompactionFailure(embeddedError.message))
        ) {
          didResetAfterCompactionFailure = true;
          return {
            kind: "final",
            payload: {
              text: "⚠️ Context limit exceeded. I've reset our conversation to start fresh - please try again.\n\nTo prevent this, increase your compaction buffer by setting `agents.defaults.compaction.reserveTokensFloor` to 20000 or higher in your config.",
            },
          };
        }
        if (embeddedError?.kind === "role_ordering") {
          const didReset = await params.resetSessionAfterRoleOrderingConflict(
            embeddedError.message,
          );
          if (didReset) {
            return {
              kind: "final",
              payload: {
                text: "⚠️ Message ordering conflict. I've reset the conversation - please try again.",
              },
            };
          }
        }

        break;
      } catch (err) {
        if (err instanceof TaskBudgetExceededError) {
          void recordGrowthTaskOutcome(false, {
            failureReason: "other",
            failureDetail: err.message.slice(0, 200),
            skipBudgetCharge: tipBudgetChargedThisTurn,
          });
          return {
            kind: "final",
            payload: {
              text: "⚠️ 任务预算已耗尽，已停止继续调用模型。请缩小范围或开新任务后再试。",
            },
          };
        }
        if (isModelEntitlementEmptyError(err)) {
          return {
            kind: "final",
            payload: {
              text: `⚠️ ${buildModelEntitlementEmptyUserMessage(modelGate?.entitlementHint)}`,
            },
          };
        }
        if (isPlatformAdmissionEmptyError(err)) {
          return {
            kind: "final",
            payload: {
              text: `⚠️ ${formatPlatformAdmissionEmptyMessage(err.decision)}`,
            },
          };
        }
        const message = err instanceof Error ? err.message : String(err);
        const isContextOverflow = isLikelyContextOverflowError(message);
        const isCompactionFailure = isCompactionFailureError(message);
        const isSessionCorruption = /function call turn comes immediately after/i.test(message);
        const isRoleOrderingError = /incorrect role information|roles must alternate/i.test(
          message,
        );
        const isTransientHttp = isTransientHttpError(message);

        // CLI 后端凭证引导（Task 10/R3.4）：失败来自 CLI 后端且像"缺失/无效 API Key"时，
        // 在对话内给出"去平台/企业控制台配置凭证"的一次性引导，绝不要求用户本机命令行登录。
        if (
          isCliProvider(fallbackProvider, params.followupRun.run.config) &&
          isLikelyCredentialError(message)
        ) {
          return {
            kind: "final",
            payload: { text: buildCliBackendCredentialGuidance(fallbackProvider) },
          };
        }

        if (
          isCompactionFailure &&
          !didResetAfterCompactionFailure &&
          (await params.resetSessionAfterCompactionFailure(message))
        ) {
          didResetAfterCompactionFailure = true;
          return {
            kind: "final",
            payload: {
              text: "⚠️ Context limit exceeded during compaction. I've reset our conversation to start fresh - please try again.\n\nTo prevent this, increase your compaction buffer by setting `agents.defaults.compaction.reserveTokensFloor` to 20000 or higher in your config.",
            },
          };
        }
        if (isRoleOrderingError) {
          const didReset = await params.resetSessionAfterRoleOrderingConflict(message);
          if (didReset) {
            return {
              kind: "final",
              payload: {
                text: "⚠️ Message ordering conflict. I've reset the conversation - please try again.",
              },
            };
          }
        }

        // Auto-recover from Gemini session corruption by resetting the session
        if (
          isSessionCorruption &&
          params.sessionKey &&
          params.activeSessionStore &&
          params.storePath
        ) {
          await host.sessions.resetCorruptedSession({
            sessionKey: params.sessionKey,
            activeSessionStore: params.activeSessionStore,
            storePath: params.storePath,
            getActiveSessionEntry: params.getActiveSessionEntry,
          });

          return {
            kind: "final",
            payload: {
              text: "⚠️ Session history was corrupted. I've reset the conversation - please try again!",
            },
          };
        }

        if (isSoftRecoverableEntitlementFailure(message) && !didRetrySoftEntitlement) {
          didRetrySoftEntitlement = true;
          // lease-mismatch / stale-snapshot: refresh and self-advance once.
          // Never ask the user to 「重新发送」as fuel for a soft runtime stop.
          defaultRuntime.error(
            `Soft entitlement stop before reply (${message}). Self-advancing once in ${SOFT_ENTITLEMENT_RETRY_DELAY_MS}ms.`,
          );
          await new Promise<void>((resolve) => {
            setTimeout(resolve, SOFT_ENTITLEMENT_RETRY_DELAY_MS);
          });
          continue;
        }

        if (isTransientHttp && !didRetryTransientHttpError && retryAllowedForMessage(message)) {
          // Pre-retry budget gate: do not spend another model call when already exhausted.
          try {
            assertTipBudgetAllowsModelCall();
          } catch (gateErr) {
            if (gateErr instanceof TaskBudgetExceededError) {
              void recordGrowthTaskOutcome(false, {
                failureReason: "other",
                failureDetail: gateErr.message.slice(0, 200),
                skipBudgetCharge: tipBudgetChargedThisTurn,
              });
              return {
                kind: "final",
                payload: {
                  text: "⚠️ 任务预算已耗尽，已停止继续调用模型。请缩小范围或开新任务后再试。",
                },
              };
            }
            throw gateErr;
          }
          didRetryTransientHttpError = true;
          // Retry the full controlledExecution prepare→infer cycle — transient errors
          // (502/521/etc.) typically affect the whole provider, so falling
          // back to an alternate model first would not help. Instead we wait
          // and retry the complete primary→fallback chain through the same
          // controlled use-case (no parallel host.model.runWithModelFallback).
          defaultRuntime.error(
            `Transient HTTP provider error before reply (${message}). Retrying once in ${TRANSIENT_HTTP_RETRY_DELAY_MS}ms.`,
          );
          await new Promise<void>((resolve) => {
            setTimeout(resolve, TRANSIENT_HTTP_RETRY_DELAY_MS);
          });
          continue;
        }

        defaultRuntime.error(`Embedded agent failed before reply: ${message}`);
        const dockerFailure = userFacingPreReplyFailure(message);
        const isInfraStartupFailure =
          dockerFailure != null ||
          /EEXIST|Requested model .+ not supported|workspace_authorization_failed/i.test(message);
        const safeMessage = isTransientHttp
          ? sanitizeUserFacingText(message, { errorContext: true })
          : message;
        const trimmedMessage = safeMessage.replace(/\.\s*$/, "");
        const modelCallFailure = buildUserFacingModelCallFailure(
          message,
          params.opts?.expectedReplyLanguage,
        );
        const fallbackText = modelCallFailure
          ? `⚠️ ${modelCallFailure}`
          : dockerFailure
            ? dockerFailure
            : isContextOverflow
              ? "⚠️ Context overflow — prompt too large for this model. Try a shorter message or a larger-context model."
              : isRoleOrderingError
                ? "⚠️ Message ordering conflict - please try again. If this persists, use /new to start a fresh session."
                : isInfraStartupFailure
                  ? "这一轮没能完成回复。请再试一次，或 @ 对应助手。"
                  : `⚠️ Agent failed before reply: ${trimmedMessage}.\nLogs: openbot logs --follow`;

        void recordGrowthTaskOutcome(false, {
          aborted: Boolean(params.opts?.abortSignal?.aborted),
          providerFault: isTransientHttp || isInfraStartupFailure,
          prepareFailed: isInfraStartupFailure,
          errorMessage: message,
          failureDetail: trimmedMessage.slice(0, 200),
        });
        if (!params.opts?.abortSignal?.aborted && !isInfraStartupFailure && !isTransientHttp) {
          try {
            host.observability.recordHonestCapabilityGap({
              runId,
              agentId: params.followupRun.run.agentId ?? null,
              tenantId: modelGate?.tenantId?.trim() || null,
              sessionKey: params.followupRun.run.sessionKey ?? null,
              chatType: params.sessionCtx.ChatType ?? null,
              reason: isContextOverflow ? "context_overflow" : "unresolved_run_error",
              category: isContextOverflow ? "perception" : "tool",
              detail: trimmedMessage.slice(0, 160),
              userLanguageSummary: fallbackText.slice(0, 160),
              sourceKind: "run_error",
            });
          } catch {
            // evolution store must never fail the reply
          }
        }
        return {
          kind: "final",
          payload: {
            text: fallbackText,
          },
        };
      }
    }

    // Agent Growth OS：嵌入式运行完成但结果为 context overflow 错误（无正文回复）→ 记录失败。
    const finalEmbeddedError = runResult?.meta?.error;
    const hasPayloadText = runResult?.payloads?.some((p) => p.text?.trim());
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

    const didUseTools = commercialToolCallCount > 0 || outcomeRecorder.hasToolResults();
    // Defer success/failure until agent-runner classifies delivery (honest-empty /
    // abort / reaction). Same decideHonestEmptyReply drives both fallback and outcome.
    return {
      kind: "success",
      runId,
      runResult,
      fallbackProvider,
      fallbackModel,
      fallbackAttempts,
      didLogHeartbeatStrip,
      autoCompactionCompleted,
      directlySentBlockKeys: directlySentBlockKeys.size > 0 ? directlySentBlockKeys : undefined,
      didUseTools,
      commitGrowthOutcome: recordGrowthTaskOutcome,
    };
  } finally {
    await controlledExecution.dispose();
  }
}
