import type { EffectiveCollaborationPolicy } from "./effective-policy.js";
import { normalizeMentionIdentity } from "./mention-utils.js";
import {
  resolveDispatchLaneTier1Merge,
  type Tier1MergePolicyResolved,
} from "./policy-lane-dispatch.js";
import type { RuntimeFacts } from "./runtime-authority.js";
import {
  rankGroupDiscussionBots,
  scoreGroupDiscussionBot,
  selectPhasePriorityBots,
} from "./tier1a-duty-engine.js";
import type { CollaborationBotTarget } from "./types.js";

export type Tier1MergePolicy = {
  dutyFloor?: number;
  proactiveReplyThreshold?: number;
  dutyWeight?: number;
  relevanceWeight?: number;
};

export type Tier1ParticipantMeta = {
  bot: CollaborationBotTarget;
  tier: "duty" | "relevance";
  reasonText: string;
};

function resolveMergePolicy(
  _facts: RuntimeFacts,
  effective?: EffectiveCollaborationPolicy | null,
): Tier1MergePolicyResolved {
  // P1-A5 ② BP-03: tier1Merge via dispatch lane (default legacy = L1_TIER1_MERGE_DEFAULTS).
  return resolveDispatchLaneTier1Merge({ effective }).merge;
}

function phaseKeywordBoost(phase: string | undefined, message: string) {
  const normalizedMessage = message.trim().toLowerCase();
  if (!normalizedMessage) {
    return 0;
  }
  const keywords: Record<string, string[]> = {
    explore: ["介绍", "讨论", "探索", "想法", "认识", "彼此"],
    debate: ["批判", "方案", "风险", "辩论", "反驳"],
    decide: ["决策", "收敛", "拍板", "决定", "建议"],
    deliver: ["交付", "输出", "文档", "总结", "成果"],
  };
  let score = 0;
  for (const keyword of keywords[phase ?? ""] ?? []) {
    if (normalizedMessage.includes(keyword)) {
      score += 12;
    }
  }
  return score;
}

export function scoreRelevanceBot(params: {
  facts: RuntimeFacts;
  bot: CollaborationBotTarget;
  message: string;
}): number {
  const normalizedMessage = params.message.trim().toLowerCase();
  if (!normalizedMessage) {
    return 0;
  }
  let score = 0;
  const botName = normalizeMentionIdentity(params.bot.name);
  const botId = normalizeMentionIdentity(params.bot.agentId);
  if (botName && normalizedMessage.includes(botName)) {
    score += 45;
  }
  if (botId && normalizedMessage.includes(botId)) {
    score += 25;
  }
  score += phaseKeywordBoost(
    params.facts.activeContext.currentOperatingPhase ?? undefined,
    params.message,
  );
  const mission = params.facts.activeContext.summary?.trim().toLowerCase();
  if (mission && mission.length >= 4) {
    const missionSnippet = mission.slice(0, Math.min(12, mission.length));
    if (normalizedMessage.includes(missionSnippet)) {
      score += 15;
    }
  }
  return Math.min(100, score);
}

function buildReasonText(params: {
  bot: CollaborationBotTarget;
  tier: "duty" | "relevance";
  message: string;
}) {
  if (params.tier === "relevance") {
    const normalizedMessage = params.message.trim().toLowerCase();
    const botName = params.bot.name.trim();
    if (botName && normalizedMessage.includes(botName.toLowerCase())) {
      return `${botName} 与当前话题直接相关`;
    }
    return `${params.bot.name} 与话题语义相关`;
  }
  return `${params.bot.name} 与当前阶段职责相关`;
}

function resolveParticipantTier(params: {
  dutyScore: number;
  relevanceScore: number;
}): "duty" | "relevance" {
  if (params.relevanceScore >= 35 && params.relevanceScore >= params.dutyScore * 0.45) {
    return "relevance";
  }
  return "duty";
}

function scoreBotForMerge(params: {
  facts: RuntimeFacts;
  bot: CollaborationBotTarget;
  message: string;
  policy: Required<Tier1MergePolicy>;
}) {
  const dutyScore = scoreGroupDiscussionBot({ facts: params.facts, bot: params.bot });
  const relevanceScore = scoreRelevanceBot({
    facts: params.facts,
    bot: params.bot,
    message: params.message,
  });
  const proactiveScore =
    dutyScore * params.policy.dutyWeight + relevanceScore * params.policy.relevanceWeight;
  const tier = resolveParticipantTier({ dutyScore, relevanceScore });
  return {
    bot: params.bot,
    dutyScore,
    relevanceScore,
    proactiveScore,
    tier,
  };
}

export function selectTier1Participants(params: {
  facts: RuntimeFacts;
  message: string;
  bots: CollaborationBotTarget[];
  visibleReplyLimit: number;
  dutyOnly: boolean;
  /** P1-A5 ②: injected EffectivePolicy for dispatch lane (optional). */
  effective?: EffectiveCollaborationPolicy | null;
}): Tier1ParticipantMeta[] {
  if (params.visibleReplyLimit <= 0 || params.bots.length === 0) {
    return [];
  }

  if (params.dutyOnly) {
    const topBot = rankGroupDiscussionBots(params.facts, params.bots)[0];
    if (!topBot) {
      return [];
    }
    return [
      {
        bot: topBot,
        tier: "duty",
        reasonText: buildReasonText({ bot: topBot, tier: "duty", message: params.message }),
      },
    ];
  }

  const policy = resolveMergePolicy(params.facts, params.effective);

  const phaseSelected = selectPhasePriorityBots({
    facts: params.facts,
    bots: params.bots,
    visibleReplyLimit: params.visibleReplyLimit,
  });

  return phaseSelected.map((bot) => {
    const entry = scoreBotForMerge({
      facts: params.facts,
      bot,
      message: params.message,
      policy,
    });
    return {
      bot,
      tier: entry.tier,
      reasonText: buildReasonText({ bot, tier: entry.tier, message: params.message }),
    };
  });
}
