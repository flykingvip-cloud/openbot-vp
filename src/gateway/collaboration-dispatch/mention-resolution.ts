import {
  buildMentionConfirm,
  closestBotCandidates,
  findSpokenExactBots,
  findSpokenTypoConfirm,
  isOpaqueMentionToken,
} from "./mention-confirm.js";
import {
  collectMentionTokens,
  isBroadcastMentionToken,
  normalizeAgentIdentifier,
  normalizeMentionIdentity,
} from "./mention-utils.js";
import type { MentionMode, PrimaryMode } from "./round-state.js";
import type { CollaborationBotTarget, MentionConfirm } from "./types.js";

export type MentionHuman = {
  userId?: string | null;
  name?: string | null;
  email?: string | null;
  handle?: string | null;
};

/** Structured @ chip. Identity is agentId / userId, never mention_id. */
export type ExplicitMentionRef = {
  mentionId?: string | null;
  agentId?: string | null;
  userId?: string | null;
  displayName?: string | null;
  targetKind?: string | null;
  targetId?: string | null;
};

export type MentionResolution = {
  tokens: string[];
  matchedAgentIds: string[];
  matchedBots: CollaborationBotTarget[];
  unmatchedTokens: string[];
  mode: MentionMode;
  primaryMode: PrimaryMode;
  unmatched: boolean;
  /** Near-miss name. Ask once; do not treat as MENTION_UNMATCHED. */
  confirm: MentionConfirm | null;
};

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

function humanIdentityValues(human: MentionHuman) {
  return [human.userId, human.name, human.email, human.handle]
    .map((value) => normalizeMentionIdentity(value))
    .filter((value): value is string => Boolean(value));
}

function humanMatchesToken(human: MentionHuman, token: string) {
  return humanIdentityValues(human).some((value) => value === token || token.startsWith(value));
}

function knownIdentities(bots: CollaborationBotTarget[], humans: MentionHuman[]) {
  const known = new Set<string>();
  for (const bot of bots) {
    for (const value of [bot.agentId, bot.name]) {
      const identity = normalizeMentionIdentity(value);
      if (identity) {
        known.add(identity);
      }
    }
  }
  for (const human of humans) {
    for (const identity of humanIdentityValues(human)) {
      known.add(identity);
    }
  }
  return known;
}

function findBotByAgentId(bots: CollaborationBotTarget[], agentId: string | null) {
  if (!agentId) {
    return null;
  }
  return (
    bots.find(
      (bot) => normalizeAgentIdentifier(bot.agentId) === normalizeAgentIdentifier(agentId),
    ) ?? null
  );
}

function findBotByExactIdentity(bots: CollaborationBotTarget[], token: string | null) {
  if (!token) {
    return null;
  }
  return (
    bots.find((bot) =>
      [bot.agentId, bot.name].some((value) => normalizeMentionIdentity(value) === token),
    ) ?? null
  );
}

function emptyResolution(tokens: string[]): MentionResolution {
  return {
    tokens,
    matchedAgentIds: [],
    matchedBots: [],
    unmatchedTokens: [],
    mode: "none",
    primaryMode: "single",
    unmatched: false,
    confirm: null,
  };
}

