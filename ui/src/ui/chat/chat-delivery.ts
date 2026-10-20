/**
 * Chat delivery-layer bubble parser (v0).
 *
 * Maps assistant delivery text into { conclusion, detail?, next?, choices? }
 * for the workbench bubble component. Distinct from deliverable-envelope
 * (`<<DELIVERABLE>>` product tags). Process/thinking panels stay out of this path.
 *
 * Spec: reply-surface-protocol / chat-delivery-fields.md
 */

export type ChatDeliveryChoice = {
  key: string;
  label: string;
};

export type ChatDelivery = {
  conclusion: string;
  detail?: string;
  next?: string;
  choices?: ChatDeliveryChoice[];
};

export type ChatDeliveryGateOptions = {
  /** Streaming may use the same skeleton once a conclusion beat exists. */
  streaming?: boolean;
  /** Alias used by some call sites. */
  isStreaming?: boolean;
  /**
   * Collaboration supplement (lead_plus_supplement member):
   * conclusion-only OK; never invent choices UI when choices are absent.
   */
  isSupplement?: boolean;
};

const NEXT_HEADING_RE = /^(?:下一步|Next(?:\s*steps?)?)\s*[:：]?\s*$/i;
const CHOICES_HEADING_RE = /^(?:你选|选项|Choices?|Options?)\s*[:：]?\s*$/i;
const BRACKET_LABEL_RE = /^【\s*(结论|现状|说明|下一步|选项|你选)\s*】\s*/;
const LABELED_CHOICE_RE = /^([A-Za-z])\s*(?:[·•]|[.．、)])\s*(.+)$/;
const NUMBERED_CHOICE_RE = /^(?:[-*•]|\d+[.)、])\s*(.+)$/;
const CHITCHAT_ONLY_RE =
  /^(你好|您好|嗨|哈喽|hello|hi|hey|在吗|在的|嗯|好的|收到|谢谢|ok|okay)[!！。.?？~～\s]*$/i;

function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function stripBracketLabels(line: string): string {
  return line.replace(BRACKET_LABEL_RE, "").trim();
}

function splitParagraphs(block: string): string[] {
  return block
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function countSignificantChars(text: string): number {
  const matches = text.match(/[\u4e00-\u9fffA-Za-z0-9]/g);
  return matches ? matches.length : 0;
}

function isHeading(line: string, pattern: RegExp): boolean {
  return pattern.test(line.trim());
}

export function parseChoiceLine(line: string): ChatDeliveryChoice | null {
  const trimmed = stripBracketLabels(line.trim());
  if (!trimmed) {
    return null;
  }
  const labeled = LABELED_CHOICE_RE.exec(trimmed);
  if (labeled) {
    return { key: labeled[1].toUpperCase(), label: labeled[2].trim() };
  }
  const numbered = NUMBERED_CHOICE_RE.exec(trimmed);
  if (numbered) {
    const label = numbered[1].trim();
    const indexMatch = /^(\d+)[.)、]/.exec(trimmed);
    const key = indexMatch?.[1] ?? "1";
    return { key, label };
  }
  return null;
}

function hasDeliveryMarkers(text: string): boolean {
  if (NEXT_HEADING_RE.test(text) || CHOICES_HEADING_RE.test(text)) {
    return true;
  }
  if (/^(?:下一步|你选|选项)\b/m.test(text)) {
    return true;
  }
  if (/^[A-Za-z]\s*(?:[·•]|[.．、)])\s*\S+/m.test(text)) {
    return true;
  }
  if (/【\s*(结论|现状|下一步|选项|你选)\s*】/.test(text)) {
    return true;
  }
  return false;
}

/** Short greetings / ≤8 CJK-or-latin chars, single line, no delivery structure. */
export function isShortChitchat(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return true;
  }
  if (hasDeliveryMarkers(trimmed)) {
    return false;
  }
  if (trimmed.includes("\n")) {
    return false;
  }
  if (CHITCHAT_ONLY_RE.test(trimmed)) {
    return true;
  }
  return countSignificantChars(trimmed) <= 8;
}

/**
 * Parse delivery envelope from assistant markdown.
 * Prefer sections titled 下一步 / 你选; also accept A. / A、 / A · choice lines.
 * Heuristic: first para = conclusion; remaining non-choice body paras = detail
 * (do not drop deliverable tables/lists after the second paragraph);
 * 下一步 para = next; choice lines = choices. Strip 【结论】… bracket labels.
 * Returns null if empty / no usable conclusion.
 */
