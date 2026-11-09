import type { ReplyPayload } from "../../../auto-reply/types.js";
import { getChannelPlugin, normalizeChannelId } from "../../../channels/plugins/index.js";
import { createOutboundSendDeps, type CliDeps } from "../../../cli/outbound-send-deps.js";
import type { OpenBotConfig } from "../../../config/config.js";
import type { SessionEntry } from "../../../config/sessions.js";
import {
  resolveAgentDeliveryPlan,
  resolveAgentOutboundTarget,
} from "../../../infra/outbound/agent-delivery.js";
import { resolveMessageChannelSelection } from "../../../infra/outbound/channel-selection.js";
import { deliverOutboundPayloads } from "../../../infra/outbound/deliver.js";
import { buildOutboundResultEnvelope } from "../../../infra/outbound/envelope.js";
import {
  formatOutboundPayloadLog,
  type NormalizedOutboundPayload,
  normalizeOutboundPayloads,
  normalizeOutboundPayloadsForJson,
} from "../../../infra/outbound/payloads.js";
import type { OutboundSessionContext } from "../../../infra/outbound/session-context.js";
import { CommandLane } from "../../../process/lanes.js";
import type { RuntimeEnv } from "../../../runtime.js";
import { isInternalMessageChannel } from "../../../utils/message-channel.js";
import type { CommandDeliveryOptions, CommandDeliveryReceipt } from "../../contracts/delivery.js";
import { logNestedCommandOutput } from "../presentation/command-output.js";

export async function deliverAgentCommandResult<
  TMeta extends { durationMs: number; taskId?: string },
