import type { CollaborationRole } from "@openbot/collaboration-core";
import type { EffectiveCollaborationPolicy } from "./effective-policy.js";
import { normalizeAgentIdentifier } from "./mention-utils.js";
import type { MentionMode } from "./round-state.js";
import type { RuntimeFacts } from "./runtime-authority.js";
import { resolveBotDiscussionRole } from "./tier1a-duty-engine.js";
import type { CollaborationBotTarget, CollaborationResponseMode, RoundPlanAlert } from "./types.js";

const REVIEW_ROLES = new Set<CollaborationRole>(["reviewer", "decision_advisor", "coordinator"]);
const TASK_OWNER_ROLES = new Set<CollaborationRole>([
  "contributor",
  "final_decider",
  "coordinator",
]);

export type StrategyDispatchPlan = {
  responseMode: CollaborationResponseMode;
  applyKeywordLimits: boolean;
  constrainUnmentionedToRoles: ReadonlySet<CollaborationRole> | null;
  alerts: RoundPlanAlert[];
};

/**
 * Strategy is the selector source. Message keywords only refine within a
 * discussion template, or pick a focused owner inside task_driven.
 */
export function resolveStrategyDispatchPlan(params: {
  effective: EffectiveCollaborationPolicy;
  keywordResponseMode: CollaborationResponseMode;
  mentionMode: MentionMode;
}): StrategyDispatchPlan {
  const strategy = params.effective.strategy;
  const mentioned = params.mentionMode !== "none";
  const alerts: RoundPlanAlert[] = [];

  if (strategy.id === "review_driven") {
    const responseMode =
      strategy.preserveConflict && params.keywordResponseMode === "single_owner"
        ? "debate_or_brainstorm"
        : params.keywordResponseMode;
    if (responseMode !== params.keywordResponseMode) {
      alerts.push({
        kind: "strategy_constrained",
        message: "本群为评审驱动，冲突需保留，本轮不收成单主答",
      });
    } else if (!mentioned) {
      alerts.push({
        kind: "strategy_constrained",
        message: "本群为评审驱动，未点名时只请评审相关成员回应",
      });
    }
    return {
      responseMode,
      applyKeywordLimits: mentioned ? false : responseMode !== "debate_or_brainstorm",
      constrainUnmentionedToRoles: mentioned ? null : REVIEW_ROLES,
      alerts,
    };
  }

  if (strategy.id === "task_driven") {
    if (!mentioned && params.keywordResponseMode !== "single_owner") {
      alerts.push({
        kind: "strategy_on_demand",
        message: "本群为任务驱动，未点名时按需请负责人回应",
      });
    }
    return {
      responseMode: params.keywordResponseMode,
      applyKeywordLimits: true,
      constrainUnmentionedToRoles:
        mentioned || params.keywordResponseMode === "single_owner" ? null : TASK_OWNER_ROLES,
      alerts,
    };
  }

  return {
    responseMode: params.keywordResponseMode,
    applyKeywordLimits: true,
    constrainUnmentionedToRoles: null,
    alerts,
  };
}

export function filterBotsByCollaborationRoles(params: {
  facts: RuntimeFacts;
  bots: CollaborationBotTarget[];
  roles: ReadonlySet<CollaborationRole>;
}): CollaborationBotTarget[] {
  const matched = params.bots.filter((bot) => {
    const role = resolveBotDiscussionRole({ facts: params.facts, bot });
    return role != null && params.roles.has(role);
  });
  return matched.length > 0 ? matched : params.bots.slice(0, 1);
}

export function shouldLimitLowSignalToOneReply(effective: EffectiveCollaborationPolicy): boolean {
  return effective.participation.lowSignalStrategy !== "all_named_confirmers";
}

export function resolveWrapEnabled(effective: EffectiveCollaborationPolicy): boolean {
  return effective.dispatch.coordinatorWrap;
}

export function keepBotsByAgentId(
  preferred: CollaborationBotTarget[],
  pool: CollaborationBotTarget[],
): CollaborationBotTarget[] {
  const ids = new Set(
    preferred.map((bot) => normalizeAgentIdentifier(bot.agentId)).filter(Boolean),
  );
  return pool.filter((bot) => {
    const agentId = normalizeAgentIdentifier(bot.agentId);
    return agentId != null && ids.has(agentId);
  });
}