export function resolveMentionResolution(params: {
  message: string;
  explicitMentions?: string[];
  explicitMentionRefs?: ExplicitMentionRef[];
  bots: CollaborationBotTarget[];
  humans?: MentionHuman[];
}): MentionResolution {
  const humans = params.humans ?? [];
  const textTokens = [...collectMentionTokens(params.message, [])];
  const explicitTokens = [...collectMentionTokens("", params.explicitMentions ?? [])];
  const tokens = [...new Set([...textTokens, ...explicitTokens])];
  const known = knownIdentities(params.bots, humans);
  const matchedBots: CollaborationBotTarget[] = [];
  const matchedAgentIds: string[] = [];
  const unmatchedTokens: string[] = [];
  const seen = new Set<string>();
  const consumed = new Set<string>();
  let preciseUnmatched = false;

  const addBot = (bot: CollaborationBotTarget) => {
    const agentId = normalizeAgentIdentifier(bot.agentId);
    if (!agentId || seen.has(agentId)) {
      return;
    }
    seen.add(agentId);
    matchedAgentIds.push(agentId);
    matchedBots.push(bot);
  };

  const consumeIdentity = (value: string | null | undefined) => {
    const identity = normalizeMentionIdentity(value);
    if (identity) {
      consumed.add(identity);
    }
  };

  for (const ref of params.explicitMentionRefs ?? []) {
    const display = normalizeMentionIdentity(ref.displayName);
    const targetKind = ref.targetKind ?? null;
    const targetAgentId = targetKind === "agent" ? normalizeAgentIdentifier(ref.targetId) : null;
    const targetUserId = targetKind === "human" ? normalizeMentionIdentity(ref.targetId) : null;
    const agentId = normalizeAgentIdentifier(ref.agentId) || targetAgentId;
    const userId = normalizeMentionIdentity(ref.userId) || targetUserId;
    if (
      targetKind === "all" ||
      isBroadcastMentionToken(display) ||
      isBroadcastMentionToken(ref.agentId) ||
      isBroadcastMentionToken(ref.targetId)
    ) {
      consumeIdentity(display);
      consumeIdentity(ref.agentId);
      consumeIdentity(ref.targetId);
      continue;
    }
    const botById = findBotByAgentId(params.bots, agentId);
    if (botById) {
      addBot(botById);
      consumeIdentity(display);
      consumeIdentity(agentId);
      consumeIdentity(ref.mentionId);
      continue;
    }
    const humanById = userId
      ? humans.some((human) => humanIdentityValues(human).includes(userId))
      : false;
    if (humanById) {
      consumeIdentity(display);
      consumeIdentity(userId);
      consumeIdentity(ref.mentionId);
      continue;
    }
    const botByName = findBotByExactIdentity(params.bots, display);
    if (botByName) {
      addBot(botByName);
      consumeIdentity(display);
      consumeIdentity(ref.mentionId);
      continue;
    }
    const humanByName = display
      ? humans.some((human) => humanIdentityValues(human).includes(display))
      : false;
    if (humanByName) {
      consumeIdentity(display);
      consumeIdentity(ref.mentionId);
      continue;
    }
    const concreteId = agentId || userId;
    if (concreteId && !isOpaqueMentionToken(concreteId, known)) {
      preciseUnmatched = true;
      consumeIdentity(display);
      consumeIdentity(concreteId);
    }
  }

  let confirm: MentionConfirm | null = null;
  for (const token of tokens) {
    if (consumed.has(token) || isBroadcastMentionToken(token)) {
      continue;
    }
    if (isOpaqueMentionToken(token, known)) {
      consumed.add(token);
      continue;
    }
    let bestBot: CollaborationBotTarget | null = null;
    let bestLength = 0;
    for (const bot of params.bots) {
      const matchLength = botMentionIdentityLength(bot, token);
      if (matchLength > bestLength) {
        bestLength = matchLength;
        bestBot = bot;
      }
    }
    const exact = bestBot
      ? [bestBot.agentId, bestBot.name].some((value) => normalizeMentionIdentity(value) === token)
      : false;
    const closerTypo =
      bestBot && !exact
        ? closestBotCandidates(token, params.bots).some((bot) => {
            const name = normalizeMentionIdentity(bot.name) ?? "";
            return (
              name.length > bestLength &&
              normalizeAgentIdentifier(bot.agentId) !== normalizeAgentIdentifier(bestBot?.agentId)
            );
          })
        : false;
    const agentId = bestBot && !closerTypo ? normalizeAgentIdentifier(bestBot.agentId) : null;
    if (agentId && bestBot && !seen.has(agentId)) {
      seen.add(agentId);
      matchedAgentIds.push(agentId);
      matchedBots.push(bestBot);
      continue;
    }
    if (agentId && seen.has(agentId)) {
      continue;
    }
    if (humans.some((human) => humanMatchesToken(human, token))) {
      continue;
    }
    const closest = closestBotCandidates(token, params.bots);
    if (closest.length > 0) {
      confirm ??= buildMentionConfirm({
        token,
        candidates: closest.map((bot) => ({ agentId: bot.agentId, name: bot.name })),
      });
      continue;
    }
    unmatchedTokens.push(token);
  }

  const hardUnmatched = preciseUnmatched || unmatchedTokens.length > 0;
  if (hardUnmatched) {
    return {
      tokens,
      matchedAgentIds,
      matchedBots,
      unmatchedTokens,
      mode: "none",
      primaryMode: "single",
      unmatched: true,
      confirm: null,
    };
  }

  if (confirm) {
    return {
      tokens,
      matchedAgentIds: [],
      matchedBots: [],
      unmatchedTokens: [],
      mode: "none",
      primaryMode: "single",
      unmatched: false,
      confirm,
    };
  }

  for (const bot of findSpokenExactBots(params.message, params.bots)) {
    addBot(bot);
  }
  const meaningfulExplicit = explicitTokens.filter(
    (token) => !isBroadcastMentionToken(token) && !isOpaqueMentionToken(token, known),
  );
  if (matchedBots.length === 0 && textTokens.length === 0 && meaningfulExplicit.length === 0) {
    const spokenTypo = findSpokenTypoConfirm(params.message, params.bots);
    if (spokenTypo) {
      return {
        tokens,
        matchedAgentIds: [],
        matchedBots: [],
        unmatchedTokens: [],
        mode: "none",
        primaryMode: "single",
        unmatched: false,
        confirm: spokenTypo,
      };
    }
  }

  if (tokens.length === 0 && matchedBots.length === 0) {
    return emptyResolution(tokens);
  }

  const mode: MentionMode =
    matchedBots.length >= 2
      ? "explicit_multi"
      : matchedBots.length === 1
        ? "single_primary"
        : "none";
  const primaryMode: PrimaryMode = mode === "explicit_multi" ? "explicit_multi" : "single";
  return {
    tokens,
    matchedAgentIds,
    matchedBots,
    unmatchedTokens,
    mode,
    primaryMode,
    unmatched: false,
    confirm: null,
  };
}
