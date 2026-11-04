import { resolveBootstrapWarningSignaturesSeen } from "../../../agents/bootstrap-budget.js";
import { resolveCredentialForRun } from "../../../agents/cli-backend-credential-resolve.js";
import { recordCliBackendUsage } from "../../../agents/cli-backend-usage-attribution.js";
import { runCliAgent } from "../../../agents/cli-runner.js";
import { getCliSessionId } from "../../../agents/cli-session.js";
import { isCliProvider } from "../../../agents/model-selection.js";
import { runEmbeddedPiAgent } from "../../../agents/pi-embedded.js";
import { buildEmbeddedRunContexts } from "../../../auto-reply/reply/agent-runner-utils.js";
import { createBlockReplyDeliveryHandler } from "../../../auto-reply/reply/reply-delivery.js";
import type { ReplyPayload } from "../../../auto-reply/types.js";
import { resolveGroupSessionKey } from "../../../config/sessions.js";
import { createConversationTurnToolObserver } from "../../../conversation-task/ledger-binding.js";
import { defaultShadowStoreRoot } from "../../../conversation-task/runtime-bootstrap.js";
import { resolveCronStorePath } from "../../../cron/store.js";
import { emitChatInboundStage } from "../../../gateway/chat-inbound-stage-events.js";
import { resolveEnterpriseEmbeddedTransport } from "../../../gateway/enterprise-model/embedded-transport.js";
import { inheritExecutionIdentityRunFields } from "../../../gateway/execution-identity-context.js";
import type { EmployeeModelGateResult } from "../../../gateway/model-entitlement/employee-model-gate.js";
import { resolveAgentRunEntitlementScope } from "../../../gateway/model-entitlement/resolve-agent-run-scope.js";
import type { GatewayClient } from "../../../gateway/server-methods/types.js";
import { logVerbose } from "../../../globals.js";
import { emitAgentEvent } from "../../../infra/agent-events.js";
import { getExecApprovalReplyMetadata } from "../../../infra/exec-approval-reply.js";
import { APPROVE_CARD_CTA } from "../../../shared/text/assistant-scratchpad.js";
import type { ModalityExecutionArtifact } from "../../../task-outcome/modality-artifact-evidence.js";
import { TaskBudgetExceededError } from "../../../task-outcome/runtime-from-runner.js";
import {
  isMarkdownCapableMessageChannel,
  resolveMessageChannel,
} from "../../../utils/message-channel.js";
import { buildEmbeddedRunBaseParams } from "../preparation/index.js";
/** Legacy single admitted candidate adapter. Outer admission/fallback/finalization remain with the caller. */
import type { AgentTurnExecutionParams } from "./turn-contract.js";
export type AdmittedCandidateHost = {
  assertOriginalTaskCurrent: () => void;
  assertTipBudgetAllowsModelCall: () => void;

  directlySentBlockKeys: Set<string>;
  chargeTipBudgetAfterModelCall: (usage: {
    provider: string;
    model: string;
    usage?: unknown;
  }) => void;
  notifyAgentRunStart: () => void;
  handlePartialForTyping: (payload: ReplyPayload) => Promise<string | undefined>;
  normalizeStreamingText: (payload: ReplyPayload) => {
    text?: string;
    skip: boolean;
    sanitizedEmpty?: boolean;
  };
  normalizeReplyMediaPaths: (payload: ReplyPayload) => Promise<ReplyPayload>;
  recordGrowthToolResult: (isError: boolean) => void;
  recordCommercialToolStart: (name: string) => void;
  recordModalityArtifact: (artifact: ModalityExecutionArtifact) => void;
  markAutoCompactionCompleted: () => void;
  getBootstrapWarnings: () => string[];
  setBootstrapWarnings: (warnings: string[]) => void;
  getModelGate: () => EmployeeModelGateResult | undefined;
  identity: { user?: string; domain?: GatewayClient["sessionDomain"]; platformUserId?: string };
};
export function createAdmittedCandidateInvoker(
  params: AgentTurnExecutionParams,
  runId: string,
  host: AdmittedCandidateHost,
) {
  const onToolResult = params.opts?.onToolResult;
  const blockReplyPipeline = params.blockReplyPipeline;
  return (
    provider: string,
    model: string,
    runOptions?: { allowTransientCooldownProbe?: boolean },
  ) => {
    if (isCliProvider(provider, params.followupRun.run.config)) {
      host.assertTipBudgetAllowsModelCall();
      const startedAt = Date.now();
      host.notifyAgentRunStart();
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
        let usageAttr: { tenantId: string; userId: string; credentialId: string } | undefined;
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
          host.assertOriginalTaskCurrent();
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
            abortSignal: params.opts?.abortSignal,
            extraSystemPrompt: params.followupRun.run.extraSystemPrompt,
            ownerNumbers: params.followupRun.run.ownerNumbers,
            cliSessionId,
            bootstrapPromptWarningSignaturesSeen: host.getBootstrapWarnings(),
            bootstrapPromptWarningSignature:
              host.getBootstrapWarnings()[host.getBootstrapWarnings().length - 1],
            images: params.opts?.images,
            credentialEnv,
          });
          host.setBootstrapWarnings(
            resolveBootstrapWarningSignaturesSeen(result.meta?.systemPromptReport),
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

          try {
            host.chargeTipBudgetAfterModelCall({
              provider,
              model,
              usage: result.meta?.agentMeta?.usage,
            });
          } catch (chargeErr) {
            if (chargeErr instanceof TaskBudgetExceededError) {
              throw chargeErr;
            }
            logVerbose(
              `tip budget mid-run charge failed (cli): ${chargeErr instanceof Error ? chargeErr.message : String(chargeErr)}`,
            );
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
      // ent/<connection>/<upstream> is a tenant catalog id, not a registry provider.
      // Without this remap the runner throws Unknown model before any reply.
      const transport = await resolveEnterpriseEmbeddedTransport({
        provider,
        model,
        tenantId:
          host.getModelGate()?.tenantId?.trim() ||
          host.getModelGate()?.creditReporting?.enterpriseId?.trim() ||
          params.followupRun.run.executionIdentity?.enterpriseId?.trim() ||
          params.sessionCtx.GatewayClientSessionEnterpriseId?.trim() ||
          params.sessionCtx.CollaborationGroupOwnerEntitlement?.tenantId?.trim() ||
          "",
        resolveTenantId: async () => {
          const scope = await resolveAgentRunEntitlementScope({
            agentId: params.followupRun.run.agentId,
          });
          return scope?.tenantId;
        },
      });
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
      host.assertTipBudgetAllowsModelCall();
      emitModelStage("model_started");
      const conversationToolObserver = createConversationTurnToolObserver({
        isHeartbeat: params.isHeartbeat,
        sessionKey: params.sessionKey,
        commandBody: params.commandBody,
        sessionCtx: params.sessionCtx,
        tenantId:
          params.followupRun.run.executionIdentity?.enterpriseId ??
          params.followupRun.run.executionIdentity?.collaborationOwnerEntitlement?.tenantId ??
          params.sessionCtx.GatewayClientSessionEnterpriseId ??
          params.sessionCtx.CollaborationTenantId ??
          host.getModelGate()?.tenantId ??
          null,
        storeRoot: defaultShadowStoreRoot(),
        cronStorePath: resolveCronStorePath(params.followupRun.run.config.cron?.store),
      });
      try {
        host.assertOriginalTaskCurrent();
        const result = await runEmbeddedPiAgent({
          ...embeddedContext,
          trigger: params.isHeartbeat ? "heartbeat" : "user",
          groupId: resolveGroupSessionKey(params.sessionCtx)?.id,
          groupChannel:
            params.sessionCtx.GroupChannel?.trim() ?? params.sessionCtx.GroupSubject?.trim(),
          groupSpace: params.sessionCtx.GroupSpace?.trim() ?? undefined,
          ...senderContext,
          ...runBaseParams,
          provider: transport.provider,
          model: transport.model,
          ...(transport.providerAuthOverride
            ? { providerAuthOverride: transport.providerAuthOverride }
            : {}),
          ...(transport.enterpriseRuntimeModelId
            ? { enterpriseRuntimeModelId: transport.enterpriseRuntimeModelId }
            : {}),
          ...inheritExecutionIdentityRunFields({
            ...params.followupRun.run,
            gatewayClientUser: host.identity.user,
            gatewayClientSessionDomain: host.identity.domain,
            gatewayClientPlatformUserId: host.identity.platformUserId,
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
          taskExecutionBinding: params.followupRun.run.taskCompletionBinding,
          blockReplyBreak: params.resolvedBlockStreamingBreak,
          blockReplyChunking: params.blockReplyChunking,
          onPartialReply: async (payload) => {
            const textForTyping = await host.handlePartialForTyping(payload);
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
              host.notifyAgentRunStart();
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
                host.recordCommercialToolStart(name);
              }
              // Agent Growth OS：工具成功率信号源（此前 recordToolOutcome 无任何调用方）。
              if (phase === "result") {
                host.recordGrowthToolResult(evt.data.isError === true);
                if (evt.data.isError !== true && name) {
                  const relativePath =
                    typeof evt.data.relativePath === "string" ? evt.data.relativePath.trim() : "";
                  if (relativePath && (name === "image_gen" || name === "music_gen")) {
                    host.recordModalityArtifact({ toolName: name, relativePath });
                  }
                }
              }
            }
            // Track auto-compaction completion
            if (evt.stream === "compaction") {
              const phase = typeof evt.data.phase === "string" ? evt.data.phase : "";
              if (phase === "end") {
                host.markAutoCompactionCompleted();
              }
            }
          },
          // Always pass onBlockReply so flushBlockReplyBuffer works before tool execution,
          // even when regular block streaming is disabled. The handler sends directly
          // via opts.onBlockReply when the pipeline isn't available.
          onBlockReply: params.opts?.onBlockReply
            ? createBlockReplyDeliveryHandler({
                onBlockReply: params.opts.onBlockReply,
                currentMessageId: params.sessionCtx.MessageSidFull ?? params.sessionCtx.MessageSid,
                normalizeStreamingText: host.normalizeStreamingText,
                applyReplyToMode: params.applyReplyToMode,
                normalizeMediaPaths: host.normalizeReplyMediaPaths,
                typingSignals: params.typingSignals,
                blockStreamingEnabled: params.blockStreamingEnabled,
                blockReplyPipeline: params.blockReplyPipeline,
                directlySentBlockKeys: host.directlySentBlockKeys,
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
          bootstrapPromptWarningSignaturesSeen: host.getBootstrapWarnings(),
          bootstrapPromptWarningSignature:
            host.getBootstrapWarnings()[host.getBootstrapWarnings().length - 1],
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
                      const normalized = host.normalizeStreamingText(payload);
                      // Only restore a valid structured card when sanitation removed its protocol text.
                      const hasApprovalCard =
                        normalized.sanitizedEmpty === true &&
                        getExecApprovalReplyMetadata(payload) !== null &&
                        /\/approve\s+[0-9a-f-]{8,}\s+allow-once\b/i.test(payload.text ?? "");
                      const text =
                        normalized.skip && hasApprovalCard ? APPROVE_CARD_CTA : normalized.text;
                      if (normalized.skip && !hasApprovalCard) {
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
        host.setBootstrapWarnings(
          resolveBootstrapWarningSignaturesSeen(result.meta?.systemPromptReport),
        );
        emitModelStage("model_finished", {
          modelMs: Date.now() - modelStartedAtMs,
          ok: true,
        });
        emitModelStage("assistant_persisted", { source: "session_manager" });
        try {
          host.chargeTipBudgetAfterModelCall({
            provider,
            model,
            usage: result.meta?.agentMeta?.usage,
          });
        } catch (chargeErr) {
          if (chargeErr instanceof TaskBudgetExceededError) {
            throw chargeErr;
          }
          logVerbose(
            `tip budget mid-run charge failed: ${chargeErr instanceof Error ? chargeErr.message : String(chargeErr)}`,
          );
        }
        return result;
      } catch (err) {
        emitModelStage("model_finished", {
          modelMs: Date.now() - modelStartedAtMs,
          ok: false,
        });
        throw err;
      }
    })();
  };
}
