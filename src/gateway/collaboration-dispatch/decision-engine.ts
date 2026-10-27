import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import { suggestWorkMissionAfterOnboarding } from "../collaboration-learning/mission-phase.js";
import { episodeIdForClientRun } from "./collaboration-event-key.js";
import { isCollaborationChitchat } from "./completion-contract.js";
import { applyResponseModeParticipantLimits } from "./contribution-roles.js";
import {
  isOnboardingIntroductionMissionForScope,
  resolveDirectedDecisionTargetBot,
  resolveLastSpeakerFollowUpBot,
  resolveRecentFollowUpBot,
} from "./directed-decision-reply.js";
import type { EffectiveCollaborationPolicy } from "./effective-policy.js";
import { attachFloorShadow } from "./floor-shadow-plan.js";
import {
  isIntroductionFollowUpMessage,
  resolveBotsAlreadyIntroducedInThread,
} from "./group-inbound-history.js";
import { applyV1RollCallDecisionHotfix } from "./hotfix-rollcall-v1.js"; // v1-only
import { resolveMentionConfirmFollowUp } from "./mention-confirm.js";
import { resolveMentionResolution, type ExplicitMentionRef } from "./mention-resolution.js";
import {
  collectMentionTokens,
  hasBroadcastMention,
  hasNonBroadcastMention,
  normalizeAgentIdentifier,
  normalizeMentionIdentity,
} from "./mention-utils.js";
import { selectModeBLead } from "./mode-b-member-selection.js";
import { nominatePrimarySpeaker } from "./primary-matcher.js";
import { resolveCollaborationResponseMode } from "./response-mode.js";
import { buildCollaborationRoundPlan } from "./round-plan.js";
import type { RoundPolicySnapshot } from "./round-policy-snapshot.js";
import { resolveEffectivePolicy } from "./round-policy-snapshot.js";
import type { DecideInput, RuntimeAuthority, RuntimeFacts } from "./runtime-authority.js";
import { buildGroupRuntimeAuthority, scopeViewFromRuntimeFacts } from "./runtime-authority.js";
import { pickRotatedIndex } from "./speaker-rotation.js";
import {
  filterBotsByCollaborationRoles,
  resolveStrategyDispatchPlan,
  resolveWrapEnabled,
  shouldLimitLowSignalToOneReply,
} from "./strategy-dispatch.js";
import {
  findCoordinatorBot,
  rankGroupDiscussionBots,
  resolveCoordinatorBotId,
} from "./tier1a-duty-engine.js";
import { selectTier1Participants, type Tier1ParticipantMeta } from "./tier1b-relevance-engine.js";
import type {
  CollaborationBotTarget,
  CollaborationDispatchScope,
  ParticipationDecision,
} from "./types.js";
import { resolveElasticVisibleReplyLimit } from "./visible-reply-limit.js";

export type DecideParticipantsParams = {
  message: string;
  scope: CollaborationDispatchScope;
  roundId: string;
  explicitMentions?: string[];
  explicitMentionRefs?: ExplicitMentionRef[];
  recentGroupMessages?: unknown[];
  /** Transcript sender label of the human sending this message (follow-up same-human check). */
  senderLabel?: string | null;
  /** Clock override for tests. */
  nowMs?: number;
  /** P0.0b: frozen RoundPolicySnapshot; when set, skip re-compile (BP-18). */
  policySnapshot?: RoundPolicySnapshot | null;
};

function resolveVisibleReplyLimit(params: {
  message: string;
  facts: RuntimeFacts;
  effective?: import("./effective-policy.js").EffectiveCollaborationPolicy;
  operatingState?:
    | import("../collaboration-learning.js").GatewayCollaborationGroupOperatingState
    | null;
}) {
  return resolveElasticVisibleReplyLimit(params);
}

function resolveOpenDiscussionWithoutMention(effective: EffectiveCollaborationPolicy) {
  return effective.participation.openDiscussionWithoutMention;
}

function filterBlockedBots(
  bots: CollaborationBotTarget[],
  blockedAgentIds: readonly string[] | undefined,
) {
  if (!blockedAgentIds?.length) {
    return bots;
  }
  const blocked = new Set(
    blockedAgentIds.map((id) => normalizeAgentIdentifier(id)).filter(Boolean),
  );
  return bots.filter((bot) => {
    const agentId = normalizeAgentIdentifier(bot.agentId);
    return !agentId || !blocked.has(agentId);
  });
}