>(params: {
  cfg: OpenBotConfig;
  deps: CliDeps;
  runtime: RuntimeEnv;
  opts: CommandDeliveryOptions;
  outboundSession: OutboundSessionContext | undefined;
  sessionEntry: SessionEntry | undefined;
  result: { meta: TMeta };
  payloads: ReplyPayload[] | undefined;
  receipt?: { deliveryId: string; record: (receipt: CommandDeliveryReceipt) => void };
}) {
  const { cfg, deps, runtime, opts, outboundSession, sessionEntry, payloads, result } = params;
  const effectiveSessionKey = outboundSession?.key ?? opts.sessionKey;
  const deliver = opts.deliver === true;
  // Persist uncertainty before target/plugin setup, which can throw before send.
  if (deliver) {
    params.receipt?.record({
      deliveryId: params.receipt.deliveryId,
      status: "delivery_unknown",
      messageIds: [],
    });
  }
  const bestEffortDeliver = opts.bestEffortDeliver === true;
  const turnSourceChannel = opts.runContext?.messageChannel ?? opts.messageChannel;
  const turnSourceTo = opts.runContext?.currentChannelId ?? opts.to;
  const turnSourceAccountId = opts.runContext?.accountId ?? opts.accountId;
  const turnSourceThreadId = opts.runContext?.currentThreadTs ?? opts.threadId;
  const deliveryPlan = resolveAgentDeliveryPlan({
    sessionEntry,
    requestedChannel: opts.replyChannel ?? opts.channel,
    explicitTo: opts.replyTo ?? opts.to,
    explicitThreadId: opts.threadId,
    accountId: opts.replyAccountId ?? opts.accountId,
    wantsDelivery: deliver,
    turnSourceChannel,
    turnSourceTo,
    turnSourceAccountId,
    turnSourceThreadId,
  });
  let deliveryChannel = deliveryPlan.resolvedChannel;
  const explicitChannelHint = (opts.replyChannel ?? opts.channel)?.trim();
  if (deliver && isInternalMessageChannel(deliveryChannel) && !explicitChannelHint) {
    try {
      const selection = await resolveMessageChannelSelection({ cfg });
      deliveryChannel = selection.channel;
    } catch {
      // Keep the internal channel marker; error handling below reports the failure.
    }
  }
  const effectiveDeliveryPlan =
    deliveryChannel === deliveryPlan.resolvedChannel
      ? deliveryPlan
      : {
          ...deliveryPlan,
          resolvedChannel: deliveryChannel,
        };
  // Channel docking: delivery channels are resolved via plugin registry.
  const deliveryPlugin = !isInternalMessageChannel(deliveryChannel)
    ? getChannelPlugin(normalizeChannelId(deliveryChannel) ?? deliveryChannel)
    : undefined;

  const isDeliveryChannelKnown =
    isInternalMessageChannel(deliveryChannel) || Boolean(deliveryPlugin);

  const targetMode =
    opts.deliveryTargetMode ??
    effectiveDeliveryPlan.deliveryTargetMode ??
    (opts.to ? "explicit" : "implicit");
  const resolvedAccountId = effectiveDeliveryPlan.resolvedAccountId;
  const resolved =
    deliver && isDeliveryChannelKnown && deliveryChannel
      ? resolveAgentOutboundTarget({
          cfg,
          plan: effectiveDeliveryPlan,
          targetMode,
          validateExplicitTarget: true,
        })
      : {
          resolvedTarget: null,
          resolvedTo: effectiveDeliveryPlan.resolvedTo,
          targetMode,
        };
  const resolvedTarget = resolved.resolvedTarget;
  const deliveryTarget = resolved.resolvedTo;
  const resolvedThreadId = deliveryPlan.resolvedThreadId ?? opts.threadId;
  const resolvedReplyToId =
    deliveryChannel === "slack" && resolvedThreadId != null ? String(resolvedThreadId) : undefined;
  const resolvedThreadTarget = deliveryChannel === "slack" ? undefined : resolvedThreadId;

  let deliveryError: string | undefined;
  const recordReceipt = (status: CommandDeliveryReceipt["status"], messageIds: string[] = []) => {
    params.receipt?.record({
      deliveryId: params.receipt.deliveryId,
      status,
      messageIds,
      ...(deliveryError ? { error: deliveryError } : {}),
    });
  };
  const logDeliveryError = (err: unknown) => {
    deliveryError = String(err);
    const message = `Delivery failed (${deliveryChannel}${deliveryTarget ? ` to ${deliveryTarget}` : ""}): ${String(err)}`;
    runtime.error?.(message);
    if (!runtime.error) {
      runtime.log(message);
    }
  };

  if (deliver) {
    if (isInternalMessageChannel(deliveryChannel)) {
      const err = new Error(
        "delivery channel is required: pass --channel/--reply-channel or use a main session with a previous channel",
      );
      logDeliveryError(err);
      if (!bestEffortDeliver) {
        recordReceipt("failed");
        throw err;
      }
    } else if (!isDeliveryChannelKnown) {
      const err = new Error(`Unknown channel: ${deliveryChannel}`);
      logDeliveryError(err);
      if (!bestEffortDeliver) {
        recordReceipt("failed");
        throw err;
      }
    } else if (resolvedTarget && !resolvedTarget.ok) {
      logDeliveryError(resolvedTarget.error);
      if (!bestEffortDeliver) {
        recordReceipt("failed");
        throw resolvedTarget.error;
      }
    }
  }

  const normalizedPayloads = normalizeOutboundPayloadsForJson(payloads ?? []);
  if (opts.json) {
    runtime.log(
      JSON.stringify(
        buildOutboundResultEnvelope({
          payloads: normalizedPayloads,
          meta: result.meta,
        }),
        null,
        2,
      ),
    );
    if (!deliver) {
      return { payloads: normalizedPayloads, meta: result.meta };
    }
  }

  if (!payloads || payloads.length === 0) {
    runtime.log("No reply from agent.");
    if (deliver) {
      recordReceipt("delivery_unknown");
    }
    return { payloads: [], meta: result.meta };
  }

  const deliveryPayloads = normalizeOutboundPayloads(payloads);
  const logPayload = (payload: NormalizedOutboundPayload) => {
    if (opts.json) {
      return;
    }
    const output = formatOutboundPayloadLog(payload);
    if (!output) {
      return;
    }
    if (opts.lane === CommandLane.Nested) {
      logNestedCommandOutput(runtime, opts, output, effectiveSessionKey);
      return;
    }
    runtime.log(output);
  };
  if (!deliver) {
    for (const payload of deliveryPayloads) {
      logPayload(payload);
    }
  }
  if (deliver && deliveryChannel && !isInternalMessageChannel(deliveryChannel)) {
    if (deliveryTarget) {
      try {
        const receipts = await deliverOutboundPayloads({
          cfg,
          channel: deliveryChannel,
          to: deliveryTarget,
          accountId: resolvedAccountId,
          payloads: deliveryPayloads,
          session: outboundSession,
          taskId: result.meta.taskId,
          replyToId: resolvedReplyToId ?? null,
          threadId: resolvedThreadTarget ?? null,
          bestEffort: bestEffortDeliver,
          onError: (err) => logDeliveryError(err),
          onPayload: logPayload,
          deps: createOutboundSendDeps(deps),
          abortSignal: opts.abortSignal,
        });
        const messageIds = receipts
          .map((receipt) => receipt.messageId)
          .filter((id) => id.trim() && id.trim().toLowerCase() !== "unknown");
        recordReceipt(
          deliveryError
            ? "failed"
            : receipts.length > 0 && messageIds.length === receipts.length
              ? "delivered"
              : "delivery_unknown",
          messageIds,
        );
      } catch (error) {
        deliveryError = String(error);
        recordReceipt("failed");
        throw error;
      }
    }
  }

  if (deliver && (!deliveryTarget || isInternalMessageChannel(deliveryChannel))) {
    recordReceipt(deliveryError ? "failed" : "delivery_unknown");
  }
  return { payloads: normalizedPayloads, meta: result.meta };
}
