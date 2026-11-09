import type {
  ActorCapability,
  DecisionMode,
  DeepProvenance,
  DispatchTuning,
  EffectiveContextPolicy,
  EffectivePolicyValue,
  FloorOpenness,
  FloorProtocol,
  GovernanceRole,
  GovernanceTaskPolicy,
  GroupPolicyInput,
  LowSignalStrategy,
  ModeTemplate,
  PolicyValueSource,
} from "./collaboration-policy-model.js";
import { OBSERVER_PERMISSIONS, SYSTEM_INVARIANTS } from "./collaboration-rules.js";
import { clampMaxBeatsPerEpisode, MULTI_BEAT_DEFAULT_MAX } from "./collaboration-rules.js";
/**
 * P1-A1 — EffectivePolicy capability segments (Floor Runtime v2.1 §2.6 / §5.5).
 *
 * Compiles participation / dispatch / governance / context / presentation.
 * No runtime consumers yet; old field values must stay byte-identical.
 */

export const L1_FLOOR_TUNING_DEFAULTS = {
  router: {
    l1TopK: 5,
    l1AmbiguityBand: [0.15, 0.35] as const,
    recentShareWindow: 8,
  },
  bid: {
    deadlineMs: 3_000,
    maxBidders: 5,
    selfAssessmentWeight: 0.2,
  },
  admission: {
    modelCalls: SYSTEM_INVARIANTS.maxVisibleRepliesCeiling,
    tokens: 24_000,
    noveltyFloor: 0.35,
    duplicateSimilarityMax: 0.85,
    noveltyDecay: 0.1,
    cooldownBeats: 1,
    loopGuardDepth: 1 as const,
  },
  beats: { maxBeatsPerEpisode: 1 },
} as const;

export const L1_TIER1_MERGE_DEFAULTS = {
  dutyFloor: 25,
  proactiveReplyThreshold: 40,
  dutyWeight: 0.7,
  relevanceWeight: 0.3,
} as const;

export const L1_CHEAP_GATE_DEFAULTS = {
  clearlyIrrelevant: 18,
  clearlyRelevant: 40,
} as const;

export const L1_KEYWORD_CAPS_DEFAULTS = {
  chitchat: 1,
  simpleKnowledge: 2,
  numberedDecision: 2,
  lowSignal: 1,
} as const;

export const L1_TIMEOUT_DEFAULTS = {
  placeholderMs: 5_000,
  byTaskType: {
    chitchat: 8_000,
    chat: 8_000,
    knowledge: 15_000,
    analysis: 30_000,
    research: 60_000,
    data: 60_000,
    decision: 30_000,
    execution: 120_000,
    unknown: 30_000,
  },
} as const;

export const L1_CONTEXT_DEFAULTS = {
  crossSourceRetrieval: true,
  confidentialityCeiling: "internal" as const,
  defaultMode: "auto" as const,
  allowMemberOverride: true,
  mandatoryGroupContext: true,
  allowedSourceTypes: ["conversation", "group", "knowledge", "folder", "file", "api"] as const,
  budget: { maxTokens: 24_000, maxFiles: 20 },
  enforceConfidentiality: true,
} as const;

/** L1-hard: bot roles never receive L3 task capabilities (§2.9). */
export const L1_GOVERNANCE_CAPABILITIES: Readonly<
  Record<GovernanceRole, readonly ActorCapability[]>
> = {
  owner: [
    "discussion.control",
    "governance.converge",
    "governance.request_evidence",
    "governance.request_human",
    "governance.restrict_member",
    "task.assign",
    "task.owner_transfer",
  ],
  admin: [
    "discussion.control",
    "governance.converge",
    "governance.request_evidence",
    "governance.request_human",
    "governance.restrict_member",
    "task.assign",
    "task.owner_transfer",
  ],
  coordinator: [
    "discussion.control",
    "governance.converge",
    "governance.request_evidence",
    "governance.request_human",
    "governance.restrict_member",
  ],
  reviewer: ["discussion.control"],
  final_decider: ["discussion.control"],
  member_bot: [],
  member_human: ["discussion.control"],
  observer: [],
};

