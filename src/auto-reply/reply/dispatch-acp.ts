import fs from "node:fs/promises";
import { getAcpSessionManager } from "../../acp/control-plane/manager.js";
import type { AcpTurnAttachment } from "../../acp/control-plane/manager.types.js";
import { resolveAcpAgentPolicyError, resolveAcpDispatchPolicyError } from "../../acp/policy.js";
import { formatAcpRuntimeErrorText } from "../../acp/runtime/error-text.js";
import { toAcpRuntimeError } from "../../acp/runtime/errors.js";
import { resolveAcpThreadSessionDetailLines } from "../../acp/runtime/session-identifiers.js";
import {
  isSessionIdentityPending,
  resolveSessionIdentityFromMeta,
} from "../../acp/runtime/session-identity.js";
import { readAcpSessionEntry } from "../../acp/runtime/session-meta.js";
import { observePreflightRuntimeFacade } from "../../agents/execution-preflight/constitutional-runtime-facade.js";
import { buildExecutionPreflight } from "../../agents/execution-preflight/resolve.js";
import type { OpenBotConfig } from "../../config/config.js";
import type { TtsAutoMode } from "../../config/types.tts.js";
import {
  mediaUnderstandingUsesFromOutputs,
  recordMediaUnderstandingShadow,
} from "../../gateway/governance/media-understanding-shadow.js";
import { logVerbose } from "../../globals.js";
import { isTruthyEnvValue } from "../../infra/env.js";
import { getSessionBindingService } from "../../infra/outbound/session-binding-service.js";
import { generateSecureUuid } from "../../infra/secure-random.js";
import { prefixSystemMessage } from "../../infra/system-message.js";
import { logWarn } from "../../logger.js";
import { applyMediaUnderstanding } from "../../media-understanding/apply.js";
import {
  normalizeAttachmentPath,
  normalizeAttachments,
} from "../../media-understanding/attachments.normalize.js";
import { normalizeAgentId, resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { maybeApplyTtsToPayload, resolveTtsConfig } from "../../tts/tts.js";
import {
  isCommandEnabled,
  maybeResolveTextAlias,
  shouldHandleTextCommands,
} from "../commands-registry.js";
import type { FinalizedMsgContext } from "../templating.js";
import { createAcpReplyProjector } from "./acp-projector.js";
import { createAcpDispatchDeliveryCoordinator } from "./dispatch-acp-delivery.js";
import type { ReplyDispatcher, ReplyDispatchKind } from "./reply-dispatcher.js";

type DispatchProcessedRecorder = (
  outcome: "completed" | "skipped" | "error",
  opts?: {
    reason?: string;
    error?: string;
  },
) => void;

function resolveFirstContextText(
  ctx: FinalizedMsgContext,
  keys: Array<"BodyForAgent" | "BodyForCommands" | "CommandBody" | "RawBody" | "Body">,
): string {
  for (const key of keys) {
    const value = ctx[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

function resolveAcpPromptText(ctx: FinalizedMsgContext): string {
  const promptText = resolveFirstContextText(ctx, [
    "BodyForAgent",
    "BodyForCommands",
    "CommandBody",
    "RawBody",
    "Body",
  ]).trim();
  if (promptText) {
    return promptText;
  }
  const mediaAttachments = normalizeAttachments(ctx);
  const fileAttachments = mediaAttachments.filter((attachment) => {
    const mime = attachment.mime ?? "application/octet-stream";
    return !mime.startsWith("image/");
  });
  if (fileAttachments.length === 0) {
    return "";
  }
  return [
    "<attachments>",
    ...fileAttachments.map((attachment, index) => {
      const source = attachment.path?.trim() || attachment.url?.trim() || "";
      const name = source.split(/[\\/]/).pop() || `attachment-${index + 1}`;
      const mime = attachment.mime ?? "application/octet-stream";
      return `<attachment name="${name.replace(/[<>&"]/g, "_")}" mime="${mime.replace(/[<>&"]/g, "_")}" status="received" />`;
    }),
    "</attachments>",
  ].join("\n");
}

const ACP_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

async function resolveAcpAttachments(ctx: FinalizedMsgContext): Promise<AcpTurnAttachment[]> {
  const mediaAttachments = normalizeAttachments(ctx);
  const results: AcpTurnAttachment[] = [];
  for (const attachment of mediaAttachments) {
    const mediaType = attachment.mime ?? "application/octet-stream";
    if (!mediaType.startsWith("image/")) {
      continue;
    }
    const filePath = normalizeAttachmentPath(attachment.path);
    if (!filePath) {
      continue;
    }
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > ACP_ATTACHMENT_MAX_BYTES) {
        logVerbose(
          `dispatch-acp: skipping attachment ${filePath} (${stat.size} bytes exceeds ${ACP_ATTACHMENT_MAX_BYTES} byte limit)`,
        );
        continue;
      }
      const buf = await fs.readFile(filePath);
      results.push({
        mediaType,
        data: buf.toString("base64"),
      });
    } catch {
      // Skip unreadable files. Text content should still be delivered.
    }
  }
  return results;
}

function resolveCommandCandidateText(ctx: FinalizedMsgContext): string {
  return resolveFirstContextText(ctx, ["CommandBody", "BodyForCommands", "RawBody", "Body"]).trim();
}

export function shouldBypassAcpDispatchForCommand(
  ctx: FinalizedMsgContext,
  cfg: OpenBotConfig,
): boolean {
  const candidate = resolveCommandCandidateText(ctx);
  if (!candidate) {
    return false;
  }
  const allowTextCommands = shouldHandleTextCommands({
    cfg,
    surface: ctx.Surface ?? ctx.Provider ?? "",
    commandSource: ctx.CommandSource,
  });
  if (maybeResolveTextAlias(candidate, cfg) != null) {
    return allowTextCommands;
  }

  const normalized = candidate.trim();
  if (!normalized.startsWith("!")) {
    return false;
  }

  if (!ctx.CommandAuthorized) {
    return false;
  }

  if (!isCommandEnabled(cfg, "bash")) {
    return false;
  }

  return allowTextCommands;
}

/**
 * Observe-only. Unset/off keeps ACP in-process dispatch on today's policy and
 * allowlist path. Truthy values match isTruthyEnvValue (1, true, yes, on).
 */
export const ACP_TURN_PREFLIGHT_OBSERVE_ENV = "OPENBOT_ACP_TURN_PREFLIGHT_OBSERVE";

export function isAcpTurnPreflightObserveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyEnvValue(env[ACP_TURN_PREFLIGHT_OBSERVE_ENV]);
}

/** Process-local trace key. Not a completion, ledger, or authorization id. */
export function acpInProcessTurnObserveTaskId(sessionKey: string, agentId: string): string {
  return `acp-inprocess-turn:${sessionKey}:${normalizeAgentId(agentId)}`;
}

/**
 * Names already admitted by `allowedAgents`. An empty allowlist admits the
 * resolved agent. These are observe labels, not a Pi tool catalog.
 */
export function acpInProcessTurnObserveNames(cfg: OpenBotConfig, agentId: string): string[] {
  const allowed = (cfg.acp?.allowedAgents ?? [])
    .map((entry) => normalizeAgentId(entry))
    .filter(Boolean);
  if (allowed.length > 0) {
    return allowed;
  }
  const resolved = normalizeAgentId(agentId);
  return resolved ? [resolved] : [];
}

function observeAcpInProcessTurnPreflight(params: {
  cfg: OpenBotConfig;
  sessionKey: string;
  agentId: string;
}): void {
  if (!isAcpTurnPreflightObserveEnabled()) {
    return;
  }
  try {
    // Record the existing preflight trace only. The returned tool set is unused.
    buildExecutionPreflight({
      taskId: acpInProcessTurnObserveTaskId(params.sessionKey, params.agentId),
      sessionId: params.sessionKey,
      message: normalizeAgentId(params.agentId),
      skills: [],
      policyToolNames: acpInProcessTurnObserveNames(params.cfg, params.agentId),
      catalogToolNames: acpInProcessTurnObserveNames(params.cfg, params.agentId),
    });
  } catch (err) {
    logWarn(`dispatch-acp: observe preflight failed: ${String(err)}`);
  }
}

/**
 * Phase D H1 — one hot-path façade observe beside the ACP turn soft-observe.
 * Start-order: `phase_d_hotpath_facade_observe_one_site_start_order`.
 * Reuses #60 `observePreflightRuntimeFacade`. Caller passes an env snapshot;
 * the façade module does not read `process.env`. Prefer
 * `OPENBOT_CONSTITUTIONAL_SHADOW` (default off → inert; on → report-only).
 * Discard the result (including allow / selectedPath). Never apply/arm,
 * never Gate tighten, never enforce default-on.
 */
function observeAcpInProcessTurnRuntimeFacade(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  try {
    observePreflightRuntimeFacade({ env });
  } catch (err) {
    logWarn(`dispatch-acp: runtime façade observe failed: ${String(err)}`);
  }
}

function resolveAcpRequestId(ctx: FinalizedMsgContext): string {
  const id = ctx.MessageSidFull ?? ctx.MessageSid ?? ctx.MessageSidFirst ?? ctx.MessageSidLast;
  if (typeof id === "string" && id.trim()) {
    return id.trim();
  }
  if (typeof id === "number" || typeof id === "bigint") {
    return String(id);
  }
  return generateSecureUuid();
}

function hasBoundConversationForSession(params: {
  sessionKey: string;
  channelRaw: string | undefined;
  accountIdRaw: string | undefined;
}): boolean {
  const channel = String(params.channelRaw ?? "")
    .trim()
    .toLowerCase();
  if (!channel) {
    return false;
  }
  const accountId = String(params.accountIdRaw ?? "")
    .trim()
    .toLowerCase();
  const normalizedAccountId = accountId || "default";
  const bindingService = getSessionBindingService();
  const bindings = bindingService.listBySession(params.sessionKey);
  return bindings.some((binding) => {
    const bindingChannel = String(binding.conversation.channel ?? "")
      .trim()
      .toLowerCase();
    const bindingAccountId = String(binding.conversation.accountId ?? "")
      .trim()
      .toLowerCase();
    const conversationId = String(binding.conversation.conversationId ?? "").trim();
    return (
      bindingChannel === channel &&
      (bindingAccountId || "default") === normalizedAccountId &&
      conversationId.length > 0
    );
  });
}

export type AcpDispatchAttemptResult = {
  queuedFinal: boolean;
  counts: Record<ReplyDispatchKind, number>;
};

export async function tryDispatchAcpReply(params: {
  ctx: FinalizedMsgContext;
  cfg: OpenBotConfig;
  dispatcher: ReplyDispatcher;
  sessionKey?: string;
  inboundAudio: boolean;
  sessionTtsAuto?: TtsAutoMode;
  ttsChannel?: string;
  shouldRouteToOriginating: boolean;
  originatingChannel?: string;
  originatingTo?: string;
  shouldSendToolSummaries: boolean;
  bypassForCommand: boolean;
  onReplyStart?: () => Promise<void> | void;
  recordProcessed: DispatchProcessedRecorder;
  markIdle: (reason: string) => void;
}): Promise<AcpDispatchAttemptResult | null> {
  const sessionKey = params.sessionKey?.trim();
  if (!sessionKey || params.bypassForCommand) {
    return null;
  }

  const acpManager = getAcpSessionManager();
  const acpResolution = acpManager.resolveSession({
    cfg: params.cfg,
    sessionKey,
  });
  if (acpResolution.kind === "none") {
    return null;
  }

  let queuedFinal = false;
  const delivery = createAcpDispatchDeliveryCoordinator({
    cfg: params.cfg,
    ctx: params.ctx,
    dispatcher: params.dispatcher,
    inboundAudio: params.inboundAudio,
    sessionTtsAuto: params.sessionTtsAuto,
    ttsChannel: params.ttsChannel,
    shouldRouteToOriginating: params.shouldRouteToOriginating,
    originatingChannel: params.originatingChannel,
    originatingTo: params.originatingTo,
    onReplyStart: params.onReplyStart,
  });

  const identityPendingBeforeTurn = isSessionIdentityPending(
    resolveSessionIdentityFromMeta(acpResolution.kind === "ready" ? acpResolution.meta : undefined),
  );
  const shouldEmitResolvedIdentityNotice =
    identityPendingBeforeTurn &&
    (Boolean(params.ctx.MessageThreadId != null && String(params.ctx.MessageThreadId).trim()) ||
      hasBoundConversationForSession({
        sessionKey,
        channelRaw: params.ctx.OriginatingChannel ?? params.ctx.Surface ?? params.ctx.Provider,
        accountIdRaw: params.ctx.AccountId,
      }));

  const resolvedAcpAgent =
    acpResolution.kind === "ready"
      ? (
          acpResolution.meta.agent?.trim() ||
          params.cfg.acp?.defaultAgent?.trim() ||
          resolveAgentIdFromSessionKey(sessionKey)
        ).trim()
      : resolveAgentIdFromSessionKey(sessionKey);
  const projector = createAcpReplyProjector({
    cfg: params.cfg,
    shouldSendToolSummaries: params.shouldSendToolSummaries,
    deliver: delivery.deliver,
    provider: params.ctx.Surface ?? params.ctx.Provider,
    accountId: params.ctx.AccountId,
  });

  const acpDispatchStartedAt = Date.now();
  try {
    const dispatchPolicyError = resolveAcpDispatchPolicyError(params.cfg);
    if (dispatchPolicyError) {
      throw dispatchPolicyError;
    }
    if (acpResolution.kind === "stale") {
      throw acpResolution.error;
    }
    const agentPolicyError = resolveAcpAgentPolicyError(params.cfg, resolvedAcpAgent);
    if (agentPolicyError) {
      throw agentPolicyError;
    }
    if (!params.ctx.MediaUnderstanding?.length) {
      try {
        const mediaUnderstanding = await applyMediaUnderstanding({
          ctx: params.ctx,
          cfg: params.cfg,
        });
        // E19, same reason as the chat path in get-reply.ts: a model ran here
        // outside the model-fallback helpers, so record it rather than leave it
        // invisible to the §4.8 coverage rule.
        await recordMediaUnderstandingShadow({
          uses: mediaUnderstandingUsesFromOutputs(mediaUnderstanding.outputs),
          ...(params.ctx.GatewayClientSessionEnterpriseId?.trim()
            ? { tenantId: params.ctx.GatewayClientSessionEnterpriseId.trim() }
            : {}),
          ...(params.ctx.GatewayClientPlatformUserId
            ? { platformUserId: params.ctx.GatewayClientPlatformUserId }
            : {}),
        });
      } catch (err) {
        logVerbose(
          `dispatch-acp: media understanding failed, proceeding with raw content: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const promptText = resolveAcpPromptText(params.ctx);
    const attachments = await resolveAcpAttachments(params.ctx);
    if (!promptText && attachments.length === 0) {
      const counts = params.dispatcher.getQueuedCounts();
      delivery.applyRoutedCounts(counts);
      params.recordProcessed("completed", { reason: "acp_empty_prompt" });
      params.markIdle("message_completed");
      return { queuedFinal: false, counts };
    }

    try {
      await delivery.startReplyLifecycle();
    } catch (error) {
      logVerbose(
        `dispatch-acp: start reply lifecycle failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    observeAcpInProcessTurnPreflight({
      cfg: params.cfg,
      sessionKey,
      agentId: resolvedAcpAgent,
    });
    // H1: one #60 façade observe beside ACP turn soft-observe (report-only).
    observeAcpInProcessTurnRuntimeFacade();

    await acpManager.runTurn({
      cfg: params.cfg,
      sessionKey,
      text: promptText,
      attachments: attachments.length > 0 ? attachments : undefined,
      mode: "prompt",
      requestId: resolveAcpRequestId(params.ctx),
      onEvent: async (event) => await projector.onEvent(event),
    });

    await projector.flush(true);
    const ttsMode = resolveTtsConfig(params.cfg).mode ?? "final";
    const accumulatedBlockText = delivery.getAccumulatedBlockText();
    if (
      params.shouldRouteToOriginating &&
      delivery.getBlockCount() > 0 &&
      accumulatedBlockText.trim()
    ) {
      try {
        const bufferedFinalReply = await maybeApplyTtsToPayload({
          payload: { text: accumulatedBlockText },
          cfg: params.cfg,
          channel: params.ttsChannel,
          kind: "final",
          inboundAudio: params.inboundAudio,
          ttsAuto: params.sessionTtsAuto,
        });
        const delivered = await delivery.deliver("final", bufferedFinalReply);
        queuedFinal = queuedFinal || delivered;
      } catch (err) {
        logVerbose(
          `dispatch-acp: buffered ACP final delivery failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else if (ttsMode === "final" && delivery.getBlockCount() > 0 && accumulatedBlockText.trim()) {
      try {
        const ttsSyntheticReply = await maybeApplyTtsToPayload({
          payload: { text: accumulatedBlockText },
          cfg: params.cfg,
          channel: params.ttsChannel,
          kind: "final",
          inboundAudio: params.inboundAudio,
          ttsAuto: params.sessionTtsAuto,
        });
        if (ttsSyntheticReply.mediaUrl) {
          const delivered = await delivery.deliver("final", {
            mediaUrl: ttsSyntheticReply.mediaUrl,
            audioAsVoice: ttsSyntheticReply.audioAsVoice,
          });
          queuedFinal = queuedFinal || delivered;
        }
      } catch (err) {
        logVerbose(
          `dispatch-acp: accumulated ACP block TTS failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (shouldEmitResolvedIdentityNotice) {
      const currentMeta = readAcpSessionEntry({
        cfg: params.cfg,
        sessionKey,
      })?.acp;
      const identityAfterTurn = resolveSessionIdentityFromMeta(currentMeta);
      if (!isSessionIdentityPending(identityAfterTurn)) {
        const resolvedDetails = resolveAcpThreadSessionDetailLines({
          sessionKey,
          meta: currentMeta,
        });
        if (resolvedDetails.length > 0) {
          const delivered = await delivery.deliver("final", {
            text: prefixSystemMessage(["Session ids resolved.", ...resolvedDetails].join("\n")),
          });
          queuedFinal = queuedFinal || delivered;
        }
      }
    }

    const counts = params.dispatcher.getQueuedCounts();
    delivery.applyRoutedCounts(counts);
    const acpStats = acpManager.getObservabilitySnapshot(params.cfg);
    logVerbose(
      `acp-dispatch: session=${sessionKey} outcome=ok latencyMs=${Date.now() - acpDispatchStartedAt} queueDepth=${acpStats.turns.queueDepth} activeRuntimes=${acpStats.runtimeCache.activeSessions}`,
    );
    params.recordProcessed("completed", { reason: "acp_dispatch" });
    params.markIdle("message_completed");
    return { queuedFinal, counts };
  } catch (err) {
    await projector.flush(true);
    const acpError = toAcpRuntimeError({
      error: err,
      fallbackCode: "ACP_TURN_FAILED",
      fallbackMessage: "ACP turn failed before completion.",
    });
    const delivered = await delivery.deliver("final", {
      text: formatAcpRuntimeErrorText(acpError),
      isError: true,
    });
    queuedFinal = queuedFinal || delivered;
    const counts = params.dispatcher.getQueuedCounts();
    delivery.applyRoutedCounts(counts);
    const acpStats = acpManager.getObservabilitySnapshot(params.cfg);
    logVerbose(
      `acp-dispatch: session=${sessionKey} outcome=error code=${acpError.code} latencyMs=${Date.now() - acpDispatchStartedAt} queueDepth=${acpStats.turns.queueDepth} activeRuntimes=${acpStats.runtimeCache.activeSessions}`,
    );
    params.recordProcessed("completed", {
      reason: `acp_error:${acpError.code.toLowerCase()}`,
    });
    params.markIdle("message_completed");
    return { queuedFinal, counts };
  }
}
