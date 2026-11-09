import { resolveAuthProfileOrder } from "../../agents/model-auth.js";
import { normalizeProviderId } from "../../agents/model-selection.js";

/** Select authentication candidates without reading credentials or starting execution. */
export function resolveRunAuthProfileCandidates(input: {
  config: Parameters<typeof resolveAuthProfileOrder>[0]["cfg"];
  store: Parameters<typeof resolveAuthProfileOrder>[0]["store"];
  provider: string;
  authProfileId?: string;
  authProfileIdSource?: "auto" | "user";
}) {
  const preferredProfileId = input.authProfileId?.trim();
  let lockedProfileId = input.authProfileIdSource === "user" ? preferredProfileId : undefined;
  if (lockedProfileId) {
    const lockedProfile = input.store.profiles[lockedProfileId];
    if (
      !lockedProfile ||
      normalizeProviderId(lockedProfile.provider) !== normalizeProviderId(input.provider)
    ) {
      lockedProfileId = undefined;
    }
  }
  const profileOrder = resolveAuthProfileOrder({
    cfg: input.config,
    store: input.store,
    provider: input.provider,
    preferredProfile: preferredProfileId,
  });
  if (lockedProfileId && !profileOrder.includes(lockedProfileId)) {
    throw new Error(`Auth profile "${lockedProfileId}" is not configured for ${input.provider}.`);
  }
  const profileCandidates = lockedProfileId
    ? [lockedProfileId]
    : profileOrder.length > 0
      ? profileOrder
      : [undefined];
  return { lockedProfileId, profileCandidates };
}