export type ParticipationSegment = {
  openDiscussionWithoutMention: boolean;
  maxVisibleBotRepliesPerRound: number;
  mentionBotMustRespond: boolean;
  mentionMustDispatch: true;
  mentionMaySilentIfNoIncrement: boolean;
  lowSignalStrategy: LowSignalStrategy;
  humanStartsNewRound: boolean;
  floorOpenness: FloorOpenness;
  rollCall: { enabled: true; ceiling: number };
  proactiveBots: boolean;
  emergencyFanoutFuse: 12;
};

export type DispatchSegment = {
  primaryThenSupplement: true;
  allowEvidenceCollection: false;
  coordinatorWrap: boolean;
  supplementEnabled: boolean;
  maxSupplementBots: number;
  allowSecondaryTakeover: boolean;
  floorProtocol: FloorProtocol;
  tuning: DispatchTuning;
};

export type GovernanceSegment = {
  decisionMode: DecisionMode;
  allowAgentPublishProposal: boolean;
  observer: typeof OBSERVER_PERMISSIONS;
  entersWaitingForHumanAfterVisibleTurnsExhausted: boolean;
  botMaySelfAdvanceWithoutHuman: boolean;
  coordinatorBotId: string | null;
  capabilities: Readonly<Record<GovernanceRole, readonly ActorCapability[]>>;
  task: GovernanceTaskPolicy;
};

export type PresentationSegment = {
  replyLanguage: "zh" | "en" | "inherit";
};

export type SegmentProvenance = {
  participation: DeepProvenance<ParticipationSegment>;
  dispatch: DeepProvenance<DispatchSegment>;
  governance: DeepProvenance<GovernanceSegment>;
  context: DeepProvenance<EffectiveContextPolicy>;
  presentation: DeepProvenance<PresentationSegment>;
};

export function policyValue<T>(params: {
  value: T;
  source: PolicyValueSource;
  requested?: unknown;
  constrainedBy?: string;
}): EffectivePolicyValue<T> {
  return {
    value: params.value,
    source: params.source,
    ...(params.requested !== undefined ? { requested: params.requested } : {}),
    ...(params.constrainedBy ? { constrainedBy: params.constrainedBy } : {}),
  };
}

function isConfidentiality(
  value: string,
): value is EffectiveContextPolicy["confidentialityCeiling"] {
  return value === "public" || value === "internal" || value === "restricted";
}

function isReplyLanguage(value: string): value is "zh" | "en" | "inherit" {
  return value === "zh" || value === "en" || value === "inherit";
}

export function resolveFloorOpenness(openDiscussion: boolean): FloorOpenness {
  return openDiscussion ? "open" : "single";
}

