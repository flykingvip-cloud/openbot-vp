import crypto from "node:crypto";
import fs from "node:fs";
import { resolveBootstrapWarningSignaturesSeen } from "../../agents/bootstrap-budget.js";
import {
  buildCliBackendCredentialGuidance,
  isLikelyCredentialError,
} from "../../agents/cli-backend-credential-guidance.js";
import { resolveCredentialForRun } from "../../agents/cli-backend-credential-resolve.js";
import { recordCliBackendUsage } from "../../agents/cli-backend-usage-attribution.js";
import { runCliAgent } from "../../agents/cli-runner.js";
import { getCliSessionId } from "../../agents/cli-session.js";
import { resolveEmbeddedModelGovernance } from "../../agents/embedded-model-governance.js";
import { retryAllowedForMessage } from "../../agents/execution-preflight/index.js";
import {
  buildModelEntitlementEmptyUserMessage,
  isModelEntitlementEmptyError,
  runWithModelFallback,
} from "../../agents/model-fallback.js";
import { isCliProvider } from "../../agents/model-selection.js";
import {
  isCompactionFailureError,
  isContextOverflowError,
  isLikelyContextOverflowError,
  isTransientHttpError,
  sanitizeUserFacingText,
} from "../../agents/pi-embedded-helpers.js";
import { runEmbeddedPiAgent } from "../../agents/pi-embedded.js";
import { userFacingPreReplyFailure } from "../../agents/sandbox/docker-engine-client.js";
import { isSoftRecoverableEntitlementFailure } from "../../agents/sandbox/user-facing-entitlement-failure.js";
import { noteSkillSmokeClock } from "../../agents/turn-completion/contract.js";
import { normalizeUsage } from "../../agents/usage.js";
import {
  resolveGroupSessionKey,
  resolveSessionTranscriptPath,
  type SessionEntry,
  updateSessionStore,
} from "../../config/sessions.js";
import { createConversationTurnToolObserver } from "../../conversation-task/ledger-binding.js";
import { defaultShadowStoreRoot } from "../../conversation-task/runtime-bootstrap.js";
import { resolveCronStorePath } from "../../cron/store.js";
import { syncRobotGrowthFromOperationalMetrics } from "../../gateway/agent-growth/operational-growth.js";
import { recordRunOutcome } from "../../gateway/agent-growth/operational-metrics-store.js";
import {
  releaseEnterpriseAgentRun,
  tryAcquireEnterpriseAgentRun,
} from "../../gateway/billing/agent-run-governance.js";
import { recordCreditUsage } from "../../gateway/billing/record-credit-usage.js";
import { emitChatInboundStage } from "../../gateway/chat-inbound-stage-events.js";
import { reportEvolutionOutcomeWriteFailure } from "../../gateway/evolution-control/evolution-loop-log.js";
import { inheritExecutionIdentityRunFields } from "../../gateway/execution-identity-context.js";
import {
  buildRunModelSetSnapshot,
  forgetRunModelSet,
  rememberRunModelSet,
  snapshotCreditReportingFromGate,
} from "../../gateway/governance/spawn-snapshot-handoff.js";
import {
  recordAorRoutingExplanation,
  recordAorRunFeedback,
} from "../../gateway/model-entitlement/aor-feedback.js";
import { type EmployeeModelGateResult } from "../../gateway/model-entitlement/employee-model-gate.js";
import { resolveAgentRunEntitlementScope } from "../../gateway/model-entitlement/resolve-agent-run-scope.js";
import { logVerbose } from "../../globals.js";
import { emitAgentEvent, registerAgentRunContext } from "../../infra/agent-events.js";
import { defaultRuntime } from "../../runtime.js";
import { registerRunReplyLanguage } from "../../shared/text/run-reply-language.js";
import {
  isMarkdownCapableMessageChannel,
  resolveMessageChannel,
} from "../../utils/message-channel.js";
import { isInternalMessageChannel } from "../../utils/message-channel.js";
import { stripHeartbeatToken } from "../heartbeat.js";
import type { TemplateContext } from "../templating.js";
import type { VerboseLevel } from "../thinking.js";
import {
  HEARTBEAT_TOKEN,
  isSilentReplyPrefixText,
  isSilentReplyText,
  SILENT_REPLY_TOKEN,
} from "../tokens.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import {
  buildCommercialRunCreditUsageInput,
  type RuntimeFallbackAttempt,
} from "./agent-run-credit-usage.js";
import {
  buildEmbeddedRunBaseParams,
  buildEmbeddedRunContexts,
  resolveModelFallbackOptions,
} from "./agent-runner-utils.js";
import { type BlockReplyPipeline } from "./block-reply-pipeline.js";
import { recordHonestCapabilityGap } from "./honest-empty-reply.js";
import type { FollowupRun } from "./queue.js";
import { createBlockReplyDeliveryHandler } from "./reply-delivery.js";
import { createReplyMediaPathNormalizer } from "./reply-media-paths.js";
import type { TypingSignaler } from "./typing-mode.js";

