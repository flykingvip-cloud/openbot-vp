import { normalizeAgentIdentifier } from "./mention-utils.js";
import { resolveCoordinationWindowMs } from "./response-mode.js";
import type { CollaborationBotTarget, ParticipationDecision } from "./types.js";

export type CollaborationExecutionStage = {
  bots: CollaborationBotTarget[];
  contributionRoleByAgentId: Map<string, string>;
  isWrapTurn: boolean;
};

export type CollaborationRoundStages = {
  lead: CollaborationExecutionStage;
  supplement: CollaborationExecutionStage;
  wrap: CollaborationExecutionStage;
  coordinationDelayMs: number;
};

function resolveParticipantContributionRole(decision: ParticipationDecision, agentId: string) {
  return (
    decision.roundPlan.participants.find((participant) => participant.agentId === agentId)
      ?.contributionRole ?? "supplement"
  );
}

function buildStage(
  bots: CollaborationBotTarget[],
  decision: ParticipationDecision,
  isWrapTurn: boolean,
): CollaborationExecutionStage {
  return {
    bots,
    isWrapTurn,
    contributionRoleByAgentId: new Map(
      bots.map((bot) => [
        bot.agentId,
        isWrapTurn ? "wrap" : resolveParticipantContributionRole(decision, bot.agentId),
      ]),
    ),
  };
}

export function buildCollaborationRoundStages(
  decision: ParticipationDecision,
): CollaborationRoundStages {
  if (decision.responseMode === "decision_to_executor") {
    const confirmBots: CollaborationBotTarget[] = [];
    const executorBots: CollaborationBotTarget[] = [];
    for (const bot of decision.executionBots) {
      const role = resolveParticipantContributionRole(decision, bot.agentId);
      if (role === "executor") {
        executorBots.push(bot);
      } else {
        confirmBots.push(bot);
      }
    }
    return {
      lead: buildStage(confirmBots, decision, false),
      supplement: buildStage(executorBots, decision, false),
      wrap: buildStage([], decision, true),
      coordinationDelayMs: resolveCoordinationWindowMs(decision.responseMode),
    };
  }

  const queueIds = decision.primaryQueue
    .map((agentId) => normalizeAgentIdentifier(agentId))
    .filter((agentId): agentId is string => Boolean(agentId));

  if (queueIds.length > 0) {
    const byId = new Map(
      decision.executionBots.map((bot) => [normalizeAgentIdentifier(bot.agentId), bot]),
    );
    const leadBots = queueIds
      .map((agentId) => byId.get(agentId))
      .filter((bot): bot is CollaborationBotTarget => Boolean(bot));
    const leadIdSet = new Set(queueIds);
    const supplementBots = decision.executionBots.filter((bot) => {
      const agentId = normalizeAgentIdentifier(bot.agentId);
      return !agentId || !leadIdSet.has(agentId);
    });
    return {
      lead: buildStage(leadBots, decision, false),
      supplement: buildStage(supplementBots, decision, false),
      wrap: buildStage(
        decision.primaryMode === "explicit_multi" ? [] : decision.tier2,
        decision,
        true,
      ),
      coordinationDelayMs: resolveCoordinationWindowMs(decision.responseMode),
    };
  }

  const leadAgentId = decision.roundPlan.participants.find(
    (participant) => participant.contributionRole === "lead",
  )?.agentId;
  const normalizedLeadId = leadAgentId ? normalizeAgentIdentifier(leadAgentId) : null;

  const leadBots: CollaborationBotTarget[] = [];
  const supplementBots: CollaborationBotTarget[] = [];

  for (const bot of decision.executionBots) {
    const role = resolveParticipantContributionRole(decision, bot.agentId);
    const agentId = normalizeAgentIdentifier(bot.agentId);
    if (role === "lead" || (normalizedLeadId && agentId === normalizedLeadId)) {
      leadBots.push(bot);
      continue;
    }
    supplementBots.push(bot);
  }

  if (leadBots.length === 0 && supplementBots.length > 0) {
    leadBots.push(supplementBots.shift()!);
  }

  return {
    lead: buildStage(leadBots, decision, false),
    supplement: buildStage(supplementBots, decision, false),
    wrap: buildStage(decision.tier2, decision, true),
    coordinationDelayMs: resolveCoordinationWindowMs(decision.responseMode),
  };
}

export function sleepMs(ms: number) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