export function compileParticipationSegment(params: {
  openDiscussion: boolean;
  openDiscussionSource: PolicyValueSource;
  maxVisible: EffectivePolicyValue<number>;
  mentionMustRespond: boolean;
  mentionProvenance: EffectivePolicyValue<boolean>;
  lowSignal: EffectivePolicyValue<LowSignalStrategy>;
  humanStartsNewRound: boolean;
  humanStartsSource: PolicyValueSource;
  rollCallCeilingRaw?: number;
}): { segment: ParticipationSegment; provenance: DeepProvenance<ParticipationSegment> } {
  const floorOpenness = resolveFloorOpenness(params.openDiscussion);
  const proactiveBots = !params.humanStartsNewRound;
  const ceilingBound = SYSTEM_INVARIANTS.maxVisibleRepliesCeiling;
  let rollCallCeiling: number = ceilingBound;
  let rollCallProv: EffectivePolicyValue<number> = policyValue({
    value: rollCallCeiling,
    source: "l1-default",
    constrainedBy:
      "rollCall.ceiling defaults to min(botCount,12) at consume-time; compile stores absolute ceiling",
  });
  const raw = params.rollCallCeilingRaw;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const truncated = Math.trunc(raw);
    const effective = Math.max(1, Math.min(ceilingBound, truncated));
    if (effective !== truncated) {
      // P1-A1: segment constraint stays in provenance only — never legacy effective.clamps.
      rollCallCeiling = effective;
      rollCallProv = policyValue({
        value: effective,
        source: "l1-hard",
        requested: truncated,
        constrainedBy:
          truncated > ceilingBound
            ? `maxVisibleBotRepliesPerRoundBroad <= ${ceilingBound}`
            : "maxVisibleBotRepliesPerRoundBroad >= 1",
      });
    } else {
      rollCallCeiling = effective;
      rollCallProv = policyValue({ value: effective, source: "l2", requested: truncated });
    }
  }

  const segment: ParticipationSegment = {
    openDiscussionWithoutMention: params.openDiscussion,
    maxVisibleBotRepliesPerRound: params.maxVisible.value,
    mentionBotMustRespond: params.mentionMustRespond,
    mentionMustDispatch: true,
    mentionMaySilentIfNoIncrement: !params.mentionMustRespond,
    lowSignalStrategy: params.lowSignal.value,
    humanStartsNewRound: params.humanStartsNewRound,
    floorOpenness,
    rollCall: { enabled: true, ceiling: rollCallCeiling },
    proactiveBots,
    emergencyFanoutFuse: 12,
  };

  const provenance: DeepProvenance<ParticipationSegment> = {
    openDiscussionWithoutMention: policyValue({
      value: params.openDiscussion,
      source: params.openDiscussionSource,
    }),
    maxVisibleBotRepliesPerRound: params.maxVisible,
    mentionBotMustRespond: params.mentionProvenance,
    mentionMustDispatch: policyValue({ value: true, source: "l1-hard" }),
    mentionMaySilentIfNoIncrement: policyValue({
      value: !params.mentionMustRespond,
      source: params.mentionProvenance.source,
      ...(params.mentionProvenance.requested !== undefined
        ? { requested: params.mentionProvenance.requested }
        : {}),
    }),
    lowSignalStrategy: params.lowSignal,
    humanStartsNewRound: policyValue({
      value: params.humanStartsNewRound,
      source: params.humanStartsSource,
    }),
    floorOpenness: policyValue({
      value: floorOpenness,
      source: params.openDiscussionSource,
      constrainedBy: 'openDiscussionWithoutMention ? "open" : "single"',
    }),
    rollCall: {
      enabled: policyValue({ value: true, source: "l1-hard" }),
      ceiling: rollCallProv,
    },
    proactiveBots: policyValue({
      value: proactiveBots,
      source: params.humanStartsSource,
      constrainedBy: "proactiveBots = !humanStartsNewRound",
    }),
    emergencyFanoutFuse: policyValue({ value: 12, source: "l1-hard" }),
  };

  return { segment, provenance };
}

