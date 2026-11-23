import { randomUUID } from "node:crypto";
import { isHumanInteractionIngress } from "../../agent-runtime/command/index.js";
import type { TaskActionBoundary } from "../../agent-runtime/contracts/task-binding.js";
import { confirmPendingTurnDelivery } from "../../agent-runtime/wiring/delivery-confirm.js";
import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../config/config.js";
import {
  loadSessionStore,
  resolveSessionStoreEntry,
  resolveStorePath,
  type SessionEntry,
} from "../../config/sessions.js";
import { observeInboundTurnActivation } from "../../conversation-task/gateway-activation-hook.js";
import { observeInboundTurnShadow } from "../../conversation-task/gateway-shadow-hook.js";
import { observeConversationTaskReplyCompleted } from "../../conversation-task/reply-completion.js";
import { captureTaskCompletionBinding } from "../../conversation-task/session-task-board.js";
import { resolveCronStorePath } from "../../cron/store.js";
import { shouldSuppressLocalDiscordExecApprovalPrompt } from "../../discord/exec-approvals.js";
import { resolveKnowledgeSourceContext } from "../../gateway/knowledge/context.js";
import { buildKnowledgeReplyGatewayClient } from "../../gateway/knowledge/reply-gateway-client.js";
import {
  getTenantConfigOverride,
  loadTenantConfigStore,
  resolveConfigForTenant,
} from "../../gateway/tenant-config.js";
import { logVerbose } from "../../globals.js";
import { fireAndForgetHook } from "../../hooks/fire-and-forget.js";
import { createInternalHookEvent, triggerInternalHook } from "../../hooks/internal-hooks.js";
import {
  deriveInboundMessageHookContext,
  toInternalMessageReceivedContext,
  toPluginMessageContext,
  toPluginMessageReceivedEvent,
} from "../../hooks/message-hook-mappers.js";
import { isDiagnosticsEnabled } from "../../infra/diagnostic-events.js";
import {
  logMessageProcessed,
  logMessageQueued,
  logSessionStateChange,
} from "../../logging/diagnostic.js";
import { getGlobalHookRunner } from "../../plugins/hook-runner-global.js";
import { resolveSendPolicy } from "../../sessions/send-policy.js";
import { observeWebReadShadowFromChat } from "../../task-orchestration/gateway-hook.js";
import {
  resolveRequiredDeliveryConfirmStatus,
  type RequiredDeliveryAttempt,
} from "../../task-outcome/delivery-confirm.js";
import { maybeApplyTtsToPayload, normalizeTtsAutoMode, resolveTtsConfig } from "../../tts/tts.js";
import { INTERNAL_MESSAGE_CHANNEL, normalizeMessageChannel } from "../../utils/message-channel.js";
import { getReplyFromConfig } from "../reply.js";
import type { FinalizedMsgContext } from "../templating.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import { formatAbortReplyText, tryFastAbortFromMessage } from "./abort.js";
import { shouldBypassAcpDispatchForCommand, tryDispatchAcpReply } from "./dispatch-acp.js";
import { shouldSkipDuplicateInbound } from "./inbound-dedupe.js";
import type { ReplyDispatcher, ReplyDispatchKind } from "./reply-dispatcher.js";
import { shouldSuppressReasoningPayload } from "./reply-payloads.js";
import { isRoutableChannel, routeReply } from "./route-reply.js";
import { resolveRunTypingPolicy } from "./typing-policy.js";

const AUDIO_PLACEHOLDER_RE = /^<media:audio>(\s*\([^)]*\))?$/i;

