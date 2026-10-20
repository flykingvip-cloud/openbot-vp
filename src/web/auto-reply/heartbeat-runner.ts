import type { getReplyFromConfig } from "../../auto-reply/reply.js";
import type { OpenBotConfig } from "../../config/config.js";
import { emitHeartbeatEvent } from "../../infra/heartbeat-events.js";
import type { sendMessageWhatsApp } from "../outbound.js";

export async function runWebHeartbeatOnce(_opts: {
  cfg?: OpenBotConfig;
  to: string;
  verbose?: boolean;
  replyResolver?: typeof getReplyFromConfig;
  sender?: typeof sendMessageWhatsApp;
  sessionId?: string;
  overrideBody?: string;
  dryRun?: boolean;
}) {
  emitHeartbeatEvent({
    status: "skipped",
    reason: "legacy-outbound-retired",
    channel: "whatsapp",
    silent: true,
  });
}

export function resolveHeartbeatRecipients(
  _cfg: OpenBotConfig,
  _opts: { to?: string; all?: boolean } = {},
) {
  return [];
}
