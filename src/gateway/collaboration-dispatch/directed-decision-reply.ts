import { isPriorUtteranceCorrection } from "../../agent-runtime/policy/index.js";
import { isLanguageAsideMessage } from "../../conversation-task/turn-relation.js";
import { isOnboardingIntroductionMission } from "../collaboration-learning/mission-phase.js";
import { normalizeAgentIdentifier, normalizeMentionIdentity } from "./mention-utils.js";
import type { CollaborationBotTarget, CollaborationDispatchScope } from "./types.js";

type TranscriptMessage = {
  role?: string;
  content?: unknown;
  timestamp?: number;
  senderLabel?: string;
};

const NUMBERED_ITEM_PATTERN = /(?:^|[\s，,;；])(\d+[.)）、])\S+/gu;

const QUESTIONNAIRE_SIGNALS = [
  "确认",
  "动工前",
  "请问",
  "还是",
  "或者",
  "名字",
  "范围",
  "资源",
  "关键细节",
  "？",
  "?",
];

function extractTranscriptText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const typed = block as { type?: string; text?: string };
      if (typed.type === "text" && typeof typed.text === "string") {
        return typed.text.trim();
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function classifyNumberedDecisionReply(message: string) {
  const trimmed = message.trim();
  if (!trimmed || trimmed.includes("@")) {
    return false;
  }
  const matches = trimmed.match(NUMBERED_ITEM_PATTERN);
  return (matches?.length ?? 0) >= 2;
}

function isQuestionnaireAssistantMessage(body: string) {
  const normalized = body.replace(/\s+/g, "");
  if (!normalized) {
    return false;
  }
  const numberedQuestions = body.match(NUMBERED_ITEM_PATTERN);
  if ((numberedQuestions?.length ?? 0) >= 2) {
    return true;
  }
  if (/[?？]/.test(body)) {
    return true;
  }
  const textSignals = QUESTIONNAIRE_SIGNALS.filter((signal) => signal !== "?" && signal !== "？");
  return textSignals.some((signal) => normalized.includes(signal.replace(/\s+/g, "")));
}

function resolveBotBySenderLabel(
  senderLabel: string,
  bots: CollaborationBotTarget[],
): CollaborationBotTarget | null {
  const normalizedSender = normalizeMentionIdentity(senderLabel);
  if (!normalizedSender) {
    return null;
  }
  let bestBot: CollaborationBotTarget | null = null;
  let bestLength = 0;
  for (const bot of bots) {
    for (const value of [bot.name, bot.agentId]) {
      const identity = normalizeMentionIdentity(value);
      if (!identity || identity.length < 2) {
        continue;
      }
      if (
        normalizedSender === identity ||
        normalizedSender.startsWith(identity) ||
        identity.startsWith(normalizedSender)
      ) {
        if (identity.length > bestLength) {
          bestLength = identity.length;
          bestBot = bot;
        }
      }
    }
  }
  return bestBot;
}

const INFRA_ASSISTANT_RE =
  /Agent failed before reply|Requested model |Workspace authorization failed|workspace_authorization_failed|^400\b/i;

export function isLastSpeakerFollowUpMessage(message: string | undefined): boolean {
  return isLanguageAsideMessage(message);
}

export function resolveLastSpeakerFollowUpBot(params: {
  message: string;
  recentGroupMessages?: unknown[];
  bots: CollaborationBotTarget[];
}): CollaborationBotTarget | null {
  if (!isLastSpeakerFollowUpMessage(params.message)) {
    return null;
  }
  if (!params.recentGroupMessages?.length) {
    return null;
  }

  for (let index = params.recentGroupMessages.length - 1; index >= 0; index -= 1) {
    const raw = params.recentGroupMessages[index];
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const message = raw as TranscriptMessage;
    if (message.role !== "assistant") {
      continue;
    }
    const body = extractTranscriptText(message.content);
    if (!body || INFRA_ASSISTANT_RE.test(body)) {
      continue;
    }
    const senderLabel = message.senderLabel?.trim();
    if (!senderLabel) {
      continue;
    }
    const bot = resolveBotBySenderLabel(senderLabel, params.bots);
    if (bot) {
      return bot;
    }
  }

  return null;
}

/**
 * Short correction / clarification aimed at the previous answer, e.g.
 * 「我并没有将任务派发给大白管家，大白管家也不在这个群里」 (round 6f230125).
 * Same prior-utterance predicate as one-to-one amend. 「另外…」「新任务」 stay out.
 */
export const RECENT_FOLLOW_UP_WINDOW_MS = 10 * 60_000;

export function isRecentFollowUpMessage(message: string | undefined): boolean {
  return isPriorUtteranceCorrection(message);
}

type RoundTranscriptMessage = TranscriptMessage & { collaborationRoundId?: string };

/**
 * Follow-up / correction with no explicit mention → previous round's primary.
 * Conservative: previous human message must have been answered by a group bot,
 * that answer must be recent, and (when known) the same human must be speaking.
 * Callers only use this when the message names no bot.
 */
export function resolveRecentFollowUpBot(params: {
  message: string;
  recentGroupMessages?: unknown[];
  bots: CollaborationBotTarget[];
  nowMs?: number;
  senderLabel?: string | null;
  windowMs?: number;
}): CollaborationBotTarget | null {
  if (!isRecentFollowUpMessage(params.message) || !params.recentGroupMessages?.length) {
    return null;
  }
  const nowMs = params.nowMs ?? Date.now();
  const windowMs = params.windowMs ?? RECENT_FOLLOW_UP_WINDOW_MS;
  const currentCompact = params.message.replace(/\s+/g, "");
  const messages = params.recentGroupMessages;
  let index = messages.length - 1;
  // Defensive: skip the current user turn if it was already appended.
  const tail = messages[index] as RoundTranscriptMessage | undefined;
  if (
    tail?.role === "user" &&
    extractTranscriptText(tail.content).replace(/\s+/g, "") === currentCompact
  ) {
    index -= 1;
  }

  let lastReply: { bot: CollaborationBotTarget; message: RoundTranscriptMessage } | null = null;
  for (; index >= 0; index -= 1) {
    const raw = messages[index];
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const message = raw as RoundTranscriptMessage;
    if (message.role === "user") {
      // Previous human turn got no bot reply — not a follow-up to a bot answer.
      return null;
    }
    if (message.role !== "assistant") {
      continue;
    }
    const body = extractTranscriptText(message.content);
    const senderLabel = message.senderLabel?.trim();
    if (!body || INFRA_ASSISTANT_RE.test(body) || !senderLabel) {
      continue;
    }
    const bot = resolveBotBySenderLabel(senderLabel, params.bots);
    if (bot) {
      lastReply = { bot, message };
      break;
    }
  }
  if (!lastReply) {
    return null;
  }
  const repliedAt = lastReply.message.timestamp;
  if (typeof repliedAt !== "number" || !Number.isFinite(repliedAt)) {
    return null;
  }
  if (nowMs - repliedAt > windowMs || nowMs < repliedAt - 60_000) {
    return null;
  }

  // Walk back through the same round to find its primary (first bot reply) and
  // the human message that opened it.
  const roundId = lastReply.message.collaborationRoundId;
  let primary = lastReply.bot;
  let openingUser: RoundTranscriptMessage | null = null;
  for (index -= 1; index >= 0; index -= 1) {
    const raw = messages[index];
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const message = raw as RoundTranscriptMessage;
    if (message.role === "user") {
      openingUser = message;
      break;
    }
    if (message.role !== "assistant") {
      continue;
    }
    if (roundId && message.collaborationRoundId && message.collaborationRoundId !== roundId) {
      break;
    }
    const senderLabel = message.senderLabel?.trim();
    const body = extractTranscriptText(message.content);
    if (!senderLabel || !body || INFRA_ASSISTANT_RE.test(body)) {
      continue;
    }
    const bot = resolveBotBySenderLabel(senderLabel, params.bots);
    if (bot) {
      primary = bot;
    }
  }
  const currentSender = normalizeMentionIdentity(params.senderLabel);
  const openingSender = normalizeMentionIdentity(openingUser?.senderLabel);
  if (currentSender && openingSender && currentSender !== openingSender) {
    return null;
  }
  return primary;
}

export function resolveDirectedDecisionTargetBot(params: {
  message: string;
  recentGroupMessages?: unknown[];
  bots: CollaborationBotTarget[];
}): CollaborationBotTarget | null {
  if (!classifyNumberedDecisionReply(params.message)) {
    return null;
  }
  if (!params.recentGroupMessages?.length) {
    return null;
  }

  for (let index = params.recentGroupMessages.length - 1; index >= 0; index -= 1) {
    const raw = params.recentGroupMessages[index];
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const message = raw as TranscriptMessage;
    if (message.role === "user") {
      continue;
    }
    if (message.role !== "assistant") {
      continue;
    }
    const body = extractTranscriptText(message.content);
    if (!isQuestionnaireAssistantMessage(body)) {
      continue;
    }
    const senderLabel = message.senderLabel?.trim();
    if (!senderLabel) {
      continue;
    }
    const bot = resolveBotBySenderLabel(senderLabel, params.bots);
    if (bot) {
      return bot;
    }
  }

  return null;
}

export function botAgentId(bot: CollaborationBotTarget | null | undefined) {
  return bot ? normalizeAgentIdentifier(bot.agentId) : null;
}

export function resolveActiveGroupMission(scope: CollaborationDispatchScope) {
  return (
    scope.operatingState?.activeContext?.currentMission ??
    scope.operatingState?.groupProfile?.currentMission ??
    scope.groupProfile?.currentMission ??
    null
  );
}

export function isOnboardingIntroductionMissionForScope(scope: CollaborationDispatchScope) {
  return isOnboardingIntroductionMission(resolveActiveGroupMission(scope));
}