export { confirmPendingTurnDelivery } from "../../agent-runtime/wiring/delivery-confirm.js";
const AUDIO_HEADER_RE = /^\[Audio\b/i;
const normalizeMediaType = (value: string): string => value.split(";")[0]?.trim().toLowerCase();

const isInboundAudioContext = (ctx: FinalizedMsgContext): boolean => {
  const rawTypes = [
    typeof ctx.MediaType === "string" ? ctx.MediaType : undefined,
    ...(Array.isArray(ctx.MediaTypes) ? ctx.MediaTypes : []),
  ].filter(Boolean) as string[];
  const types = rawTypes.map((type) => normalizeMediaType(type));
  if (types.some((type) => type === "audio" || type.startsWith("audio/"))) {
    return true;
  }

  const body =
    typeof ctx.BodyForCommands === "string"
      ? ctx.BodyForCommands
      : typeof ctx.CommandBody === "string"
        ? ctx.CommandBody
        : typeof ctx.RawBody === "string"
          ? ctx.RawBody
          : typeof ctx.Body === "string"
            ? ctx.Body
            : "";
  const trimmed = body.trim();
  if (!trimmed) {
    return false;
  }
  if (AUDIO_PLACEHOLDER_RE.test(trimmed)) {
    return true;
  }
  return AUDIO_HEADER_RE.test(trimmed);
};

const resolveSessionStoreLookup = (
  ctx: FinalizedMsgContext,
  cfg: OpenBotConfig,
): {
  sessionKey?: string;
  entry?: SessionEntry;
} => {
  const targetSessionKey =
    ctx.CommandSource === "native" ? ctx.CommandTargetSessionKey?.trim() : undefined;
  const sessionKey = (targetSessionKey ?? ctx.SessionKey)?.trim();
  if (!sessionKey) {
    return {};
  }
  const agentId = resolveSessionAgentId({ sessionKey, config: cfg });
  const storePath = resolveStorePath(cfg.session?.store, { agentId });
  try {
    const store = loadSessionStore(storePath);
    return {
      sessionKey,
      entry: resolveSessionStoreEntry({ store, sessionKey }).existing,
    };
  } catch {
    return {
      sessionKey,
    };
  }
};

export type DispatchFromConfigResult = {
  queuedFinal: boolean;
  counts: Record<ReplyDispatchKind, number>;
};

export async function dispatchReplyFromConfig(params: {
  ctx: FinalizedMsgContext;
  cfg: OpenBotConfig;
  dispatcher: ReplyDispatcher;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof getReplyFromConfig;
}): Promise<DispatchFromConfigResult> {
  const { ctx, cfg, dispatcher } = params;
  const humanInteraction = isHumanInteractionIngress({
    provenanceKind: ctx.InputProvenance?.kind,
    heartbeat: params.replyOptions?.isHeartbeat,
    birthTurn: params.replyOptions?.growthBirthTurn,
    collaborationRound: ctx.CollaborationRoundInvoked,
  });
  const interactionIngress =
    params.replyOptions?.interactionIngress ??
    (humanInteraction
      ? {
          userMessageId: String(
            ctx.MessageSidFull ?? ctx.MessageSid ?? params.replyOptions?.runId ?? randomUUID(),
          ),
          persistOwnTranscript: true,
        }
      : undefined);
  const gatewayClient = buildKnowledgeReplyGatewayClient({
    gatewayClientUser: ctx.GatewayClientUser,
    gatewayClientSessionDomain: ctx.GatewayClientSessionDomain,
    gatewayClientSessionEnterpriseId: ctx.GatewayClientSessionEnterpriseId,
    gatewayClientSessionMembershipId: ctx.GatewayClientSessionMembershipId,
    gatewayClientPlatformUserId: ctx.GatewayClientPlatformUserId,
  });
  const sourceContext = await resolveKnowledgeSourceContext(gatewayClient);
  const effectiveCfg =
    sourceContext.hasEnterpriseScope && sourceContext.tenantId
      ? resolveConfigForTenant({
          platformDefault: cfg,
          override: getTenantConfigOverride(await loadTenantConfigStore(), sourceContext.tenantId),
        })
      : cfg;
  const diagnosticsEnabled = isDiagnosticsEnabled(effectiveCfg);
  const channel = String(ctx.Surface ?? ctx.Provider ?? "unknown").toLowerCase();
  const chatId = ctx.To ?? ctx.From;
  const messageId = ctx.MessageSid ?? ctx.MessageSidFirst ?? ctx.MessageSidLast;
  const sessionKey = ctx.SessionKey;
  const startTime = diagnosticsEnabled ? Date.now() : 0;
  const canTrackSession = diagnosticsEnabled && Boolean(sessionKey);

  const recordProcessed = (
    outcome: "completed" | "skipped" | "error",
    opts?: {
      reason?: string;
      error?: string;
    },
  ) => {
    if (!diagnosticsEnabled) {
      return;
    }
    logMessageProcessed({
      channel,
      chatId,
      messageId,
      sessionKey,
      durationMs: Date.now() - startTime,
      outcome,
      reason: opts?.reason,
      error: opts?.error,
    });
  };

  const markProcessing = () => {
    if (!canTrackSession || !sessionKey) {
      return;
    }
    logMessageQueued({ sessionKey, channel, source: "dispatch" });
    logSessionStateChange({
      sessionKey,
      state: "processing",
      reason: "message_start",
    });
  };

  const markIdle = (reason: string) => {
    if (!canTrackSession || !sessionKey) {
      return;
    }
    logSessionStateChange({
      sessionKey,
      state: "idle",
      reason,
    });
  };

  if (shouldSkipDuplicateInbound(ctx)) {
    recordProcessed("skipped", { reason: "duplicate" });
    return { queuedFinal: false, counts: dispatcher.getQueuedCounts() };
  }

  const sessionStoreEntry = resolveSessionStoreLookup(ctx, effectiveCfg);
  const acpDispatchSessionKey = sessionStoreEntry.sessionKey ?? sessionKey;
  const inboundAudio = isInboundAudioContext(ctx);
  const sessionTtsAuto = normalizeTtsAutoMode(sessionStoreEntry.entry?.ttsAuto);
  const hookRunner = getGlobalHookRunner();

  // Extract message context for hooks (plugin and internal)
  const timestamp =
    typeof ctx.Timestamp === "number" && Number.isFinite(ctx.Timestamp) ? ctx.Timestamp : undefined;
  const messageIdForHook =
    ctx.MessageSidFull ?? ctx.MessageSid ?? ctx.MessageSidFirst ?? ctx.MessageSidLast;
  const hookContext = deriveInboundMessageHookContext(ctx, { messageId: messageIdForHook });
  const { isGroup, groupId } = hookContext;

  // Trigger plugin hooks (fire-and-forget)
  if (hookRunner?.hasHooks("message_received")) {
    fireAndForgetHook(
      hookRunner.runMessageReceived(
        toPluginMessageReceivedEvent(hookContext),
        toPluginMessageContext(hookContext),
      ),
      "dispatch-from-config: message_received plugin hook failed",
    );
  }

  // Bridge to internal hooks (HOOK.md discovery system) - refs #8807
  if (sessionKey) {
    fireAndForgetHook(
      triggerInternalHook(
        createInternalHookEvent("message", "received", sessionKey, {
          ...toInternalMessageReceivedContext(hookContext),
          timestamp,
        }),
      ),
      "dispatch-from-config: message_received internal hook failed",
    );
  }

  // ConversationTask Runtime — passive shadow observation (P2.5, admission §5 AC2; design §1.2).
  // Fire-and-forget and synchronous; never alters the reply and never throws into this path.
  // Identity is server-derived only (never client-supplied). Default-dormant: a no-op until the
  // shadow runtime is initialized (initShadowHook, wired separately under its own grant) AND
  // detection is enabled AND the tenant is allowlisted. No flag, no activation, no side effect.
  observeInboundTurnShadow({
    tenantId: sourceContext.tenantId,
    requesterId: ctx.GatewayClientPlatformUserId ?? sourceContext.userId ?? null,
    conversationId: sessionKey ?? null,
    employeeScopeAllowed: sourceContext.hasEnterpriseScope,
    messageId: messageId ?? "",
    text: ctx.BodyForCommands ?? ctx.Body ?? "",
  });

  // ConversationTask Runtime — official Activation bridge (fail-safe, default-off).
  // Same server-derived identity as the shadow hook. No-op unless the hook is
  // initialized and OPENBOT_CONVERSATION_TASK_ACTIVATION is on. Never throws
  // into this path and does not enable the flag.
  observeInboundTurnActivation({
    tenantId: sourceContext.tenantId,
    requesterId: ctx.GatewayClientPlatformUserId ?? sourceContext.userId ?? null,
    conversationId: sessionKey ?? null,
    employeeScopeAllowed: sourceContext.hasEnterpriseScope,
    messageId: messageId ?? "",
    text: ctx.BodyForCommands ?? ctx.Body ?? "",
  });

  // Accepted execution requests replace automatic activation and parallel dispatch.
  // Phase B B2 — web_read shadow (ORCH_SHADOW && WEB_READ_SHADOW). Utterance
  // selected here; Profile resolved only inside the adapter. Never mutates reply.
  observeWebReadShadowFromChat({
    cfg,
    tenantId: sourceContext.tenantId ?? null,
    messageId: messageId ?? null,
    utterance:
      [ctx.BodyForCommands, ctx.CommandBody, ctx.RawBody, ctx.Body].find(
        (value): value is string => typeof value === "string" && value.trim() !== "",
      ) ?? "",
  });

  // Check if we should route replies to originating channel instead of dispatcher.
  // Only route when the originating channel is DIFFERENT from the current surface.
  // This handles cross-provider routing (e.g., message from Telegram being processed
  // by a shared session that's currently on Slack) while preserving normal dispatcher
  // flow when the provider handles its own messages.
  //
  // Debug: `pnpm test src/auto-reply/reply/dispatch-from-config.test.ts`
  const originatingChannel = normalizeMessageChannel(ctx.OriginatingChannel);
  const originatingTo = ctx.OriginatingTo;
  const providerChannel = normalizeMessageChannel(ctx.Provider);
  const surfaceChannel = normalizeMessageChannel(ctx.Surface);
  // Prefer provider channel because surface may carry origin metadata in relayed flows.
  const currentSurface = providerChannel ?? surfaceChannel;
  const isInternalWebchatTurn =
    currentSurface === INTERNAL_MESSAGE_CHANNEL &&
    (surfaceChannel === INTERNAL_MESSAGE_CHANNEL || !surfaceChannel) &&
    ctx.ExplicitDeliverRoute !== true;
  const shouldRouteToOriginating = Boolean(
    !isInternalWebchatTurn &&
    isRoutableChannel(originatingChannel) &&
    originatingTo &&
    originatingChannel !== currentSurface,
  );
  const shouldSuppressTyping =
    shouldRouteToOriginating || originatingChannel === INTERNAL_MESSAGE_CHANNEL;
  const ttsChannel = shouldRouteToOriginating ? originatingChannel : currentSurface;

  /**
   * Helper to send a payload via route-reply (async).
   * Only used when actually routing to a different provider.
   * Note: Only called when shouldRouteToOriginating is true, so
   * originatingChannel and originatingTo are guaranteed to be defined.
   */
  const sendPayloadAsync = async (
    payload: ReplyPayload,
    abortSignal?: AbortSignal,
    mirror?: boolean,
  ): Promise<void> => {
    // TypeScript doesn't narrow these from the shouldRouteToOriginating check,
    // but they're guaranteed non-null when this function is called.
    if (!originatingChannel || !originatingTo) {
      return;
    }
    if (abortSignal?.aborted) {
      return;
    }
    const result = await routeReply({
      payload,
      channel: originatingChannel,
      to: originatingTo,
      sessionKey: ctx.SessionKey,
      taskId: params.replyOptions?.runId,
      accountId: ctx.AccountId,
      threadId: ctx.MessageThreadId,
      cfg: effectiveCfg,
      abortSignal,
      mirror,
      isGroup,
      groupId,
    });
    if (!result.ok) {
      logVerbose(`dispatch-from-config: route-reply failed: ${result.error ?? "unknown error"}`);
    }
  };

  markProcessing();

  // R85e: shared slot so agent-runner can publish deliveryId/taskId across options spreads.
  const pendingTurnDeliveryRef =
    params.replyOptions?.pendingTurnDeliveryRef ??
    ({ current: undefined } as NonNullable<
      NonNullable<typeof params.replyOptions>["pendingTurnDeliveryRef"]
    >);

  try {
    const fastAbort = await tryFastAbortFromMessage({ ctx, cfg: effectiveCfg });
    if (fastAbort.handled) {
      const payload = {
        text: formatAbortReplyText(fastAbort.stoppedSubagents),
      } satisfies ReplyPayload;
      let queuedFinal = false;
      let routedFinalCount = 0;
      if (shouldRouteToOriginating && originatingChannel && originatingTo) {
        const result = await routeReply({
          payload,
          channel: originatingChannel,
          to: originatingTo,
          sessionKey: ctx.SessionKey,
          accountId: ctx.AccountId,
          threadId: ctx.MessageThreadId,
          cfg: effectiveCfg,
          isGroup,
          groupId,
        });
        queuedFinal = result.ok;
        if (result.ok) {
          routedFinalCount += 1;
        }
        if (!result.ok) {
          logVerbose(
            `dispatch-from-config: route-reply (abort) failed: ${result.error ?? "unknown error"}`,
          );
        }
      } else {
        queuedFinal = dispatcher.sendFinalReply(payload);
      }
      const counts = dispatcher.getQueuedCounts();
      counts.final += routedFinalCount;
      recordProcessed("completed", { reason: "fast_abort" });
      markIdle("message_completed");
      return { queuedFinal, counts };
    }

    const bypassAcpForCommand = shouldBypassAcpDispatchForCommand(ctx, effectiveCfg);

    const sendPolicy = resolveSendPolicy({
      cfg: effectiveCfg,
      entry: sessionStoreEntry.entry,
      sessionKey: sessionStoreEntry.sessionKey ?? sessionKey,
      channel:
        sessionStoreEntry.entry?.channel ??
        ctx.OriginatingChannel ??
        ctx.Surface ??
        ctx.Provider ??
        undefined,
      chatType: sessionStoreEntry.entry?.chatType,
    });
    if (sendPolicy === "deny" && !bypassAcpForCommand) {
      logVerbose(
        `Send blocked by policy for session ${sessionStoreEntry.sessionKey ?? sessionKey ?? "unknown"}`,
      );
      const counts = dispatcher.getQueuedCounts();
      recordProcessed("completed", { reason: "send_policy_deny" });
      markIdle("message_completed");
      return { queuedFinal: false, counts };
    }

    const shouldSendToolSummaries = ctx.ChatType !== "group" && ctx.CommandSource !== "native";
    const acpDispatch = await tryDispatchAcpReply({
      ctx,
      cfg: effectiveCfg,
      dispatcher,
      sessionKey: acpDispatchSessionKey,
      inboundAudio,
      sessionTtsAuto,
      ttsChannel,
      shouldRouteToOriginating,
      originatingChannel,
      originatingTo,
      shouldSendToolSummaries,
      bypassForCommand: bypassAcpForCommand,
      onReplyStart: params.replyOptions?.onReplyStart,
      recordProcessed,
      markIdle,
    });
    if (acpDispatch) {
      return acpDispatch;
    }

    // Track accumulated block text for TTS generation after streaming completes.
    // When block streaming succeeds, there's no final reply, so we need to generate
    // TTS audio separately from the accumulated block content.
    let accumulatedBlockText = "";
    let blockCount = 0;

    const resolveToolDeliveryPayload = (payload: ReplyPayload): ReplyPayload | null => {
      if (
        normalizeMessageChannel(ctx.Surface ?? ctx.Provider) === "discord" &&
        shouldSuppressLocalDiscordExecApprovalPrompt({
          cfg: effectiveCfg,
          accountId: ctx.AccountId,
          payload,
        })
      ) {
        return null;
      }
      if (shouldSendToolSummaries) {
        return payload;
      }
      const execApproval =
        payload.channelData &&
        typeof payload.channelData === "object" &&
        !Array.isArray(payload.channelData)
          ? payload.channelData.execApproval
          : undefined;
      if (execApproval && typeof execApproval === "object" && !Array.isArray(execApproval)) {
        return payload;
      }
      // Group/native flows intentionally suppress tool summary text, but media-only
      // tool results (for example TTS audio) must still be delivered.
      const hasMedia = Boolean(payload.mediaUrl) || (payload.mediaUrls?.length ?? 0) > 0;
      if (!hasMedia) {
        return null;
      }
      return { ...payload, text: undefined };
    };
    const typing = resolveRunTypingPolicy({
      requestedPolicy: params.replyOptions?.typingPolicy,
      suppressTyping: params.replyOptions?.suppressTyping === true || shouldSuppressTyping,
      originatingChannel,
      systemEvent: shouldRouteToOriginating,
    });

    let completionBinding =
      interactionIngress && !params.replyOptions?.resumedTaskBinding
        ? undefined
        : captureTaskCompletionBinding(
            sessionStoreEntry.entry?.sessionFile,
            [ctx.BodyForCommands, ctx.CommandBody, ctx.RawBody, ctx.Body].find(
              (value): value is string => typeof value === "string" && value.trim() !== "",
            ) ?? "",
          );
    let executionDeliveryBoundary: TaskActionBoundary | undefined;
    const taskDeliveryContext = () =>
      executionDeliveryBoundary ? { taskBoundary: executionDeliveryBoundary } : undefined;
    const replyResult = await (params.replyResolver ?? getReplyFromConfig)(
      ctx,
      {
        ...params.replyOptions,
        ...(interactionIngress ? { interactionIngress } : {}),
        onTaskExecutionBound: (binding, context) => {
          completionBinding = binding;
          const sessionFile = context?.sessionFile ?? sessionStoreEntry.entry?.sessionFile;
          executionDeliveryBoundary = sessionFile
            ? {
                sessionFile,
                binding: { ...binding },
                constraints: [...(binding.constraints ?? [])],
              }
            : undefined;
          params.replyOptions?.onTaskExecutionBound?.(binding, context);
        },
        pendingTurnDeliveryRef,
        typingPolicy: typing.typingPolicy,
        suppressTyping: typing.suppressTyping,
        onToolResult: (payload: ReplyPayload) => {
          const run = async () => {
            if (shouldRouteToOriginating) {
              return;
            }
            const ttsPayload = await maybeApplyTtsToPayload({
              payload,
              cfg: effectiveCfg,
              channel: ttsChannel,
              kind: "tool",
              inboundAudio,
              ttsAuto: sessionTtsAuto,
            });
            const deliveryPayload = resolveToolDeliveryPayload(ttsPayload);
            if (!deliveryPayload) {
              return;
            }
            if (shouldRouteToOriginating) {
              await sendPayloadAsync(deliveryPayload, undefined, false);
            } else {
              dispatcher.sendToolResult(
                deliveryPayload,
                ...(taskDeliveryContext() ? [taskDeliveryContext()] : []),
              );
            }
          };
          return run();
        },
        onBlockReply: (payload: ReplyPayload) => {
          const run = async () => {
            // Suppress reasoning payloads — channels using this generic dispatch
            // path (WhatsApp, web, etc.) do not have a dedicated reasoning lane.
            // Telegram has its own dispatch path that handles reasoning splitting.
            if (shouldSuppressReasoningPayload(payload)) {
              return;
            }
            // Accumulate block text for TTS generation after streaming
            if (payload.text) {
              if (accumulatedBlockText.length > 0) {
                accumulatedBlockText += "\n";
              }
              accumulatedBlockText += payload.text;
              blockCount++;
            }
            const ttsPayload = await maybeApplyTtsToPayload({
              payload,
              cfg: effectiveCfg,
              channel: ttsChannel,
              kind: "block",
              inboundAudio,
              ttsAuto: sessionTtsAuto,
            });
            if (!shouldRouteToOriginating) {
              dispatcher.sendBlockReply(
                ttsPayload,
                ...(taskDeliveryContext() ? [taskDeliveryContext()] : []),
              );
            }
          };
          return run();
        },
      },
      effectiveCfg,
    );

    if (ctx.AcpDispatchTailAfterReset === true) {
      // Command handling prepared a trailing prompt after ACP in-place reset.
      // Route that tail through ACP now (same turn) instead of embedded dispatch.
      ctx.AcpDispatchTailAfterReset = false;
      const acpTailDispatch = await tryDispatchAcpReply({
        ctx,
        cfg: effectiveCfg,
        dispatcher,
        sessionKey: acpDispatchSessionKey,
        inboundAudio,
        sessionTtsAuto,
        ttsChannel,
        shouldRouteToOriginating,
        originatingChannel,
        originatingTo,
        shouldSendToolSummaries,
        bypassForCommand: false,
        onReplyStart: params.replyOptions?.onReplyStart,
        recordProcessed,
        markIdle,
      });
      if (acpTailDispatch) {
        return acpTailDispatch;
      }
    }

    const deliveryTaskBoundary = executionDeliveryBoundary;
    const replies = replyResult ? (Array.isArray(replyResult) ? replyResult : [replyResult]) : [];

    let queuedFinal = false;
    let routedFinalCount = 0;
    // R85d: record each required delivery attempt; aggregate with AND (not OR).
    const requiredDeliveryAttempts: RequiredDeliveryAttempt[] = [];
    for (const reply of replies) {
      // Suppress reasoning payloads from channel delivery — channels using this
      // generic dispatch path do not have a dedicated reasoning lane.
      if (shouldSuppressReasoningPayload(reply)) {
        continue;
      }
      const ttsReply = await maybeApplyTtsToPayload({
        payload: reply,
        cfg: effectiveCfg,
        channel: ttsChannel,
        kind: "final",
        inboundAudio,
        ttsAuto: sessionTtsAuto,
      });
      if (shouldRouteToOriginating && originatingChannel && originatingTo) {
        // Route final reply to originating channel — actual deliver receipt.
        const result = await routeReply({
          payload: ttsReply,
          channel: originatingChannel,
          to: originatingTo,
          sessionKey: ctx.SessionKey,
          taskId: params.replyOptions?.runId,
          taskBoundary: deliveryTaskBoundary,
          accountId: ctx.AccountId,
          threadId: ctx.MessageThreadId,
          cfg: effectiveCfg,
          isGroup,
          groupId,
        });
        if (!result.ok) {
          logVerbose(
            `dispatch-from-config: route-reply (final) failed: ${result.error ?? "unknown error"}`,
          );
        }
        requiredDeliveryAttempts.push({
          source: "deliver",
          ok: result.ok,
          ...(result.error ? { error: result.error } : {}),
        });
        // queuedFinal remains a dispatcher hint; delivery confirm uses AND aggregate.
        queuedFinal = result.ok && (queuedFinal || requiredDeliveryAttempts.length === 1);
        if (!result.ok) {
          queuedFinal = false;
        } else if (requiredDeliveryAttempts.every((a) => a.ok)) {
          queuedFinal = true;
        }
        if (result.ok) {
          routedFinalCount += 1;
        }
      } else {
        // Dispatcher enqueue is NOT a send receipt.
        const didQueue = dispatcher.sendFinalReply(
          ttsReply,
          ...(taskDeliveryContext() ? [taskDeliveryContext()] : []),
        );
        requiredDeliveryAttempts.push({
          source: "enqueue_only",
          ok: didQueue,
          ...(didQueue ? {} : { error: "final_reply_not_queued" }),
        });
        queuedFinal = didQueue && requiredDeliveryAttempts.every((a) => a.ok);
      }
    }

    const ttsMode = resolveTtsConfig(cfg).mode ?? "final";
    // Generate TTS-only reply after block streaming completes (when there's no final reply).
    // This handles the case where block streaming succeeds and drops final payloads,
    // but we still want TTS audio to be generated from the accumulated block content.
    if (replies.length === 0 && blockCount > 0 && accumulatedBlockText.trim()) {
      try {
        const ttsSyntheticReply = await maybeApplyTtsToPayload({
          payload: { text: accumulatedBlockText },
          cfg: effectiveCfg,
          channel: ttsChannel,
          kind: "final",
          inboundAudio,
          ttsAuto: sessionTtsAuto,
        });
        if (shouldRouteToOriginating && originatingChannel && originatingTo) {
          const result = await routeReply({
            payload: ttsSyntheticReply,
            channel: originatingChannel,
            to: originatingTo,
            sessionKey: ctx.SessionKey,
            taskId: params.replyOptions?.runId,
            taskBoundary: deliveryTaskBoundary,
            accountId: ctx.AccountId,
            threadId: ctx.MessageThreadId,
            cfg: effectiveCfg,
            isGroup,
            groupId,
          });
          requiredDeliveryAttempts.push({
            source: "deliver",
            ok: result.ok,
            ...(result.error ? { error: result.error } : {}),
          });
          queuedFinal = result.ok && requiredDeliveryAttempts.every((a) => a.ok);
          if (result.ok) {
            routedFinalCount += 1;
          }
          if (!result.ok) {
            queuedFinal = false;
            logVerbose(
              `dispatch-from-config: route-reply (buffered-final) failed: ${result.error ?? "unknown error"}`,
            );
          }
        } else if (ttsMode === "final" && ttsSyntheticReply.mediaUrl) {
          // Send TTS-only payload (no text, just audio) so it doesn't duplicate the block content
          const ttsOnlyPayload: ReplyPayload = {
            mediaUrl: ttsSyntheticReply.mediaUrl,
            audioAsVoice: ttsSyntheticReply.audioAsVoice,
          };
          const didQueue = dispatcher.sendFinalReply(ttsOnlyPayload);
          requiredDeliveryAttempts.push({
            source: "enqueue_only",
            ok: didQueue,
            ...(didQueue ? {} : { error: "tts_final_not_queued" }),
          });
          queuedFinal = didQueue && requiredDeliveryAttempts.every((a) => a.ok);
        }
      } catch (err) {
        requiredDeliveryAttempts.push({
          source: "deliver",
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
        queuedFinal = false;
        logVerbose(
          `dispatch-from-config: accumulated block TTS failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Apply channel send result to TaskOutcome delivery (prepare left it pending).
    // R85e: enqueue_only → delivery_unknown (keep pending); wait for real deliver()
    // settlements on the dispatcher, then AND-aggregate and clear only on terminal.
    {
      const sendAttempted =
        replies.length > 0 || (blockCount > 0 && Boolean(accumulatedBlockText.trim()));
      if (sendAttempted) {
        const pendingIds = pendingTurnDeliveryRef.current;
        const confirmIds = {
          runId: params.replyOptions?.runId ?? pendingIds?.runId,
          deliveryId: pendingIds?.deliveryId,
          taskId: pendingIds?.taskId,
          sessionKey: sessionKey ?? ctx.SessionKey,
        };

        const enqueuedOnly = requiredDeliveryAttempts.some((a) => a.source === "enqueue_only");
        if (enqueuedOnly) {
          // Intermediate: record unknown without clearing association.
          const interim = resolveRequiredDeliveryConfirmStatus(requiredDeliveryAttempts);
          if (interim === "delivery_unknown" || interim === "failed") {
            const firstErr = requiredDeliveryAttempts.find((a) => !a.ok)?.error;
            await confirmPendingTurnDelivery({
              cfg: effectiveCfg,
              ...confirmIds,
              status: interim === "failed" ? "failed" : "delivery_unknown",
              error:
                interim === "failed"
                  ? (firstErr ?? "channel_send_failed_or_not_queued")
                  : (firstErr ?? "enqueue_only_not_a_send_receipt"),
            });
          }

          // Wait for actual dispatcher deliver() callbacks to settle.
          try {
            await dispatcher.waitForIdle();
          } catch (err) {
            logVerbose(
              `dispatch-from-config: waitForIdle before delivery confirm failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }

          const finalOutcomes =
            typeof dispatcher.getDeliveryOutcomes === "function"
              ? dispatcher.getDeliveryOutcomes().filter((o) => o.kind === "final")
              : [];
          if (finalOutcomes.length > 0) {
            const keptDelivers = requiredDeliveryAttempts.filter((a) => a.source === "deliver");
            const enqueueFails = requiredDeliveryAttempts.filter(
              (a) => a.source === "enqueue_only" && !a.ok,
            );
            requiredDeliveryAttempts.length = 0;
            requiredDeliveryAttempts.push(
              ...keptDelivers,
              ...finalOutcomes.map((o) => ({
                source: "deliver" as const,
                ok: o.ok,
                ...(o.error ? { error: o.error } : {}),
              })),
              ...enqueueFails,
            );
          }
        }

        const confirmStatus = resolveRequiredDeliveryConfirmStatus(requiredDeliveryAttempts);
        if (confirmStatus !== "none") {
          const firstErr = requiredDeliveryAttempts.find((a) => !a.ok)?.error;
          await confirmPendingTurnDelivery({
            cfg: effectiveCfg,
            ...confirmIds,
            status: confirmStatus,
            error:
              confirmStatus === "delivered"
                ? undefined
                : (firstErr ??
                  (confirmStatus === "delivery_unknown"
                    ? "enqueue_only_not_a_send_receipt"
                    : "channel_send_failed_or_not_queued")),
          });
        }
      }
    }

    const counts = dispatcher.getQueuedCounts();
    counts.final += routedFinalCount;
    const assistantReplyText = replies
      .map((reply) => (typeof reply.text === "string" ? reply.text.trim() : ""))
      .filter(Boolean)
      .join("\n\n");
    // A queued or failed final must not close the conversation task.
    if (resolveRequiredDeliveryConfirmStatus(requiredDeliveryAttempts) === "delivered") {
      void observeConversationTaskReplyCompleted({
        tenantId: sourceContext.tenantId,
        requesterId: ctx.GatewayClientPlatformUserId ?? sourceContext.userId ?? null,
        conversationId: sessionKey ?? null,
        sourceMessageId: messageId ?? "",
        text:
          [ctx.BodyForCommands, ctx.CommandBody, ctx.RawBody, ctx.Body].find(
            (value): value is string => typeof value === "string" && value.trim() !== "",
          ) ?? "",
        assistantReplyText: assistantReplyText || accumulatedBlockText.trim() || undefined,
        cronStorePath: resolveCronStorePath(effectiveCfg.cron?.store),
        sessionFile: sessionStoreEntry.entry?.sessionFile,
        completionBinding,
      }).then((notice) => {
        if (!notice) {
          return;
        }
        try {
          dispatcher.sendFinalReply({ text: notice });
        } catch {
          // Completion notice must not fail the already-finished reply.
        }
      });
    }
    recordProcessed("completed");
    markIdle("message_completed");
    return { queuedFinal, counts };
  } catch (err) {
    {
      const pendingIds = pendingTurnDeliveryRef?.current;
      await confirmPendingTurnDelivery({
        cfg: effectiveCfg,
        runId: params.replyOptions?.runId ?? pendingIds?.runId,
        deliveryId: pendingIds?.deliveryId,
        taskId: pendingIds?.taskId,
        sessionKey: sessionKey ?? ctx.SessionKey,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
    recordProcessed("error", { error: String(err) });
    markIdle("message_error");
    throw err;
  }
}
