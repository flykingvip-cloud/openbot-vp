/**
 * Quote a prior assistant turn into the composer as the next-question focus.
 *
 * This is not session resume/fork. The full turn already lives in history;
 * send only a short excerpt so the new user message stays small.
 */

export {
  QUOTE_EXCERPT_MAX_CHARS,
  buildQuoteDraft,
  composeQuotedUserMessage,
  excerptForQuote,
  neutralizeMentionTriggersInQuoteText,
  type ChatComposerQuote as ChatQuoteDraft,
} from "../../../../src/chat/composer-quote.js";
