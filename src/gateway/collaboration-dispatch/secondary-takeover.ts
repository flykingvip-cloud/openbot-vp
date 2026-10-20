import { normalizeAgentIdentifier } from "./mention-utils.js";
import type { CollaborationBotTarget } from "./types.js";

/**
 * Pick a FALLBACK candidate from bots that already passed this round's
 * selector. Do not invent a new agent that never went through
 * capability / role / policy filtering.
 */
export function resolveSecondaryTakeoverBot(params: {
  timedOutAgentId: string;
  selected: readonly CollaborationBotTarget[];
}): CollaborationBotTarget | null {
  const timedOut = normalizeAgentIdentifier(params.timedOutAgentId);
  if (!timedOut) {
    return null;
  }
  return (
    params.selected.find((bot) => {
      const agentId = normalizeAgentIdentifier(bot.agentId);
      return Boolean(agentId && agentId !== timedOut);
    }) ?? null
  );
}