function excludeStewardBots(bots: CollaborationBotTarget[]) {
  return bots.filter((bot) => !isBuiltinStewardAgent(bot.agentId));
}

function pickRotatedFallbackSpeaker(params: {
  groupId: string;
  roundId?: string;
  bots: CollaborationBotTarget[];
}): CollaborationBotTarget | undefined {
  const bots = params.bots;
  if (bots.length === 0) {
    return undefined;
  }
  return bots[
    pickRotatedIndex({
      groupId: params.groupId,
      roundId: params.roundId,
      count: bots.length,
    })
  ];
}

const PPT_OR_DELIVERABLE_INTENT_RE =
  /(?:\bpptx?\b|powerpoint|演示文稿|幻灯片|路演|做一份?ppt|生成一份?ppt|出一份?ppt|\bcyber-ppt\b|交付物|成果文件|\.html\b|\.pdf\b)/i;

/** Explicit PPT / file-deliverable asks must not inherit a sticky last speaker. */
export function isExplicitPptOrDeliverableIntent(message: string | undefined): boolean {
  const trimmed = message?.trim() ?? "";
  if (!trimmed) {
    return false;
  }
  return PPT_OR_DELIVERABLE_INTENT_RE.test(trimmed);
}

function preferSkillOrMainBot(bots: CollaborationBotTarget[]): CollaborationBotTarget | undefined {
  const byId = (id: string) =>
    bots.find((bot) => normalizeAgentIdentifier(bot.agentId) === normalizeAgentIdentifier(id));
  const skill =
    byId("bot-skill") ||
    bots.find((bot) => {
      const name = (bot.name ?? "").toLowerCase();
      const id = normalizeAgentIdentifier(bot.agentId);
      return (id ?? "").includes("skill") || name.includes("skill") || name.includes("技能");
    });
  if (skill) {
    return skill;
  }
  return byId("main") || bots.find((bot) => normalizeAgentIdentifier(bot.agentId) === "main");
}

function resolveSingleUnmentionedSpeaker(params: {
  facts: RuntimeFacts;
  message: string;
  bots: CollaborationBotTarget[];
  alerts: NonNullable<ParticipationDecision["roundPlan"]["alerts"]>;
  roundId?: string;
  effective?: EffectiveCollaborationPolicy;
}): CollaborationBotTarget[] {
  const bots = excludeStewardBots(params.bots);
  const coordinator = findCoordinatorBot(params.facts, bots, params.effective);
  if (coordinator) {
    params.alerts.push({
      kind: "standing_coordinator",
      message: `未点名时由主负责人 ${coordinator.name} 开口`,
    });
    return [coordinator];
  }
  // Explicit PPT / deliverable: prefer bot-skill/main before matcher sticky paths.
  if (isExplicitPptOrDeliverableIntent(params.message)) {
    const preferred = preferSkillOrMainBot(bots);
    if (preferred) {
      params.alerts.push({
        kind: "matcher_nominated",
        message: `已识别 PPT/交付物意图，优先由 ${preferred.name} 主答`,
      });
      return [preferred];
    }
  }
  const nomination = nominatePrimarySpeaker({
    facts: params.facts,
    message: params.message,
    bots,
  });
  if (nomination) {
    params.alerts.push({
      kind: "matcher_nominated",
      message: `未指定主负责人，已提名 ${nomination.bot.name} 为本轮主答`,
    });
    return [nomination.bot];
  }
  // Do not inherit last speaker for PPT/deliverable (handled above); otherwise sticky OK.
  if (!isExplicitPptOrDeliverableIntent(params.message)) {
    const lastSpeakerId = normalizeAgentIdentifier(params.facts.recentAssistantBotIds?.[0]);
    const lastSpeaker = lastSpeakerId
      ? bots.find((bot) => normalizeAgentIdentifier(bot.agentId) === lastSpeakerId)
      : undefined;
    if (lastSpeaker) {
      params.alerts.push({
        kind: "last_speaker_follow_up",
        message: `匹配置信不足，沿用上一轮主答 ${lastSpeaker.name}`,
      });
      return [lastSpeaker];
    }
  }
  const fallback = pickRotatedFallbackSpeaker({
    groupId: params.facts.groupId,
    roundId: params.roundId,
    bots,
  });
  if (fallback) {
    params.alerts.push({
      kind: "fallback_speaker",
      message: `未指定主负责人且匹配置信不足，本轮由 ${fallback.name} 主答`,
    });
    return [fallback];
  }
  return [];
}

