import { assignContributionRole } from "./contribution-roles.js";
import { normalizeAgentIdentifier } from "./mention-utils.js";
import type { MentionMode, PrimaryMode } from "./round-state.js";
import type { Tier1ParticipantMeta } from "./tier1b-relevance-engine.js";
import type {
  CollaborationBotTarget,
  CollaborationResponseMode,
  CollaborationRoundPlanPayload,
  MentionConfirm,
  ParticipationDecision,
  RoundPlanAlert,
  RoundPlanParticipant,
} from "./types.js";

function roleReasonText(bot: CollaborationBotTarget, tier: RoundPlanParticipant["tier"]) {
  switch (tier) {
    case "mention":
      return `${bot.name} 已被点名`;
    case "duty":
      return `${bot.name} 与当前阶段职责相关`;
    case "relevance":
      return `${bot.name} 与话题相关`;
    case "wrap":
      return `${bot.name} 将为本轮收口总结`;
  }
}

function buildSummaryText(params: {
  participants: RoundPlanParticipant[];
  tier2: CollaborationBotTarget[];
  responseMode: CollaborationResponseMode;
}) {
  const active = params.participants.filter((entry) => entry.tier !== "wrap");
  const mentionNames = active
    .filter((entry) => entry.tier === "mention")
    .map((entry) => entry.displayName);
  const wrapBot = params.tier2[0]?.name;
  const parts: string[] = [];

  if (active.length > 0) {
    parts.push(`本轮参与 ${active.length} 人`);
  } else {
    parts.push("本轮暂无机器人参与");
  }

  if (params.responseMode === "single_owner") {
    parts.push("单主答模式");
  } else if (params.responseMode === "decision_to_executor") {
    parts.push("决策→执行模式");
  } else if (params.responseMode === "lead_plus_supplement") {
    parts.push("主答+补充模式");
  } else {
    parts.push("讨论协作模式");
  }

  if (mentionNames.length > 0) {
    parts.push(`${mentionNames.join("、")} 已点名`);
  }

  if (wrapBot) {
    parts.push(`${wrapBot} 将收口`);
  }

  return parts.join(" · ");
}

export function buildCollaborationRoundPlan(params: {
  roundId: string;
  sessionKey: string;
  responseMode: CollaborationResponseMode;
  tier0: CollaborationBotTarget[];
  tier1: CollaborationBotTarget[];
  tier1Meta?: Tier1ParticipantMeta[];
  tier2: CollaborationBotTarget[];
  alerts: RoundPlanAlert[];
  lowSignalLimited: boolean;
  mentionUnmatched: boolean;
  mentionConfirm?: MentionConfirm | null;
  primaryMode: PrimaryMode;
  mentionMode: MentionMode;
  mentionAll?: boolean;
}): ParticipationDecision {
  const tier1MetaByAgentId = new Map(
    (params.tier1Meta ?? []).map((entry) => [entry.bot.agentId, entry]),
  );
  const leadAgentId = params.tier0[0]?.agentId ?? params.tier1[0]?.agentId ?? null;
  const participants: RoundPlanParticipant[] = [
    ...params.tier0.map((bot) => ({
      agentId: bot.agentId,
      displayName: bot.name,
      tier: "mention" as const,
      contributionRole: assignContributionRole({
        bot,
        tier: "mention",
        responseMode: params.responseMode,
        leadAgentId,
      }),
      reasonText: roleReasonText(bot, "mention"),
    })),
    ...params.tier1.map((bot) => {
      const meta = tier1MetaByAgentId.get(bot.agentId);
      const tier = meta?.tier ?? ("duty" as const);
      return {
        agentId: bot.agentId,
        displayName: bot.name,
        tier,
        contributionRole: assignContributionRole({
          bot,
          tier,
          responseMode: params.responseMode,
          leadAgentId,
        }),
        reasonText: meta?.reasonText ?? roleReasonText(bot, tier),
      };
    }),
    ...params.tier2.map((bot) => ({
      agentId: bot.agentId,
      displayName: bot.name,
      tier: "wrap" as const,
      contributionRole: "wrap" as const,
      reasonText: roleReasonText(bot, "wrap"),
    })),
  ];

  const normalizedLeadId = leadAgentId ? normalizeAgentIdentifier(leadAgentId) : null;
  if (
    normalizedLeadId &&
    params.primaryMode !== "explicit_multi" &&
    params.responseMode !== "debate_or_brainstorm" &&
    params.responseMode !== "decision_to_executor"
  ) {
    for (const participant of participants) {
      if (participant.tier === "wrap") {
        continue;
      }
      const agentId = normalizeAgentIdentifier(participant.agentId);
      if (agentId === normalizedLeadId) {
        participant.contributionRole = "lead";
      } else if (participant.contributionRole !== "wrap") {
        participant.contributionRole = "supplement";
      }
    }
  }

  if (params.primaryMode === "explicit_multi") {
    for (const participant of participants) {
      if (participant.tier === "mention") {
        participant.contributionRole = "lead";
      }
    }
  }

  const primaryQueue =
    params.mentionUnmatched || params.mentionConfirm
      ? []
      : params.primaryMode === "explicit_multi"
        ? params.tier0.map((bot) => bot.agentId)
        : leadAgentId
          ? [leadAgentId]
          : params.tier1[0]
            ? [params.tier1[0].agentId]
            : [];

  const roundPlan: CollaborationRoundPlanPayload = {
    roundId: params.roundId,
    sessionKey: params.sessionKey,
    responseMode: params.responseMode,
    summaryText:
      params.mentionConfirm?.question ??
      buildSummaryText({
        participants,
        tier2: params.tier2,
        responseMode: params.responseMode,
      }),
    participants,
    mentionMode: params.mentionMode,
    ...(params.mentionAll ? { mentionAll: true } : {}),
    ...(params.alerts.length > 0 ? { alerts: params.alerts } : {}),
  };

  return {
    roundId: params.roundId,
    responseMode: params.responseMode,
    tier0: params.tier0,
    tier1: params.tier1,
    tier2: params.tier2,
    executionBots: [...params.tier0, ...params.tier1],
    roundPlan,
    lowSignalLimited: params.lowSignalLimited,
    mentionUnmatched: params.mentionUnmatched,
    mentionConfirm: params.mentionConfirm ?? null,
    primaryMode: params.primaryMode,
    mentionMode: params.mentionMode,
    primaryQueue,
  };
}
