import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import { normalizeAgentIdentifier } from "./mention-utils.js";
import type { RuntimeFacts } from "./runtime-authority.js";
import { scoreGroupDiscussionBot } from "./tier1a-duty-engine.js";
import { scoreRelevanceBot } from "./tier1b-relevance-engine.js";
import type { CollaborationBotTarget } from "./types.js";

export const PRIMARY_MATCHER_CONFIDENCE_FLOOR = 0.4;

export type PrimaryNominationReason = "matcher" | "duty_rank";

export type PrimaryNomination = {
  bot: CollaborationBotTarget;
  confidence: number;
  reason: PrimaryNominationReason;
};

function excludeIneligibleBots(bots: CollaborationBotTarget[]) {
  return bots.filter((bot) => {
    const agentId = normalizeAgentIdentifier(bot.agentId);
    return Boolean(agentId) && !isBuiltinStewardAgent(agentId);
  });
}

function clampConfidence(score: number) {
  return Math.max(0, Math.min(1, score / 100));
}

function compactText(value: string | null | undefined) {
  return value?.replace(/\s+/g, "").toLowerCase() ?? "";
}

function lexicalOverlapBonus(message: string, bot: CollaborationBotTarget, facts: RuntimeFacts) {
  const hay = compactText(message);
  if (hay.length < 2) {
    return 0;
  }
  let bonus = 0;
  const name = compactText(bot.name);
  if (name.length >= 2 && (hay.includes(name) || name.includes(hay))) {
    bonus += 30;
  } else if (name.length >= 2) {
    for (let index = 0; index <= name.length - 2; index += 1) {
      if (hay.includes(name.slice(index, index + 2))) {
        bonus += 16;
        break;
      }
    }
  }
  const mission = compactText(facts.activeContext.currentMission ?? facts.activeContext.summary);
  if (mission.length >= 4 && hay.includes(mission.slice(0, Math.min(mission.length, 8)))) {
    bonus += 12;
  }
  return bonus;
}

/**
 * Nominate one unmentioned primary speaker. Never writes coordinatorBotId.
 * Builtin steward is excluded from the candidate set.
 */
export function nominatePrimarySpeaker(params: {
  facts: RuntimeFacts;
  message: string;
  bots: CollaborationBotTarget[];
}): PrimaryNomination | null {
  const candidates = excludeIneligibleBots(params.bots);
  if (candidates.length === 0) {
    return null;
  }

  let best: PrimaryNomination | null = null;
  for (const bot of candidates) {
    const duty = scoreGroupDiscussionBot({ facts: params.facts, bot });
    const relevance = scoreRelevanceBot({
      facts: params.facts,
      bot,
      message: params.message,
    });
    const raw =
      duty * 0.55 + relevance * 0.25 + lexicalOverlapBonus(params.message, bot, params.facts);
    const confidence = clampConfidence(raw);
    if (!best || raw > best.confidence * 100) {
      best = {
        bot,
        confidence,
        reason: relevance >= 40 ? "matcher" : "duty_rank",
      };
    }
  }

  if (!best || best.confidence < PRIMARY_MATCHER_CONFIDENCE_FLOOR) {
    return null;
  }
  return best;
}
