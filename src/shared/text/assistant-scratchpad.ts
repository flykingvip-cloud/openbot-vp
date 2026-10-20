import { splitReplyTagPreamble } from "./reply-tag-preamble.js";

/**
 * Strip layer-A/B leakage from assistant text before it reaches the user bubble.
 * Layer A: English (or tooling) chain-of-thought written as ordinary type:text
 * Layer B: sandbox/path escapes, Exec denied prose, raw /approve protocol lines
 * Layer C: real user-facing answer — keep
 *
 * /approve strip-because-card:
 *   The local approval UI already renders an approval card for `/approve … allow-once`.
 *   Raw protocol fences/lines must not stay in the delivery bubble. When stripped from
 *   a Chinese (or mixed) delivery body, replace with the user-facing CTA
 *   「请批准下面这条命令」 so the bubble stays aligned with the card without leaking
 *   uuid protocol text.
 *
 * Must NOT kill legitimate all-English product answers.
 *
 * Chinese chain-of-thought (deepseek-v4-flash with thinking off) is the same
 * layer as English scratchpad: paragraph markers, not a second reply stage.
 * `[[reply_to_*]]` with a visible answer after it drops the preamble.
 */

const APPROVE_FENCE_RE = /```(?:[^\n`]*)\n\s*\/approve\s+[0-9a-f-]{8,}\s+allow-once\s*\n```/gi;
const APPROVE_LINE_RE = /^\s*\/approve\s+[0-9a-f-]{8,}\s+allow-once\s*$/gim;
/** User-facing rewrite after strip-because-card. */
export const APPROVE_CARD_CTA = "请批准下面这条命令";

const META_LINE_RE =
  /^\s*(\/\*?|\/\/)?\s*(Exec denied|Path escapes sandbox|Approval required \(id|toolCall|TRANSPORT_UNCONFIGURED|PROTOCOL_ENGINE_UNCONFIGURED).*$/gim;

/** Inline exec-deny token — models often wrap it mid-sentence. */
const EXEC_DENIED_ANYWHERE_RE = /Exec denied|\bgateway id=/i;

/** User-facing rewrite when the visible bubble would otherwise be exec meta. */
export const EXEC_DENIED_USER_CTA =
  "这条本机命令没有获授权，我不会重跑。需要的话请在授权卡里处理，或换一种做法。";

/** Async exec follow-up prompt — must never appear as a user-visible bubble. */
const EXEC_FOLLOWUP_LEAK_RE =
  /An async command the user already approved has (completed|finished)|Reply to the user in a helpful way\.|If it succeeded, share the relevant output|If it failed, explain what went wrong|never say Exec denied|User-visible reply rules/i;

/** Heuristic: paragraph looks like model scratchpad, not a product answer. */
const SCRATCHPAD_HINT_RE =
  /\b(Let me|I need to|Actually,|The skill (is|was)|outside my sandbox|try exec|toolCall|Path escapes sandbox|Approval required|I('ll| will) (attempt|clarify)|executive command|gateway id=)\b/i;

/** Cron/bot English openers. Strip from zh delivery; keep for English users as thinking. */
const ENGLISH_PLANNING_OPENER_RE =
  /\b(I('ll| will) (start|fetch|gather|look|inspect|check)|Now I\b|Good[—–-]|Let me (start|check|look|fetch|gather|inspect))\b/i;

/**
 * First-person status of the current task ("I have the paper. Now writing the article.").
 * Not a product answer. Stripped unless the user is writing in English.
 */
const ENGLISH_WORK_PROGRESS_RE =
  /\bI have\b[\s\S]{0,240}\bNow (writing|drafting|preparing|reading|working on)\b/i;

/**
 * Chinese planning written as ordinary text. A paragraph must lead with one of
 * these; a normal answer that merely mentions the same words later is kept.
 */
const CHINESE_SCRATCHPAD_RE =
  /(?:^|\n)\s*(?:用户希望我|用户要求我|用户想让我|让我先|让我试|我先|先看看|先试试|我需要先|我应该|我先试|给回复\s*[:：]|考虑要不要|保持简短|技能约束|简洁三句|用户可见回复最多三句)|SKILL\.md|host browser control|\[\[capability_gap/iu;

export type VisibleReplyLanguage = "zh" | "en";

/** Minimum CJK chars for a "solid" Chinese delivery paragraph (L10). */
const SOLID_CJK_MIN = 8;

function splitParagraphs(text: string): string[] {
  return text.split(/\n{2,}/);
}

function cjkCount(text: string): number {
  // A fresh global regex: a shared /g pattern keeps lastIndex and under-counts.
  return text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
}

/**
 * Real Chinese delivery — not English CoT that merely mentions 微信/目录 etc.
 * Scratchpad hints always disqualify, even when a few CJK product nouns appear.
 */
function isSolidCjkDelivery(para: string): boolean {
  const t = para.trim();
  if (!t) {
    return false;
  }
  if (SCRATCHPAD_HINT_RE.test(t) || EXEC_DENIED_ANYWHERE_RE.test(t)) {
    return false;
  }
  if (EXEC_FOLLOWUP_LEAK_RE.test(t)) {
    return false;
  }
  if (/\b(Let me|I need|Actually|sandbox|skill metadata|exec needs approval)\b/i.test(t)) {
    return false;
  }
  return cjkCount(t) >= SOLID_CJK_MIN;
}

function isLayerBLeak(para: string): boolean {
  return (
    EXEC_DENIED_ANYWHERE_RE.test(para) ||
    EXEC_FOLLOWUP_LEAK_RE.test(para) ||
    APPROVE_LINE_RE.test(para) ||
    /^\s*```[\s\S]*\/approve\s+[0-9a-f-]{8,}[\s\S]*```\s*$/i.test(para)
  );
}

function isMostlyEnglishScratchpad(
  para: string,
  expectedLanguage?: VisibleReplyLanguage | null,
): boolean {
  const t = para.trim();
  if (!t) {
    return false;
  }
  if (isSolidCjkDelivery(t)) {
    return false;
  }
  if (isLayerBLeak(t)) {
    return true;
  }
  if (expectedLanguage !== "en" && ENGLISH_WORK_PROGRESS_RE.test(t)) {
    return true;
  }
  // English users keep same-language thinking/status; only Layer B is stripped.
  if (expectedLanguage === "en") {
    return Boolean(
      /\b(The skill (is|was)|outside my sandbox|try exec|toolCall|Path escapes sandbox|Approval required|executive command|gateway id=)\b/i.test(
        t,
      ),
    );
  }
  if (SCRATCHPAD_HINT_RE.test(t) || ENGLISH_PLANNING_OPENER_RE.test(t)) {
    return true;
  }
  if (cjkCount(t) >= SOLID_CJK_MIN) {
    return false;
  }
  if (/\b(Let me|I need|Actually|sandbox|skill metadata|exec needs approval)\b/i.test(t)) {
    return true;
  }
  return false;
}

function isChineseScratchpadParagraph(para: string): boolean {
  const trimmed = para.trim();
  // English sentences that merely mention a machine tag are not Chinese CoT.
  if (cjkCount(trimmed) < 4) {
    return false;
  }
  CHINESE_SCRATCHPAD_RE.lastIndex = 0;
  return CHINESE_SCRATCHPAD_RE.test(trimmed);
}

function isScratchpadParagraph(
  para: string,
  expectedLanguage?: VisibleReplyLanguage | null,
): boolean {
  if (expectedLanguage !== "en" && isChineseScratchpadParagraph(para)) {
    return true;
  }
  return isMostlyEnglishScratchpad(para, expectedLanguage);
}

/**
 * strip-because-card: peel raw /approve protocol; leave a short Chinese CTA when
 * the surrounding body is user-facing delivery (or when the body becomes empty).
 */
function rewriteApproveProtocol(text: string): string {
  if (!APPROVE_FENCE_RE.test(text) && !APPROVE_LINE_RE.test(text)) {
    // reset lastIndex after test
    APPROVE_FENCE_RE.lastIndex = 0;
    APPROVE_LINE_RE.lastIndex = 0;
    return text;
  }
  APPROVE_FENCE_RE.lastIndex = 0;
  APPROVE_LINE_RE.lastIndex = 0;
  let next = text.replace(APPROVE_FENCE_RE, "\n\n").replace(APPROVE_LINE_RE, "");
  next = next
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+/, "")
    .replace(/\s+$/, "");
  const hadCjk = cjkCount(text) > 0 || cjkCount(next) > 0;
  if (!next.trim()) {
    return APPROVE_CARD_CTA;
  }
  if (hadCjk && !next.includes(APPROVE_CARD_CTA)) {
    return `${next}\n\n${APPROVE_CARD_CTA}`;
  }
  return next;
}

function stripMetaLines(text: string): string {
  return text
    .replace(META_LINE_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+/, "");
}

/**
 * If the message mixes scratchpad + user-facing text, keep user-facing parts.
 * If the whole message is scratchpad and nothing else, return "" (caller may hide bubble).
 * If the whole message is a normal English answer (no scratchpad hints), keep as-is.
 */
export function stripAssistantScratchpadFromText(
  text: string,
  expectedLanguage?: VisibleReplyLanguage | null,
): string {
  if (!text) {
    return text;
  }
  let next = rewriteApproveProtocol(stripMetaLines(text));
  if (!next) {
    return "";
  }
  next = splitReplyTagPreamble(next).text;
  if (!next.trim()) {
    return "";
  }

  const paras = splitParagraphs(next);
  const hasExecDeniedLeak = paras.some((p) => EXEC_DENIED_ANYWHERE_RE.test(p));
  if (paras.length === 1) {
    if (isScratchpadParagraph(paras[0], expectedLanguage)) {
      return hasExecDeniedLeak ? EXEC_DENIED_USER_CTA : "";
    }
    return next;
  }

  const kept = paras.filter((p) => !isScratchpadParagraph(p, expectedLanguage));
  if (kept.length === 0) {
    // Solid Chinese delivery can rescue a mixed bubble. Chinese scratchpad
    // must not — ≥8 Han characters used to keep the whole chain of thought.
    const cjkParas = paras.filter((p) => isSolidCjkDelivery(p) && !isChineseScratchpadParagraph(p));
    if (cjkParas.length > 0) {
      return cjkParas[cjkParas.length - 1].trimStart();
    }
    return hasExecDeniedLeak ? EXEC_DENIED_USER_CTA : "";
  }
  return kept.join("\n\n").trimStart();
}

export function stripAssistantScratchpadFromContent(
  content: unknown,
  expectedLanguage?: VisibleReplyLanguage | null,
): unknown {
  if (typeof content === "string") {
    return stripAssistantScratchpadFromText(content, expectedLanguage);
  }
  if (!Array.isArray(content)) {
    return content;
  }
  let changed = false;
  const next = content.map((block) => {
    if (!block || typeof block !== "object") {
      return block;
    }
    const rec = block as Record<string, unknown>;
    if (rec.type !== "text" || typeof rec.text !== "string") {
      return block;
    }
    const cleaned = stripAssistantScratchpadFromText(rec.text, expectedLanguage);
    if (cleaned === rec.text) {
      return block;
    }
    changed = true;
    return { ...rec, text: cleaned };
  });
  return changed ? next : content;
}

function assistantTextBlocks(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const rec = block as Record<string, unknown>;
      return rec.type === "text" && typeof rec.text === "string" ? rec.text : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function contentHasToolCall(content: unknown): boolean {
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((block) => {
    if (!block || typeof block !== "object") {
      return false;
    }
    const type = (block as { type?: unknown }).type;
    return type === "toolCall" || type === "tool_use" || type === "tool_call";
  });
}

/**
 * Any assistant message that stopped for a tool call. Its text is progress
 * narration, including ordinary prose, and must not become its own reply.
 */
export function isToolUseProgressMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const record = message as Record<string, unknown>;
  return record.role === "assistant" && record.stopReason === "toolUse";
}

/** Visible narration for a toolUse stop. Empty when the text is only scratchpad. */
export function toolUseProgressNarration(
  message: unknown,
  expectedLanguage?: VisibleReplyLanguage | null,
): string {
  if (!isToolUseProgressMessage(message)) {
    return "";
  }
  const record = message as Record<string, unknown>;
  const text = assistantTextBlocks(record.content).trim();
  if (!text) {
    return "";
  }
  return stripAssistantScratchpadFromText(text, expectedLanguage).trim();
}

/**
 * A tool-use assistant turn whose only text is scratchpad. History drops it
 * entirely. Ordinary prose stays in the transcript and is folded into the
 * tool-progress group instead of a reply bubble.
 */
export function isHiddenToolUseScratchpadMessage(
  message: unknown,
  expectedLanguage?: VisibleReplyLanguage | null,
): boolean {
  if (!isToolUseProgressMessage(message)) {
    return false;
  }
  const record = message as Record<string, unknown>;
  if (!contentHasToolCall(record.content)) {
    return false;
  }
  const text = assistantTextBlocks(record.content).trim();
  if (!text) {
    return false;
  }
  return stripAssistantScratchpadFromText(text, expectedLanguage).trim().length === 0;
}