export function compileDispatchSegment(params: {
  coordinatorWrap: boolean;
  coordinatorWrapSource: PolicyValueSource;
  allowSupplement: boolean;
  allowSupplementSource: PolicyValueSource;
  allowSupplementRequested?: boolean;
  maxVisible: number;
  allowSecondaryTakeover: boolean;
  allowSecondarySource: PolicyValueSource;
  preserveConflict: boolean;
  /** P5 raise gate. Unset/null → 1. Clamped to 1..12. */
  maxBeatsPerEpisode?: number | null;
}): { segment: DispatchSegment; provenance: DeepProvenance<DispatchSegment> } {
  const maxSupplementBots = Math.max(1, Math.min(3, params.maxVisible - 1));
  const floorProtocol: FloorProtocol = "legacy";
  const maxBeatsPerEpisode = clampMaxBeatsPerEpisode(
    params.maxBeatsPerEpisode ?? MULTI_BEAT_DEFAULT_MAX,
  );
  const tuning: DispatchTuning = {
    floor: {
      router: {
        l1TopK: L1_FLOOR_TUNING_DEFAULTS.router.l1TopK,
        l1AmbiguityBand: L1_FLOOR_TUNING_DEFAULTS.router.l1AmbiguityBand,
        recentShareWindow: L1_FLOOR_TUNING_DEFAULTS.router.recentShareWindow,
      },
      bid: {
        deadlineMs: L1_FLOOR_TUNING_DEFAULTS.bid.deadlineMs,
        maxBidders: L1_FLOOR_TUNING_DEFAULTS.bid.maxBidders,
        selfAssessmentWeight: L1_FLOOR_TUNING_DEFAULTS.bid.selfAssessmentWeight,
      },
      admission: {
        budgets: {
          visiblePosts: params.maxVisible,
          modelCalls: L1_FLOOR_TUNING_DEFAULTS.admission.modelCalls,
          tokens: L1_FLOOR_TUNING_DEFAULTS.admission.tokens,
        },
        noveltyFloor: L1_FLOOR_TUNING_DEFAULTS.admission.noveltyFloor,
        duplicateSimilarityMax: L1_FLOOR_TUNING_DEFAULTS.admission.duplicateSimilarityMax,
        noveltyDecay: L1_FLOOR_TUNING_DEFAULTS.admission.noveltyDecay,
        cooldownBeats: L1_FLOOR_TUNING_DEFAULTS.admission.cooldownBeats,
        loopGuardDepth: L1_FLOOR_TUNING_DEFAULTS.admission.loopGuardDepth,
      },
      beats: { maxBeatsPerEpisode },
    },
    tier1Merge: { ...L1_TIER1_MERGE_DEFAULTS },
    cheapGate: { ...L1_CHEAP_GATE_DEFAULTS },
    keywordCaps: { ...L1_KEYWORD_CAPS_DEFAULTS },
    timeouts: {
      placeholderMs: L1_TIMEOUT_DEFAULTS.placeholderMs,
      byTaskType: { ...L1_TIMEOUT_DEFAULTS.byTaskType },
    },
    preserveConflict: params.preserveConflict,
    leadPlusSupplementCap: 2,
  };

  const l1 = <T>(value: T): EffectivePolicyValue<T> => policyValue({ value, source: "l1-default" });
  const l1Hard = <T>(value: T): EffectivePolicyValue<T> =>
    policyValue({ value, source: "l1-hard" });

  const segment: DispatchSegment = {
    primaryThenSupplement: true,
    allowEvidenceCollection: false,
    coordinatorWrap: params.coordinatorWrap,
    supplementEnabled: params.allowSupplement,
    maxSupplementBots,
    allowSecondaryTakeover: params.allowSecondaryTakeover,
    floorProtocol,
    tuning,
  };

  const provenance: DeepProvenance<DispatchSegment> = {
    primaryThenSupplement: l1Hard(true),
    allowEvidenceCollection: l1Hard(false),
    coordinatorWrap: policyValue({
      value: params.coordinatorWrap,
      source: params.coordinatorWrapSource,
    }),
    supplementEnabled: policyValue({
      value: params.allowSupplement,
      source: params.allowSupplementSource,
      ...(params.allowSupplementRequested !== undefined
        ? { requested: params.allowSupplementRequested }
        : {}),
    }),
    maxSupplementBots: policyValue({
      value: maxSupplementBots,
      source: "l1-hard",
      constrainedBy: "max(1, min(3, maxVisible - 1))",
    }),
    allowSecondaryTakeover: policyValue({
      value: params.allowSecondaryTakeover,
      source: params.allowSecondarySource,
    }),
    floorProtocol: policyValue({
      value: floorProtocol,
      source: "l1-default",
      constrainedBy: "P1-A1 ships floorProtocol=legacy; Floor cutover is P3",
    }),
    tuning: {
      floor: {
        router: {
          l1TopK: l1(tuning.floor.router.l1TopK),
          l1AmbiguityBand: l1(tuning.floor.router.l1AmbiguityBand),
          recentShareWindow: l1(tuning.floor.router.recentShareWindow),
        },
        bid: {
          deadlineMs: l1(tuning.floor.bid.deadlineMs),
          maxBidders: l1(tuning.floor.bid.maxBidders),
          selfAssessmentWeight: l1(tuning.floor.bid.selfAssessmentWeight),
        },
        admission: {
          budgets: {
            visiblePosts: policyValue({
              value: params.maxVisible,
              source: "l1-hard",
              constrainedBy: "visiblePosts = participation.maxVisibleBotRepliesPerRound",
            }),
            modelCalls: l1(tuning.floor.admission.budgets.modelCalls),
            tokens: l1(tuning.floor.admission.budgets.tokens),
          },
          noveltyFloor: l1(tuning.floor.admission.noveltyFloor),
          duplicateSimilarityMax: l1(tuning.floor.admission.duplicateSimilarityMax),
          noveltyDecay: l1(tuning.floor.admission.noveltyDecay),
          cooldownBeats: l1(tuning.floor.admission.cooldownBeats),
          loopGuardDepth: l1(tuning.floor.admission.loopGuardDepth),
        },
        beats: {
          maxBeatsPerEpisode:
            maxBeatsPerEpisode > MULTI_BEAT_DEFAULT_MAX
              ? policyValue({
                  value: maxBeatsPerEpisode,
                  source: "l2",
                  constrainedBy: "collaboration.episode.maxBeats (P5 gate, ≤12)",
                })
              : l1(MULTI_BEAT_DEFAULT_MAX),
        },
      },
      tier1Merge: {
        dutyFloor: l1(tuning.tier1Merge.dutyFloor),
        proactiveReplyThreshold: l1(tuning.tier1Merge.proactiveReplyThreshold),
        dutyWeight: l1(tuning.tier1Merge.dutyWeight),
        relevanceWeight: l1(tuning.tier1Merge.relevanceWeight),
      },
      cheapGate: {
        clearlyIrrelevant: l1(tuning.cheapGate.clearlyIrrelevant),
        clearlyRelevant: l1(tuning.cheapGate.clearlyRelevant),
      },
      keywordCaps: {
        chitchat: l1(tuning.keywordCaps.chitchat),
        simpleKnowledge: l1(tuning.keywordCaps.simpleKnowledge),
        numberedDecision: l1(tuning.keywordCaps.numberedDecision),
        lowSignal: l1(tuning.keywordCaps.lowSignal),
      },
      timeouts: {
        placeholderMs: l1(tuning.timeouts.placeholderMs),
        byTaskType: {
          chitchat: l1(tuning.timeouts.byTaskType.chitchat),
          chat: l1(tuning.timeouts.byTaskType.chat),
          knowledge: l1(tuning.timeouts.byTaskType.knowledge),
          analysis: l1(tuning.timeouts.byTaskType.analysis),
          research: l1(tuning.timeouts.byTaskType.research),
          data: l1(tuning.timeouts.byTaskType.data),
          decision: l1(tuning.timeouts.byTaskType.decision),
          execution: l1(tuning.timeouts.byTaskType.execution),
          unknown: l1(tuning.timeouts.byTaskType.unknown),
        },
      },
      preserveConflict: policyValue({
        value: params.preserveConflict,
        source: "l1-default",
        constrainedBy: "mirrored from strategy.preserveConflict",
      }),
      leadPlusSupplementCap: l1Hard(2),
    },
  };

  return { segment, provenance };
}

