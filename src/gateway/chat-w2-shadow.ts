import {
  runItem7W2DarkDualReadShadow,
  type Item7W2SiteId,
} from "../memory/item7-w2-dark-dual-read-shadow.js";

/** Post-resolve shadow for chat.ts S16; no legacy resolver calls. */
export function scheduleChatW2MentionShadow(input: {
  siteId: Item7W2SiteId;
  resolvedLocator: string | null;
}): void {
  runItem7W2DarkDualReadShadow({
    siteId: input.siteId,
    legacyLocator: input.resolvedLocator,
    replacementLocator: null,
  });
}
