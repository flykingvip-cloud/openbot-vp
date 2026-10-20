import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import { resolveBotCollaborationRole } from "./contribution-roles.js";
import { normalizeAgentIdentifier } from "./mention-utils.js";
import { nominatePrimarySpeaker } from "./primary-matcher.js";
import type { RuntimeFacts } from "./runtime-authority.js";
import { pickRotatedIndex } from "./speaker-rotation.js";
import type { CollaborationBotTarget } from "./types.js";

function excludeStewardBots(bots: readonly CollaborationBotTarget[]) {
  return bots.filter((bot) => !isBuiltinStewardAgent(bot.agentId));
}

/**
 * After a concluded primary, pick one remaining specialist when the supplement
 * queue is empty. Prefer a different collaborationRole; never the steward or
 * standing coordinator (cheap-gate would drop them).
 */
export function pickDutyDifferentiatedSupplement(params: {
  facts: RuntimeFacts;
  message: string;
  leadBots: readonly CollaborationBotTarget[];
  bots: readonly CollaborationBotTarget[];
  roundId?: string;
  responseMode?: string;
}): CollaborationBotTarget | undefined {
  const leadIds = new Set(
    params.leadBots
      .map((bot) => normalizeAgentIdentifier(bot.agentId))
      .filter((id): id is string => Boolean(id)),
  );
  const blocked = new Set(
    (params.facts.busyAgentIds ?? [])
      .map((id) => normalizeAgentIdentifier(id))
      .filter((id): id is string => Boolean(id)),
  );
  const candidates = excludeStewardBots(params.bots).filter((bot) => {
    const agentId = normalizeAgentIdentifier(bot.agentId);
    if (!agentId || leadIds.has(agentId) || blocked.has(agentId)) {
      return false;
    }
    const role = resolveBotCollaborationRole(params.facts, bot);
    if (role === "coordinator") {
      return false;
    }
    if (role === "reviewer" && params.responseMode !== "debate_or_brainstorm") {
      return false;
    }
    return true;
  });
  if (candidates.length === 0) {
    return undefined;
  }

  const leadRole = params.leadBots[0]
    ? resolveBotCollaborationRole(params.facts, params.leadBots[0])
    : null;
  const differentiated =
    leadRole != null
      ? candidates.filter((bot) => resolveBotCollaborationRole(params.facts, bot) !== leadRole)
      : [];
  const pool = differentiated.length > 0 ? differentiated : candidates;
  const nomination = nominatePrimarySpeaker({
    facts: params.facts,
    message: params.message,
    bots: pool,
  });
  if (nomination) {
    return nomination.bot;
  }
  return pool[
    pickRotatedIndex({
      groupId: params.facts.groupId,
      roundId: params.roundId,
      count: pool.length,
    })
  ];
}
