import type { FloorRouterInput, L0Route } from "./router-l0.js";
/**
 * Floor Runtime v2.1 §2.7 / §5.8 P2-A — cheap L1 rank.
 * Synchronous and pure. Lexical + duty scores only (no embedding, no model).
 * Roll-call returns an empty rank: those agents are already L0 must-admit.
 * Scores inside the ambiguity band are marked ambiguous and are not admitted
 * until a later Shadow-B bid. This module does not call a model.
 */
import type { RuntimeAuthority, RuntimeFacts } from "./runtime-authority.js";
import { scoreGroupDiscussionBot } from "./tier1a-duty-engine.js";
import { scoreRelevanceBot } from "./tier1b-relevance-engine.js";
import type { CollaborationBotTarget } from "./types.js";

export type L1Band = "clear" | "ambiguous" | "below";

export type L1Candidate = {
  agentId: string;
  capabilityFit: number;
  band: L1Band;
};

export type L1Route = {
  clear: L1Candidate[];
  ambiguous: L1Candidate[];
  below: L1Candidate[];
};

const FIT_SCALE = 160;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function roundFit(value: number): number {
  return Math.round(clamp01(value) * 10_000) / 10_000;
}

function byFitDesc(left: L1Candidate, right: L1Candidate): number {
  if (right.capabilityFit !== left.capabilityFit) {
    return right.capabilityFit - left.capabilityFit;
  }
  return left.agentId < right.agentId ? -1 : left.agentId > right.agentId ? 1 : 0;
}

function botById(facts: RuntimeFacts, agentId: string): CollaborationBotTarget | undefined {
  return facts.bots.find((bot) => bot.agentId === agentId);
}

export function routeL1(
  authority: RuntimeAuthority,
  facts: RuntimeFacts,
  l0: L0Route,
  input: FloorRouterInput,
): L1Route {
  if (l0.rollCall || l0.pool.length === 0) {
    return { clear: [], ambiguous: [], below: [] };
  }
  const tuning = authority.policy.effective.dispatch.tuning;
  const [bandLow, bandHigh] = tuning.floor.router.l1AmbiguityBand;
  const topK = Math.max(0, tuning.floor.router.l1TopK);
  const dutyWeight = tuning.tier1Merge.dutyWeight;
  const relevanceWeight = tuning.tier1Merge.relevanceWeight;
  const ranked: L1Candidate[] = [];
  for (const agentId of l0.pool) {
    const bot = botById(facts, agentId);
    if (!bot) {
      continue;
    }
    const duty = scoreGroupDiscussionBot({ facts, bot });
    const relevance = scoreRelevanceBot({ facts, bot, message: input.message });
    const capabilityFit = roundFit((duty * dutyWeight + relevance * relevanceWeight) / FIT_SCALE);
    const band: L1Band =
      capabilityFit > bandHigh ? "clear" : capabilityFit >= bandLow ? "ambiguous" : "below";
    ranked.push({ agentId, capabilityFit, band });
  }
  ranked.sort(byFitDesc);
  const clear = ranked.filter((candidate) => candidate.band === "clear").slice(0, topK);
  const ambiguous = ranked.filter((candidate) => candidate.band === "ambiguous").slice(0, topK);
  const below = ranked.filter((candidate) => candidate.band === "below");
  return { clear, ambiguous, below };
}
