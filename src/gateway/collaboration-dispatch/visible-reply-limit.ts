import type { OpenBotConfig } from "../../config/types.js";
import type { GatewayCollaborationGroupOperatingState } from "../collaboration-learning.js";
import type { CollaborationEventKey } from "./collaboration-event-key.js";
import { isCollaborationChitchat } from "./completion-contract.js";
import { classifyNumberedDecisionReply } from "./directed-decision-reply.js";
import type { EffectiveCollaborationPolicy } from "./effective-policy.js";
import { isLowSignalOpenDiscussionMessage } from "./mention-utils.js";
import { resolveDispatchLaneKeywordCaps } from "./policy-lane-dispatch.js";
import type { PolicyLaneMode } from "./policy-lane-divergence.js";
import {
  resolveParticipationLaneVisibleLimits,
  type ParticipationLaneVisibleLimits,
} from "./policy-lane-participation.js";
import { classifySimpleKnowledgeQuestion } from "./response-mode.js";
import type { RuntimeFacts } from "./runtime-authority.js";

export type VisibleReplyLimitMode =
  | "chitchat_idle"
  | "low_signal"
  | "group_broadcast"
  | "focused_task"
  | "open";

export type ResolvedVisibleReplyLimit = {
  mode: VisibleReplyLimitMode;
  limit: number;
  policyCeiling: number;
};

function normalizeMessageText(text: string) {
  return text.replace(/\s+/g, "").trim().toLowerCase();
}

const INTRODUCTION_BROADCAST_SIGNALS = [
  "介绍一下自己",
  "介绍自己",
  "介绍下自己",
  "认识一下",
  "彼此认识",
  "报个到",
  "签到",
];

const PRESENCE_CHECK_SIGNALS = [
  "都在吗",
  "其他人在吗",
  "其它人在吗",
  "还有人吗",
  "各位在吗",
  "人都在吗",
  "谁还在",
];

const ROOM_GREETING_RE = /^(大家好|各位好|全体好)[!！?？。.\s~～]*$/u;

export function isPresenceCheckMessage(message: string): boolean {
  const normalized = normalizeMessageText(message);
  if (!normalized || normalized.includes("@")) {
    return false;
  }
  return PRESENCE_CHECK_SIGNALS.some((signal) => normalized.includes(signal));
}

export function isRoomGreetingMessage(message: string): boolean {
  return ROOM_GREETING_RE.test(message.replace(/\s+/g, "").trim());
}

/** Presence checks always broadcast. Room greetings broadcast only on intro missions. */
function isOnboardingIntroductionMissionForFacts(facts: RuntimeFacts): boolean {
  const mission = `${facts.profileMission ?? ""} ${facts.activeContext.currentMission ?? ""}`;
  return /介绍|认识|自我介绍|onboarding|introduc/i.test(mission);
}

export function shouldBroadcastPresenceOrIntroduction(
  message: string,
  facts?: RuntimeFacts,
): boolean {
  if (isPresenceCheckMessage(message)) {
    return true;
  }
  const normalized = normalizeMessageText(message);
  if (
    normalized &&
    !normalized.includes("@") &&
    INTRODUCTION_BROADCAST_SIGNALS.some((signal) => normalized.includes(signal))
  ) {
    return true;
  }
  return Boolean(
    facts && isRoomGreetingMessage(message) && isOnboardingIntroductionMissionForFacts(facts),
  );
}

export function classifyOpenDiscussionLimitMode(
  message: string,
  facts?: RuntimeFacts,
): VisibleReplyLimitMode {
  const normalized = normalizeMessageText(message);
  if (!normalized || normalized.includes("@")) {
    return "open";
  }

  if (shouldBroadcastPresenceOrIntroduction(message, facts)) {
    return "group_broadcast";
  }

  if (isCollaborationChitchat(message)) {
    return "chitchat_idle";
  }

  const focusedTaskSignals = [
    "分析",
    "制定",
    "方案",
    "评审",
    "决策",
    "输出",
    "交付",
    "总结",
    "收敛",
    "批判",
    "下一步",
    "怎么办",
    "任务",
    "执行",
    "修改",
    "修复",
    "实现",
    "开发",
  ];
  if (focusedTaskSignals.some((signal) => normalized.includes(signal))) {
    return "focused_task";
  }

  return "open";
}

