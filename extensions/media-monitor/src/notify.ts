import type { OpenClawPluginApi } from "openclaw/plugin-sdk/media-monitor";
import { deliverOutboundPayloads } from "openclaw/plugin-sdk/media-monitor";
import type { NotificationOutboxRow } from "./types.js";

type ChannelSend = (to: string, text: string, opts?: { accountId?: string }) => Promise<unknown>;

function resolveChannelSend(api: OpenClawPluginApi, channel: string): ChannelSend | null {
  const runtimeChannel = api.runtime?.channel as Record<string, unknown> | undefined;
  if (!runtimeChannel) {
    return null;
  }
  const key = channel.trim().toLowerCase();
  const candidates: Array<[string, string]> = [
    ["telegram", "sendMessageTelegram"],
    ["discord", "sendMessageDiscord"],
    ["slack", "sendMessageSlack"],
    ["signal", "sendMessageSignal"],
    ["whatsapp", "sendMessageWhatsApp"],
    ["imessage", "sendMessageIMessage"],
    ["line", "sendMessageLine"],
  ];
  for (const [id, method] of candidates) {
    if (id !== key) {
      continue;
    }
    const bag = runtimeChannel[id] as Record<string, unknown> | undefined;
    const fn = bag?.[method];
    if (typeof fn === "function") {
      return fn as ChannelSend;
    }
  }
  return null;
}

async function deliverViaOutbound(params: {
  api: OpenClawPluginApi;
  row: NotificationOutboxRow;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = params.api.config;
  if (!cfg) {
    return { ok: false, error: "plugin config unavailable for outbound delivery" };
  }
  const channel = params.row.channel.trim().toLowerCase();
  if (!channel || channel === "none") {
    return { ok: false, error: "invalid notify channel" };
  }
  try {
    await deliverOutboundPayloads({
      cfg,
      channel: channel as Parameters<typeof deliverOutboundPayloads>[0]["channel"],
      to: params.row.destination,
      accountId: params.row.accountId,
      payloads: [{ text: params.row.body }],
      skipQueue: true,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "outbound delivery failed",
    };
  }
}

export async function sendOutboxNotification(params: {
  api: OpenClawPluginApi;
  row: NotificationOutboxRow;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const send = resolveChannelSend(params.api, params.row.channel);
  if (send) {
    try {
      await send(params.row.destination, params.row.body, {
        ...(params.row.accountId ? { accountId: params.row.accountId } : {}),
      });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "send failed",
      };
    }
  }
  return deliverViaOutbound(params);
}
