import {
  createScopedPairingAccess,
  dispatchInboundReplyWithBase,
  issuePairingChallenge,
  resolveDirectDmAuthorizationOutcome,
  resolveInboundRouteEnvelopeBuilderWithRuntime,
  resolveSenderCommandAuthorizationWithRuntime,
  type ChatType,
} from "openclaw/plugin-sdk/compat";
import { resolveWechatAccount } from "./accounts.js";
import { sendWechatTextMessage } from "./api.js";
import { getWechatRuntime } from "./runtime.js";
import type { WechatInboundMessage } from "./types.js";

export type WechatInboundSkipReason = "invalid" | "group" | "media" | "empty" | "fromSelf";

export type ParsedWechatInbound =
  | { skip: true; reason: WechatInboundSkipReason }
  | {
      skip: false;
      fromUser: string;
      text: string;
      accountId: string;
      msgId?: string;
      nickname?: string;
    };

export type WechatInboundDispatchInfo = {
  fromUser: string;
  text: string;
  accountId: string;
  sessionKey: string;
};

type InboundDispatchHook = (info: WechatInboundDispatchInfo) => Promise<void>;

let testDispatch: InboundDispatchHook | null = null;

/** Test-only seam. Production inbound uses the channel plugin runtime. */
export function setWechatInboundDispatchForTest(dispatch: InboundDispatchHook | null): void {
  testDispatch = dispatch;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boolField(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function parsePayload(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  return raw;
}

export function parseWechatInboundPayload(
  raw: unknown,
  fallbackAccountId = "default",
): ParsedWechatInbound {
  const payload = parsePayload(raw);
  const record = asRecord(payload);
  if (!record) {
    return { skip: true, reason: "invalid" };
  }

  // Prefer explicit fromSelf over senderId===myWxid (both directions can share sender shapes).
  if (boolField(record, "fromSelf") === true) {
    return { skip: true, reason: "fromSelf" };
  }

  const isGroup =
    boolField(record, "isGroup") === true ||
    Boolean(stringField(record, "groupId")) ||
    (stringField(record, "fromUser") ?? "").includes("@chatroom");
  if (isGroup) {
    return { skip: true, reason: "group" };
  }

  const msgType = (stringField(record, "msgType") ?? "text").toLowerCase();
  if (msgType !== "text") {
    return { skip: true, reason: "media" };
  }
  if (
    stringField(record, "fileUrl") &&
    !stringField(record, "content") &&
    !stringField(record, "text")
  ) {
    return { skip: true, reason: "media" };
  }

  const fromUser =
    stringField(record, "fromUser") ??
    stringField(record, "from") ??
    stringField(record, "senderId");
  const text = stringField(record, "content") ?? stringField(record, "text");
  if (!fromUser) {
    return { skip: true, reason: "invalid" };
  }
  if (!text) {
    return { skip: true, reason: "empty" };
  }

  return {
    skip: false,
    fromUser,
    text,
    accountId: stringField(record, "accountId") ?? fallbackAccountId,
    msgId: stringField(record, "msgId") ?? stringField(record, "messageId"),
    nickname: stringField(record, "fromUserNick") ?? stringField(record, "nickname"),
  };
}

function isWechatSenderAllowed(senderId: string, allowFrom: Array<string | number>): boolean {
  const normalized = senderId.trim().toLowerCase();
  return allowFrom.some((entry) => String(entry).trim().toLowerCase() === normalized);
}

function logSkip(
  log: ((message: string) => void) | undefined,
  reason: WechatInboundSkipReason,
): void {
  log?.(
    `wechat inbound skipped (${reason}): fromSelf/group/media are out of scope or payload was empty`,
  );
}

export async function handleWechatPersonalInboundEvent(params: {
  payloadJSON?: string | null;
  payload?: unknown;
  accountId?: string;
  log?: { warn?: (message: string) => void };
}): Promise<{ handled: boolean; reason?: WechatInboundSkipReason | "error" }> {
  const parsed = parseWechatInboundPayload(
    params.payloadJSON ?? params.payload,
    params.accountId ?? "default",
  );
  const warn = params.log?.warn;
  if (parsed.skip) {
    logSkip(warn, parsed.reason);
    return { handled: false, reason: parsed.reason };
  }

  if (testDispatch) {
    await testDispatch({
      fromUser: parsed.fromUser,
      text: parsed.text,
      accountId: parsed.accountId,
      sessionKey: `wechat:${parsed.accountId}:${parsed.fromUser}`,
    });
    return { handled: true };
  }

  try {
    await dispatchWechatInboundText(parsed);
    return { handled: true };
  } catch (error) {
    warn?.(
      `wechat inbound dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { handled: false, reason: "error" };
  }
}

async function dispatchWechatInboundText(
  parsed: Extract<ParsedWechatInbound, { skip: false }>,
): Promise<void> {
  const runtime = getWechatRuntime();
  const cfg = runtime.config.loadConfig();
  const account = resolveWechatAccount({ cfg, accountId: parsed.accountId });
  const pairing = createScopedPairingAccess({
    core: runtime,
    channel: "wechat",
    accountId: account.accountId,
  });
  const dmPolicy = account.config.dm?.policy ?? "pairing";
  const configAllowFrom = account.config.dm?.allowFrom ?? [];

  const { senderAllowedForCommands, commandAuthorized } =
    await resolveSenderCommandAuthorizationWithRuntime({
      cfg,
      rawBody: parsed.text,
      isGroup: false,
      dmPolicy,
      configuredAllowFrom: configAllowFrom,
      senderId: parsed.fromUser,
      isSenderAllowed: isWechatSenderAllowed,
      readAllowFromStore: pairing.readAllowFromStore,
      runtime: runtime.channel.commands,
    });

  const directDmOutcome = resolveDirectDmAuthorizationOutcome({
    isGroup: false,
    dmPolicy,
    senderAllowedForCommands,
  });
  if (directDmOutcome === "disabled") {
    runtime.logging
      .getChildLogger({ module: "wechat" })
      .warn?.(`Blocked wechat DM from ${parsed.fromUser} (dmPolicy=disabled)`);
    return;
  }
  if (directDmOutcome === "unauthorized") {
    if (dmPolicy === "pairing") {
      await issuePairingChallenge({
        channel: "wechat",
        senderId: parsed.fromUser,
        senderIdLine: `Your WeChat id: ${parsed.fromUser}`,
        meta: { name: parsed.nickname },
        upsertPairingRequest: pairing.upsertPairingRequest,
        sendPairingReply: async (text) => {
          await sendWechatTextMessage({ account, to: parsed.fromUser, text });
        },
        onReplyError: (err) => {
          runtime.logging
            .getChildLogger({ module: "wechat" })
            .warn?.(`wechat pairing reply failed for ${parsed.fromUser}: ${String(err)}`);
        },
      });
    }
    return;
  }

  const peer: { kind: ChatType; id: string } = {
    kind: "direct",
    id: parsed.fromUser,
  };
  const { route, buildEnvelope } = resolveInboundRouteEnvelopeBuilderWithRuntime({
    cfg,
    channel: "wechat",
    accountId: account.accountId,
    peer,
    runtime: runtime.channel,
    sessionStore: cfg.session?.store,
  });
  const { storePath, body } = buildEnvelope({
    channel: "WeChat",
    from: parsed.nickname || `user:${parsed.fromUser}`,
    body: parsed.text,
  });
  const ctxPayload = runtime.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: parsed.text,
    RawBody: parsed.text,
    CommandBody: parsed.text,
    From: `wechat:${parsed.fromUser}`,
    To: `wechat:${account.accountId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: "direct",
    ConversationLabel: parsed.nickname || parsed.fromUser,
    SenderName: parsed.nickname,
    SenderId: parsed.fromUser,
    CommandAuthorized: commandAuthorized,
    Provider: "wechat",
    Surface: "wechat",
    MessageSid: parsed.msgId,
    OriginatingChannel: "wechat",
    OriginatingTo: parsed.fromUser,
  });

  await dispatchInboundReplyWithBase({
    cfg,
    channel: "wechat",
    accountId: account.accountId,
    route,
    storePath,
    ctxPayload,
    core: runtime,
    deliver: async (payload) => {
      const text = payload.text?.trim();
      if (!text) {
        return;
      }
      await sendWechatTextMessage({ account, to: parsed.fromUser, text });
    },
    onRecordError: (err) => {
      runtime.logging
        .getChildLogger({ module: "wechat" })
        .warn?.(`wechat: failed updating session meta: ${String(err)}`);
    },
    onDispatchError: (err, info) => {
      runtime.logging
        .getChildLogger({ module: "wechat" })
        .warn?.(`[${account.accountId}] WeChat ${info.kind} reply failed: ${String(err)}`);
    },
  });
}

export type { WechatInboundMessage };
