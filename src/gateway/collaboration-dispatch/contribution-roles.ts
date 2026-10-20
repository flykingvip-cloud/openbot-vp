import { normalizeAgentIdentifier } from "./mention-utils.js";
import type { RuntimeFacts } from "./runtime-authority.js";
import { findCoordinatorBot, rankGroupDiscussionBots } from "./tier1a-duty-engine.js";
import type {
  CollaborationBotTarget,
  CollaborationResponseMode,
  ContributionRole,
} from "./types.js";

export function resolveBotCollaborationRole(facts: RuntimeFacts, bot: CollaborationBotTarget) {
  const normalizedAgentId = normalizeAgentIdentifier(bot.agentId);
  if (!normalizedAgentId) {
    return null;
  }
  const roleEntry = facts.memberRoleMap.find(
    (member) =>
      member.memberKind === "bot" &&
      [normalizeAgentIdentifier(member.memberId), member.label?.trim().toLowerCase()]
        .filter(Boolean)
        .some(
          (value) =>
            value === normalizedAgentId ||
            value === `bot:${normalizedAgentId}` ||
            value?.endsWith(`:${normalizedAgentId}`) === true,
        ),
  );
  return roleEntry?.collaborationRole ?? null;
}

export function isSecretaryLikeBot(_facts: RuntimeFacts, bot: CollaborationBotTarget) {
  const normalizedName = bot.name.replace(/\s+/g, "").toLowerCase();
  return normalizedName.includes("秘书") || normalizedName.includes("secretary");
}

export function shouldSuppressSecretaryForKnowledgeRound(params: {
  facts: RuntimeFacts;
  bot: CollaborationBotTarget;
  responseMode: CollaborationResponseMode;
  wasMentioned: boolean;
}) {
  if (params.wasMentioned) {
    return false;
  }
  if (params.responseMode !== "single_owner") {
    return false;
  }
  return isSecretaryLikeBot(params.facts, params.bot);
}

function dedupeBots(bots: CollaborationBotTarget[]) {
  const seen = new Set<string>();
  const result: CollaborationBotTarget[] = [];
  for (const bot of bots) {
    const agentId = normalizeAgentIdentifier(bot.agentId);
    if (!agentId || seen.has(agentId)) {
      continue;
    }
    seen.add(agentId);
    result.push(bot);
  }
  return result;
}

export function applyResponseModeParticipantLimits(params: {
  facts: RuntimeFacts;
  responseMode: CollaborationResponseMode;
  tier0: CollaborationBotTarget[];
  tier1: CollaborationBotTarget[];
  mentionTokens: Set<string>;
}) {
  const mentionedAgentIds = new Set(
    params.tier0.map((bot) => normalizeAgentIdentifier(bot.agentId)).filter(Boolean),
  );
  const filterBots = (bots: CollaborationBotTarget[]) =>
    bots.filter((bot) => {
      const agentId = normalizeAgentIdentifier(bot.agentId);
      const wasMentioned = agentId != null && mentionedAgentIds.has(agentId);
      return !shouldSuppressSecretaryForKnowledgeRound({
        facts: params.facts,
        bot,
        responseMode: params.responseMode,
        wasMentioned,
      });
    });

  let tier0 = filterBots(params.tier0);
  let tier1 = filterBots(params.tier1);
  const coordinator = findCoordinatorBot(params.facts, [...tier0, ...tier1]);
  const coordinatorId = coordinator ? normalizeAgentIdentifier(coordinator.agentId) : null;

  if (params.responseMode === "single_owner") {
    const ranked = rankGroupDiscussionBots(
      params.facts,
      dedupeBots([...tier0, ...tier1]).filter((bot) => {
        const agentId = normalizeAgentIdentifier(bot.agentId);
        return !(coordinatorId && agentId === coordinatorId && !mentionedAgentIds.has(agentId));
      }),
    );
    const lead = ranked[0];
    if (!lead) {
      return { tier0: [], tier1: [] };
    }
    const supplement = ranked.find((bot) => bot.agentId !== lead.agentId);
    const leadMentioned = tier0.some((bot) => bot.agentId === lead.agentId);
    tier0 = leadMentioned ? [lead] : [];
    tier1 = leadMentioned
      ? supplement
        ? [supplement]
        : []
      : supplement
        ? [lead, supplement]
        : [lead];
    return { tier0, tier1 };
  }

  if (params.responseMode === "lead_plus_supplement") {
    const withoutUnmentionedCoordinator = dedupeBots([...tier0, ...tier1]).filter((bot) => {
      const agentId = normalizeAgentIdentifier(bot.agentId);
      if (coordinatorId && agentId === coordinatorId && !mentionedAgentIds.has(agentId)) {
        return false;
      }
      return true;
    });
    const specialists =
      withoutUnmentionedCoordinator.length > 0
        ? withoutUnmentionedCoordinator
        : coordinator
          ? [coordinator]
          : [];
    const capped = specialists.slice(0, 2);
    const cappedIds = new Set(
      capped.map((bot) => normalizeAgentIdentifier(bot.agentId)).filter(Boolean),
    );
    const nextTier0 = tier0.filter((bot) => {
      const agentId = normalizeAgentIdentifier(bot.agentId);
      return agentId != null && cappedIds.has(agentId);
    });
    const nextTier1 = capped.filter(
      (bot) => !nextTier0.some((lead) => lead.agentId === bot.agentId),
    );
    return { tier0: nextTier0, tier1: nextTier1 };
  }

  if (params.responseMode === "decision_to_executor") {
    const executor =
      tier0[0] ??
      tier1.find((bot) => {
        const agentId = normalizeAgentIdentifier(bot.agentId);
        return agentId != null && mentionedAgentIds.has(agentId);
      }) ??
      tier1[0];
    if (!executor) {
      return { tier0: [], tier1: [] };
    }
    const executorId = normalizeAgentIdentifier(executor.agentId);
    let confirmBot = findCoordinatorBot(
      params.facts,
      params.facts.bots as CollaborationBotTarget[],
    );
    if (confirmBot && executorId && normalizeAgentIdentifier(confirmBot.agentId) === executorId) {
      confirmBot = findCoordinatorBot(
        params.facts,
        (params.facts.bots as CollaborationBotTarget[]).filter(
          (bot) => normalizeAgentIdentifier(bot.agentId) !== executorId,
        ),
      );
    }
    if (!confirmBot) {
      return { tier0: [executor], tier1: [] };
    }
    return { tier0: [confirmBot], tier1: [executor] };
  }

  return { tier0, tier1 };
}

export function assignContributionRole(params: {
  bot: CollaborationBotTarget;
  tier: "mention" | "duty" | "relevance" | "wrap";
  responseMode: CollaborationResponseMode;
  leadAgentId?: string | null;
}): ContributionRole {
  if (params.tier === "wrap") {
    return "wrap";
  }
  if (params.responseMode === "decision_to_executor") {
    return params.tier === "mention" ? "confirm" : "executor";
  }
  if (params.tier === "mention") {
    return "lead";
  }
  const agentId = normalizeAgentIdentifier(params.bot.agentId);
  if (params.leadAgentId && agentId === normalizeAgentIdentifier(params.leadAgentId)) {
    return "lead";
  }
  if (params.responseMode === "debate_or_brainstorm") {
    return params.tier === "relevance" ? "challenge" : "supplement";
  }
  return "supplement";
}