export function parseChatDelivery(text: string): ChatDelivery | null {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return null;
  }

  const lines = normalized.split("\n");
  let section: "body" | "next" | "choices" = "body";
  const bodyLines: string[] = [];
  const nextLines: string[] = [];
  const choiceRaw: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      if (section === "body") {
        bodyLines.push("");
      } else if (section === "next") {
        nextLines.push("");
      }
      continue;
    }

    // 【下一步】content on one line
    const bracketNextInline = /^【\s*下一步\s*】\s*(.*)$/.exec(trimmed);
    if (bracketNextInline) {
      section = "next";
      const rest = bracketNextInline[1].trim();
      if (rest) {
        nextLines.push(rest);
      }
      continue;
    }
    if (/^【\s*(?:选项|你选)\s*】\s*$/.test(trimmed)) {
      section = "choices";
      continue;
    }

    const withoutBracket = stripBracketLabels(trimmed);
    if (isHeading(withoutBracket, NEXT_HEADING_RE) || isHeading(trimmed, NEXT_HEADING_RE)) {
      section = "next";
      continue;
    }
    if (isHeading(withoutBracket, CHOICES_HEADING_RE) || isHeading(trimmed, CHOICES_HEADING_RE)) {
      section = "choices";
      continue;
    }
    const inlineNext = /^(?:下一步|Next)\s*[:：]\s*(.+)$/i.exec(withoutBracket);
    if (inlineNext && section === "body") {
      section = "next";
      nextLines.push(inlineNext[1].trim());
      continue;
    }
    if (
      section === "body" &&
      LABELED_CHOICE_RE.test(withoutBracket) &&
      bodyLines.some((l) => l.trim())
    ) {
      section = "choices";
      choiceRaw.push(withoutBracket);
      continue;
    }
    if (section === "choices") {
      choiceRaw.push(withoutBracket);
      continue;
    }
    if (section === "next") {
      if (LABELED_CHOICE_RE.test(withoutBracket) && nextLines.some((l) => l.trim())) {
        section = "choices";
        choiceRaw.push(withoutBracket);
        continue;
      }
      nextLines.push(withoutBracket);
      continue;
    }
    bodyLines.push(stripBracketLabels(line) === line ? line : stripBracketLabels(line));
  }

  const bodyText = bodyLines.join("\n").trim();
  const next = nextLines.join("\n").trim() || undefined;
  const choices: ChatDeliveryChoice[] = [];
  for (const line of choiceRaw) {
    const parsed = parseChoiceLine(line);
    if (parsed) {
      choices.push(parsed);
    }
  }

  if (!bodyText) {
    return null;
  }

  const bodyParagraphs = splitParagraphs(bodyText);
  const conclusion = stripBracketLabels((bodyParagraphs[0] ?? "").split("\n")[0] ?? "");
  if (!conclusion) {
    return null;
  }

  let detail: string | undefined;
  if (bodyParagraphs.length > 1) {
    const detailParas: string[] = [];
    for (const para of bodyParagraphs.slice(1)) {
      // Skip paragraphs that are themselves choice lines (heuristic fallback).
      const first = para.split("\n")[0] ?? "";
      if (LABELED_CHOICE_RE.test(stripBracketLabels(first))) {
        continue;
      }
      detailParas.push(stripBracketLabels(para));
    }
    detail = detailParas.join("\n\n").trim() || undefined;
  } else {
    const restOfFirst = (bodyParagraphs[0] ?? "").split("\n").slice(1).join("\n").trim();
    detail = restOfFirst ? stripBracketLabels(restOfFirst) : undefined;
  }

  return {
    conclusion,
    ...(detail ? { detail } : {}),
    ...(next ? { next } : {}),
    ...(choices.length > 0 ? { choices } : {}),
  };
}

const FORMAL_CONCLUSION_MIN_CHARS = 12;

/**
 * Whether the assistant bubble should wrap in delivery component chrome.
 * Short chitchat and fenced-code replies stay on the plain markdown path.
 * Two-or-more beats (detail / next / choices) always qualify, including while
 * streaming, so the skeleton does not jump at final. Longer conclusion-only
 * replies also qualify so everyday drafts get the same hierarchy.
 */
