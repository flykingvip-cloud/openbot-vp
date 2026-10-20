/**
 * Honest fallback for a *private* user-facing turn that ended with nothing
 * delivered (model emitted only NO_REPLY / empty output).
 *
 * Silence is legitimate in group chats, channels, collaboration rounds, and
 * internal/system/cron/inter-session turns. In those cases this module never
 * substitutes a message. The fallback is emitted only when every exemption
 * below is ruled out. See docs/design/honest-empty-reply-direct-only-2026-10-06.md.
 */
import { normalizeChatType } from "../../channels/chat-type.js";
import type { CollaborationReplyLanguage } from "../../gateway/collaboration-dispatch/reply-language.js";
import {
  recordCapabilityGapEvent,
  type CapabilityGapCategory,
} from "../../gateway/evolution-control/capability-gap-ingest.js";
import type { TemplateContext } from "../templating.js";
import { isSilentReplyText, SILENT_REPLY_TOKEN } from "../tokens.js";

export const HONEST_EMPTY_REPLY_ZH =
  "这一轮我没能给出有效回复（缺：可执行技能/工具或可感知输入）。下一步：请用一句话重述目标，或指出要用的技能/工具，我会继续尝试。";

export const HONEST_EMPTY_REPLY_EN =
  "I could not produce a usable reply this turn (missing: an actionable skill/tool or usable perception). Next: restate the goal in one sentence, or name the skill/tool to use, and I will keep trying.";

/** Structured marker models may emit when refusing due to a capability boundary. */
export const CAPABILITY_GAP_MARKER_RE =
  /\[\[capability_gap:(skill|tool|perception)(?::([^\]]+))?\]\]/i;

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
  if (
    input.didSendViaMessagingTool ||
    (input.messagingToolSentTexts?.length ?? 0) > 0 ||
    (input.messagingToolSentMediaUrls?.length ?? 0) > 0 ||
    (input.messagingToolSentTargets?.length ?? 0) > 0
  ) {
    return { emit: false, reason: "messaging_tool_delivered" };
  }
  if (hasUserVisibleReplyPayload(input.rawPayloads)) {
    // Something visible existed but delivery filtering removed it (dedupe etc.).
    // Don't second-guess the filter with a fallback.
    return { emit: false, reason: "visible_payload_filtered" };
  }
  return { emit: true, reason: "direct_chat_silent_or_empty_reply" };
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

const ALLOWED_GAP_CATEGORIES = new Set<CapabilityGapCategory>(["skill", "tool", "perception"]);
const MARKER_DETAIL_MAX = 64;
const MARKER_RATE_LIMIT_PER_SESSION = 3;
const markerRateBySession = new Map<string, { count: number; windowStart: number }>();
const MARKER_RATE_WINDOW_MS = 60 * 60 * 1000;

/** Test helper */
export function resetCapabilityGapMarkerRateLimitForTests(): void {
  markerRateBySession.clear();
}

export function parseCapabilityGapMarker(
  text: string | null | undefined,
  options?: { fromAssistant?: boolean; sessionKey?: string | null; nowMs?: number },
): { category: CapabilityGapCategory; detail: string | null } | null {
  if (!text) {
    return null;
  }
  // Only parse assistant-authored output (ignore user-echo / injection).
  if (options?.fromAssistant === false) {
    return null;
  }
  const match = CAPABILITY_GAP_MARKER_RE.exec(text);
  if (!match) {
    return null;
  }
  const categoryRaw = match[1]?.toLowerCase() ?? "";
  if (!ALLOWED_GAP_CATEGORIES.has(categoryRaw as CapabilityGapCategory)) {
    return null;
  }
  const category = categoryRaw as CapabilityGapCategory;
  let detail = match[2]?.trim() || null;
  if (detail && detail.length > MARKER_DETAIL_MAX) {
    detail = detail.slice(0, MARKER_DETAIL_MAX);
  }
  // Reject obviously injected junk (control chars / nested brackets).
  if (
    detail &&
    (detail.includes("[") ||
      detail.includes("]") ||
      detail.includes("\n") ||
      detail.includes("\r") ||
      detail.includes("\u0000"))
  ) {
    return null;
  }
  const sessionKey = options?.sessionKey?.trim() || "";
  if (sessionKey) {
    const now = options?.nowMs ?? Date.now();
    const row = markerRateBySession.get(sessionKey);
    if (!row || now - row.windowStart >= MARKER_RATE_WINDOW_MS) {
      markerRateBySession.set(sessionKey, { count: 1, windowStart: now });
    } else if (row.count >= MARKER_RATE_LIMIT_PER_SESSION) {
      return null;
    } else {
      row.count += 1;
    }
  }
  return { category, detail };
}

/**
 * Record a capability gap into the evolution loop (log + persisted DISCOVERED
 * proposal on the existing control plane). Never call for user abort.
 * Best-effort: evolution store errors must never fail a reply.
 */
export function recordHonestCapabilityGap(fields: {
  runId?: string | null;
  agentId?: string | null;
  tenantId?: string | null;
  sessionKey?: string | null;
  chatType?: string | null;
  reason: string;
  category?: CapabilityGapCategory;
  detail?: string | null;
  userLanguageSummary?: string | null;
  explicitMarker?: boolean;
  sourceKind?: "marker" | "empty_reply" | "run_error" | "other";
  ownerUserId?: string | null;
}): void {
  try {
    recordCapabilityGapEvent({
      runId: fields.runId,
      agentId: fields.agentId,
      tenantId: fields.tenantId,
      sessionKey: fields.sessionKey,
      chatType: fields.chatType,
      category: fields.category ?? "perception",
      reason: fields.reason,
      detail: fields.detail,
      explicitMarker: fields.explicitMarker,
      ownerUserId: fields.ownerUserId,
      sourceKind:
        fields.sourceKind ??
        (fields.explicitMarker
          ? "marker"
          : fields.reason === "direct_chat_silent_or_empty_reply"
            ? "empty_reply"
            : "other"),
      userLanguageSummary:
        fields.userLanguageSummary ??
        (fields.reason === "direct_chat_silent_or_empty_reply"
          ? "silent/empty turn; missing actionable skill/tool or perception"
          : fields.reason),
    });
  } catch (err) {
    // Evolution plane / store failure must never fail the user-facing reply.
    try {
      // eslint-disable-next-line no-console
      console.warn(`[capability-gap] record failed: ${String(err)}`);
    } catch {
      // ignore
    }
  }
}

/** Strip markers from assistant text before delivery (final payloads). */
export function stripCapabilityGapMarkers(text: string): string {
  return text
    .replace(CAPABILITY_GAP_MARKER_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
