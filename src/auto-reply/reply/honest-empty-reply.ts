/**
 * Honest fallback for a *private* user-facing turn that ended with nothing
 * delivered (model emitted only NO_REPLY / empty output).
 *
 * Silence is legitimate in group chats, channels, collaboration rounds, and
 * internal/system/cron/inter-session turns. In those cases this module never
 * substitutes a message. The fallback is emitted only when every exemption
 * below is ruled out. See docs/design/honest-empty-reply-direct-only-2026-10-06.md.
 */
import {
  recordCapabilityGapEvent,
  type CapabilityGapCategory,
} from "../../gateway/evolution-control/capability-gap-ingest.js";

/** Structured marker models may emit when refusing due to a capability boundary. */
export const CAPABILITY_GAP_MARKER_RE =
  /\[\[capability_gap:(skill|tool|perception)(?::([^\]]+))?\]\]/i;

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

// Compatibility exports: one implementation, owned by runtime delivery.
export {
  HONEST_EMPTY_REPLY_ZH,
  HONEST_EMPTY_REPLY_EN,
  formatHonestEmptyReply,
  hasUserVisibleReplyPayload,
  decideHonestEmptyReply,
  classifySilentTurnGrowthOutcome,
  type HonestEmptyReplyProbePayload,
  type HonestEmptyReplyDecisionInput,
  type HonestEmptyReplySkipReason,
  type HonestEmptyReplyDecision,
} from "../../agent-runtime/delivery/index.js";
