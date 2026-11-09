import { applyUserVisibleOutputGate } from "../../agents/model-output-boundary.js";
import { detectReplyLanguage } from "../user-modeling/derive.js";

export type CollaborationReplyLanguage = "zh" | "en";

const ENGLISH_PLANNING_MARKERS: RegExp[] = [
  /\bper my role\b/i,
  /\bincremental value\b/i,
  /\blooking at the chat history\b/i,
  /\bi should not\b/i,
  /\bi should NOT\b/,
  /\bas a supplement\b/i,
  /\blet me keep it\b/i,
  /\bdraft reply covered\b/i,
  /\bwhat incremental value\b/i,
  /\bdo not repeat the full answer\b/i,
  /\bfrom my own functional perspective\b/i,
  /\bthis is a direct question from\b/i,
  /\bi'll start\b/i,
  /\bi will start\b/i,
  /\bi'll (?:fetch|gather|look|inspect|check)\b/i,
  /\bi will (?:fetch|gather|look|inspect|check)\b/i,
  /\bnow i\b/i,
  /\bgood[—–-]/i,
  /\blet me (?:start|check|look|fetch|gather|inspect)\b/i,
];

const INTERNAL_HISTORY_PREFIXES = [
  "Pre-compaction memory flush",
  "Conversation info (untrusted metadata)",
  "Sender (untrusted metadata)",
];

const REPLY_LANGUAGE_TIMESTAMP_RE = /^\[[A-Za-z]{3}\s+\d{4}-\d{2}-\d{2}[^\]]*\]\s*/;
const REPLY_LANGUAGE_FOCUS_TOKEN_RE = /\[FOCUS_(?:CANCELLED|PARKED)\]/g;

function isReplyLanguageSystemLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed === "[FOCUS_CANCELLED]" || trimmed === "[FOCUS_PARKED]") {
    return true;
  }
  return (
    trimmed.startsWith("Previous tasks in this conversation are cancelled.") ||
    trimmed.startsWith("Previous tasks in this conversation are parked.") ||
    trimmed.startsWith("上一任务已取消。") ||
    trimmed.startsWith("上一任务已暂停。")
  );
}

/**
 * Language detection sees only the user's sentence.
 * Timestamps, focus fences, and sender metadata are system text and must not
 * flip the turn to English.
 */
export function stripReplyLanguageSample(text: string): string {
  const value = text.trim();
  if (!value) {
    return "";
  }
  const withoutSender = value.replace(/Sender \(untrusted metadata\):[\s\S]*?```[\s\S]*?```/g, "");
  const lines = withoutSender
    .split("\n")
    .filter((line) => !isReplyLanguageSystemLine(line))
    .map((line) =>
      line.replace(REPLY_LANGUAGE_FOCUS_TOKEN_RE, "").replace(REPLY_LANGUAGE_TIMESTAMP_RE, ""),
    );
  return lines.join("\n").trim();
}

function countScripts(text: string): { han: number; latin: number } {
  // Artifact locators are opaque data, not English prose. Keep the original
  // text for planning-marker checks and output; mask paths only for counting.
  const sample = text.replace(
    /(?:[A-Za-z]:)?[\\/](?:[A-Za-z0-9._~%+-]+[\\/])*[A-Za-z0-9._~%+-]+/gu,
    " ",
  );
  return {
    han: (sample.match(/[\u4e00-\u9fff]/g) ?? []).length,
    latin: (sample.match(/[A-Za-z]/g) ?? []).length,
  };
}

function hasEnglishPlanningMarkers(text: string): boolean {
  return ENGLISH_PLANNING_MARKERS.some((marker) => marker.test(text));
}

