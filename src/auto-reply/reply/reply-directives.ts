import { splitMediaFromOutput } from "../../media/parse.js";
import {
  stripAssistantScratchpadFromText,
  type VisibleReplyLanguage,
} from "../../shared/text/assistant-scratchpad.js";
import { rewritePlanSpeakFinal } from "../../shared/text/plan-speak-final.js";
import { parseInlineDirectives } from "../../utils/directive-tags.js";
import { isSilentReplyText, SILENT_REPLY_TOKEN } from "../tokens.js";

export type ReplyDirectiveParseResult = {
  text: string;
  mediaUrls?: string[];
  mediaUrl?: string;
  replyToId?: string;
  replyToCurrent: boolean;
  replyToTag: boolean;
  audioAsVoice?: boolean;
  isSilent: boolean;
};

export function parseReplyDirectives(
  raw: string,
  options: {
    currentMessageId?: string;
    silentToken?: string;
    expectedLanguage?: VisibleReplyLanguage | null;
    /** Latest user turn (compat). Reply layer no longer invents plan-speak pause CTAs. */
    planSpeakContext?: string;
  } = {},
): ReplyDirectiveParseResult {
  const split = splitMediaFromOutput(raw);
  let text = split.text ?? "";

  const replyParsed = parseInlineDirectives(text, {
    currentMessageId: options.currentMessageId,
    stripAudioTag: false,
    stripReplyTags: true,
  });

  if (replyParsed.hasReplyTag) {
    text = replyParsed.text;
  }
  if ("expectedLanguage" in options) {
    text = stripAssistantScratchpadFromText(text, options.expectedLanguage);
  }
  // Pass-through: reply layer must not invent pause/confirm from plan-speak.
  text = rewritePlanSpeakFinal(text, options.planSpeakContext ?? "");

  const silentToken = options.silentToken ?? SILENT_REPLY_TOKEN;
  const isSilent = isSilentReplyText(text, silentToken);
  if (isSilent) {
    text = "";
  }

  return {
    text,
    mediaUrls: split.mediaUrls,
    mediaUrl: split.mediaUrl,
    replyToId: replyParsed.replyToId,
    replyToCurrent: replyParsed.replyToCurrent,
    replyToTag: replyParsed.hasReplyTag,
    audioAsVoice: split.audioAsVoice,
    isSilent,
  };
}