export function compileGovernanceSegment(params: {
  decisionMode: EffectivePolicyValue<DecisionMode>;
  allowProposal: boolean;
  allowProposalSource: PolicyValueSource;
  entersWaiting: boolean;
  entersWaitingSource: PolicyValueSource;
  botMaySelfAdvance: boolean;
  botMaySelfAdvanceSource: PolicyValueSource;
  coordinatorBotId: string | null;
  coordinatorSource: PolicyValueSource;
  strategy: ModeTemplate;
  deliverableRequiredOverride?: boolean | null;
  acceptanceCriteriaRequiredOverride?: boolean | null;
  allowBotToBotHandoffOverride?: boolean | null;
}): { segment: GovernanceSegment; provenance: DeepProvenance<GovernanceSegment> } {
  const deliverableRequired =
    params.deliverableRequiredOverride ?? params.strategy.deliverableRequired;
  const deliverableSource: PolicyValueSource =
    params.deliverableRequiredOverride === undefined || params.deliverableRequiredOverride === null
      ? "l1-default"
      : "l2";
  const acceptanceCriteriaRequired = params.acceptanceCriteriaRequiredOverride ?? true;
  const acceptanceSource: PolicyValueSource =
    params.acceptanceCriteriaRequiredOverride === undefined ||
    params.acceptanceCriteriaRequiredOverride === null
      ? "l1-default"
      : "l2";
  const allowBotToBotHandoff = params.allowBotToBotHandoffOverride ?? true;
  const handoffSource: PolicyValueSource =
    params.allowBotToBotHandoffOverride === undefined ||
    params.allowBotToBotHandoffOverride === null
      ? "l1-default"
      : "l2";

  const segment: GovernanceSegment = {
    decisionMode: params.decisionMode.value,
    allowAgentPublishProposal: params.allowProposal,
    observer: OBSERVER_PERMISSIONS,
    entersWaitingForHumanAfterVisibleTurnsExhausted: params.entersWaiting,
    botMaySelfAdvanceWithoutHuman: params.botMaySelfAdvance,
    coordinatorBotId: params.coordinatorBotId,
    capabilities: L1_GOVERNANCE_CAPABILITIES,
    task: {
      deliverableRequired,
      acceptanceCriteriaRequired,
      allowBotToBotHandoff,
    },
  };

  const provenance: DeepProvenance<GovernanceSegment> = {
    decisionMode: params.decisionMode,
    allowAgentPublishProposal: policyValue({
      value: params.allowProposal,
      source: params.allowProposalSource,
    }),
    observer: {
      canRead: policyValue({ value: true as const, source: "l1-hard" }),
      canMention: policyValue({ value: false as const, source: "l1-hard" }),
      canRespond: policyValue({ value: false as const, source: "l1-hard" }),
      canExecute: policyValue({ value: false as const, source: "l1-hard" }),
      canApprove: policyValue({ value: false as const, source: "l1-hard" }),
    },
    entersWaitingForHumanAfterVisibleTurnsExhausted: policyValue({
      value: params.entersWaiting,
      source: params.entersWaitingSource,
    }),
    botMaySelfAdvanceWithoutHuman: policyValue({
      value: params.botMaySelfAdvance,
      source: params.botMaySelfAdvanceSource,
    }),
    coordinatorBotId: policyValue({
      value: params.coordinatorBotId,
      source: params.coordinatorSource,
    }),
    capabilities: {
      owner: policyValue({
        value: L1_GOVERNANCE_CAPABILITIES.owner,
        source: "l1-hard",
        constrainedBy: "bot roles never receive L3 task.* capabilities",
      }),
      admin: policyValue({
        value: L1_GOVERNANCE_CAPABILITIES.admin,
        source: "l1-hard",
        constrainedBy: "bot roles never receive L3 task.* capabilities",
      }),
      coordinator: policyValue({
        value: L1_GOVERNANCE_CAPABILITIES.coordinator,
        source: "l1-hard",
        constrainedBy: "bot roles never receive L3 task.* capabilities",
      }),
      reviewer: policyValue({
        value: L1_GOVERNANCE_CAPABILITIES.reviewer,
        source: "l1-hard",
        constrainedBy: "bot roles never receive L3 task.* capabilities",
      }),
      final_decider: policyValue({
        value: L1_GOVERNANCE_CAPABILITIES.final_decider,
        source: "l1-hard",
        constrainedBy: "bot roles never receive L3 task.* capabilities",
      }),
      member_bot: policyValue({
        value: L1_GOVERNANCE_CAPABILITIES.member_bot,
        source: "l1-hard",
        constrainedBy: "bot roles never receive L3 task.* capabilities",
      }),
      member_human: policyValue({
        value: L1_GOVERNANCE_CAPABILITIES.member_human,
        source: "l1-hard",
        constrainedBy: "bot roles never receive L3 task.* capabilities",
      }),
      observer: policyValue({
        value: L1_GOVERNANCE_CAPABILITIES.observer,
        source: "l1-hard",
        constrainedBy: "bot roles never receive L3 task.* capabilities",
      }),
    },
    task: {
      deliverableRequired: policyValue({
        value: deliverableRequired,
        source: deliverableSource,
        ...(params.deliverableRequiredOverride != null
          ? { requested: params.deliverableRequiredOverride }
          : {}),
        constrainedBy: "L2 ?? strategy.deliverableRequired",
      }),
      acceptanceCriteriaRequired: policyValue({
        value: acceptanceCriteriaRequired,
        source: acceptanceSource,
        ...(params.acceptanceCriteriaRequiredOverride != null
          ? { requested: params.acceptanceCriteriaRequiredOverride }
          : {}),
      }),
      allowBotToBotHandoff: policyValue({
        value: allowBotToBotHandoff,
        source: handoffSource,
        ...(params.allowBotToBotHandoffOverride != null
          ? { requested: params.allowBotToBotHandoffOverride }
          : {}),
      }),
    },
  };

  return { segment, provenance };
}

