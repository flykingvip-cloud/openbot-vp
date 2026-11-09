import type { CollaborationEventKey } from "./collaboration-event-key.js";
import type { EffectiveCollaborationPolicy, PolicyDecisionRecord } from "./effective-policy.js";
import { hashEffectiveCollaborationPolicy } from "./policy-compiler-hash.js";
import type { RuntimeFacts } from "./runtime-authority.js";
import { resolveBotDiscussionRole } from "./tier1a-duty-engine.js";
import type { ParticipationDecision } from "./types.js";

function mapParticipantTier(params: {
  contributionRole: string;
  planTier: string;
  collaborationRole: string | null;
}): PolicyDecisionRecord["participants"][number]["tier"] {
  if (params.planTier === "wrap" || params.contributionRole === "wrap") {
    return "wrap";
  }
  if (params.collaborationRole === "coordinator") {
    return "coordinator";
  }
  if (params.collaborationRole === "reviewer" || params.contributionRole === "challenge") {
    return "reviewer";
  }
  if (params.planTier === "mention" || params.contributionRole === "lead") {
    return "primary";
  }
  return "contributor";
}

export function buildPolicyDecisionRecord(params: {
  decision: ParticipationDecision;
  effective: EffectiveCollaborationPolicy;
  facts?: RuntimeFacts;
  /** P0.0b: CollaborationEventKey stamped when policySnapshot flag is on. */
  key?: CollaborationEventKey;
}): PolicyDecisionRecord {
  const botsById = new Map(
    [...params.decision.tier0, ...params.decision.tier1, ...params.decision.tier2].map((bot) => [
      bot.agentId,
      bot,
    ]),
  );
  return {
    roundId: params.decision.roundId,
    ...(params.decision.visibleReplyBudget
      ? { visibleReplyBudget: { ...params.decision.visibleReplyBudget } }
      : {}),
    protocolVersion: params.effective.protocolVersion,
    effectivePolicyHash: hashEffectiveCollaborationPolicy(params.effective),
    mode: params.effective.strategy.id,
    policyConstraints: params.effective.clamps,
    ...(params.key ? { key: params.key } : {}),
    participants: params.decision.roundPlan.participants.map((participant) => {
      const bot = botsById.get(participant.agentId);
      const collaborationRole =
        params.facts && bot ? resolveBotDiscussionRole({ facts: params.facts, bot }) : null;
      return {
        agentId: participant.agentId,
        tier: mapParticipantTier({
          contributionRole: participant.contributionRole,
          planTier: participant.tier,
          collaborationRole,
        }),
        reason: participant.reasonText,
      };
    }),
  };
}
