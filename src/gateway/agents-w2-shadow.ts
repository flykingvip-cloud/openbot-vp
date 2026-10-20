import {
  runItem7W2DarkDualReadShadow,
  type Item7W2SiteId,
} from "../memory/item7-w2-dark-dual-read-shadow.js";

function scheduleShadow(input: {
  siteId: Item7W2SiteId;
  legacyLocator: string | null;
  replacementLocator: string | null;
}): void {
  runItem7W2DarkDualReadShadow(input);
}

/** Post-resolve shadow only; does not call legacy resolver symbols (freeze-safe). */
export function scheduleAgentsW2ResolvedShadow(input: {
  siteId: Item7W2SiteId;
  resolvedLocator: string | null;
  replacementLocator?: string | null;
}): void {
  scheduleShadow({
    siteId: input.siteId,
    legacyLocator: input.resolvedLocator,
    replacementLocator: input.replacementLocator ?? null,
  });
}

export function scheduleAgentsW2ResolvedShadowPair(input: {
  siteIdTrusted: Item7W2SiteId;
  siteIdLegacy: Item7W2SiteId;
  resolvedLocator: string | null;
}): void {
  scheduleAgentsW2ResolvedShadow({
    siteId: input.siteIdTrusted,
    resolvedLocator: input.resolvedLocator,
  });
  scheduleAgentsW2ResolvedShadow({
    siteId: input.siteIdLegacy,
    resolvedLocator: input.resolvedLocator,
  });
}
