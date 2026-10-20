import {
  createScopedPairingAccess,
  formatTextWithAttachmentLinks,
  issuePairingChallenge,
  logInboundDrop,
  readStoreAllowFromForDmPolicy,
  resolveDmGroupAccessWithCommandGate,
  resolveInboundRouteEnvelopeBuilderWithRuntime,
  resolveOutboundMediaUrls,
} from "openclaw/plugin-sdk/wecom";
import type { OpenBotConfig } from "openclaw/plugin-sdk/wecom";
import { mapAibotTextToInbound, WecomAibotWsClient } from "./aibot-ws.js";
import { sendWecomTextMessage } from "./api.js";
import { getWecomRuntime } from "./runtime.js";
import type { ResolvedWecomAccount } from "./types.js";
import {
  handleWecomWebhookRequest,
  registerWecomWebhookTarget,
  resolveWecomWebhookPath,
  type WecomInboundMessage,
} from "./webhook.js";

const CHANNEL_ID = "wecom" as const;

function normalizeAllowEntry(value: string | number): string {
  return String(value)
    .trim()
    .replace(/^wecom:/i, "")
    .replace(/^user:/i, "");
}

function isSenderAllowed(senderId: string, allowFrom: readonly string[]): boolean {
  return allowFrom.includes("*") || allowFrom.includes(senderId);
}

async function deliverWecomReply(params: {
  payload: { text?: string; mediaUrl?: string; mediaUrls?: string[]; replyToId?: string };
  account: ResolvedWecomAccount;
  senderId: string;
  aibotReqId?: string;
  aibotClient?: WecomAibotWsClient;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const combined = formatTextWithAttachmentLinks(
    params.payload.text,
    resolveOutboundMediaUrls(params.payload),
  );
  if (!combined) {
    return;
  }
  if (params.aibotClient && params.aibotReqId) {
    await params.aibotClient.replyText({ reqId: params.aibotReqId, text: combined });
  } else {
    await sendWecomTextMessage({
      account: params.account,
      to: params.senderId,
      text: combined,
    });
  }
  params.statusSink?.({ lastOutboundAt: Date.now() });
}

export async function processWecomInbound(params: {
  message: WecomInboundMessage;
  account: ResolvedWecomAccount;
  config: OpenBotConfig;
  runtime: {
    log?: (message: string) => void;
    error?: (message: string) => void;
  };
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  aibotClient?: WecomAibotWsClient;
}): Promise<void> {
  const { message, account, config, runtime, statusSink } = params;
  const core = getWecomRuntime();
  const pairing = createScopedPairingAccess({
    core,
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });

  const rawBody =
    message.msgType === "text"
      ? (message.content?.trim() ?? "")
      : message.msgType === "event" && message.event
        ? `[event:${message.event}]`
        : "";
  if (!rawBody) {
    return;
  }

  const senderId = message.fromUserName.trim();
  if (!senderId) {
    return;
  }

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
    isGroup: false,
    dmPolicy,
    groupPolicy: "disabled",
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
    if (access.decision === "pairing") {
      await issuePairingChallenge({
        channel: CHANNEL_ID,
        senderId,
        senderIdLine: `Your WeCom user id: ${senderId}`,
        meta: { name: senderId },
        upsertPairingRequest: pairing.upsertPairingRequest,
        sendPairingReply: async (text) => {
          await sendWecomTextMessage({
            account,
            to: senderId,
            text,
          });
          statusSink?.({ lastOutboundAt: Date.now() });
        },
        onReplyError: (error) => {
          runtime.error?.(`wecom: pairing reply failed for ${senderId}: ${String(error)}`);
        },
      });
    }
    runtime.log?.(`wecom: drop sender ${senderId} (reason=${access.reason})`);
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
    kind: "direct" as const,
    id: senderId,
  };

  const { route, buildEnvelope } = resolveInboundRouteEnvelopeBuilderWithRuntime({
    cfg: config,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer,
    runtime: core.channel,
    sessionStore: config.session?.store,
  });

  const { storePath, body } = buildEnvelope({
    channel: "WeCom",
    from: `user:${senderId}`,
    timestamp: message.createTime ? message.createTime * 1000 : undefined,
    body: rawBody,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: `wecom:${senderId}`,
    To: `wecom:${senderId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: "direct",
    ConversationLabel: senderId,
    SenderId: senderId,
    SenderName: senderId,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    MessageSid: message.msgId,
    MessageSidFull: message.msgId,
    Timestamp: message.createTime ? message.createTime * 1000 : undefined,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `wecom:${senderId}`,
    CommandAuthorized: access.commandAuthorized,
  });

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
      await deliverWecomReply({
        payload,
        account,
        senderId,
        aibotReqId: message.aibotReqId,
        aibotClient: params.aibotClient,
        statusSink,
      });
    },
    onRecordError: (error) => {
      runtime.error?.(`wecom: failed updating session meta: ${String(error)}`);
    },
    onDispatchError: (error, info) => {
      runtime.error?.(`wecom ${info.kind} reply failed: ${String(error)}`);
    },
  });
}

async function startWecomAibotMonitor(params: {
  account: ResolvedWecomAccount;
  config: OpenBotConfig;
  runtime: {
    log?: (message: string) => void;
    error?: (message: string) => void;
  };
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<() => void> {
  const botId = params.account.botId?.trim();
  const secret = params.account.secret?.trim();
  if (!botId || !secret) {
    throw new Error("WeCom AIBot long connection requires botId and secret");
  }

  const abort = new AbortController();
  const client = new WecomAibotWsClient({
    botId,
    secret,
    abortSignal: abort.signal,
    log: params.runtime.log,
    error: params.runtime.error,
    onTextMessage: async (message) => {
      params.statusSink?.({ lastInboundAt: Date.now() });
      const inbound = mapAibotTextToInbound(message);
      await processWecomInbound({
        message: inbound,
        account: params.account,
        config: params.config,
        runtime: params.runtime,
        statusSink: params.statusSink,
        aibotClient: client,
      });
    },
  });
  client.start();
  return () => {
    abort.abort();
    client.stop();
  };
}

export async function startWecomMonitor(params: {
  account: ResolvedWecomAccount;
  config: OpenBotConfig;
  runtime: {
    log?: (message: string) => void;
    error?: (message: string) => void;
  };
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<() => void> {
  if (params.account.connectionMode === "websocket") {
    return startWecomAibotMonitor(params);
  }

  const webhookPath = resolveWecomWebhookPath(params.account);
  if (!webhookPath) {
    throw new Error("invalid WeCom webhook path");
  }

  return registerWecomWebhookTarget(
    {
      account: params.account,
      config: params.config,
      path: webhookPath,
      runtime: params.runtime,
      statusSink: params.statusSink,
    },
    {
      auth: "plugin",
      match: "exact",
      pluginId: "wecom",
      source: "wecom-webhook",
      accountId: params.account.accountId,
      log: params.runtime.log,
      handler: async (req, res) => {
        const handled = await handleWecomWebhookRequest(req, res, async ({ message, target }) => {
          await processWecomInbound({
            message,
            account: target.account,
            config: target.config,
            runtime: target.runtime,
            statusSink: target.statusSink,
          });
        });
        if (!handled && !res.headersSent) {
          res.statusCode = 404;
          res.end("Not Found");
        }
      },
    },
  );
}
