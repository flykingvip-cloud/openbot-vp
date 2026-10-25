import crypto from "node:crypto";
import { resolveRunModelFallbacksOverride } from "../../agents/agent-scope.js";
import { resolveBootstrapWarningSignaturesSeen } from "../../agents/bootstrap-budget.js";
import { lookupContextTokens } from "../../agents/context.js";
import { DEFAULT_CONTEXT_TOKENS } from "../../agents/defaults.js";
import { resolveEmbeddedModelGovernance } from "../../agents/embedded-model-governance.js";
import { runWithModelFallback } from "../../agents/model-fallback.js";
import { runEmbeddedPiAgent } from "../../agents/pi-embedded.js";
import { hasNonzeroUsage, normalizeUsage } from "../../agents/usage.js";
import type { SessionEntry } from "../../config/sessions.js";
import {
  admitOguiDecisionTurn,
  releaseOguiDecisionResume,
  runWithOguiDecisionResume,
} from "../../config/sessions/ogui-decision-engine.js";
import type { TypingMode } from "../../config/types.js";
import {
  tryAcquireEnterpriseAgentRun,
  releaseEnterpriseAgentRun,
} from "../../gateway/billing/agent-run-governance.js";
import { drainUsageOutboxRecord } from "../../gateway/billing/usage-outbox-drain.js";
import { enqueueUsageOutbox } from "../../gateway/billing/usage-outbox-store.js";
import { isEnterpriseRuntimeModelId } from "../../gateway/enterprise-model/ids.js";
import { resolveEnterpriseRuntimeInvocation } from "../../gateway/enterprise-model/runtime-invocation.js";
import { inheritExecutionIdentityRunFields } from "../../gateway/execution-identity-context.js";
import {
  buildRunModelSetSnapshot,
  forgetRunModelSet,
  rememberRunModelSet,
  snapshotCreditReportingFromGate,
} from "../../gateway/governance/spawn-snapshot-handoff.js";
import type { EmployeeModelGateResult } from "../../gateway/model-entitlement/employee-model-gate.js";
import { logVerbose } from "../../globals.js";
import { registerAgentRunContext } from "../../infra/agent-events.js";
import { defaultRuntime } from "../../runtime.js";
import { isInternalMessageChannel } from "../../utils/message-channel.js";
import { stripHeartbeatToken } from "../heartbeat.js";
import type { OriginatingChannelType } from "../templating.js";
import { isSilentReplyText, SILENT_REPLY_TOKEN } from "../tokens.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import { buildCommercialRunCreditUsageInput } from "./agent-run-credit-usage.js";
import { resolveRunAuthProfile } from "./agent-runner-utils.js";
import {
  resolveOriginAccountId,
  resolveOriginMessageProvider,
  resolveOriginMessageTo,
} from "./origin-routing.js";
import type { FollowupRun } from "./queue.js";
import {
  applyReplyThreading,
  filterMessagingToolDuplicates,
  filterMessagingToolMediaDuplicates,
  shouldSuppressMessagingToolReplies,
} from "./reply-payloads.js";
import { resolveReplyToMode } from "./reply-threading.js";
import { isRoutableChannel, routeReply } from "./route-reply.js";
import { incrementRunCompactionCount, persistRunSessionUsage } from "./session-run-accounting.js";
import { createTypingSignaler } from "./typing-mode.js";
import type { TypingController } from "./typing.js";