export function compileContextSegment(params: { input: GroupPolicyInput }): {
  segment: EffectiveContextPolicy;
  provenance: DeepProvenance<EffectiveContextPolicy>;
} {
  const raw =
    typeof params.input.confidentialityTier === "string"
      ? params.input.confidentialityTier.trim()
      : "";
  let ceiling: EffectiveContextPolicy["confidentialityCeiling"] =
    L1_CONTEXT_DEFAULTS.confidentialityCeiling;
  let ceilingProv: EffectivePolicyValue<EffectiveContextPolicy["confidentialityCeiling"]> =
    policyValue({ value: ceiling, source: "l1-default" });
  if (raw) {
    if (isConfidentiality(raw)) {
      ceiling = raw;
      ceilingProv = policyValue({ value: raw, source: "l2", requested: raw });
    } else {
      // P1-A1: dirty tier recorded in provenance only — never legacy effective.clamps.
      ceilingProv = policyValue({
        value: L1_CONTEXT_DEFAULTS.confidentialityCeiling,
        source: "l1-default",
        requested: raw,
        constrainedBy: "confidentialityTier in public|internal|restricted",
      });
    }
  }

  const segment: EffectiveContextPolicy = {
    crossSourceRetrieval: L1_CONTEXT_DEFAULTS.crossSourceRetrieval,
    confidentialityCeiling: ceiling,
    defaultMode: L1_CONTEXT_DEFAULTS.defaultMode,
    allowMemberOverride: L1_CONTEXT_DEFAULTS.allowMemberOverride,
    mandatoryGroupContext: L1_CONTEXT_DEFAULTS.mandatoryGroupContext,
    allowedSourceTypes: [...L1_CONTEXT_DEFAULTS.allowedSourceTypes],
    budget: { ...L1_CONTEXT_DEFAULTS.budget },
    enforceConfidentiality: L1_CONTEXT_DEFAULTS.enforceConfidentiality,
  };

  const l1 = <T>(value: T): EffectivePolicyValue<T> => policyValue({ value, source: "l1-default" });
  const provenance: DeepProvenance<EffectiveContextPolicy> = {
    crossSourceRetrieval: l1(segment.crossSourceRetrieval),
    confidentialityCeiling: ceilingProv,
    defaultMode: l1(segment.defaultMode),
    allowMemberOverride: l1(segment.allowMemberOverride),
    mandatoryGroupContext: l1(segment.mandatoryGroupContext),
    allowedSourceTypes: l1(segment.allowedSourceTypes),
    budget: {
      maxTokens: l1(segment.budget.maxTokens),
      maxFiles: l1(segment.budget.maxFiles),
    },
    enforceConfidentiality: policyValue({
      value: segment.enforceConfidentiality,
      source: "l1-hard",
      constrainedBy: "SYSTEM_INVARIANTS.cannotBypassConfidentiality",
    }),
  };

  return { segment, provenance };
}

