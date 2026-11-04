import type { TemplateContext } from "../../../auto-reply/templating.js";
import { isSilentReplyText, SILENT_REPLY_TOKEN } from "../../../auto-reply/tokens.js";
/** Original empty-turn presentation policy; no persistence or execution effects. */
import { normalizeChatType } from "../../../channels/chat-type.js";
import type { CollaborationReplyLanguage } from "../../../gateway/collaboration-dispatch/reply-language.js";

export const HONEST_EMPTY_REPLY_ZH =
  "这一轮我没能给出有效回复（缺：可执行技能/工具或可感知输入）。下一步：请用一句话重述目标，或指出要用的技能/工具，我会继续尝试。";

export const HONEST_EMPTY_REPLY_EN =
  "I could not produce a usable reply this turn (missing: an actionable skill/tool or usable perception). Next: restate the goal in one sentence, or name the skill/tool to use, and I will keep trying.";

export function formatHonestEmptyReply(
  language: CollaborationReplyLanguage | null | undefined,
): string {
  return language === "en" ? HONEST_EMPTY_REPLY_EN : HONEST_EMPTY_REPLY_ZH;
}

export type HonestEmptyReplyProbePayload = {
  text?: string | null;
  mediaUrl?: string | null;
  mediaUrls?: string[] | null;
};

/** True when a payload would show something to the user (not pure NO_REPLY / empty). */
export function hasUserVisibleReplyPayload(
  payloads: readonly HonestEmptyReplyProbePayload[] | null | undefined,
): boolean {
  for (const payload of payloads ?? []) {
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (text && !isSilentReplyText(text, SILENT_REPLY_TOKEN)) {
      return true;
    }
    if (typeof payload.mediaUrl === "string" && payload.mediaUrl.trim()) {
      return true;
    }
    if (payload.mediaUrls?.some((url) => Boolean(url?.trim()))) {
      return true;
    }
  }
  return false;
}

export type HonestEmptyReplyDecisionInput = {
  isHeartbeat: boolean;
  sessionCtx: Pick<
    TemplateContext,
    | "ChatType"
    | "GroupSubject"
    | "GroupChannel"
    | "GroupSpace"
    | "CollaborationGroupId"
    | "CollaborationRoundInvoked"
    | "CollaborationBotAgentId"
    | "InputProvenance"
  >;
  /** Final payloads from the run, before delivery filtering. */
  rawPayloads: readonly HonestEmptyReplyProbePayload[] | null | undefined;
  /** Block streaming delivered at least one block (covers shouldDropFinalPayloads). */
  blockStreamDelivered: boolean;
  /** Blocks sent directly during tool flush (no pipeline). */
  directlySentBlockCount: number;
  /** A tool result (e.g. TTS audio, generated image) was handed to delivery. */
  toolResultDelivered: boolean;
  didSendViaMessagingTool?: boolean;
  messagingToolSentTexts?: readonly string[];
  messagingToolSentMediaUrls?: readonly string[];
  messagingToolSentTargets?: readonly unknown[];
  /** User Stop (/stop, chat.abort) aborted this run — never fallback / never gap. */
  runAborted?: boolean;
  /** Emoji reaction already delivered (reaction-only + NO_REPLY counts as delivery). */
  reactionDelivered?: boolean;
};

export type HonestEmptyReplySkipReason =
  | "heartbeat"
  | "not_direct_chat"
  | "group_context"
  | "collaboration"
  | "non_user_provenance"
  | "block_stream_delivered"
  | "tool_result_delivered"
  | "messaging_tool_delivered"
  | "visible_payload_filtered"
  | "user_aborted"
  | "reaction_delivered";

export type HonestEmptyReplyDecision =
  | { emit: true; reason: "direct_chat_silent_or_empty_reply" }
  | { emit: false; reason: HonestEmptyReplySkipReason };

/**
 * Decide whether an empty final delivery should become an honest fallback.
 * Called only after the runner has determined there is nothing left to send.
 * A successful tool with an empty, unfinished final is continued once inside
 * the embedded attempt before this runs. This fallback stays for turns that
 * never called a tool, and for an empty final that is still empty after that
 * one continue.
 */
export function decideHonestEmptyReply(
  input: HonestEmptyReplyDecisionInput,
): HonestEmptyReplyDecision {
  const ctx = input.sessionCtx;
  if (input.runAborted) {
    return { emit: false, reason: "user_aborted" };
  }
  if (input.isHeartbeat) {
    return { emit: false, reason: "heartbeat" };
  }
  if (
    ctx.CollaborationGroupId?.trim() ||
    ctx.CollaborationRoundInvoked === true ||
    ctx.CollaborationBotAgentId?.trim()
  ) {
    // Collaboration NO_REPLY ("nothing to add this round") is a valid answer.
    return { emit: false, reason: "collaboration" };
  }
  if (normalizeChatType(ctx.ChatType) !== "direct") {
    // Groups/channels may stay silent; unknown chat type is treated as not private.
    return { emit: false, reason: "not_direct_chat" };
  }
  if (ctx.GroupSubject?.trim() || ctx.GroupChannel?.trim() || ctx.GroupSpace?.trim()) {
    return { emit: false, reason: "group_context" };
  }
  const provenanceKind = ctx.InputProvenance?.kind;
  if (provenanceKind && provenanceKind !== "external_user") {
    // internal_system / cron / inter_session turns may legitimately end silent.
    return { emit: false, reason: "non_user_provenance" };
  }
  if (input.blockStreamDelivered || input.directlySentBlockCount > 0) {
    return { emit: false, reason: "block_stream_delivered" };
  }
  if (input.toolResultDelivered) {
    return { emit: false, reason: "tool_result_delivered" };
  }
  if (input.reactionDelivered) {
    return { emit: false, reason: "reaction_delivered" };
  }
  if (hasMessagingToolDelivery(input)) {
    return { emit: false, reason: "messaging_tool_delivered" };
  }
  if (hasUserVisibleReplyPayload(input.rawPayloads)) {
    // Something visible existed but delivery filtering removed it (dedupe etc.).
    // Don't second-guess the filter with a fallback.
    return { emit: false, reason: "visible_payload_filtered" };
  }
  return { emit: true, reason: "direct_chat_silent_or_empty_reply" };
}

export function hasMessagingToolDelivery(input: HonestEmptyReplyDecisionInput): boolean {
  return Boolean(
    input.didSendViaMessagingTool ||
    (input.messagingToolSentTexts?.length ?? 0) > 0 ||
    (input.messagingToolSentMediaUrls?.length ?? 0) > 0 ||
    (input.messagingToolSentTargets?.length ?? 0) > 0,
  );
}

/**
 * Single source of truth for growth/operational success of a silent/empty turn.
 * Emit-fallback turns are NOT success; every skip reason (incl. abort, group
 * NO_REPLY, reaction, heartbeat) remains not-failure (success=true).
 */
export function classifySilentTurnGrowthOutcome(decision: HonestEmptyReplyDecision): {
  success: boolean;
  reason: string;
} {
  if (decision.emit) {
    return { success: false, reason: decision.reason };
  }
  return { success: true, reason: decision.reason };
}
