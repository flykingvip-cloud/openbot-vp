import {
  stripAssistantScratchpadFromContent,
  stripAssistantScratchpadFromText,
  type VisibleReplyLanguage,
} from "../shared/text/assistant-scratchpad.js";
import { splitReplyTagPreamble } from "../shared/text/reply-tag-preamble.js";

export type InlineDirectiveParseResult = {
  text: string;
  audioAsVoice: boolean;
  replyToId?: string;
  replyToExplicitId?: string;
  replyToCurrent: boolean;
  hasAudioTag: boolean;
  hasReplyTag: boolean;
};

type InlineDirectiveParseOptions = {
  currentMessageId?: string;
  stripAudioTag?: boolean;
  stripReplyTags?: boolean;
};

const AUDIO_TAG_RE = /\[\[\s*audio_as_voice\s*\]\]/gi;
const REPLY_TAG_RE = /\[\[\s*(?:reply_to_current|reply_to\s*:\s*([^\]\n]+))\s*\]\]/gi;
/** Strip capability-gap markers from user-visible / streamed output (incl. split chunks). */
const CAPABILITY_GAP_TAG_RE = /\[\[\s*capability_gap(?::[^\]]*)?\]\]/gi;
/** Incomplete marker at end of a stream chunk — hold back until closed or abandoned. */
const CAPABILITY_GAP_PARTIAL_TAIL_RE = /\[\[(?:capability_gap(?::[^\]]*)?)?$/i;

function normalizeDirectiveWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

type StripInlineDirectiveTagsResult = {
  text: string;
  changed: boolean;
};

type MessageTextPart = {
  type: "text";
  text: string;
} & Record<string, unknown>;

type MessagePart = Record<string, unknown> | null | undefined;

export type DisplayMessageWithContent = {
  content?: unknown;
} & Record<string, unknown>;

export function stripInlineDirectiveTagsForDisplay(
  text: string,
  expectedLanguage?: VisibleReplyLanguage | null,
): StripInlineDirectiveTagsResult {
  if (!text) {
    return { text, changed: false };
  }
  // Drop chain-of-thought before the last reply tag while the tag is still
  // present. Tag removal below would erase that boundary.
  const split = splitReplyTagPreamble(text);
  const delivery = stripAssistantScratchpadFromText(split.text, expectedLanguage);
  const stripTags = (value: string) => {
    AUDIO_TAG_RE.lastIndex = 0;
    REPLY_TAG_RE.lastIndex = 0;
    CAPABILITY_GAP_TAG_RE.lastIndex = 0;
    return value
      .replace(AUDIO_TAG_RE, "")
      .replace(REPLY_TAG_RE, "")
      .replace(CAPABILITY_GAP_TAG_RE, "");
  };
  const stripped = stripTags(delivery).replace(/\n{3,}/g, "\n\n");
  const originalTagsStripped = stripTags(split.text).replace(/\n{3,}/g, "\n\n");
  // Scratchpad may only trim. Keep the caller's spacing unless the body changed
  // or a reply-tag preamble was dropped.
  const textOut = split.dropped
    ? stripped.trim()
    : stripped.trim() === originalTagsStripped.trim()
      ? originalTagsStripped
      : stripped;
  return {
    text: textOut,
    changed: textOut !== text,
  };
}

function isMessageTextPart(part: MessagePart): part is MessageTextPart {
  return Boolean(part) && part?.type === "text" && typeof part.text === "string";
}

/**
 * Strips inline directive tags from message text blocks while preserving message shape.
 * Empty post-strip text stays empty-string to preserve caller semantics.
 */
export function stripInlineDirectiveTagsFromMessageForDisplay(
  message: DisplayMessageWithContent | undefined,
  expectedLanguage?: VisibleReplyLanguage | null,
): DisplayMessageWithContent | undefined {
  if (!message) {
    return message;
  }
  const next: DisplayMessageWithContent = { ...message };
  let changed = false;
  if (Array.isArray(message.content)) {
    const cleaned = message.content.map((part) => {
      if (!part || typeof part !== "object") {
        return part;
      }
      const record = part as MessagePart;
      if (!isMessageTextPart(record)) {
        return part;
      }
      const text = stripInlineDirectiveTagsForDisplay(record.text, expectedLanguage).text;
      if (text === record.text) {
        return part;
      }
      changed = true;
      return { ...record, text };
    });
    if (changed) {
      next.content = cleaned;
    }
  } else if ("content" in message) {
    const cleaned = stripAssistantScratchpadFromContent(message.content, expectedLanguage);
    if (typeof cleaned === "string") {
      const display = stripInlineDirectiveTagsForDisplay(cleaned, expectedLanguage).text;
      if (display !== message.content) {
        next.content = display;
        changed = true;
      }
    } else if (cleaned !== message.content) {
      next.content = cleaned;
      changed = true;
    }
  }
  if (typeof message.text === "string") {
    const text = stripInlineDirectiveTagsForDisplay(message.text, expectedLanguage).text;
    if (text !== message.text) {
      next.text = text;
      changed = true;
    }
  }
  return changed ? next : message;
}

export function parseInlineDirectives(
  text?: string,
  options: InlineDirectiveParseOptions = {},
): InlineDirectiveParseResult {
  const { currentMessageId, stripAudioTag = true, stripReplyTags = true } = options;
  if (!text) {
    return {
      text: "",
      audioAsVoice: false,
      replyToCurrent: false,
      hasAudioTag: false,
      hasReplyTag: false,
    };
  }
  if (!text.includes("[[")) {
    return {
      text: normalizeDirectiveWhitespace(text),
      audioAsVoice: false,
      replyToCurrent: false,
      hasAudioTag: false,
      hasReplyTag: false,
    };
  }

  let cleaned = text;
  let audioAsVoice = false;
  let hasAudioTag = false;
  let hasReplyTag = false;
  let sawCurrent = false;
  let lastExplicitId: string | undefined;

  if (stripReplyTags) {
    cleaned = splitReplyTagPreamble(cleaned).text;
  }

  cleaned = cleaned.replace(AUDIO_TAG_RE, (match) => {
    audioAsVoice = true;
    hasAudioTag = true;
    return stripAudioTag ? " " : match;
  });

  cleaned = cleaned.replace(REPLY_TAG_RE, (match, idRaw: string | undefined) => {
    hasReplyTag = true;
    if (idRaw === undefined) {
      sawCurrent = true;
    } else {
      const id = idRaw.trim();
      if (id) {
        lastExplicitId = id;
      }
    }
    return stripReplyTags ? " " : match;
  });

  cleaned = cleaned.replace(CAPABILITY_GAP_TAG_RE, " ");

  cleaned = normalizeDirectiveWhitespace(cleaned);

  const replyToId =
    lastExplicitId ?? (sawCurrent ? currentMessageId?.trim() || undefined : undefined);

  return {
    text: cleaned,
    audioAsVoice,
    replyToId,
    replyToExplicitId: lastExplicitId,
    replyToCurrent: sawCurrent,
    hasAudioTag,
    hasReplyTag,
  };
}

/**
 * Strip complete capability_gap markers and hold back a trailing partial `[[…`
 * so markers split across stream chunks never leak to the user.
 */
export function stripCapabilityGapMarkersForStream(text: string): {
  text: string;
  holdback: string;
} {
  if (!text) {
    return { text, holdback: "" };
  }
  let working = text.replace(CAPABILITY_GAP_TAG_RE, "");
  const partial = CAPABILITY_GAP_PARTIAL_TAIL_RE.exec(working);
  if (partial && partial.index >= 0) {
    const holdback = working.slice(partial.index);
    working = working.slice(0, partial.index);
    return { text: working, holdback };
  }
  return { text: working, holdback: "" };
}