export function compilePresentationSegment(params: { input: GroupPolicyInput }): {
  segment: PresentationSegment;
  provenance: DeepProvenance<PresentationSegment>;
} {
  const raw =
    typeof params.input.replyLanguage === "string" ? params.input.replyLanguage.trim() : "";
  let replyLanguage: PresentationSegment["replyLanguage"] = "inherit";
  let source: PolicyValueSource = "l1-default";
  let requested: unknown;
  if (raw) {
    if (isReplyLanguage(raw)) {
      replyLanguage = raw;
      source = "l2";
      requested = raw;
    } else {
      // P1-A1: dirty language recorded in provenance only — never legacy effective.clamps.
      source = "l1-default";
      requested = raw;
    }
  }
  const segment: PresentationSegment = { replyLanguage };
  const provenance: DeepProvenance<PresentationSegment> = {
    replyLanguage: policyValue({
      value: replyLanguage,
      source,
      ...(requested !== undefined ? { requested } : {}),
      ...(requested !== undefined && source === "l1-default"
        ? { constrainedBy: "replyLanguage in zh|en|inherit" }
        : {}),
    }),
  };
  return { segment, provenance };
}

function isProvenanceLeaf(value: unknown): value is EffectivePolicyValue<unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    "value" in value &&
    "source" in value &&
    (value as EffectivePolicyValue<unknown>).source !== undefined &&
    ["l1-hard", "l1-default", "l2"].includes(
      (value as EffectivePolicyValue<unknown>).source as string,
    )
  );
}

