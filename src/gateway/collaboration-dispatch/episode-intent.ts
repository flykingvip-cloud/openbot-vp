/**
 * Floor Runtime v2.1 §5.7 P1-C — Episode intent classification.
 *
 * Deterministic kinds match EpisodeDecisionRecord. A caller may pass
 * `hooks.classify` for a later shadow router; a throw or unknown kind falls
 * through to this classifier and never changes a round outcome.
 */
import { isCollaborationSocialCheck } from "./completion-contract.js";

export const COLLABORATION_INTENT_KINDS = [
  "discussion",
  "roll_call",
  "review",
  "task",
  "chitchat",
  "mention_only",
] as const;

export type CollaborationIntentKind = (typeof COLLABORATION_INTENT_KINDS)[number];

const INTENT_KIND_SET = new Set<string>(COLLABORATION_INTENT_KINDS);

/** Bare roll-call utterances (P0.2 vocab, kept local so this file does not import the hotfix). */
const ROLL_CALL_EXACT = new Set([
  "点名",
  "其他成员呢",
  "其它成员呢",
  "还有谁",
  "剩下的呢",
  "都说说",
  "还有吗",
  "怎么没人",
]);

const REVIEW_RE = /评审|代码审查|请审核|code\s*review/iu;
const ROLL_CALL_RE = /@所有人|@全体|@everyone|@all\b|各自介绍|自我介绍|大家介绍/iu;

export type EpisodeIntentInput = {
  message?: string;
  mentionMode?: "none" | "single_primary" | "explicit_multi" | "broadcast";
  /** Specific @ targets. Broadcast / 点名 does not put the whole roster here. */
  mentionedAgentIds?: readonly string[];
  mentionAll?: boolean;
  responseMode?: string;
  /** Round-plan alert kinds, e.g. broadcast_mention. */
  alertKinds?: readonly string[];
  inboundDepth?: "chat" | "retrieve" | "act";
  /** Explicit task owner on the episode, when the caller already knows one. */
  taskOwnerAgentId?: string | null;
  /**
   * Later shadow may pin a kind. Unknown values are ignored.
   * Checked before `hooks.classify`.
   */
  hintedIntent?: string | null;
};

export type EpisodeIntentHooks = {
  /**
   * Optional later-shadow classifier. Return a known kind to override the
   * deterministic result, or null to fall through. Throws are ignored.
   */
  classify?: (input: EpisodeIntentInput) => CollaborationIntentKind | null;
};

function compactMessage(message: string | undefined): string {
  return (message ?? "").replace(/\s+/g, "").replace(/[!！?？。.~～，,、]+$/gu, "");
}

function knownIntent(value: string | null | undefined): CollaborationIntentKind | null {
  if (!value || !INTENT_KIND_SET.has(value)) {
    return null;
  }
  return value as CollaborationIntentKind;
}

function isRollCall(input: EpisodeIntentInput): boolean {
  if (input.mentionAll === true || input.mentionMode === "broadcast") {
    return true;
  }
  if (input.alertKinds?.includes("broadcast_mention")) {
    return true;
  }
  if (input.alertKinds?.includes("introduction_follow_up")) {
    return true;
  }
  const compact = compactMessage(input.message);
  if (!compact) {
    return false;
  }
  if (ROLL_CALL_EXACT.has(compact)) {
    return true;
  }
  return ROLL_CALL_RE.test(input.message ?? "");
}

function isReview(input: EpisodeIntentInput): boolean {
  return REVIEW_RE.test(input.message ?? "");
}

function isTask(input: EpisodeIntentInput): boolean {
  if (input.inboundDepth === "act") {
    return true;
  }
  if (input.responseMode === "single_owner" || input.responseMode === "decision_to_executor") {
    return true;
  }
  if (
    input.alertKinds?.includes("single_owner_mode") ||
    input.alertKinds?.includes("decision_to_executor_mode")
  ) {
    return true;
  }
  const owner = input.taskOwnerAgentId?.trim();
  return Boolean(owner);
}

function isMentionOnly(input: EpisodeIntentInput): boolean {
  return (input.mentionedAgentIds ?? []).some((id) => id.trim().length > 0);
}

export function classifyEpisodeIntent(
  input: EpisodeIntentInput,
  hooks?: EpisodeIntentHooks,
): CollaborationIntentKind {
  const hinted = knownIntent(input.hintedIntent);
  if (hinted) {
    return hinted;
  }
  if (hooks?.classify) {
    try {
      const hooked = knownIntent(hooks.classify(input));
      if (hooked) {
        return hooked;
      }
    } catch {
      // A shadow hook must not block deterministic classification.
    }
  }
  if (isRollCall(input)) {
    return "roll_call";
  }
  if (isReview(input)) {
    return "review";
  }
  if (isTask(input)) {
    return "task";
  }
  if (isMentionOnly(input)) {
    return "mention_only";
  }
  if (isCollaborationSocialCheck(input.message)) {
    return "chitchat";
  }
  return "discussion";
}
