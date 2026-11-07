import { resolveOriginMessageProvider } from "../../../auto-reply/reply/origin-routing.js";
import type { RouteReplyParams, RouteReplyResult } from "../../../auto-reply/reply/route-reply.js";
import { isSilentReplyText, SILENT_REPLY_TOKEN } from "../../../auto-reply/tokens.js";
import type { ReplyPayload } from "../../../auto-reply/types.js";
import {
  resolveRequiredDeliveryConfirmStatus,
  type RequiredDeliveryAttempt,
} from "../../../task-outcome/delivery-confirm.js";

/** Deliver to the original route; queue acceptance remains unconfirmed delivery. */
export async function deliverQueuedReply(
  input: {
    payloads: ReplyPayload[];
    originatingChannel?: RouteReplyParams["channel"];
    originatingTo?: string;
    originatingAccountId?: string;
    originatingThreadId?: string | number;
    run: Pick<RouteReplyParams, "sessionKey" | "cfg"> & { messageProvider?: string };
  },
  ports: {
    routeReply: (request: RouteReplyParams) => Promise<RouteReplyResult>;
    isRoutableChannel: (
      channel: RouteReplyParams["channel"] | undefined,
    ) => channel is RouteReplyParams["channel"];
    onBlockReply?: (payload: ReplyPayload) => void | Promise<void>;
    signalTextDelta: (text?: string) => Promise<void>;
    log: (message: string) => void;
  },
) {
  const attempts: RequiredDeliveryAttempt[] = [];
  // Check if we should route to originating channel.
  const { originatingChannel, originatingTo } = input;
  const shouldRouteToOriginating = ports.isRoutableChannel(originatingChannel) && originatingTo;

  if (!shouldRouteToOriginating && !ports.onBlockReply) {
    ports.log("followup queue: no onBlockReply handler; dropping payloads");
    return "none" as const;
  }

  for (const payload of input.payloads) {
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
    await ports.signalTextDelta(payload.text);

    // Route to originating channel if set, otherwise fall back to dispatcher.
    if (shouldRouteToOriginating) {
      const result = await ports.routeReply({
        payload,
        channel: originatingChannel,
        to: originatingTo,
        sessionKey: input.run.sessionKey,
        accountId: input.originatingAccountId,
        threadId: input.originatingThreadId,
        cfg: input.run.cfg,
      });
      if (!result.ok) {
        const errorMsg = result.error ?? "unknown error";
        ports.log(`followup queue: route-reply failed: ${errorMsg}`);
        // Fall back to the caller-provided dispatcher only when the
        // originating channel matches the session's message provider.
        // In that case onBlockReply was created by the same channel's
        // handler and delivers to the correct destination.  For true
        // cross-channel routing (origin !== provider), falling back
        // would send to the wrong channel, so we drop the payload.
        const provider = resolveOriginMessageProvider({
          provider: input.run.messageProvider,
        });
        const origin = resolveOriginMessageProvider({
          originatingChannel,
        });
        if (ports.onBlockReply && origin && origin === provider) {
          await ports.onBlockReply(payload);
          attempts.push({ source: "enqueue_only", ok: true });
        } else {
          attempts.push({ source: "deliver", ok: false, error: errorMsg });
        }
      } else {
        attempts.push({ source: "deliver", ok: true });
      }
    } else if (ports.onBlockReply) {
      await ports.onBlockReply(payload);
      attempts.push({ source: "enqueue_only", ok: true });
    }
  }
  return resolveRequiredDeliveryConfirmStatus(attempts);
}
