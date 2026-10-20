import type { EffectiveCollaborationPolicy } from "./effective-policy.js";
import { normalizeAgentIdentifier } from "./mention-utils.js";
import { resolveGovernanceLaneCoordinatorBotId } from "./policy-lane-governance.js";
import type { RuntimeFacts } from "./runtime-authority.js";
import type { CollaborationBotTarget } from "./types.js";

export function resolveCoordinatorBotId(
  facts: RuntimeFacts,
  effective?: EffectiveCollaborationPolicy | null,
) {
  // P1-A5 ③ BP-16: coordinator via governance lane (default legacy =
  // facts.coordinatorBotId projected at composition root from BP-15 standing
  // resolution; standing id projected onto facts.coordinatorBotId).
  return resolveGovernanceLaneCoordinatorBotId({
    legacyCoordinatorBotId: facts.coordinatorBotId ?? "",
    effective: effective ?? null,
  }).coordinatorBotId;
}

export function findCoordinatorBot(
  facts: RuntimeFacts,
  bots: CollaborationBotTarget[],
  effective?: EffectiveCollaborationPolicy | null,
) {
  const coordinatorBotId = resolveCoordinatorBotId(facts, effective);
  if (!coordinatorBotId) {
    return undefined;
  }
  return bots.find((bot) => normalizeAgentIdentifier(bot.agentId) === coordinatorBotId);
}

export function resolveBotDiscussionRole(params: {
  facts: RuntimeFacts;
  bot: CollaborationBotTarget;
}) {
  const normalizedAgentId = normalizeAgentIdentifier(params.bot.agentId);
  if (!normalizedAgentId) {
    return null;
  }
  const roleEntry = params.facts.memberRoleMap.find(
    (member) =>
      member.memberKind === "bot" &&
      [normalizeAgentIdentifier(member.memberId), normalizeAgentIdentifier(member.label)]
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

export function scoreGroupDiscussionBot(params: {
  facts: RuntimeFacts;
  bot: CollaborationBotTarget;
}) {
  const normalizedAgentId = normalizeAgentIdentifier(params.bot.agentId);
  const normalizedCoordinatorId = resolveCoordinatorBotId(params.facts);
  const role = resolveBotDiscussionRole(params);
  const phase = params.facts.activeContext.currentOperatingPhase;
  let score = 0;

  if (
    normalizedAgentId &&
    normalizedCoordinatorId &&
    normalizedAgentId === normalizedCoordinatorId
  ) {
    score += 120;
  }

  const recentSpeakerIndex =
    normalizedAgentId != null
      ? (params.facts.recentAssistantBotIds?.indexOf(normalizedAgentId) ?? -1)
      : -1;
  if (recentSpeakerIndex === 0) {
    score -= 120;
  } else if (recentSpeakerIndex === 1) {
    score -= 80;
  } else if (recentSpeakerIndex === 2) {
    score -= 40;
  }

  switch (phase) {
    case "explore":
      switch (role) {
        case "coordinator":
          score += 50;
          break;
        case "contributor":
          score += 45;
          break;
        case "decision_advisor":
          score += 35;
          break;
        case "reviewer":
          score += 20;
          break;
        case "final_decider":
          score += 15;
          break;
      }
      break;
    case "debate":
      switch (role) {
        case "reviewer":
          score += 50;
          break;
        case "decision_advisor":
          score += 45;
          break;
        case "coordinator":
          score += 35;
          break;
        case "contributor":
          score += 20;
          break;
        case "final_decider":
          score += 10;
          break;
      }
      break;
    case "decide":
      switch (role) {
        case "final_decider":
          score += 50;
          break;
        case "coordinator":
          score += 45;
          break;
        case "reviewer":
          score += 35;
          break;
        case "decision_advisor":
          score += 30;
          break;
        case "contributor":
          score += 20;
          break;
      }
      break;
    case "deliver":
      switch (role) {
        case "contributor":
          score += 50;
          break;
        case "reviewer":
          score += 45;
          break;
        case "coordinator":
          score += 35;
          break;
        case "final_decider":
          score += 20;
          break;
        case "decision_advisor":
          score += 15;
          break;
      }
      break;
  }

  return score;
}

export function rankGroupDiscussionBots(facts: RuntimeFacts, bots: CollaborationBotTarget[]) {
  return bots.toSorted((left, right) => {
    const scoreDiff =
      scoreGroupDiscussionBot({ facts, bot: right }) -
      scoreGroupDiscussionBot({ facts, bot: left });
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    const updatedAtDiff = right.updatedAt - left.updatedAt;
    if (updatedAtDiff !== 0) {
      return updatedAtDiff;
    }
    return left.name.localeCompare(right.name);
  });
}

function resolvePhasePriorityRoles(facts: RuntimeFacts) {
  switch (facts.activeContext.currentOperatingPhase) {
    case "explore":
      return ["coordinator", "contributor", "decision_advisor"] as const;
    case "debate":
      return ["reviewer", "decision_advisor", "coordinator"] as const;
    case "decide":
      return ["coordinator", "final_decider", "reviewer"] as const;
    case "deliver":
      return ["contributor", "reviewer", "coordinator"] as const;
    case "review":
      return ["reviewer", "coordinator", "decision_advisor"] as const;
    default:
      return [] as const;
  }
}

export function selectPhasePriorityBots(params: {
  facts: RuntimeFacts;
  bots: CollaborationBotTarget[];
  visibleReplyLimit: number;
}) {
  const rankedBots = rankGroupDiscussionBots(params.facts, params.bots);
  const priorityRoles = resolvePhasePriorityRoles(params.facts);
  if (priorityRoles.length === 0) {
    return rankedBots.slice(0, params.visibleReplyLimit);
  }

  const selected: CollaborationBotTarget[] = [];
  const selectedAgentIds = new Set<string>();

  for (const role of priorityRoles) {
    const candidate = rankedBots.find((bot) => {
      const normalizedAgentId = normalizeAgentIdentifier(bot.agentId);
      if (!normalizedAgentId || selectedAgentIds.has(normalizedAgentId)) {
        return false;
      }
      return resolveBotDiscussionRole({ facts: params.facts, bot }) === role;
    });
    if (!candidate) {
      continue;
    }
    selected.push(candidate);
    selectedAgentIds.add(candidate.agentId);
    if (selected.length >= params.visibleReplyLimit) {
      return selected;
    }
  }

  for (const bot of rankedBots) {
    const normalizedAgentId = normalizeAgentIdentifier(bot.agentId);
    if (!normalizedAgentId || selectedAgentIds.has(normalizedAgentId)) {
      continue;
    }
    selected.push(bot);
    selectedAgentIds.add(normalizedAgentId);
    if (selected.length >= params.visibleReplyLimit) {
      break;
    }
  }

  return selected;
}
