import { asMessageList, readTextBlock } from "../../shared/text/visible-message-text.js";
import { normalizeAgentIdentifier, normalizeMentionIdentity } from "./mention-utils.js";
import type { CollaborationBotTarget } from "./types.js";

export type CollaborationInboundHistoryEntry = {
  sender: string;
  body: string;
  timestamp: number;
};

type TranscriptMessage = {
  id?: string;
  role?: string;
  content?: unknown;
  timestamp?: number;
  senderLabel?: string;
};

const INTRODUCTION_TOPIC_SIGNALS = ["介绍", "认识", "报到", "签到", "自我介绍", "介绍一下"];

const REMAINING_MEMBERS_SIGNALS = [
  "其他人",
  "其它成员",
  "其它人",
  "剩余",
  "还没",
  "尚未",
  "也介绍",
];

function extractTranscriptText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => readTextBlock(block)?.trim() ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

const INJECTED_HISTORY_SKIP_RE =
  /^(?:NO_REPLY|无需回复|不用回复|不必回复|无增量|没有增量|无增量可补充|暂无增量|Pre-compaction memory flush\.|Conversation info \(untrusted metadata\)|Sender \(untrusted metadata\)|Image attachment guard:|⚠️ Agent failed before reply:|Workspace authorization failed|400:)/;

function shouldSkipInjectedHistoryBody(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) {
    return true;
  }
  return INJECTED_HISTORY_SKIP_RE.test(trimmed);
}

function resolveTranscriptSender(message: TranscriptMessage): string {
  if (message.role === "user") {
    return message.senderLabel?.trim() || "用户";
  }
  if (message.role === "assistant") {
    return message.senderLabel?.trim() || "助手";
  }
  return message.senderLabel?.trim() || "system";
}

export function buildCollaborationGroupInboundHistory(params: {
  messages: unknown;
  limit?: number;
  /** Exclude the triggering message by identity, never by assuming it is last. */
  excludeMessageId?: string;
}): CollaborationInboundHistoryEntry[] {
  const limit = Math.max(1, Math.min(40, params.limit ?? 24));
  const history: CollaborationInboundHistoryEntry[] = [];

  for (const raw of asMessageList(params.messages).toReversed()) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const message = raw as TranscriptMessage;
    if (message.id === params.excludeMessageId && params.excludeMessageId) {
      continue;
    }
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }
    const body = extractTranscriptText(message.content);
    if (!body || shouldSkipInjectedHistoryBody(body)) {
      continue;
    }
    history.unshift({
      sender: resolveTranscriptSender(message),
      body,
      timestamp: typeof message.timestamp === "number" ? message.timestamp : Date.now(),
    });
    if (history.length >= limit) {
      break;
    }
  }

  return history;
}

export function isIntroductionFollowUpMessage(message: string) {
  const normalized = message.replace(/\s+/g, "").trim();
  if (!normalized) {
    return false;
  }
  const hasIntroSignal = INTRODUCTION_TOPIC_SIGNALS.some((signal) => normalized.includes(signal));
  const hasRemainingSignal = REMAINING_MEMBERS_SIGNALS.some((signal) =>
    normalized.includes(signal),
  );
  return hasIntroSignal && (hasRemainingSignal || normalized.includes("也"));
}

export function resolveBotsAlreadyIntroducedInThread(params: {
  messages: unknown[];
  bots: CollaborationBotTarget[];
  userMessage: string;
}): Set<string> {
  const alreadySpoke = new Set<string>();
  if (!isIntroductionFollowUpMessage(params.userMessage)) {
    return alreadySpoke;
  }

  const botIdentities = new Map<string, string>();
  for (const bot of params.bots) {
    const agentId = normalizeAgentIdentifier(bot.agentId);
    if (!agentId) {
      continue;
    }
    botIdentities.set(agentId, agentId);
    const normalizedName = normalizeMentionIdentity(bot.name);
    if (normalizedName) {
      botIdentities.set(normalizedName, agentId);
    }
  }

  let collecting = true;
  for (const raw of [...params.messages].toReversed()) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const message = raw as TranscriptMessage;
    if (message.role === "user") {
      const body = extractTranscriptText(message.content);
      const normalized = body.replace(/\s+/g, "");
      if (
        INTRODUCTION_TOPIC_SIGNALS.some((signal) => normalized.includes(signal)) &&
        !isIntroductionFollowUpMessage(body)
      ) {
        break;
      }
      if (isIntroductionFollowUpMessage(body)) {
        continue;
      }
      collecting = false;
      continue;
    }
    if (!collecting || message.role !== "assistant") {
      continue;
    }
    const body = extractTranscriptText(message.content);
    if (!body || body.length < 12) {
      continue;
    }
    const normalizedSender = normalizeMentionIdentity(message.senderLabel);
    if (!normalizedSender) {
      continue;
    }
    const agentId = botIdentities.get(normalizedSender);
    if (agentId) {
      alreadySpoke.add(agentId);
    }
  }

  return alreadySpoke;
}
