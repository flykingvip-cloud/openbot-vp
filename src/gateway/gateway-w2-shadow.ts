import {
  runItem7W2DarkDualReadShadow,
  type Item7W2SiteId,
} from "../memory/item7-w2-dark-dual-read-shadow.js";

/** Post-resolve shadow; does not call legacy resolver symbols (freeze-safe). */
export function scheduleGatewayW2ResolvedShadow(input: {
  siteId: Item7W2SiteId;
  resolvedLocator: string | null;
}): void {
  runItem7W2DarkDualReadShadow({
    siteId: input.siteId,
    legacyLocator: input.resolvedLocator,
    replacementLocator: null,
  });
}