export function createFollowupRunner(params: {
  opts?: GetReplyOptions;
  typing: TypingController;
  typingMode: TypingMode;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  defaultModel: string;
  agentCfgContextTokens?: number;
}): (queued: FollowupRun) => Promise<void> {
  const {
    opts,
    typing,
    typingMode,
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    defaultModel,
    agentCfgContextTokens,
  } = params;
  const typingSignals = createTypingSignaler({
    typing,
    mode: typingMode,
    isHeartbeat: opts?.isHeartbeat === true,
  });

  /**
   * Sends followup payloads, routing to the originating channel if set.
   *
   * When originatingChannel/originatingTo are set on the queued run,
   * replies are routed directly to that provider instead of using the
   * session's current dispatcher. This ensures replies go back to
   * where the message originated.
   */
  const sendFollowupPayloads = async (payloads: ReplyPayload[], queued: FollowupRun) => {
    // Check if we should route to originating channel.
    const { originatingChannel, originatingTo } = queued;
    const shouldRouteToOriginating = isRoutableChannel(originatingChannel) && originatingTo;

    if (!shouldRouteToOriginating && !opts?.onBlockReply) {
      logVerbose("followup queue: no onBlockReply handler; dropping payloads");
      return;
    }

    for (const payload of payloads) {
      if (!payload?.text && !payload?.mediaUrl && !payload?.mediaUrls?.length) {
        continue;
      }
      if (
        isSilentReplyText(payload.text, SILENT_REPLY_TOKEN) &&
        !payload.mediaUrl &&
        !payload.mediaUrls?.length
      ) {
        continue;
      }
      await typingSignals.signalTextDelta(payload.text);

      // Route to originating channel if set, otherwise fall back to dispatcher.
      if (shouldRouteToOriginating) {
        const result = await routeReply({
          payload,
          channel: originatingChannel,
          to: originatingTo,
          sessionKey: queued.run.sessionKey,
          accountId: queued.originatingAccountId,
          threadId: queued.originatingThreadId,
          cfg: queued.run.config,
        });
        if (!result.ok) {
          const errorMsg = result.error ?? "unknown error";
          logVerbose(`followup queue: route-reply failed: ${errorMsg}`);
          // Fall back to the caller-provided dispatcher only when the
          // originating channel matches the session's message provider.
          // In that case onBlockReply was created by the same channel's
          // handler and delivers to the correct destination.  For true
          // cross-channel routing (origin !== provider), falling back
          // would send to the wrong channel, so we drop the payload.
          const provider = resolveOriginMessageProvider({
            provider: queued.run.messageProvider,
          });
          const origin = resolveOriginMessageProvider({
            originatingChannel,
          });
          if (opts?.onBlockReply && origin && origin === provider) {
            await opts.onBlockReply(payload);
          }
        }
      } else if (opts?.onBlockReply) {
        await opts.onBlockReply(payload);
      }
    }
  };

  return async (queued: FollowupRun) => {
    const runId = crypto.randomUUID();
    let followupSlotHeld = false;
    let oguiResume:
      | { storePath: string; sessionKey: string; decisionId: string; resumeRef: string }
      | undefined;
    let oguiModelPrompt: string | undefined;
    let oguiResumeSettled = false;
    try {
      if (queued.run.oguiDecisionRun) {
        const admission = await admitOguiDecisionTurn({
          binding: queued.run.oguiDecisionRun,
          inboundText: queued.prompt,
          ingress: "queue",
          phase: "run",
        });
        if (admission.action === "pause" || admission.action === "ack") {
          await sendFollowupPayloads([{ text: admission.text ?? "" }], queued);
          return;
        }
        if (admission.action === "resume" && admission.decisionId && admission.resumeRef) {
          const binding = queued.run.oguiDecisionRun;
          queued.run.oguiDecisionRun = {
            ...binding,
            decisionId: admission.decisionId,
            resumeRef: admission.resumeRef,
          };
          oguiResume = {
            storePath: binding.storePath,
            sessionKey: binding.sessionKey,
            decisionId: admission.decisionId,
            resumeRef: admission.resumeRef,
          };
          if (admission.acceptedPrompt) {
            oguiModelPrompt = admission.acceptedPrompt;
          }
        }
      }
      const shouldSurfaceToControlUi = isInternalMessageChannel(
        resolveOriginMessageProvider({
          originatingChannel: queued.originatingChannel,
          provider: queued.run.messageProvider,
        }),
      );
      if (queued.run.sessionKey) {
        registerAgentRunContext(runId, {
          sessionKey: queued.run.sessionKey,
          verboseLevel: queued.run.verboseLevel,
          isControlUiVisible: shouldSurfaceToControlUi,
        });
      }
      let autoCompactionCompleted = false;
      let runResult: Awaited<ReturnType<typeof runEmbeddedPiAgent>>;
      let fallbackProvider = queued.run.provider;
      let fallbackModel = queued.run.model;
      const activeSessionEntry =
        (sessionKey ? sessionStore?.[sessionKey] : undefined) ?? sessionEntry;
      let bootstrapPromptWarningSignaturesSeen = resolveBootstrapWarningSignaturesSeen(
        activeSessionEntry?.systemPromptReport,
      );
      try {
        // P5（model-entitlement-chain §6.5）：协作小组 / followup 多 bot 回合按 bot 归属席位
        // 接入 Commercial Runtime 统一闸口（P0）。
        const modelGateInput = {
          cfg: queued.run.config,
          agentId: queued.run.agentId,
          gatewayClientUser: queued.run.gatewayClientUser,
          gatewayClientSessionDomain: queued.run.gatewayClientSessionDomain,
        };
        let modelGate: EmployeeModelGateResult = {};
        let followupAuthorizationId: string | undefined;
        const runSlot = await tryAcquireEnterpriseAgentRun({
          runId,
          agentId: queued.run.agentId,
          ...(queued.run.groupId ? { groupId: queued.run.groupId } : {}),
          modelGateInput,
        });
        if (!runSlot.skipped && !runSlot.acquired) {
          logVerbose(`followup commercial gate blocked: ${runSlot.message}`);
          return;
        }
        if (runSlot.acquired) {
          if (runSlot.modelGate) {
            modelGate = runSlot.modelGate;
          }
          followupSlotHeld = true;
          followupAuthorizationId = runSlot.authorizationDecisionId;
        }
        const embeddedModelGovernance = resolveEmbeddedModelGovernance({
          gateStatus: followupSlotHeld ? "acquired" : "skipped",
          allowlist: modelGate.allowlist,
          tenantId: modelGate.tenantId,
          commercialAuthorizationId: followupAuthorizationId,
        });
        const parentSnapshot = buildRunModelSetSnapshot({
          runId,
          allowlist: modelGate.allowlist,
          governanceMode: embeddedModelGovernance.governanceMode,
          commercialAuthorizationId: followupAuthorizationId,
          tenantId: modelGate.tenantId,
          preferredModelOrder: modelGate.preferredModelOrder,
          // P4-1: parent billing context for child runs (acquired gate only).
          creditReporting: runSlot.acquired ? snapshotCreditReportingFromGate(runSlot) : undefined,
        });
        if (parentSnapshot) {
          rememberRunModelSet(runId, parentSnapshot);
        }
        const runFallback = () =>
          runWithModelFallback({
            cfg: queued.run.config,
            provider: queued.run.provider,
            model: queued.run.model,
            ...embeddedModelGovernance,
            ...(modelGate.preferredModelOrder
              ? { preferredModelOrder: modelGate.preferredModelOrder }
              : {}),
            runId,
            agentDir: queued.run.agentDir,
            fallbacksOverride: resolveRunModelFallbacksOverride({
              cfg: queued.run.config,
              agentId: queued.run.agentId,
              sessionKey: queued.run.sessionKey,
            }),
            run: async (provider, model, runOptions) => {
              const authProfile = resolveRunAuthProfile(queued.run, provider);
              let embeddedProvider = provider;
              let embeddedModel = model;
              let providerAuthOverride:
                | {
                    apiKey: string;
                    source?: string;
                    baseUrl?: string;
                    protocol?: string;
                  }
                | undefined;
              let enterpriseRuntimeModelId: string | undefined;
              const candidateRuntimeId = `${provider}/${model}`;
              if (isEnterpriseRuntimeModelId(candidateRuntimeId)) {
                const tenantId =
                  modelGate.tenantId?.trim() ||
                  modelGate.creditReporting?.enterpriseId?.trim() ||
                  "";
                if (!tenantId) {
                  throw new Error(
                    "Enterprise BYOK model selected but managed tenantId could not be resolved",
                  );
                }
                const invocation = await resolveEnterpriseRuntimeInvocation({
                  tenantId,
                  provider,
                  model,
                });
                if (!invocation) {
                  throw new Error(
                    `Enterprise BYOK runtime config missing for ${candidateRuntimeId}`,
                  );
                }
                embeddedProvider = invocation.provider;
                embeddedModel = invocation.model;
                enterpriseRuntimeModelId = invocation.runtimeModelId;
                providerAuthOverride = {
                  apiKey: invocation.apiKey,
                  source: "enterprise-byok",
                  ...(invocation.baseUrl ? { baseUrl: invocation.baseUrl } : {}),
                  protocol: invocation.protocol,
                };
              }
              const result = await runEmbeddedPiAgent({
                sessionId: queued.run.sessionId,
                sessionKey: queued.run.sessionKey,
                agentId: queued.run.agentId,
                trigger: "user",
                messageChannel: queued.originatingChannel ?? undefined,
                messageProvider: queued.run.messageProvider,
                agentAccountId: queued.run.agentAccountId,
                messageTo: queued.originatingTo,
                messageThreadId: queued.originatingThreadId,
                currentChannelId: queued.originatingTo,
                currentThreadTs:
                  queued.originatingThreadId != null
                    ? String(queued.originatingThreadId)
                    : undefined,
                groupId: queued.run.groupId,
                groupChannel: queued.run.groupChannel,
                groupSpace: queued.run.groupSpace,
                senderId: queued.run.senderId,
                senderName: queued.run.senderName,
                senderUsername: queued.run.senderUsername,
                senderE164: queued.run.senderE164,
                senderIsOwner: queued.run.senderIsOwner,
                ...inheritExecutionIdentityRunFields(queued.run),
                sessionFile: queued.run.sessionFile,
                agentDir: queued.run.agentDir,
                workspaceDir: queued.run.workspaceDir,
                config: queued.run.config,
                skillsSnapshot: queued.run.skillsSnapshot,
                prompt: oguiModelPrompt ?? queued.prompt,
                extraSystemPrompt: queued.run.extraSystemPrompt,
                ...(queued.run.disableTools ? { disableTools: true } : {}),
                ...(queued.run.skillPolicy ? { skillPolicy: queued.run.skillPolicy } : {}),
                ...(queued.run.inboundToolCeiling
                  ? { inboundToolCeiling: queued.run.inboundToolCeiling }
                  : {}),
                ...(queued.run.contextLane ? { contextLane: queued.run.contextLane } : {}),
                ...(queued.run.sessionEntry ? { sessionEntry: queued.run.sessionEntry } : {}),
                ...(queued.run.oguiDecisionRun
                  ? { oguiDecisionRun: queued.run.oguiDecisionRun }
                  : {}),
                ...(queued.run.knowledgeConsumeRefs?.length
                  ? { knowledgeConsumeRefs: queued.run.knowledgeConsumeRefs }
                  : {}),
                ...(queued.run.skipUserTranscriptPersist === true
                  ? { skipUserTranscriptPersist: true }
                  : {}),
                ...(queued.run.collaborationRoundInvoked === true
                  ? { collaborationRoundInvoked: true }
                  : {}),
                ...(queued.run.deliveryToolSideEffect
                  ? { deliveryToolSideEffect: queued.run.deliveryToolSideEffect }
                  : {}),
                ...(queued.run.privateRunBag ? { privateRunBag: queued.run.privateRunBag } : {}),
                ownerNumbers: queued.run.ownerNumbers,
                enforceFinalTag: queued.run.enforceFinalTag,
                provider: embeddedProvider,
                model: embeddedModel,
                ...(providerAuthOverride ? { providerAuthOverride } : {}),
                ...(enterpriseRuntimeModelId ? { enterpriseRuntimeModelId } : {}),
                ...authProfile,
                thinkLevel: queued.run.thinkLevel,
                verboseLevel: queued.run.verboseLevel,
                reasoningLevel: queued.run.reasoningLevel,
                suppressToolErrorWarnings: opts?.suppressToolErrorWarnings,
                execOverrides: queued.run.execOverrides,
                bashElevated: queued.run.bashElevated,
                timeoutMs: queued.run.timeoutMs,
                runId,
                allowTransientCooldownProbe: runOptions?.allowTransientCooldownProbe,
                blockReplyBreak: queued.run.blockReplyBreak,
                bootstrapPromptWarningSignaturesSeen,
                bootstrapPromptWarningSignature:
                  bootstrapPromptWarningSignaturesSeen[
                    bootstrapPromptWarningSignaturesSeen.length - 1
                  ],
                onAgentEvent: (evt) => {
                  if (evt.stream !== "compaction") {
                    return;
                  }
                  const phase = typeof evt.data.phase === "string" ? evt.data.phase : "";
                  if (phase === "end") {
                    autoCompactionCompleted = true;
                  }
                },
              });
              bootstrapPromptWarningSignaturesSeen = resolveBootstrapWarningSignaturesSeen(
                result.meta?.systemPromptReport,
              );
              return result;
            },
          });
        const fallbackResult = oguiResume
          ? await runWithOguiDecisionResume({
              storePath: oguiResume.storePath,
              sessionKey: oguiResume.sessionKey,
              decisionId: oguiResume.decisionId,
              resumeRef: oguiResume.resumeRef,
              lifecycleEnabled: true,
              run: runFallback,
            })
          : await runFallback();
        oguiResumeSettled = true;
        runResult = fallbackResult.result;
        fallbackProvider = fallbackResult.provider;
        fallbackModel = fallbackResult.model;

        // Mirror chat path: durable Credits/providerCost outbox for enterprise runs.
        // Outer provider/model stay as selected (may be ent/...), so BYOK ledger skips platform debit.
        if (modelGate.creditReporting && hasNonzeroUsage(runResult.meta?.agentMeta?.usage)) {
          try {
            const tokenUsage = normalizeUsage(runResult.meta?.agentMeta?.usage);
            const usagePayload = buildCommercialRunCreditUsageInput({
              enterpriseId: modelGate.creditReporting.enterpriseId,
              policyId: modelGate.creditReporting.policyId,
              runId,
              provider: fallbackProvider,
              model: fallbackModel,
              agentId: queued.run.agentId,
              durationMs: runResult.meta?.durationMs,
              toolCallCount: 0,
              toolClasses: [],
              fallbackAttemptsRaw: fallbackResult.attempts,
              tokenUsage,
            });
            const receipt = await enqueueUsageOutbox(usagePayload);
            await drainUsageOutboxRecord(receipt).catch((err) => {
              logVerbose(`followup credit usage drain deferred: ${String(err)}`);
            });
          } catch (err) {
            logVerbose(`followup credit usage outbox enqueue failed: ${String(err)}`);
            throw err;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        defaultRuntime.error?.(`Followup agent failed before reply: ${message}`);
        return;
      }

      const usage = runResult.meta?.agentMeta?.usage;
      const promptTokens = runResult.meta?.agentMeta?.promptTokens;
      const modelUsed = runResult.meta?.agentMeta?.model ?? fallbackModel ?? defaultModel;
      const contextTokensUsed =
        agentCfgContextTokens ??
        lookupContextTokens(modelUsed) ??
        sessionEntry?.contextTokens ??
        DEFAULT_CONTEXT_TOKENS;

      if (storePath && sessionKey) {
        await persistRunSessionUsage({
          storePath,
          sessionKey,
          usage,
          lastCallUsage: runResult.meta?.agentMeta?.lastCallUsage,
          promptTokens,
          modelUsed,
          providerUsed: fallbackProvider,
          contextTokensUsed,
          systemPromptReport: runResult.meta?.systemPromptReport,
          logLabel: "followup",
        });
      }

      const payloadArray = runResult.payloads ?? [];
      if (payloadArray.length === 0) {
        return;
      }
      const sanitizedPayloads = payloadArray.flatMap((payload) => {
        const text = payload.text;
        if (!text || !text.includes("HEARTBEAT_OK")) {
          return [payload];
        }
        const stripped = stripHeartbeatToken(text, { mode: "message" });
        const hasMedia = Boolean(payload.mediaUrl) || (payload.mediaUrls?.length ?? 0) > 0;
        if (stripped.shouldSkip && !hasMedia) {
          return [];
        }
        return [{ ...payload, text: stripped.text }];
      });
      const replyToChannel = resolveOriginMessageProvider({
        originatingChannel: queued.originatingChannel,
        provider: queued.run.messageProvider,
      }) as OriginatingChannelType | undefined;
      const replyToMode = resolveReplyToMode(
        queued.run.config,
        replyToChannel,
        queued.originatingAccountId,
        queued.originatingChatType,
      );

      const replyTaggedPayloads: ReplyPayload[] = applyReplyThreading({
        payloads: sanitizedPayloads,
        replyToMode,
        replyToChannel,
      });

      const dedupedPayloads = filterMessagingToolDuplicates({
        payloads: replyTaggedPayloads,
        sentTexts: runResult.messagingToolSentTexts ?? [],
      });
      const mediaFilteredPayloads = filterMessagingToolMediaDuplicates({
        payloads: dedupedPayloads,
        sentMediaUrls: runResult.messagingToolSentMediaUrls ?? [],
      });
      const suppressMessagingToolReplies = shouldSuppressMessagingToolReplies({
        messageProvider: resolveOriginMessageProvider({
          originatingChannel: queued.originatingChannel,
          provider: queued.run.messageProvider,
        }),
        messagingToolSentTargets: runResult.messagingToolSentTargets,
        originatingTo: resolveOriginMessageTo({
          originatingTo: queued.originatingTo,
        }),
        accountId: resolveOriginAccountId({
          originatingAccountId: queued.originatingAccountId,
          accountId: queued.run.agentAccountId,
        }),
      });
      const finalPayloads = suppressMessagingToolReplies ? [] : mediaFilteredPayloads;

      if (finalPayloads.length === 0) {
        return;
      }

      if (autoCompactionCompleted) {
        const count = await incrementRunCompactionCount({
          sessionEntry,
          sessionStore,
          sessionKey,
          storePath,
          lastCallUsage: runResult.meta?.agentMeta?.lastCallUsage,
          contextTokensUsed,
        });
        if (queued.run.verboseLevel && queued.run.verboseLevel !== "off") {
          const suffix = typeof count === "number" ? ` (count ${count})` : "";
          finalPayloads.unshift({
            text: `🧹 Auto-compaction complete${suffix}.`,
          });
        }
      }

      await sendFollowupPayloads(finalPayloads, queued);
    } finally {
      if (oguiResume && !oguiResumeSettled) {
        await releaseOguiDecisionResume({
          storePath: oguiResume.storePath,
          sessionKey: oguiResume.sessionKey,
          decisionId: oguiResume.decisionId,
          resumeRef: oguiResume.resumeRef,
          lifecycleEnabled: true,
        });
      }
      if (followupSlotHeld) {
        void releaseEnterpriseAgentRun(runId);
        forgetRunModelSet(runId);
      }
      // Both signals are required for the typing controller to clean up.
      // The main inbound dispatch path calls markDispatchIdle() from the
      // buffered dispatcher's finally block, but followup turns bypass the
      // dispatcher entirely — so we must fire both signals here.  Without
      // this, NO_REPLY / empty-payload followups leave the typing indicator
      // stuck (the keepalive loop keeps sending "typing" to Telegram
      // indefinitely until the TTL expires).
      typing.markRunComplete();
      typing.markDispatchIdle();
    }
  };
}
