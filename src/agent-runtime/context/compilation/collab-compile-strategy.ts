/**
 * Expert recommendation #3: collaboration-specific Context Compiler strategy.
 *
 * When enabled for a group chat session:
 * - Uses a modestly larger group-specific recent-unit window (not a global double)
 * - When compressing a unit, retains multiple members' key conclusions /
 *   disagreements instead of only the unit's final assistant reply
 *
 * Default OFF. Personal 1:1 and flag-off keep global lane budgets unchanged.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { OpenBotConfig } from "../../../config/config.js";
import { isCollaborationGroupChatSessionKey } from "../../../sessions/session-key-utils.js";
import type { ContextLane } from "../../contracts/context.js";
import { readVisibleMessageText } from "./shrink-unit.js";

/** Group-only recent-unit ceilings — modest lift vs global 10/12/12, not 2×. */
export const COLLAB_GROUP_MAX_RECENT_TURNS: Record<ContextLane, number> = {
  chat: 14,
  retrieve: 16,
  act: 18,
};

const MAX_MEMBER_CONCLUSIONS = 4;

const CONCLUSION_HINT_RE =
  /但是|不过|不同意|反对|分歧|冲突|建议|结论|我认为|我主张|风险|不可行|disagree|however|instead|conflict|propose|recommend/iu;

export function isCollaborationCollabCompileStrategyEnabled(cfg?: OpenBotConfig | null): boolean {
  if (cfg?.collaboration?.collabCompileStrategy === true) {
    return true;
  }
  const raw = process.env.OPENBOT_COLLAB_COMPILE_STRATEGY?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
    return true;
  }
  return false;
}

export function shouldApplyCollabCompileStrategy(params: {
  cfg?: OpenBotConfig | null;
  sessionKey?: string | null;
}): boolean {
  if (!isCollaborationCollabCompileStrategyEnabled(params.cfg)) {
    return false;
  }
  return isCollaborationGroupChatSessionKey(params.sessionKey);
}

export function resolveCollabGroupMaxRecentTurns(lane: ContextLane): number {
  return COLLAB_GROUP_MAX_RECENT_TURNS[lane] ?? COLLAB_GROUP_MAX_RECENT_TURNS.act;
}

function isAssistantMessage(message: AgentMessage): boolean {
  return (message as { role?: unknown }).role === "assistant";
}

function isUserMessage(message: AgentMessage): boolean {
  return (message as { role?: unknown }).role === "user";
}

function looksLikeMemberConclusion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  // Prefer disagreement / conclusion cues even for short Chinese replies.
  if (CONCLUSION_HINT_RE.test(trimmed)) {
    return true;
  }
  // Substantial member reply without only-ack fluff (CJK-friendly threshold).
  return trimmed.length >= 20;
}

function projectAssistantTextOnly(message: AgentMessage): AgentMessage {
  const timestamp = (message as { timestamp?: unknown }).timestamp;
  const text = readVisibleMessageText(message).trim();
  return {
    role: "assistant",
    content: text,
    ...(typeof timestamp === "number" ? { timestamp } : {}),
  } as unknown as AgentMessage;
}

/**
 * Keep user messages plus up to MAX_MEMBER_CONCLUSIONS assistant texts that
 * look like conclusions / disagreements, always including the final reply.
 */
export function projectUnitMessagesRetainMemberConclusions(
  messages: AgentMessage[],
): AgentMessage[] {
  const users = messages.filter((message) => isUserMessage(message));
  const assistants = messages.filter((message) => {
    if (!isAssistantMessage(message)) {
      return false;
    }
    return Boolean(readVisibleMessageText(message).trim());
  });
  if (assistants.length === 0) {
    return [...users];
  }
  if (assistants.length === 1) {
    return [...users, projectAssistantTextOnly(assistants[0])];
  }

  const finalAssistant = assistants[assistants.length - 1];
  const earlier = assistants.slice(0, -1);
  const keptEarlier: AgentMessage[] = [];
  for (const message of earlier) {
    const text = readVisibleMessageText(message).trim();
    if (!looksLikeMemberConclusion(text)) {
      continue;
    }
    keptEarlier.push(projectAssistantTextOnly(message));
    if (keptEarlier.length >= MAX_MEMBER_CONCLUSIONS - 1) {
      break;
    }
  }
  // Always retain at least one earlier member voice when multi-assistant.
  if (keptEarlier.length === 0 && earlier.length > 0) {
    const fallback = earlier[earlier.length - 1];
    keptEarlier.push(projectAssistantTextOnly(fallback));
  }
  return [...users, ...keptEarlier, projectAssistantTextOnly(finalAssistant)];
}

export type CollabCompileStrategyOptions = {
  enabled: boolean;
  maxRecentTurns?: number;
  retainMemberConclusions: boolean;
};
