/**
 * Floor Runtime v2.1 §6.1 P1-C — Need(e).
 *
 * Priority:
 *   1. @mentioned members (source mention)
 *   2. roll-call: eligible members who have not answered (source roll_call)
 *   3. task intent: owner + handoff receivers (source task)
 *   4. other intents: weekly human labels when present (source labeled)
 *   5. otherwise Need = ∅ and the episode is excluded from Coverage (source none)
 */
import type { CollaborationIntentKind } from "./episode-intent.js";

export const EPISODE_DECISION_NEED_SOURCES = [
  "mention",
  "roll_call",
  "task",
  "labeled",
  "none",
] as const;

export type EpisodeDecisionNeedSource = (typeof EPISODE_DECISION_NEED_SOURCES)[number];

export type EpisodeNeed = Readonly<{
  agentIds: string[];
  source: EpisodeDecisionNeedSource;
}>;

export type NeedResolverInput = {
  intent: CollaborationIntentKind;
  /** Members explicitly @-mentioned. Empty means rule 1 does not apply. */
  mentionedAgentIds?: readonly string[];
  /** Roll-call eligible roster. Unanswered = eligible − answered. */
  eligibleAgentIds?: readonly string[];
  answeredAgentIds?: readonly string[];
  taskOwnerAgentId?: string | null;
  handoffReceiverAgentIds?: readonly string[];
  /**
   * Human label sample for this episode.
   * `undefined` = no label. An array (including empty) is a label.
   */
  labeledAgentIds?: readonly string[] | null;
};

function uniqueIds(values: readonly (string | null | undefined)[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values ?? []) {
    const id = value?.trim() ?? "";
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}

export function resolveEpisodeNeed(input: NeedResolverInput): EpisodeNeed {
  const mentioned = uniqueIds(input.mentionedAgentIds);
  if (mentioned.length > 0) {
    return { agentIds: mentioned, source: "mention" };
  }
  if (input.intent === "roll_call") {
    const answered = new Set(uniqueIds(input.answeredAgentIds));
    const unanswered = uniqueIds(input.eligibleAgentIds).filter((id) => !answered.has(id));
    return { agentIds: unanswered, source: "roll_call" };
  }
  if (input.intent === "task") {
    return {
      agentIds: uniqueIds([input.taskOwnerAgentId, ...(input.handoffReceiverAgentIds ?? [])]),
      source: "task",
    };
  }
  if (Array.isArray(input.labeledAgentIds)) {
    return { agentIds: uniqueIds(input.labeledAgentIds), source: "labeled" };
  }
  return { agentIds: [], source: "none" };
}