export function shouldUseChatDeliveryComponent(
  text: string,
  opts?: ChatDeliveryGateOptions,
): boolean {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return false;
  }
  if (isShortChitchat(normalized)) {
    return false;
  }
  // Keep technical replies with fenced code on the plain markdown path
  // (per-code-block copy affordance lives there; delivery chrome is for decision envelopes).
  if (/```/.test(normalized)) {
    return false;
  }
  const delivery = parseChatDelivery(normalized);
  if (!delivery?.conclusion) {
    return false;
  }
  // Structured delivery (next / choices / multi-para detail) always qualifies.
  if (delivery.next || (delivery.choices && delivery.choices.length > 0) || delivery.detail) {
    return true;
  }
  // Conclusion-only: allow for Supplement; otherwise require markers.
  if (opts?.isSupplement) {
    return true;
  }
  if (hasDeliveryMarkers(normalized)) {
    return true;
  }
  return countSignificantChars(delivery.conclusion) >= FORMAL_CONCLUSION_MIN_CHARS;
}

export function isCollaborationSupplementMessage(message: unknown): boolean {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return false;
  }
  const record = message as Record<string, unknown>;
  const roleCandidates = [
    record.contributionRole,
    record.collaborationRole,
    record.deliveryRole,
    record.replySurfaceRole,
    record.agentRole,
  ];
  for (const role of roleCandidates) {
    if (typeof role === "string" && /supplement/i.test(role.trim())) {
      return true;
    }
  }
  return record.collaborationSupplement === true || record.isSupplement === true;
}

/**
 * Resolve delivery for a final/history assistant bubble.
 * Returns null when the component should not wrap (chitchat / parse fail).
 */
export function resolveChatDelivery(
  message: unknown,
  text: string,
  opts?: ChatDeliveryGateOptions,
): ChatDelivery | null {
  const isSupplement = opts?.isSupplement ?? isCollaborationSupplementMessage(message);
  const gate: ChatDeliveryGateOptions = {
    ...opts,
    isSupplement,
  };
  if (!shouldUseChatDeliveryComponent(text, gate)) {
    return null;
  }
  return parseChatDelivery(text);
}

/** One question in an Interactive Choice panel (P1 multi-question scaffold). */
export type InteractiveChoiceQuestion = {
  /** Human-readable question title shown in the submit summary. */
  name: string;
  /** Currently selected choice; omit when unanswered. */
  choice?: ChatDeliveryChoice;
};

export type InteractiveChoiceSubmitInput = {
  /** Optional restatement of the original task goal. */
  taskGoal?: string;
  /**
   * One or more answered questions. MVP uses a single implicit 「你选」 group;
   * multi-question panels pass one entry per question.
   */
  questions: InteractiveChoiceQuestion[];
  /** What the agent should produce next. */
  followUpInstruction?: string;
};

/** Composer preview text for a choice (key · label). */
export function formatChoiceComposerText(choice: ChatDeliveryChoice): string {
  const key = choice.key.trim();
  const label = choice.label.trim();
  if (!key) {
    return label;
  }
  if (!label) {
    return key;
  }
  return `${key} · ${label}`;
}

/**
 * Build the natural-language user turn submitted by 「确认并继续」.
 * Uses full option labels (not key-only). Skips unanswered optional questions.
 */
export function buildInteractiveChoiceSubmitMessage(input: InteractiveChoiceSubmitInput): string {
  const answered = input.questions.filter((q) => q.choice && q.choice.label.trim());
  const lines: string[] = ["请基于以下选择继续完成任务：", ""];
  if (input.taskGoal?.trim()) {
    lines.push(`任务目标：${input.taskGoal.trim()}`, "");
  }
  if (answered.length === 0) {
    lines.push("（尚未选择任何选项）", "");
  } else {
    for (const q of answered) {
      const name = q.name.trim() || "你选";
      const choice = q.choice!;
      lines.push(`${name}：${formatChoiceComposerText(choice)}`);
    }
    lines.push("");
  }
  lines.push(
    input.followUpInstruction?.trim() ||
      "请据此继续原任务，并明确区分事实、建议与假设。不要重复询问已回答的问题。",
  );
  return lines.join("\n");
}

/** Stable panel id for selection state across lit re-renders. */
export function interactiveChoicePanelId(choices: ChatDeliveryChoice[]): string {
  return choices.map((c) => `${c.key.trim()}\u0000${c.label.trim()}`).join("\u0001");
}
