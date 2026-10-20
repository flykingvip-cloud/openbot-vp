import {
  composeQuotedUserMessage,
  normalizeComposerQuote,
  type ChatComposerQuote,
} from "../../chat/composer-quote.js";

export type ComposerQuoteSendLayers = {
  composerQuote: ChatComposerQuote | null;
  /** Mention / dispatch parsing — composer body only when structured quote is present. */
  mentionMessage: string;
  /** Transcript + agent context — includes rendered quote block when present. */
  transcriptMessage: string;
};

export function resolveComposerQuoteSendLayers(params: {
  bodyMessage: string;
  composerQuote?: unknown;
}): ComposerQuoteSendLayers {
  const composerQuote = normalizeComposerQuote(params.composerQuote);
  const bodyMessage = params.bodyMessage;
  if (composerQuote) {
    return {
      composerQuote,
      mentionMessage: bodyMessage,
      transcriptMessage: composeQuotedUserMessage(composerQuote, bodyMessage),
    };
  }
  return {
    composerQuote: null,
    mentionMessage: bodyMessage,
    transcriptMessage: bodyMessage,
  };
}