/** Collect leaf paths from a segment value tree (arrays/objects-as-leaf stop). */
export function collectSegmentLeafPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") {
    return [prefix || "$"];
  }
  if (Array.isArray(value)) {
    return [prefix || "$"];
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return [prefix || "$"];
  }
  const paths: string[] = [];
  for (const [key, child] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    paths.push(...collectSegmentLeafPaths(child, path));
  }
  return paths;
}

function readPath(root: unknown, path: string): unknown {
  if (!path || path === "$") {
    return root;
  }
  let cur: unknown = root;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Provenance coverage = every leaf of the five capability segments has a
 * matching provenance.segments leaf whose `.value` is deeply equal.
 */
export function measureProvenanceCoverage(params: {
  participation: ParticipationSegment;
  dispatch: DispatchSegment;
  governance: GovernanceSegment;
  context: EffectiveContextPolicy;
  presentation: PresentationSegment;
  provenance: SegmentProvenance;
}): { covered: number; total: number; missing: string[]; mismatched: string[] } {
  const segments = {
    participation: params.participation,
    dispatch: params.dispatch,
    governance: params.governance,
    context: params.context,
    presentation: params.presentation,
  } as const;
  const missing: string[] = [];
  const mismatched: string[] = [];
  let total = 0;
  let covered = 0;
  for (const [name, segment] of Object.entries(segments)) {
    const paths = collectSegmentLeafPaths(segment);
    for (const leafPath of paths) {
      total += 1;
      const full = `${name}.${leafPath}`;
      const provNode = readPath((params.provenance as Record<string, unknown>)[name], leafPath);
      if (!isProvenanceLeaf(provNode)) {
        missing.push(full);
        continue;
      }
      const actual = readPath(segment, leafPath);
      if (JSON.stringify(provNode.value) !== JSON.stringify(actual)) {
        mismatched.push(full);
        continue;
      }
      covered += 1;
    }
  }
  return { covered, total, missing, mismatched };
}

export function assertProvenanceCoverage100(params: {
  participation: ParticipationSegment;
  dispatch: DispatchSegment;
  governance: GovernanceSegment;
  context: EffectiveContextPolicy;
  presentation: PresentationSegment;
  provenance: SegmentProvenance;
}): void {
  const result = measureProvenanceCoverage(params);
  if (result.covered !== result.total || result.missing.length || result.mismatched.length) {
    throw new Error(
      `provenance coverage ${result.covered}/${result.total}; missing=${JSON.stringify(result.missing)}; mismatched=${JSON.stringify(result.mismatched)}`,
    );
  }
}