/** Prefer coordinator, else rotate — floor of 1 for greetings. */
function resolveChitchatIdleParticipant(
  facts: RuntimeFacts,
  bots: CollaborationBotTarget[],
  roundId?: string,
  effective?: EffectiveCollaborationPolicy,
): CollaborationBotTarget | undefined {
  const eligible = excludeStewardBots(bots);
  const coordinator = findCoordinatorBot(facts, eligible, effective);
  if (coordinator) {
    return coordinator;
  }
  return pickRotatedFallbackSpeaker({
    groupId: facts.groupId,
    roundId,
    bots: eligible,
  });
}

function botMentionIdentityLength(bot: CollaborationBotTarget, token: string) {
  let best = 0;
  for (const value of [bot.agentId, bot.name]) {
    const identity = normalizeMentionIdentity(value);
    if (!identity || identity.length < 2) {
      continue;
    }
    if (token === identity || token.startsWith(identity)) {
      best = Math.max(best, identity.length);
    }
  }
  return best;
}

function botMatchesMentionToken(bot: CollaborationBotTarget, token: string) {
  return botMentionIdentityLength(bot, token) > 0;
}

function filterBotsAlreadyIntroduced(params: {
  bots: CollaborationBotTarget[];
  allBots: CollaborationBotTarget[];
  message: string;
  recentGroupMessages?: unknown[];
  mentionTokens: Set<string>;
}) {
  if (!params.recentGroupMessages?.length) {
    return params.bots;
  }
  const alreadyIntroduced = resolveBotsAlreadyIntroducedInThread({
    messages: params.recentGroupMessages,
    bots: params.allBots,
    userMessage: params.message,
  });
  if (alreadyIntroduced.size === 0) {
    return params.bots;
  }
  return params.bots.filter((bot) => {
    const agentId = normalizeAgentIdentifier(bot.agentId);
    if (!agentId || !alreadyIntroduced.has(agentId)) {
      return true;
    }
    const wasMentioned = [...params.mentionTokens].some((token) =>
      botMatchesMentionToken(bot, token),
    );
    return wasMentioned;
  });
}

function resolveTier1Selection(params: {
  facts: RuntimeFacts;
  message: string;
  bots: CollaborationBotTarget[];
  visibleReplyLimit: number;
  lowSignalOnly: boolean;
  /** P1-A5 ②: EffectivePolicy for dispatch-lane tier1Merge (BP-03). */
  effective?: EffectiveCollaborationPolicy;
}): { tier1: CollaborationBotTarget[]; tier1Meta: Tier1ParticipantMeta[] } {
  const tier1Meta = selectTier1Participants({
    facts: params.facts,
    message: params.message,
    bots: params.bots,
    visibleReplyLimit: params.visibleReplyLimit,
    dutyOnly: params.lowSignalOnly,
    ...(params.effective ? { effective: params.effective } : {}),
  });
  return {
    tier1: tier1Meta.map((entry) => entry.bot),
    tier1Meta,
  };
}

function resolveTier2WrapBot(params: {
  facts: RuntimeFacts;
  effective: EffectiveCollaborationPolicy;
  tier0: CollaborationBotTarget[];
  tier1: CollaborationBotTarget[];
}) {
  // Wrap is a third LLM turn (usually 大白). Default off so group discussion
  // is not blocked behind a coordinator summary; opt in via compiled policy.
  if (!resolveWrapEnabled(params.effective)) {
    return undefined;
  }
  const coordinator = findCoordinatorBot(
    params.facts,
    params.facts.bots as CollaborationBotTarget[],
    params.effective,
  );
  if (!coordinator) {
    return undefined;
  }
  const selectedIds = new Set(
    [...params.tier0, ...params.tier1].map((bot) => normalizeAgentIdentifier(bot.agentId)),
  );
  const coordinatorId = normalizeAgentIdentifier(coordinator.agentId);
  if (coordinatorId && selectedIds.has(coordinatorId)) {
    return undefined;
  }
  if (params.tier0.length + params.tier1.length <= 1) {
    return undefined;
  }
  return coordinator;
}

