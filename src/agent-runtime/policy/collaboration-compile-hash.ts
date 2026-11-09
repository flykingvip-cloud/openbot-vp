import { createHash } from "node:crypto";
import type { EffectiveCollaborationPolicy } from "./collaboration-policy-model.js";

/**
 * Content identity for EffectivePolicy.
 * Provenance / clamps are excluded (hashed separately as provenanceHash).
 * P1-A1: includes context + presentation segments once they join EffectivePolicy.
 */
export function hashEffectiveCollaborationPolicy(policy: EffectiveCollaborationPolicy): string {
  const stable = {
    protocolVersion: policy.protocolVersion,
    invariants: policy.invariants,
    strategy: policy.strategy,
    participation: policy.participation,
    dispatch: policy.dispatch,
    governance: policy.governance,
    context: policy.context,
    presentation: policy.presentation,
    guidance: policy.guidance,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

/** Legacy content slice used to prove P1-A1 does not change pre-existing fields. */
export function legacyEffectivePolicySlice(policy: EffectiveCollaborationPolicy) {
  return {
    protocolVersion: policy.protocolVersion,
    invariants: policy.invariants,
    strategy: policy.strategy,
    participation: {
      openDiscussionWithoutMention: policy.participation.openDiscussionWithoutMention,
      maxVisibleBotRepliesPerRound: policy.participation.maxVisibleBotRepliesPerRound,
      mentionBotMustRespond: policy.participation.mentionBotMustRespond,
      mentionMustDispatch: policy.participation.mentionMustDispatch,
      mentionMaySilentIfNoIncrement: policy.participation.mentionMaySilentIfNoIncrement,
      lowSignalStrategy: policy.participation.lowSignalStrategy,
      humanStartsNewRound: policy.participation.humanStartsNewRound,
    },
    dispatch: {
      primaryThenSupplement: policy.dispatch.primaryThenSupplement,
      allowEvidenceCollection: policy.dispatch.allowEvidenceCollection,
      coordinatorWrap: policy.dispatch.coordinatorWrap,
      supplementEnabled: policy.dispatch.supplementEnabled,
      maxSupplementBots: policy.dispatch.maxSupplementBots,
      allowSecondaryTakeover: policy.dispatch.allowSecondaryTakeover,
    },
    governance: {
      decisionMode: policy.governance.decisionMode,
      allowAgentPublishProposal: policy.governance.allowAgentPublishProposal,
      observer: policy.governance.observer,
      entersWaitingForHumanAfterVisibleTurnsExhausted:
        policy.governance.entersWaitingForHumanAfterVisibleTurnsExhausted,
      botMaySelfAdvanceWithoutHuman: policy.governance.botMaySelfAdvanceWithoutHuman,
    },
    guidance: policy.guidance,
    provenance: {
      collaborationMode: policy.provenance.collaborationMode,
      openDiscussionWithoutMention: policy.provenance.openDiscussionWithoutMention,
      allowSupplementAfterPrimary: policy.provenance.allowSupplementAfterPrimary,
      maxVisibleBotRepliesPerRound: policy.provenance.maxVisibleBotRepliesPerRound,
      mentionBotMustRespond: policy.provenance.mentionBotMustRespond,
      lowSignalStrategy: policy.provenance.lowSignalStrategy,
      coordinatorWrap: policy.provenance.coordinatorWrap,
      decisionMode: policy.provenance.decisionMode,
      allowAgentPublishProposal: policy.provenance.allowAgentPublishProposal,
      allowSecondaryTakeover: policy.provenance.allowSecondaryTakeover,
    },
    // Full clamps array — P1-A1 segment constraints must not appear here.
    clamps: policy.clamps,
  };
}

export function hashLegacyEffectivePolicySlice(policy: EffectiveCollaborationPolicy): string {
  return createHash("sha256")
    .update(JSON.stringify(legacyEffectivePolicySlice(policy)))
    .digest("hex");
}