export function resolveElasticVisibleReplyLimit(params: {
  message: string;
  facts: RuntimeFacts;
  /** P0.0b: injected EffectivePolicy avoids a second compile. */
  effective?: EffectiveCollaborationPolicy;
  /**
   * Legacy BP-01/02 source (scope.operatingState). Read inside the participation
   * lane composition-root helper — this file must not touch raw OS policy fields.
   */
  operatingState?:
    | Pick<GatewayCollaborationGroupOperatingState, "collaborationPolicy">
    | {
        collaborationPolicy?: {
          maxVisibleBotRepliesPerRound?: unknown;
          maxVisibleBotRepliesPerRoundBroad?: unknown;
        } | null;
      }
    | null;
  mode?: PolicyLaneMode;
  key?: CollaborationEventKey | null;
  cfg?: OpenBotConfig;
}): ResolvedVisibleReplyLimit {
  const botCount = params.facts.bots.length;
  // P1-A5 ①: BP-01/02 go through the participation lane (default legacy = raw OS clamp).
  const lane: ParticipationLaneVisibleLimits = resolveParticipationLaneVisibleLimits({
    effective: params.effective,
    operatingState: params.operatingState,
    botCount,
    ...(params.mode !== undefined ? { mode: params.mode } : {}),
    ...(params.key !== undefined ? { key: params.key } : {}),
    ...(params.cfg !== undefined ? { cfg: params.cfg } : {}),
  });
  const policyCeiling = lane.policyCeiling;
  // P1-A5 ② B1: keyword caps via dispatch lane (default legacy = L1_KEYWORD_CAPS_DEFAULTS).
  const keywordCaps = resolveDispatchLaneKeywordCaps({
    effective: params.effective,
    ...(params.key !== undefined ? { key: params.key } : {}),
    ...(params.cfg !== undefined ? { cfg: params.cfg } : {}),
  }).caps;

  if (botCount === 0) {
    return { mode: "open", limit: 0, policyCeiling };
  }

  if (shouldBroadcastPresenceOrIntroduction(params.message, params.facts)) {
    const limit = Math.min(botCount, lane.broadcastCeiling);
    return { mode: "group_broadcast", limit, policyCeiling };
  }

  if (isCollaborationChitchat(params.message)) {
    // Greetings must still produce >=1 visible reply (coordinator/member),
    // otherwise primaryQueue stays empty and the UI hangs on empty participant ledger.
    return { mode: "chitchat_idle", limit: keywordCaps.chitchat, policyCeiling };
  }

  if (classifySimpleKnowledgeQuestion(params.message)) {
    // Classifier cap is a tighter heuristic, never a second policy SoT.
    return {
      mode: "open",
      limit: Math.min(botCount, keywordCaps.simpleKnowledge, policyCeiling),
      policyCeiling,
    };
  }

  if (classifyNumberedDecisionReply(params.message)) {
    return {
      mode: "focused_task",
      limit: Math.min(keywordCaps.numberedDecision, policyCeiling),
      policyCeiling,
    };
  }

  if (isLowSignalOpenDiscussionMessage(params.message)) {
    return { mode: "low_signal", limit: keywordCaps.lowSignal, policyCeiling };
  }

  const mode = classifyOpenDiscussionLimitMode(params.message, params.facts);
  if (mode === "chitchat_idle") {
    return { mode, limit: keywordCaps.chitchat, policyCeiling };
  }
  if (mode === "group_broadcast") {
    const limit = Math.min(botCount, lane.broadcastCeiling);
    return { mode, limit, policyCeiling };
  }

  if (mode === "focused_task") {
    return { mode, limit: Math.min(botCount, policyCeiling), policyCeiling };
  }

  return { mode: "open", limit: Math.min(botCount, policyCeiling), policyCeiling };
}
