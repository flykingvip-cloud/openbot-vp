/**
 * Floor Runtime v2.1 §2.7 / §5.8 P2-A — L0 eligibility.
 * Synchronous and pure. Does not read config, ledger, or the network.
 * @-mentions are must-admit (except observers). Observers never enter.
 * Blocked agents stay out of un-@ fan-out; an explicit @ still admits them.
 * Roll-call / broadcast is L0-only (no L1 bidding).
 */
import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import { classifyEpisodeIntent, type CollaborationIntentKind } from "./episode-intent.js";
import { resolveMentionResolution, type ExplicitMentionRef } from "./mention-resolution.js";
import { hasBroadcastMention, normalizeAgentIdentifier } from "./mention-utils.js";
import type { RuntimeAuthority, RuntimeFacts } from "./runtime-authority.js";
import type { CollaborationBotTarget } from "./types.js";

export const L0_REASONS = [
  "mention",
  "roll_call",
  "broadcast",
  "task_owner",
  "handoff_receiver",
] as const;

export type L0Reason = (typeof L0_REASONS)[number];

export const L0_EXCLUDE_REASONS = ["observer", "blocked", "steward"] as const;

export type L0ExcludeReason = (typeof L0_EXCLUDE_REASONS)[number];

export type FloorRouterInput = {
  message: string;
  explicitMentions?: readonly string[];
  explicitMentionRefs?: readonly ExplicitMentionRef[];
  taskOwnerAgentId?: string | null;
  handoffReceiverAgentIds?: readonly string[];
};

export type L0Member = {
  agentId: string;
  reason: L0Reason;
};

export type L0Exclusion = {
  agentId: string;
  reason: L0ExcludeReason;
};

export type L0Route = {
  intent: CollaborationIntentKind;
  rollCall: boolean;
  mustAdmit: L0Member[];
  /** Eligible agents L1 may rank. Empty on roll-call (L0 owns the roster). */
  pool: string[];
  excluded: L0Exclusion[];
};

function sameAgent(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = normalizeAgentIdentifier(left);
  const b = normalizeAgentIdentifier(right);
  return Boolean(a && b && a === b);
}

function isObserver(facts: RuntimeFacts, bot: CollaborationBotTarget): boolean {
  const agentId = normalizeAgentIdentifier(bot.agentId);
  if (!agentId) {
    return false;
  }
  return facts.memberRoleMap.some((entry) => {
    if (entry.memberKind !== "bot" || entry.governanceRole !== "observer") {
      return false;
    }
    const memberId = normalizeAgentIdentifier(entry.memberId) ?? entry.memberId;
    return (
      sameAgent(memberId, agentId) ||
      memberId === `bot:${agentId}` ||
      memberId.endsWith(`:${agentId}`) ||
      entry.label === bot.agentId ||
      entry.label === bot.name
    );
  });
}

function isBlocked(facts: RuntimeFacts, bot: CollaborationBotTarget): boolean {
  return (facts.busyAgentIds ?? []).some((id) => sameAgent(id, bot.agentId));
}

function botsOf(facts: RuntimeFacts): CollaborationBotTarget[] {
  return facts.bots.map((bot) => ({
    agentId: bot.agentId,
    name: bot.name,
    sessionKey: bot.sessionKey,
    updatedAt: bot.updatedAt,
  }));
}

function pushUnique(list: L0Member[], seen: Set<string>, member: L0Member): void {
  const id = member.agentId.trim();
  if (!id || seen.has(id)) {
    return;
  }
  seen.add(id);
  list.push({ agentId: id, reason: member.reason });
}

export function routeL0(
  _authority: RuntimeAuthority,
  facts: RuntimeFacts,
  input: FloorRouterInput,
): L0Route {
  const bots = botsOf(facts);
  const resolution = resolveMentionResolution({
    message: input.message,
    ...(input.explicitMentions ? { explicitMentions: [...input.explicitMentions] } : {}),
    ...(input.explicitMentionRefs ? { explicitMentionRefs: [...input.explicitMentionRefs] } : {}),
    bots,
    humans: facts.humans.map((human) => ({
      userId: human.userId,
      ...(human.name ? { name: human.name } : {}),
      ...(human.handle ? { handle: human.handle } : {}),
      ...(human.email ? { email: human.email } : {}),
    })),
  });
  const mentionAll = hasBroadcastMention(resolution.tokens) || resolution.mode === "broadcast";
  const mentioned = new Set(
    resolution.matchedBots.filter((bot) => !isObserver(facts, bot)).map((bot) => bot.agentId),
  );
  const intent = classifyEpisodeIntent({
    message: input.message,
    mentionMode: resolution.mode,
    mentionedAgentIds: [...mentioned],
    mentionAll,
    ...(input.taskOwnerAgentId ? { taskOwnerAgentId: input.taskOwnerAgentId } : {}),
  });
  const rollCall = intent === "roll_call";
  const mustAdmit: L0Member[] = [];
  const seen = new Set<string>();
  const excluded: L0Exclusion[] = [];

  for (const bot of resolution.matchedBots) {
    if (!bot.agentId.trim() || isObserver(facts, bot)) {
      continue;
    }
    pushUnique(mustAdmit, seen, { agentId: bot.agentId, reason: "mention" });
  }

  const eligible: CollaborationBotTarget[] = [];
  for (const bot of bots) {
    const agentId = bot.agentId.trim();
    if (!agentId) {
      continue;
    }
    if (isObserver(facts, bot)) {
      excluded.push({ agentId, reason: "observer" });
      continue;
    }
    const mentionedBot = mentioned.has(agentId);
    if (!mentionedBot && isBuiltinStewardAgent(agentId)) {
      excluded.push({ agentId, reason: "steward" });
      continue;
    }
    if (!mentionedBot && isBlocked(facts, bot)) {
      excluded.push({ agentId, reason: "blocked" });
      continue;
    }
    eligible.push(bot);
  }

  if (rollCall) {
    const reason: L0Reason = mentionAll ? "broadcast" : "roll_call";
    for (const bot of eligible) {
      pushUnique(mustAdmit, seen, { agentId: bot.agentId, reason });
    }
  } else if (intent === "task") {
    const wanted = [input.taskOwnerAgentId, ...(input.handoffReceiverAgentIds ?? [])];
    for (const raw of wanted) {
      const bot = eligible.find((candidate) => sameAgent(candidate.agentId, raw));
      if (!bot) {
        continue;
      }
      const reason: L0Reason = sameAgent(bot.agentId, input.taskOwnerAgentId)
        ? "task_owner"
        : "handoff_receiver";
      pushUnique(mustAdmit, seen, { agentId: bot.agentId, reason });
    }
  }

  const pool = rollCall
    ? []
    : eligible.filter((bot) => !seen.has(bot.agentId)).map((bot) => bot.agentId);

  return { intent, rollCall, mustAdmit, pool, excluded };
}
