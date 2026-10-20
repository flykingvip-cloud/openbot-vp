/**
 * DingTalk inbound processing (text DM happy path).
 *
 * Exported for Stage 7 evidence and for future stream/webhook monitors.
 * Live Stream/Webhook transport is not wired here; this is the in-process
 * route → reply → outbound send path.
 */
import {
  createScopedPairingAccess,
  issuePairingChallenge,
  logInboundDrop,
  readStoreAllowFromForDmPolicy,
  resolveDmGroupAccessWithCommandGate,
  resolveInboundRouteEnvelopeBuilderWithRuntime,
  type OpenBotConfig,
} from "openclaw/plugin-sdk/compat";
import { normalizeDingtalkTarget, sendDingtalkMessage } from "./api.js";
import { getDingtalkRuntime } from "./runtime.js";
import type { DingtalkInboundMessage, ResolvedDingtalkAccount } from "./types.js";

const CHANNEL_ID = "dingtalk" as const;

function normalizeAllowEntry(value: string | number): string {
  return String(value)
    .trim()
    .replace(/^dingtalk:/i, "")
    .replace(/^user:/i, "");
}

function isSenderAllowed(senderId: string, allowFrom: readonly string[]): boolean {
  return allowFrom.includes("*") || allowFrom.includes(senderId);
}

function resolveInboundText(message: DingtalkInboundMessage): string {
  if (message.msgtype !== "text") {
    return "";
  }
  return message.text?.content?.trim() ?? "";
}

export async function processDingtalkInbound(params: {
  message: DingtalkInboundMessage;
  account: ResolvedDingtalkAccount;
  config: OpenBotConfig;
  runtime: {
    log?: (message: string) => void;
    error?: (message: string) => void;
  };
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { message, account, config, runtime, statusSink } = params;
  const core = getDingtalkRuntime();
  const pairing = createScopedPairingAccess({
    core,
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });

  const rawBody = resolveInboundText(message);
  if (!rawBody) {
    return;
  }

  const senderId = normalizeDingtalkTarget(message.senderId) ?? message.senderId.trim();
  if (!senderId) {
    return;
  }

  const isGroup = message.conversationType === "2";
  const dmPolicy = account.config.dm?.policy ?? "pairing";
  const storeAllowFrom = await readStoreAllowFromForDmPolicy({
    provider: CHANNEL_ID,
    accountId: account.accountId,
    dmPolicy,
    readStore: pairing.readStoreForDmPolicy,
  });
  const configAllowFrom = (account.config.dm?.allowFrom ?? []).map(normalizeAllowEntry);
  const effectiveStoreAllowFrom = storeAllowFrom.map(normalizeAllowEntry);

  const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
    cfg: config,
    surface: CHANNEL_ID,
  });
  const useAccessGroups =
    (config.commands as Record<string, unknown> | undefined)?.useAccessGroups !== false;
  const hasControlCommand = core.channel.text.hasControlCommand(rawBody, config);

  const access = resolveDmGroupAccessWithCommandGate({
    isGroup,
    dmPolicy,
    groupPolicy: isGroup ? "disabled" : "disabled",
    allowFrom: configAllowFrom,
    groupAllowFrom: [],
    storeAllowFrom: effectiveStoreAllowFrom,
    isSenderAllowed: (allowFrom) => isSenderAllowed(senderId, allowFrom.map(normalizeAllowEntry)),
    command: {
      useAccessGroups,
      allowTextCommands,
      hasControlCommand,
    },
  });

  if (access.decision !== "allow") {
    if (!isGroup && access.decision === "pairing") {
      await issuePairingChallenge({
        channel: CHANNEL_ID,
        senderId,
        senderIdLine: `Your DingTalk user id: ${senderId}`,
        meta: { name: message.senderNick || senderId },
        upsertPairingRequest: pairing.upsertPairingRequest,
        sendPairingReply: async (text) => {
          await sendDingtalkMessage({ account, to: senderId, text });
          statusSink?.({ lastOutboundAt: Date.now() });
        },
        onReplyError: (error) => {
          runtime.error?.(`dingtalk: pairing reply failed for ${senderId}: ${String(error)}`);
        },
      });
    }
    runtime.log?.(`dingtalk: drop sender ${senderId} (reason=${access.reason})`);
    return;
  }

  if (access.shouldBlockControlCommand) {
    logInboundDrop({
      log: (entry) => runtime.log?.(entry),
      channel: CHANNEL_ID,
      target: senderId,
      reason: "control command (unauthorized)",
    });
    return;
  }

  const peer = {
    kind: isGroup ? ("group" as const) : ("direct" as const),
    id: isGroup ? message.conversationId : senderId,
  };

  const { route, buildEnvelope } = resolveInboundRouteEnvelopeBuilderWithRuntime({
    cfg: config,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer,
    runtime: core.channel,
    sessionStore: config.session?.store,
  });

  const createAtMs = Number(message.createAt);
  const timestamp = Number.isFinite(createAtMs) ? createAtMs : undefined;

  const { storePath, body } = buildEnvelope({
    channel: "DingTalk",
    from: `user:${senderId}`,
    timestamp,
    body: rawBody,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: `dingtalk:${senderId}`,
    To: `dingtalk:${senderId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "group" : "direct",
    ConversationLabel: message.senderNick || senderId,
    SenderId: senderId,
    SenderName: message.senderNick || senderId,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    MessageSid: message.msgId,
    MessageSidFull: message.msgId,
    Timestamp: timestamp,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `dingtalk:${senderId}`,
    CommandAuthorized: access.commandAuthorized,
  });

  statusSink?.({ lastInboundAt: Date.now() });

  const { dispatchInboundReplyWithBase } = await import("./dispatch.runtime.js");
  await dispatchInboundReplyWithBase({
    cfg: config,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    route,
    storePath,
    ctxPayload,
    core,
    deliver: async (payload) => {
      const text = payload.text?.trim();
      if (!text) {
        return;
      }
      await sendDingtalkMessage({
        account,
        to: senderId,
        text,
        isGroup,
      });
      statusSink?.({ lastOutboundAt: Date.now() });
    },
    onRecordError: (error) => {
      runtime.error?.(`dingtalk: failed updating session meta: ${String(error)}`);
    },
    onDispatchError: (error, info) => {
      runtime.error?.(`dingtalk ${info.kind} reply failed: ${String(error)}`);
    },
  });
}