export function decideParticipants(
  authority: RuntimeAuthority,
  facts: RuntimeFacts,
  input: DecideInput,
): ParticipationDecision {
  const scope = scopeViewFromRuntimeFacts(authority, facts);
  const params: DecideParticipantsParams = {
    message: input.message,
    scope,
    roundId: input.roundId,
    ...(input.explicitMentions ? { explicitMentions: input.explicitMentions } : {}),
    ...(input.explicitMentionRefs ? { explicitMentionRefs: input.explicitMentionRefs } : {}),
    ...(input.recentGroupMessages ? { recentGroupMessages: input.recentGroupMessages } : {}),
    ...(input.senderLabel !== undefined ? { senderLabel: input.senderLabel } : {}),
    ...(input.nowMs !== undefined ? { nowMs: input.nowMs } : {}),
    policySnapshot: authority.policy,
  };
  const effective = resolveEffectivePolicy(params.scope, params.policySnapshot);
  // P0 G8 / G1: Floor shadow may attach a compare payload. It must not replace
  // participants. Flag-off returns the same decision object. protocol=floor is
  // not a speaker source; the G1 cutover gate stays unsigned. Floor bids and
  // Episode runtime do not choose who speaks on this path.
  const finish = (decision: ParticipationDecision): ParticipationDecision =>
    attachFloorShadow(
      authority,
      facts,
      {
        message: input.message,
        ...(input.explicitMentions ? { explicitMentions: input.explicitMentions } : {}),
        ...(input.explicitMentionRefs ? { explicitMentionRefs: input.explicitMentionRefs } : {}),
      },
      decision,
    );
  const resolvedLimit = resolveVisibleReplyLimit({
    message: params.message,
    facts,
    effective,
    // P1-A5 ①: prefer the caller's real OS (DecideInput.operatingState) so BP-01/02
    // fall back to scope OS when DecideInput.operatingState is absent.
    operatingState: input.operatingState ?? params.scope.operatingState ?? null,
  });
  const keywordResponseMode = resolveCollaborationResponseMode({
    message: params.message,
    visibleLimit: resolvedLimit,
  });
  const mentionTokens = collectMentionTokens(params.message, params.explicitMentions ?? []);
  const mentionAll = hasBroadcastMention(mentionTokens);
  let mentionResolution = resolveMentionResolution({
    message: params.message,
    explicitMentions: params.explicitMentions,
    explicitMentionRefs: params.explicitMentionRefs,
    bots: params.scope.bots,
    humans: params.scope.members?.humans,
  });
  if (
    !mentionResolution.unmatched &&
    !mentionResolution.confirm &&
    mentionResolution.matchedBots.length === 0
  ) {
    const confirmed = resolveMentionConfirmFollowUp({
      message: params.message,
      recentGroupMessages: params.recentGroupMessages,
      bots: params.scope.bots,
    });
    if (confirmed && confirmed.length > 0) {
      const matchedAgentIds = confirmed
        .map((bot) => normalizeAgentIdentifier(bot.agentId))
        .filter((agentId): agentId is string => Boolean(agentId));
      mentionResolution = {
        ...mentionResolution,
        matchedBots: confirmed,
        matchedAgentIds,
        mode: confirmed.length >= 2 ? "explicit_multi" : "single_primary",
        primaryMode: confirmed.length >= 2 ? "explicit_multi" : "single",
        confirm: null,
        unmatched: false,
      };
    }
  }
  // @所有人 / @everyone with no named bot: fan out to every group bot (bounded below).
  const broadcastOnly =
    mentionAll &&
    mentionResolution.matchedBots.length === 0 &&
    !mentionResolution.unmatched &&
    !mentionResolution.confirm;
  if (broadcastOnly) {
    mentionResolution = { ...mentionResolution, mode: "broadcast", primaryMode: "single" };
  }
  const strategyPlan = resolveStrategyDispatchPlan({
    effective,
    keywordResponseMode,
    mentionMode: mentionResolution.mode,
  });
  // Broadcast asks everyone: never collapse to a single owner / decision executor.
  const responseMode =
    broadcastOnly && strategyPlan.responseMode !== "debate_or_brainstorm"
      ? "lead_plus_supplement"
      : strategyPlan.responseMode;
  const visibleReplyLimit = resolvedLimit.limit;
  const alerts: ParticipationDecision["roundPlan"]["alerts"] = [...strategyPlan.alerts];
  let tier0: CollaborationBotTarget[] = [];
  let tier1: CollaborationBotTarget[] = [];
  let tier1Meta: Tier1ParticipantMeta[] = [];
  let lowSignalLimited = false;
  let mentionUnmatched = mentionResolution.unmatched;

  if (resolvedLimit.mode === "group_broadcast" && visibleReplyLimit > resolvedLimit.policyCeiling) {
    alerts.push({
      kind: "group_broadcast_expanded",
      message: `已识别为群向问候/介绍，本轮最多 ${visibleReplyLimit} 位成员可回应`,
    });
  }
  if (isIntroductionFollowUpMessage(params.message) && params.recentGroupMessages?.length) {
    const alreadyIntroduced = resolveBotsAlreadyIntroducedInThread({
      messages: params.recentGroupMessages,
      bots: params.scope.bots,
      userMessage: params.message,
    });
    if (alreadyIntroduced.size > 0) {
      alerts.push({
        kind: "introduction_follow_up",
        message: `已跳过 ${alreadyIntroduced.size} 位在本话题中介绍过的成员`,
      });
    }
  }

  const eligibleBots = filterBlockedBots(
    filterBotsAlreadyIntroduced({
      bots: params.scope.bots,
      allBots: params.scope.bots,
      message: params.message,
      recentGroupMessages: params.recentGroupMessages,
      mentionTokens,
    }),
    params.scope.blockedAgentIds,
  );
  if (params.scope.blockedAgentIds?.length) {
    alerts.push({
      kind: "blocked_on",
      message: `已跳过 ${params.scope.blockedAgentIds.length} 位仍被上游产物挡住的成员`,
    });
  }

  if (visibleReplyLimit === 0) {
    return finish(
      buildCollaborationRoundPlan({
        roundId: params.roundId,
        sessionKey: params.scope.rawSessionKey,
        responseMode,
        tier0,
        tier1,
        tier1Meta,
        tier2: [],
        alerts,
        lowSignalLimited,
        mentionUnmatched,
        primaryMode: mentionResolution.primaryMode,
        mentionMode: mentionResolution.mode,
        mentionAll,
      }),
    );
  }

  if (mentionResolution.confirm) {
    alerts.push({
      kind: "mention_confirm",
      message: mentionResolution.confirm.question,
    });
    return finish(
      buildCollaborationRoundPlan({
        roundId: params.roundId,
        sessionKey: params.scope.rawSessionKey,
        responseMode,
        tier0: [],
        tier1: [],
        tier1Meta: [],
        tier2: [],
        alerts,
        lowSignalLimited: false,
        mentionUnmatched: false,
        mentionConfirm: mentionResolution.confirm,
        primaryMode: "single",
        mentionMode: "none",
        mentionAll,
      }),
    );
  }

  if (mentionResolution.unmatched) {
    alerts.push({
      kind: "mention_unmatched",
      message: "未能匹配到可回应的机器人，请检查名称或邀请状态",
    });
    return finish(
      buildCollaborationRoundPlan({
        roundId: params.roundId,
        sessionKey: params.scope.rawSessionKey,
        responseMode,
        tier0: [],
        tier1: [],
        tier1Meta: [],
        tier2: [],
        alerts,
        lowSignalLimited: false,
        mentionUnmatched: true,
        primaryMode: "single",
        mentionMode: "none",
        mentionAll,
      }),
    );
  }

  if (mentionResolution.matchedBots.length > 0) {
    tier0 = mentionResolution.matchedBots;
  } else if (broadcastOnly) {
    // P4 Mode B: board 责任人 beats `@所有人` — broadcast must not steal lead.
    const modeBIds = (params.scope.modeBBoardClaimantIds ?? [])
      .map((id) => id?.trim())
      .filter((id): id is string => Boolean(id));
    const modeBLead = modeBIds.length
      ? selectModeBLead({
          boardItems: modeBIds.map((claimantId) => ({
            status: "in_progress",
            claimantId,
          })),
          hasBroadcastMention: true,
          bots: excludeStewardBots(eligibleBots),
        })
      : null;
    if (modeBLead?.leadAgentId) {
      const leadBot =
        excludeStewardBots(eligibleBots).find((bot) => {
          const id = normalizeAgentIdentifier(bot.agentId) ?? bot.agentId.trim();
          const want = normalizeAgentIdentifier(modeBLead.leadAgentId) ?? modeBLead.leadAgentId;
          return id === want;
        }) ?? null;
      if (leadBot) {
        tier0 = [leadBot];
        alerts.push({
          kind: "mode_b_board_lead",
          message: `@所有人未抢 lead：Mode B 优先看板责任人 ${leadBot.name}`,
        });
      }
    }
    if (tier0.length === 0) {
      // Everyone is explicitly invited (tier "mention"): first ranked bot leads, the
      // rest follow in the invited supplement window. Bounded by the group's
      // maxVisibleBotRepliesPerRound (already clamped to the L1-Hard absolute cap).
      const pool = rankGroupDiscussionBots(facts, excludeStewardBots(eligibleBots));
      const cap = Math.max(1, Math.min(pool.length, resolvedLimit.policyCeiling));
      tier0 = pool.slice(0, cap);
      alerts.push({
        kind: "broadcast_mention",
        message:
          pool.length > cap
            ? `@所有人：本轮按上限请 ${cap}/${pool.length} 位成员回应`
            : `@所有人：本轮请 ${tier0.length} 位成员依次回应`,
      });
    }
  } else if (!hasNonBroadcastMention(mentionTokens)) {
    const directedTarget = resolveDirectedDecisionTargetBot({
      message: params.message,
      recentGroupMessages: params.recentGroupMessages,
      bots: params.scope.bots,
    });
    // PPT / deliverable asks are new work — never inherit last-speaker sticky.
    const blockStickyFollowUp = isExplicitPptOrDeliverableIntent(params.message);
    const lastSpeakerTarget =
      directedTarget || blockStickyFollowUp
        ? null
        : resolveLastSpeakerFollowUpBot({
            message: params.message,
            recentGroupMessages: params.recentGroupMessages,
            bots: params.scope.bots,
          });
    // Short correction / clarification of the immediately previous answer sticks
    // to that round's primary instead of re-ranking by duty.
    const followUpTarget =
      directedTarget || lastSpeakerTarget || blockStickyFollowUp
        ? null
        : resolveRecentFollowUpBot({
            message: params.message,
            recentGroupMessages: params.recentGroupMessages,
            bots: excludeStewardBots(eligibleBots),
            senderLabel: params.senderLabel,
            nowMs: params.nowMs,
          });
    if (directedTarget) {
      tier0 = [directedTarget];
      alerts.push({
        kind: "directed_decision_reply",
        message: `已识别为对 ${directedTarget.name} 的任务下达，本轮采用决策→执行模式`,
      });
    } else if (lastSpeakerTarget) {
      tier0 = [lastSpeakerTarget];
      alerts.push({
        kind: "last_speaker_follow_up",
        message: `已识别为对 ${lastSpeakerTarget.name} 上一轮回复的跟进`,
      });
    } else if (followUpTarget) {
      tier0 = [followUpTarget];
      alerts.push({
        kind: "last_speaker_follow_up",
        message: `已识别为对 ${followUpTarget.name} 上一轮回复的追问/纠正，由其继续回应`,
      });
    } else if (resolvedLimit.mode === "group_broadcast") {
      // Presence / intro broadcast fans out even when openDiscussionWithoutMention is false.
      ({ tier1, tier1Meta } = resolveTier1Selection({
        facts,
        message: params.message,
        bots: eligibleBots,
        visibleReplyLimit,
        lowSignalOnly: false,
        effective,
      }));
    } else if (isCollaborationChitchat(params.message)) {
      // Idle greetings: floor 1 visible reply — coordinator preferred, else rotate.
      const idleBot = resolveChitchatIdleParticipant(
        facts,
        eligibleBots,
        params.roundId,
        effective,
      );
      tier1 = idleBot ? [idleBot] : [];
      tier1Meta = [];
    } else if (resolveOpenDiscussionWithoutMention(effective)) {
      // P1-A5 ① BP-04/05: charter whenToSpeak fan-out skip deleted (unreachable —
      // buildParticipationCharterPolicy only emits fixed templates; 2³ exhaustive test).
      const collapseLowSignal =
        resolvedLimit.mode === "low_signal" && shouldLimitLowSignalToOneReply(effective);
      const effectiveLimit = collapseLowSignal ? Math.min(visibleReplyLimit, 1) : visibleReplyLimit;
      lowSignalLimited = collapseLowSignal;
      if (lowSignalLimited) {
        alerts.push({
          kind: "low_signal_limited",
          message: "已按协作规则精简回应（通常只需 1 位成员确认）",
        });
      }
      ({ tier1, tier1Meta } = resolveTier1Selection({
        facts,
        message: params.message,
        bots: eligibleBots,
        visibleReplyLimit: effectiveLimit,
        lowSignalOnly: lowSignalLimited,
        effective,
      }));
      if (strategyPlan.constrainUnmentionedToRoles) {
        tier1 = filterBotsByCollaborationRoles({
          facts,
          bots: tier1,
          roles: strategyPlan.constrainUnmentionedToRoles,
        });
        const allowedIds = new Set(tier1.map((bot) => bot.agentId));
        tier1Meta = tier1Meta.filter((entry) => allowedIds.has(entry.bot.agentId));
      }
    } else {
      tier1 = resolveSingleUnmentionedSpeaker({
        facts,
        message: params.message,
        bots: eligibleBots,
        alerts,
        roundId: params.roundId,
        effective,
      });
      tier1Meta = [];
    }
  }

  const skipKeywordLimits =
    mentionResolution.mode === "explicit_multi" ||
    mentionResolution.mode === "broadcast" ||
    !strategyPlan.applyKeywordLimits;
  const tier2Bot =
    mentionResolution.mode === "explicit_multi"
      ? undefined
      : resolveTier2WrapBot({ facts, effective, tier0, tier1 });
  const tier2 = tier2Bot ? [tier2Bot] : [];
  if (!skipKeywordLimits) {
    ({ tier0, tier1 } = applyResponseModeParticipantLimits({
      facts,
      responseMode,
      tier0,
      tier1,
      mentionTokens,
    }));
  }

  if (responseMode === "single_owner") {
    alerts.push({
      kind: "single_owner_mode",
      message: "已识别为基础知识问答，本轮采用单主答协作模式",
    });
  }

  if (responseMode === "decision_to_executor") {
    alerts.push({
      kind: "decision_to_executor_mode",
      message: "协调者结构化确认 → 执行者认领交付；其他成员默认静默",
    });
    if (isOnboardingIntroductionMissionForScope(params.scope)) {
      alerts.push({
        kind: "onboarding_mission_stale",
        message: `群使命仍停留在介绍阶段，建议切换为：${suggestWorkMissionAfterOnboarding()}`,
      });
    }
  }

  const baseline = buildCollaborationRoundPlan({
    roundId: params.roundId,
    sessionKey: params.scope.rawSessionKey,
    responseMode,
    tier0,
    tier1,
    tier1Meta,
    tier2,
    alerts,
    lowSignalLimited,
    mentionUnmatched,
    primaryMode: mentionResolution.primaryMode,
    mentionMode: mentionResolution.mode,
    mentionAll,
  });
  // v1-only — P0.2 15:13 roll-call hotfix (allow-list groups only; default off).
  return finish(
    applyV1RollCallDecisionHotfix({
      scope: params.scope,
      facts,
      message: params.message,
      decision: baseline,
      recentGroupMessages: params.recentGroupMessages,
      mentionAll,
    }),
  );
}

export function selectGroupDiscussionBotsForScope(params: {
  message: string;
  scope: CollaborationDispatchScope;
  explicitMentions?: string[];
}) {
  const { authority, facts } = buildGroupRuntimeAuthority({
    scope: params.scope,
    episodeId: episodeIdForClientRun("legacy"),
  });
  return decideParticipants(authority, facts, {
    message: params.message,
    roundId: "legacy",
    explicitMentions: params.explicitMentions,
    operatingState: params.scope.operatingState ?? null,
  }).executionBots;
}

/** P0.1: prefer facts (or authority+facts). */
export function resolveGroupDiscussionCoordinatorBotId(
  authorityOrFacts: RuntimeAuthority | RuntimeFacts,
  facts?: RuntimeFacts,
) {
  if (facts) {
    return resolveCoordinatorBotId(facts);
  }
  return resolveCoordinatorBotId(authorityOrFacts as RuntimeFacts);
}