function isInternalHistoryBody(body: string): boolean {
  const trimmed = body.trim();
  return INTERNAL_HISTORY_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function normalizeName(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

/**
 * Prefer the latest real user utterance language; fall back to recent human
 * history. Bot / compaction / system envelopes are ignored.
 */
export function resolveCollaborationReplyLanguage(params: {
  userMessage?: string;
  inboundHistory?: Array<{ sender: string; body: string }>;
  humanNames?: string[];
  botNames?: string[];
  groupLanguage?: "zh" | "en" | "inherit" | null;
}): CollaborationReplyLanguage | null {
  if (params.groupLanguage === "zh" || params.groupLanguage === "en") {
    return params.groupLanguage;
  }
  const fromUser = detectReplyLanguage(stripReplyLanguageSample(params.userMessage ?? ""));
  if (fromUser === "zh" || fromUser === "en") {
    return fromUser;
  }

  const humanSet = new Set((params.humanNames ?? []).map(normalizeName).filter(Boolean));
  const botSet = new Set((params.botNames ?? []).map(normalizeName).filter(Boolean));
  const history = params.inboundHistory ?? [];

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (!entry?.body) {
      continue;
    }
    const body = stripReplyLanguageSample(entry.body);
    if (!body || isInternalHistoryBody(entry.body)) {
      continue;
    }
    const sender = normalizeName(entry.sender);
    if (!sender || sender === "助手" || botSet.has(sender)) {
      continue;
    }
    if (humanSet.size > 0 && sender !== "用户" && !humanSet.has(sender)) {
      // Unknown senders can still be human labels; only hard-skip known bots above.
    }
    const detected = detectReplyLanguage(body);
    if (detected === "zh" || detected === "en") {
      return detected;
    }
  }

  return null;
}

export function formatCollaborationReplyLanguageInstruction(
  language: CollaborationReplyLanguage | null,
): string {
  if (language === "zh") {
    return "本轮用户语种：中文。思考过程不得出现在回复正文里。最终回复只用中文，不要写推理、草稿或过程旁白，也不要把英文思考过程当作最终回复。";
  }
  if (language === "en") {
    return "User language for this round: English. Think and reply in English. Do not put chain-of-thought or a draft outline in the reply text, and do not publish a Chinese chain-of-thought as the final reply.";
  }
  return "Match the user's latest message language. Reasoning must never appear in the reply text. Never publish mixed Chinese/English planning drafts as the final reply.";
}

export const TURN_PROCESS_LOOKUP_ZH = "正在查资料";
export const TURN_PROCESS_WORKING_ZH = "正在处理";
export const TURN_PROCESS_LOOKUP_EN = "Looking this up.";
export const TURN_PROCESS_WORKING_EN = "Working on it.";

export type TurnProcessPlaceholderKind = "lookup" | "working";

/**
 * Delivery-channel process sentence when Layer C was stripped empty.
 * Use only when this turn already called tools — not a second progress engine.
 */
export function formatTurnProcessPlaceholder(
  language: CollaborationReplyLanguage | null,
  kind: TurnProcessPlaceholderKind = "working",
): string {
  if (language === "en") {
    return kind === "lookup" ? TURN_PROCESS_LOOKUP_EN : TURN_PROCESS_WORKING_EN;
  }
  return kind === "lookup" ? TURN_PROCESS_LOOKUP_ZH : TURN_PROCESS_WORKING_ZH;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function paragraphMatchesLanguage(
  paragraph: string,
  expected: CollaborationReplyLanguage,
): boolean {
  const { han, latin } = countScripts(paragraph);
  if (expected === "zh") {
    if (hasEnglishPlanningMarkers(paragraph)) {
      return false;
    }
    // Drop English narration that only embeds Chinese names/quotes.
    if (latin >= 24 && latin > han) {
      return false;
    }
    return han >= 4 && han >= latin;
  }
  if (hasEnglishPlanningMarkers(paragraph) && han >= 8 && latin >= 40) {
    // English planning stuffed with Chinese names/quotes — drop.
    return false;
  }
  if (han >= 16 && han > latin) {
    return false;
  }
  return latin >= 8 && latin >= han;
}

function isMixedLanguagePlanningDraft(text: string): boolean {
  const { han, latin } = countScripts(text);
  if (!hasEnglishPlanningMarkers(text)) {
    return false;
  }
  // Classic failure mode from 权变小组: English planning + Chinese names/quotes.
  return han >= 4 && latin >= 48;
}

function isWrongLanguagePlanningDraft(text: string, expected: CollaborationReplyLanguage): boolean {
  const { han, latin } = countScripts(text);
  if (expected === "zh") {
    // Cron/bot openers like "I'll start by looking…" are often under 40 latin chars.
    if (hasEnglishPlanningMarkers(text) && latin > han) {
      return true;
    }
    if (latin < 40) {
      return false;
    }
    return latin > han * 2 && latin / Math.max(1, han + latin) > 0.72;
  }
  if (han < 16) {
    return false;
  }
  return han > latin * 1.5;
}

export type CollaborationReplyLanguageSanitizeResult =
  | { ok: true; text: string; trimmed: boolean }
  | {
      ok: false;
      reason: "mixed_language_planning" | "wrong_language_planning";
    };

/**
 * Keep moderate same-language meta-reasoning, but strip/suppress mixed or
 * wrong-language planning drafts so they never reach the group transcript.
 */
export function sanitizeCollaborationVisibleReply(params: {
  text: string;
  expectedLanguage: CollaborationReplyLanguage | null;
}): CollaborationReplyLanguageSanitizeResult {
  const raw = params.text.trim();
  const text = applyUserVisibleOutputGate(raw).visibleText.trim();
  if (!text) {
    return { ok: false, reason: "wrong_language_planning" };
  }

  const expected = params.expectedLanguage;
  const mixed = isMixedLanguagePlanningDraft(text);
  const wrong = expected ? isWrongLanguagePlanningDraft(text, expected) : false;

  if (!mixed && !wrong) {
    return { ok: true, text, trimmed: text !== raw };
  }

  const target: CollaborationReplyLanguage = expected ?? (mixed ? "zh" : "en");
  const kept = splitParagraphs(text).filter((paragraph) =>
    paragraphMatchesLanguage(paragraph, target),
  );
  const rewritten = kept.join("\n\n").trim();
  if (!rewritten) {
    return {
      ok: false,
      reason: mixed ? "mixed_language_planning" : "wrong_language_planning",
    };
  }

  // Extracted remnant must itself be language-safe.
  if (
    isMixedLanguagePlanningDraft(rewritten) ||
    isWrongLanguagePlanningDraft(rewritten, target) ||
    !paragraphMatchesLanguage(rewritten, target)
  ) {
    return {
      ok: false,
      reason: mixed ? "mixed_language_planning" : "wrong_language_planning",
    };
  }

  return { ok: true, text: rewritten, trimmed: rewritten !== raw };
}