export type { RuntimeFallbackAttempt } from "./agent-run-credit-usage.js";

export type AgentRunLoopResult =
  | {
      kind: "success";
      runId: string;
      runResult: Awaited<ReturnType<typeof runEmbeddedPiAgent>>;
      fallbackProvider?: string;
      fallbackModel?: string;
      fallbackAttempts: RuntimeFallbackAttempt[];
      didLogHeartbeatStrip: boolean;
      autoCompactionCompleted: boolean;
      /** Payload keys sent directly (not via pipeline) during tool flush. */
      directlySentBlockKeys?: Set<string>;
      /** True when this turn already invoked tools. Empty Layer C may then emit a process sentence. */
      didUseTools?: boolean;
      /**
       * Commit growth/operational outcome after delivery classification.
       * Must be called exactly once on the success path (agent-runner).
       */
      commitGrowthOutcome: (success: boolean) => void;
    }
  | { kind: "final"; payload: ReplyPayload };

export async function runAgentTurnWithFallback(params: {
  commandBody: string;
  followupRun: FollowupRun;
  sessionCtx: TemplateContext;
  opts?: GetReplyOptions;
  typingSignals: TypingSignaler;
  blockReplyPipeline: BlockReplyPipeline | null;
  blockStreamingEnabled: boolean;
  blockReplyChunking?: {
    minChars: number;
    maxChars: number;
    breakPreference: "paragraph" | "newline" | "sentence";
    flushOnParagraph?: boolean;
  };
  resolvedBlockStreamingBreak: "text_end" | "message_end";
  applyReplyToMode: (payload: ReplyPayload) => ReplyPayload;
  shouldEmitToolResult: () => boolean;
  shouldEmitToolOutput: () => boolean;
  pendingToolTasks: Set<Promise<void>>;
  resetSessionAfterCompactionFailure: (reason: string) => Promise<boolean>;
  resetSessionAfterRoleOrderingConflict: (reason: string) => Promise<boolean>;
  isHeartbeat: boolean;
  sessionKey?: string;
  getActiveSessionEntry: () => SessionEntry | undefined;
  activeSessionStore?: Record<string, SessionEntry>;
  storePath?: string;
  resolvedVerboseLevel: VerboseLevel;
}): Promise<AgentRunLoopResult> {
  const TRANSIENT_HTTP_RETRY_DELAY_MS = 2_500;
  const SOFT_ENTITLEMENT_RETRY_DELAY_MS = 400;
  let didLogHeartbeatStrip = false;
  let autoCompactionCompleted = false;
  // Track payloads sent directly (not via pipeline) during tool flush to avoid duplicates.
  const directlySentBlockKeys = new Set<string>();

  const runId = params.opts?.runId ?? crypto.randomUUID();
  // Agent Growth OS（P2 12.x）：记录任务结果到运营指标累加器（fire-and-forget，绝不影响回复）。
  // 心跳不算任务；turn 级成功/失败作为 operationalScore 的 v1 task 信号。
  //
  // 工具成功率（0.30 权重）在 turn 内内存累加、收尾时一次落盘，避免逐次工具调用写盘。
  let growthToolTotal = 0;
  let growthToolSucceeded = 0;
  const growthStartedAt = Date.now();
  let modelGate: EmployeeModelGateResult = {};
  const recordGrowthToolResult = (isError: boolean): void => {
    growthToolTotal += 1;
    if (!isError) {
      growthToolSucceeded += 1;
    }
  };
  const recordGrowthTaskOutcome = (success: boolean): void => {
    if (params.isHeartbeat) {
      return;
    }
    const growthAgentId = params.followupRun.run.agentId;
    if (!growthAgentId) {
      return;
    }
    const toolsTotal = growthToolTotal;
    const toolsSucceeded = growthToolSucceeded;
    growthToolTotal = 0;
    growthToolSucceeded = 0;
    const tenantId = modelGate.tenantId?.trim();
    void recordRunOutcome(params.followupRun.run.config, growthAgentId, {
      success,
      toolsTotal,
      toolsSucceeded,
      runId,
      latencyMs: Math.max(0, Date.now() - growthStartedAt),
      ...(tenantId ? { tenantId } : {}),
    })
      .then(() =>
        syncRobotGrowthFromOperationalMetrics(params.followupRun.run.config, growthAgentId),
      )
      .catch((error: unknown) => {
        // Evolution sample write must stay observable. The user-facing task
        // outcome is already decided and is not rewritten here.
        reportEvolutionOutcomeWriteFailure({
          runId,
          agentId: growthAgentId,
          tenantId: tenantId ?? null,
          taskId: null,
          reason: error instanceof Error ? error.message : "evolution_outcome_write_failed",
        });
      });
  };
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
    const smokeStartedAtMs = noteSkillSmokeClock({
      sessionKey: params.sessionKey,
      userText: params.commandBody,
      nowMs: Date.now(),
    });
    registerAgentRunContext(runId, {
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
    registerRunReplyLanguage(runId, params.opts?.expectedReplyLanguage ?? null);
  }
  let runResult: Awaited<ReturnType<typeof runEmbeddedPiAgent>>;
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

  let enterpriseRunSlotHeld = false;
  let commercialAuthDecisionId: string | undefined;
  let commercialSubscriptionId: string | undefined;
  let commercialPlanId: string | undefined;
  let commercialPlanVersionId: string | undefined;
  let commercialSubscriptionSnapshotId: string | undefined;
  try {
    while (true) {
      commercialToolCallCount = 0;
      commercialToolClasses.length = 0;
      try {
        const normalizeStreamingText = (
          payload: ReplyPayload,
        ): { text?: string; skip: boolean } => {
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
            return { skip: true };
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
        const blockReplyPipeline = params.blockReplyPipeline;
        const onToolResult = params.opts?.onToolResult;
        const runGatewayClientUser =
          params.followupRun.run.gatewayClientUser ?? params.sessionCtx.GatewayClientUser;
        const runGatewayClientSessionDomain =
          params.followupRun.run.gatewayClientSessionDomain ??
          params.sessionCtx.GatewayClientSessionDomain;
        const runGatewayClientPlatformUserId =
          params.followupRun.run.gatewayClientPlatformUserId ??
          params.sessionCtx.GatewayClientPlatformUserId;
        // Commercial Runtime 统一闸口（P0）：model gate + 并发占槽 + 订阅 snapshot。
        const modelGateInput = {
          cfg: params.followupRun.run.config,
          agentId: params.followupRun.run.agentId,
          gatewayClientUser: runGatewayClientUser,
          gatewayClientSessionDomain: runGatewayClientSessionDomain,
          gatewayClientPlatformUserId: runGatewayClientPlatformUserId,
          ...(params.sessionCtx.CollaborationGroupOwnerEntitlement
            ? {
                collaborationGroupOwnerEntitlement:
                  params.sessionCtx.CollaborationGroupOwnerEntitlement,
              }
            : {}),
        };
        if (!enterpriseRunSlotHeld) {
          const collaborationGroupId = params.sessionCtx.CollaborationGroupId?.trim();
          const runSlot = await tryAcquireEnterpriseAgentRun({
            runId,
            agentId: params.followupRun.run.agentId,
            ...(collaborationGroupId ? { groupId: collaborationGroupId } : {}),
            modelGateInput,
          });
          if (!runSlot.skipped && !runSlot.acquired) {
            recordGrowthTaskOutcome(false);
            return {
              kind: "final",
              payload: {
                text: runSlot.message,
              },
            };
          }
          if (runSlot.acquired) {
            if (runSlot.modelGate) {
              modelGate = runSlot.modelGate;
            }
            enterpriseRunSlotHeld = true;
            commercialAuthDecisionId = runSlot.authorizationDecisionId;
            commercialSubscriptionId = runSlot.subscriptionId;
            commercialPlanId = runSlot.planId;
            commercialPlanVersionId = runSlot.planVersionId;
            commercialSubscriptionSnapshotId = runSlot.subscriptionSnapshotId;
          }
        }
        const actorId = runGatewayClientPlatformUserId?.trim()
          ? `platform-user:${runGatewayClientPlatformUserId.trim()}`
          : undefined;
        // P3-1: explicit mode (default shadow) + preexisting hard-filter when allowlist is an array.
        const embeddedModelGovernance = resolveEmbeddedModelGovernance({
          gateStatus: enterpriseRunSlotHeld ? "acquired" : "skipped",
          allowlist: modelGate.allowlist,
          tenantId: modelGate.tenantId,
          commercialAuthorizationId: commercialAuthDecisionId,
          actorId,
        });
        const parentSnapshot = buildRunModelSetSnapshot({
          runId,
          allowlist: modelGate.allowlist,
          governanceMode: embeddedModelGovernance.governanceMode,
          commercialAuthorizationId: commercialAuthDecisionId,
          tenantId: modelGate.tenantId,
          actorId,
          preferredModelOrder: modelGate.preferredModelOrder,
          // P4-1: parent billing context for child runs, only while this run holds the gate.
          creditReporting: enterpriseRunSlotHeld
            ? snapshotCreditReportingFromGate({
                modelGate,
                subscriptionId: commercialSubscriptionId,
                subscriptionSnapshotId: commercialSubscriptionSnapshotId,
                planId: commercialPlanId,
                planVersionId: commercialPlanVersionId,
              })
            : undefined,
        });
        if (parentSnapshot) {
          rememberRunModelSet(runId, parentSnapshot);
        }
        const fallbackResult = await runWithModelFallback({
          ...resolveModelFallbackOptions(params.followupRun.run),
          ...embeddedModelGovernance,
          ...(modelGate.preferredModelOrder
            ? { preferredModelOrder: modelGate.preferredModelOrder }
            : {}),
          runId,
          run: (provider, model, runOptions) => {
            // Notify that model selection is complete (including after fallback).
            // This allows responsePrefix template interpolation with the actual model.
            params.opts?.onModelSelected?.({
              provider,
              model,
              thinkLevel: params.followupRun.run.thinkLevel,
            });

            if (isCliProvider(provider, params.followupRun.run.config)) {
              const startedAt = Date.now();
              notifyAgentRunStart();
              emitAgentEvent({
                runId,
                stream: "lifecycle",
                data: {
                  phase: "start",
                  startedAt,
                  entrypoint: "cli",
                },
              });
              const cliSessionId = getCliSessionId(params.getActiveSessionEntry(), provider);
              return (async () => {
                // CLI 后端凭证桥（cli-backend-onboarding Task 6/9）：按 bot 归属席位解析企业作用域，
                // 选取个人/企业凭证并解析其 SecretRef，作为 per-run env 注入子进程；同时捕获
                // credentialId + tenant/user 供执行完成后写 UsageAttribution（chargeback 依据）。
                // fail-safe：任一环节失败 → undefined → 回退主机默认 env（零回归）。值绝不记日志。
                let credentialEnv: Record<string, string> | undefined;
                let usageAttr:
                  | { tenantId: string; userId: string; credentialId: string }
                  | undefined;
                try {
                  const credScope = await resolveAgentRunEntitlementScope({
                    agentId: params.followupRun.run.agentId,
                  });
                  if (credScope) {
                    const resolved = await resolveCredentialForRun({
                      backendId: provider,
                      model,
                      scope: {
                        tenantId: credScope.tenantId,
                        subjectId: credScope.employeeId ?? credScope.seatId,
                      },
                      config: params.followupRun.run.config,
                    });
                    if (resolved) {
                      credentialEnv = resolved.env;
                      usageAttr = {
                        tenantId: credScope.tenantId,
                        userId:
                          credScope.employeeId ??
                          credScope.seatId ??
                          params.sessionCtx.GatewayClientUser ??
                          "",
                        credentialId: resolved.credentialId,
                      };
                    }
                  }
                } catch {
                  credentialEnv = undefined;
                  usageAttr = undefined;
                }
                let lifecycleTerminalEmitted = false;
                try {
                  const result = await runCliAgent({
                    sessionId: params.followupRun.run.sessionId,
                    sessionKey: params.sessionKey,
                    agentId: params.followupRun.run.agentId,
                    sessionFile: params.followupRun.run.sessionFile,
                    workspaceDir: params.followupRun.run.workspaceDir,
                    config: params.followupRun.run.config,
                    prompt: params.commandBody,
                    provider,
                    model,
                    thinkLevel: params.followupRun.run.thinkLevel,
                    timeoutMs: params.followupRun.run.timeoutMs,
                    runId,
                    extraSystemPrompt: params.followupRun.run.extraSystemPrompt,
                    ownerNumbers: params.followupRun.run.ownerNumbers,
                    cliSessionId,
                    bootstrapPromptWarningSignaturesSeen,
                    bootstrapPromptWarningSignature:
                      bootstrapPromptWarningSignaturesSeen[
                        bootstrapPromptWarningSignaturesSeen.length - 1
                      ],
                    images: params.opts?.images,
                    credentialEnv,
                  });
                  bootstrapPromptWarningSignaturesSeen = resolveBootstrapWarningSignaturesSeen(
                    result.meta?.systemPromptReport,
                  );

                  // CLI backends don't emit streaming assistant events, so we need to
                  // emit one with the final text so server-chat can populate its buffer
                  // and send the response to TUI/WebSocket clients.
                  const cliText = result.payloads?.[0]?.text?.trim();
                  if (cliText) {
                    emitAgentEvent({
                      runId,
                      stream: "assistant",
                      data: { text: cliText },
                    });
                  }

                  emitAgentEvent({
                    runId,
                    stream: "lifecycle",
                    data: {
                      phase: "end",
                      startedAt,
                      endedAt: Date.now(),
                      entrypoint: "cli",
                    },
                  });
                  lifecycleTerminalEmitted = true;

                  // UsageAttribution（Task 9/R9.1）：执行完成后 best-effort 记录归因
                  // {tenant,user,backend,credential,model,execution}，供 chargeback；
                  // 仅在实际选中凭证时写，凭证以 id 记录（无明文），失败不影响回复。
                  if (usageAttr) {
                    void recordCliBackendUsage({
                      tenantId: usageAttr.tenantId,
                      userId: usageAttr.userId,
                      backendId: provider,
                      credentialId: usageAttr.credentialId,
                      model,
                      executionId: runId,
                    });
                  }

                  return result;
                } catch (err) {
                  emitAgentEvent({
                    runId,
                    stream: "lifecycle",
                    data: {
                      phase: "error",
                      startedAt,
                      endedAt: Date.now(),
                      error: String(err),
                      entrypoint: "cli",
                    },
                  });
                  lifecycleTerminalEmitted = true;
                  throw err;
                } finally {
                  // Defensive backstop: never let a CLI run complete without a terminal
                  // lifecycle event, otherwise downstream consumers can hang.
                  if (!lifecycleTerminalEmitted) {
                    emitAgentEvent({
                      runId,
                      stream: "lifecycle",
                      data: {
                        phase: "error",
                        startedAt,
                        endedAt: Date.now(),
                        error: "CLI run completed without lifecycle terminal event",
                        entrypoint: "cli",
                      },
                    });
                  }
                }
              })();
            }
            const { authProfile, embeddedContext, senderContext } = buildEmbeddedRunContexts({
              run: params.followupRun.run,
              sessionCtx: params.sessionCtx,
              hasRepliedRef: params.opts?.hasRepliedRef,
              provider,
            });
            const runBaseParams = buildEmbeddedRunBaseParams({
              run: params.followupRun.run,
              provider,
              model,
              runId,
              authProfile,
              allowTransientCooldownProbe: runOptions?.allowTransientCooldownProbe,
            });
            return (async () => {
              const modelStartedAtMs = Date.now();
              let firstTokenEmitted = false;
              const emitModelStage = (
                stage: "model_started" | "first_token" | "model_finished" | "assistant_persisted",
                extra?: Record<string, unknown>,
              ) => {
                if (params.isHeartbeat) {
                  return;
                }
                emitChatInboundStage({
                  runId,
                  stage,
                  sessionKey: params.sessionKey,
                  extra,
                });
              };
              const emitFirstToken = () => {
                if (firstTokenEmitted) {
                  return;
                }
                firstTokenEmitted = true;
                emitModelStage("first_token", { modelTtftMs: Date.now() - modelStartedAtMs });
              };
              emitModelStage("model_started");
              const conversationToolObserver = createConversationTurnToolObserver({
                isHeartbeat: params.isHeartbeat,
                sessionKey: params.sessionKey,
                commandBody: params.commandBody,
                sessionCtx: params.sessionCtx,
                tenantId:
                  params.followupRun.run.executionIdentity?.enterpriseId ??
                  params.followupRun.run.executionIdentity?.collaborationOwnerEntitlement
                    ?.tenantId ??
                  params.sessionCtx.GatewayClientSessionEnterpriseId ??
                  params.sessionCtx.CollaborationTenantId ??
                  modelGate.tenantId ??
                  null,
                storeRoot: defaultShadowStoreRoot(),
                cronStorePath: resolveCronStorePath(params.followupRun.run.config.cron?.store),
              });
              try {
                const result = await runEmbeddedPiAgent({
                  ...embeddedContext,
                  trigger: params.isHeartbeat ? "heartbeat" : "user",
                  groupId: resolveGroupSessionKey(params.sessionCtx)?.id,
                  groupChannel:
                    params.sessionCtx.GroupChannel?.trim() ??
                    params.sessionCtx.GroupSubject?.trim(),
                  groupSpace: params.sessionCtx.GroupSpace?.trim() ?? undefined,
                  ...senderContext,
                  ...runBaseParams,
                  ...inheritExecutionIdentityRunFields({
                    ...params.followupRun.run,
                    gatewayClientUser: runGatewayClientUser,
                    gatewayClientSessionDomain: runGatewayClientSessionDomain,
                    gatewayClientPlatformUserId: runGatewayClientPlatformUserId,
                  }),
                  prompt: params.commandBody,
                  extraSystemPrompt: params.followupRun.run.extraSystemPrompt,
                  toolResultFormat: (() => {
                    const channel = resolveMessageChannel(
                      params.sessionCtx.Surface,
                      params.sessionCtx.Provider,
                    );
                    if (!channel) {
                      return "markdown";
                    }
                    return isMarkdownCapableMessageChannel(channel) ? "markdown" : "plain";
                  })(),
                  suppressToolErrorWarnings: params.opts?.suppressToolErrorWarnings,
                  bootstrapContextMode: params.opts?.bootstrapContextMode,
                  bootstrapContextRunKind: params.opts?.isHeartbeat ? "heartbeat" : "default",
                  images: params.opts?.images,
                  abortSignal: params.opts?.abortSignal,
                  blockReplyBreak: params.resolvedBlockStreamingBreak,
                  blockReplyChunking: params.blockReplyChunking,
                  onPartialReply: async (payload) => {
                    const textForTyping = await handlePartialForTyping(payload);
                    if (textForTyping !== undefined) {
                      emitFirstToken();
                    }
                    if (!params.opts?.onPartialReply || textForTyping === undefined) {
                      return;
                    }
                    await params.opts.onPartialReply({
                      text: textForTyping,
                      mediaUrls: payload.mediaUrls,
                    });
                  },
                  onAssistantMessageStart: async () => {
                    emitFirstToken();
                    await params.typingSignals.signalMessageStart();
                    await params.opts?.onAssistantMessageStart?.();
                  },
                  onReasoningStream:
                    params.typingSignals.shouldStartOnReasoning || params.opts?.onReasoningStream
                      ? async (payload) => {
                          await params.typingSignals.signalReasoningDelta();
                          await params.opts?.onReasoningStream?.({
                            text: payload.text,
                            mediaUrls: payload.mediaUrls,
                          });
                        }
                      : undefined,
                  onReasoningEnd: params.opts?.onReasoningEnd,
                  onAgentEvent: async (evt) => {
                    // Tool stream only. Does not write assistant text into the ledger.
                    conversationToolObserver?.(evt);
                    // Signal run start only after the embedded agent emits real activity.
                    const hasLifecyclePhase =
                      evt.stream === "lifecycle" && typeof evt.data.phase === "string";
                    if (evt.stream !== "lifecycle" || hasLifecyclePhase) {
                      notifyAgentRunStart();
                    }
                    // Trigger typing when tools start executing.
                    // Must await to ensure typing indicator starts before tool summaries are emitted.
                    if (evt.stream === "tool") {
                      const phase = typeof evt.data.phase === "string" ? evt.data.phase : "";
                      const name = typeof evt.data.name === "string" ? evt.data.name : undefined;
                      if (phase === "start" || phase === "update") {
                        await params.typingSignals.signalToolStart();
                        await params.opts?.onToolStart?.({ name, phase });
                      }
                      if (phase === "start" && name) {
                        commercialToolCallCount += 1;
                        commercialToolClasses.push(name);
                      }
                      // Agent Growth OS：工具成功率信号源（此前 recordToolOutcome 无任何调用方）。
                      if (phase === "result") {
                        recordGrowthToolResult(evt.data.isError === true);
                      }
                    }
                    // Track auto-compaction completion
                    if (evt.stream === "compaction") {
                      const phase = typeof evt.data.phase === "string" ? evt.data.phase : "";
                      if (phase === "end") {
                        autoCompactionCompleted = true;
                      }
                    }
                  },
                  // Always pass onBlockReply so flushBlockReplyBuffer works before tool execution,
                  // even when regular block streaming is disabled. The handler sends directly
                  // via opts.onBlockReply when the pipeline isn't available.
                  onBlockReply: params.opts?.onBlockReply
                    ? createBlockReplyDeliveryHandler({
                        onBlockReply: params.opts.onBlockReply,
                        currentMessageId:
                          params.sessionCtx.MessageSidFull ?? params.sessionCtx.MessageSid,
                        normalizeStreamingText,
                        applyReplyToMode: params.applyReplyToMode,
                        normalizeMediaPaths: normalizeReplyMediaPaths,
                        typingSignals: params.typingSignals,
                        blockStreamingEnabled: params.blockStreamingEnabled,
                        blockReplyPipeline,
                        directlySentBlockKeys,
                      })
                    : undefined,
                  onBlockReplyFlush:
                    params.blockStreamingEnabled && blockReplyPipeline
                      ? async () => {
                          await blockReplyPipeline.flush({ force: true });
                        }
                      : undefined,
                  onBlockReplyDiscard: blockReplyPipeline
                    ? () => {
                        blockReplyPipeline.discardPending();
                      }
                    : undefined,
                  shouldEmitToolResult: params.shouldEmitToolResult,
                  shouldEmitToolOutput: params.shouldEmitToolOutput,
                  bootstrapPromptWarningSignaturesSeen,
                  bootstrapPromptWarningSignature:
                    bootstrapPromptWarningSignaturesSeen[
                      bootstrapPromptWarningSignaturesSeen.length - 1
                    ],
                  onToolResult: onToolResult
                    ? (() => {
                        // Serialize tool result delivery to preserve message ordering.
                        // Without this, concurrent tool callbacks race through typing signals
                        // and message sends, causing out-of-order delivery to the user.
                        // See: https://github.com/openclaw/openclaw/issues/11044
                        let toolResultChain: Promise<void> = Promise.resolve();
                        return (payload: ReplyPayload) => {
                          toolResultChain = toolResultChain
                            .then(async () => {
                              const { text, skip } = normalizeStreamingText(payload);
                              if (skip) {
                                return;
                              }
                              await params.typingSignals.signalTextDelta(text);
                              await onToolResult({
                                ...payload,
                                text,
                              });
                            })
                            .catch((err) => {
                              // Keep chain healthy after an error so later tool results still deliver.
                              logVerbose(`tool result delivery failed: ${String(err)}`);
                            });
                          const task = toolResultChain.finally(() => {
                            params.pendingToolTasks.delete(task);
                          });
                          params.pendingToolTasks.add(task);
                        };
                      })()
                    : undefined,
                });
                bootstrapPromptWarningSignaturesSeen = resolveBootstrapWarningSignaturesSeen(
                  result.meta?.systemPromptReport,
                );
                emitModelStage("model_finished", {
                  modelMs: Date.now() - modelStartedAtMs,
                  ok: true,
                });
                emitModelStage("assistant_persisted", { source: "session_manager" });
                return result;
              } catch (err) {
                emitModelStage("model_finished", {
                  modelMs: Date.now() - modelStartedAtMs,
                  ok: false,
                });
                throw err;
              }
            })();
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
        if (modelGate.aorFeedback) {
          recordAorRunFeedback({
            banditStatePath: modelGate.aorFeedback.banditStatePath,
            provider: fallbackResult.provider,
            model: fallbackResult.model,
            taskTypeId: modelGate.aorFeedback.taskTypeId,
          });
        }
        // P3 收口：写入 AOR 路由解释审计日志（投影 loadAuditExplanations 读取同一文件）。
        if (modelGate.aorRouting) {
          const selectedKey = `${fallbackResult.provider}/${fallbackResult.model}`;
          const explanation = modelGate.aorRouting.explanationByModelId[selectedKey];
          recordAorRoutingExplanation({
            auditLogPath: modelGate.aorRouting.auditLogPath,
            runId,
            taskTypeId: modelGate.aorRouting.taskTypeId,
            strategy: modelGate.aorRouting.strategy,
            provider: fallbackResult.provider,
            model: fallbackResult.model,
            ...(explanation ? { reason: explanation.reason, score: explanation.score } : {}),
          });
        }
        // V2 Phase 3：Credits 计量（ledger + ai_credits 用量双写）。
        if (modelGate.creditReporting) {
          const tokenUsage = normalizeUsage(runResult.meta?.agentMeta?.usage);
          const creditUserId =
            params.sessionCtx.CollaborationGroupOwnerEntitlement?.userEmail?.trim() ||
            params.sessionCtx.CollaborationGroupOwnerEntitlement?.employeeId?.trim() ||
            params.sessionCtx.GatewayClientUser;
          void recordCreditUsage(
            buildCommercialRunCreditUsageInput({
              enterpriseId: modelGate.creditReporting.enterpriseId,
              policyId: modelGate.creditReporting.policyId,
              runId,
              provider: fallbackResult.provider,
              model: fallbackResult.model,
              creditUserId,
              agentId: params.followupRun.run.agentId,
              authorizationDecisionId: commercialAuthDecisionId,
              subscriptionId: commercialSubscriptionId,
              planId: commercialPlanId,
              planVersionId: commercialPlanVersionId,
              subscriptionSnapshotId: commercialSubscriptionSnapshotId,
              durationMs: runResult.meta?.durationMs,
              toolCallCount: commercialToolCallCount,
              toolClasses: commercialToolClasses,
              fallbackAttemptsRaw: fallbackResult.attempts,
              tokenUsage,
            }),
          ).catch((err) => {
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
        if (isModelEntitlementEmptyError(err)) {
          return {
            kind: "final",
            payload: {
              text: `⚠️ ${buildModelEntitlementEmptyUserMessage(modelGate.entitlementHint)}`,
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
          const sessionKey = params.sessionKey;
          const corruptedSessionId = params.getActiveSessionEntry()?.sessionId;
          defaultRuntime.error(
            `Session history corrupted (Gemini function call ordering). Resetting session: ${params.sessionKey}`,
          );

          try {
            // Delete transcript file if it exists
            if (corruptedSessionId) {
              const transcriptPath = resolveSessionTranscriptPath(corruptedSessionId);
              try {
                fs.unlinkSync(transcriptPath);
              } catch {
                // Ignore if file doesn't exist
              }
            }

            // Keep the in-memory snapshot consistent with the on-disk store reset.
            delete params.activeSessionStore[sessionKey];

            // Remove session entry from store using a fresh, locked snapshot.
            await updateSessionStore(params.storePath, (store) => {
              delete store[sessionKey];
            });
          } catch (cleanupErr) {
            defaultRuntime.error(
              `Failed to reset corrupted session ${params.sessionKey}: ${String(cleanupErr)}`,
            );
          }

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
          didRetryTransientHttpError = true;
          // Retry the full runWithModelFallback() cycle — transient errors
          // (502/521/etc.) typically affect the whole provider, so falling
          // back to an alternate model first would not help. Instead we wait
          // and retry the complete primary→fallback chain.
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
        const fallbackText = dockerFailure
          ? dockerFailure
          : isContextOverflow
            ? "⚠️ Context overflow — prompt too large for this model. Try a shorter message or a larger-context model."
            : isRoleOrderingError
              ? "⚠️ Message ordering conflict - please try again. If this persists, use /new to start a fresh session."
              : isInfraStartupFailure
                ? "这一轮没能完成回复。请再试一次，或 @ 对应助手。"
                : `⚠️ Agent failed before reply: ${trimmedMessage}.\nLogs: openbot logs --follow`;

        recordGrowthTaskOutcome(false);
        if (!params.opts?.abortSignal?.aborted && !isInfraStartupFailure && !isTransientHttp) {
          try {
            recordHonestCapabilityGap({
              runId,
              agentId: params.followupRun.run.agentId ?? null,
              tenantId: modelGate.tenantId?.trim() || null,
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
      recordGrowthTaskOutcome(false);
      return {
        kind: "final",
        payload: {
          text: "⚠️ Context overflow — this conversation is too large for the model. Use /new to start a fresh session.",
        },
      };
    }

    const didUseTools = commercialToolCallCount > 0 || growthToolTotal > 0;
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
    if (enterpriseRunSlotHeld) {
      void releaseEnterpriseAgentRun(runId);
      forgetRunModelSet(runId);
    }
  }
}
