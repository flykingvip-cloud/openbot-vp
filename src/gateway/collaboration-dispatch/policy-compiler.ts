import { L1_DEFAULT } from "../../agent-runtime/policy/index.js";
import {
  COLLABORATION_POLICY_PROTOCOL_VERSION,
  MODE_TEMPLATES,
  SYSTEM_INVARIANTS,
  type CollaborationModeTemplateId,
  type DecisionMode,
  type EffectiveCollaborationPolicy,
  type EffectivePolicyValue,
  type GroupPolicyInput,
  type LowSignalStrategy,
  type ModeTemplate,
  type PolicyClamp,
  type PolicyValueSource,
} from "./effective-policy.js";

export { L1_DEFAULT };
import {
  assertProvenanceCoverage100,
  compileContextSegment,
  compileDispatchSegment,
  compileGovernanceSegment,
  compileParticipationSegment,
  compilePresentationSegment,
  policyValue,
} from "./policy-compiler-sections.js";

function isModeId(value: string): value is CollaborationModeTemplateId {
  return value === "discussion_driven" || value === "task_driven" || value === "review_driven";
}

function isDecisionMode(value: string): value is DecisionMode {
  return value === "human_required" || value === "delegated_low_risk";
}

function isLowSignalStrategy(value: string): value is LowSignalStrategy {
  return value === "one_reply" || value === "all_named_confirmers";
}

function resolveLowSignalStrategy(value: string | null | undefined): LowSignalStrategy | undefined {
  return value && isLowSignalStrategy(value) ? value : undefined;
}

function uniqueInstructions(values: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values ?? []) {
    const line = value.trim();
    if (!line || seen.has(line)) {
      continue;
    }
    seen.add(line);
    result.push(line);
  }
  return result;
}

function pushClamp(clamps: PolicyClamp[], clamp: PolicyClamp) {
  clamps.push(clamp);
}

function resolveMode(
  input: GroupPolicyInput,
  clamps: PolicyClamp[],
): { template: ModeTemplate; provenance: EffectivePolicyValue<CollaborationModeTemplateId> } {
  const raw = typeof input.collaborationMode === "string" ? input.collaborationMode.trim() : "";
  if (!raw) {
    return {
      template: MODE_TEMPLATES[L1_DEFAULT.collaborationMode],
      provenance: policyValue({
        value: L1_DEFAULT.collaborationMode,
        source: "l1-default",
      }),
    };
  }
  if (isModeId(raw)) {
    return {
      template: MODE_TEMPLATES[raw],
      provenance: policyValue({ value: raw, source: "l2" }),
    };
  }
  pushClamp(clamps, {
    field: "collaborationMode",
    requested: raw,
    effective: L1_DEFAULT.collaborationMode,
    reason: "unknown_mode_falls_back_to_l1_default",
    source: "l1-default",
    constrainedBy: "collaborationMode in discussion_driven|task_driven|review_driven",
  });
  return {
    template: MODE_TEMPLATES[L1_DEFAULT.collaborationMode],
    provenance: policyValue({
      value: L1_DEFAULT.collaborationMode,
      source: "l1-default",
      requested: raw,
      constrainedBy: "collaborationMode in discussion_driven|task_driven|review_driven",
    }),
  };
}

function resolveMaxVisible(
  input: GroupPolicyInput,
  clamps: PolicyClamp[],
): EffectivePolicyValue<number> {
  const ceiling = SYSTEM_INVARIANTS.maxVisibleRepliesCeiling;
  const requested = input.maxVisibleBotRepliesPerRound;
  if (typeof requested !== "number" || !Number.isFinite(requested)) {
    return policyValue({
      value: L1_DEFAULT.maxVisibleBotRepliesPerRound,
      source: "l1-default",
    });
  }
  const truncated = Math.trunc(requested);
  const effective = Math.max(1, Math.min(ceiling, truncated));
  if (effective !== truncated) {
    const constrainedBy =
      truncated > ceiling
        ? `maxVisibleBotRepliesPerRound <= ${ceiling}`
        : "maxVisibleBotRepliesPerRound >= 1";
    pushClamp(clamps, {
      field: "maxVisibleBotRepliesPerRound",
      requested: truncated,
      effective,
      reason: truncated > ceiling ? "l1_resource_ceiling" : "l1_resource_floor",
      source: "l1-hard",
      constrainedBy,
    });
    return policyValue({
      value: effective,
      source: "l1-hard",
      requested: truncated,
      constrainedBy,
    });
  }
  return policyValue({ value: effective, source: "l2", requested: truncated });
}

function resolveDecisionMode(
  input: GroupPolicyInput,
  clamps: PolicyClamp[],
): EffectivePolicyValue<DecisionMode> {
  const raw = typeof input.finalDecisionMode === "string" ? input.finalDecisionMode.trim() : "";
  if (!raw) {
    return policyValue({ value: L1_DEFAULT.finalDecisionMode, source: "l1-default" });
  }
  if (isDecisionMode(raw)) {
    return policyValue({ value: raw, source: "l2" });
  }
  pushClamp(clamps, {
    field: "finalDecisionMode",
    requested: raw,
    effective: L1_DEFAULT.finalDecisionMode,
    reason: "unknown_decision_mode_falls_back_to_l1_default",
    source: "l1-default",
    constrainedBy: "finalDecisionMode in human_required|delegated_low_risk",
  });
  return policyValue({
    value: L1_DEFAULT.finalDecisionMode,
    source: "l1-default",
    requested: raw,
    constrainedBy: "finalDecisionMode in human_required|delegated_low_risk",
  });
}

function resolveLowSignal(
  input: GroupPolicyInput,
  clamps: PolicyClamp[],
): EffectivePolicyValue<LowSignalStrategy> {
  const raw = input.lowSignalStrategy;
  if (!raw) {
    return policyValue({ value: L1_DEFAULT.lowSignalStrategy, source: "l1-default" });
  }
  if (isLowSignalStrategy(raw)) {
    return policyValue({ value: raw, source: "l2" });
  }
  pushClamp(clamps, {
    field: "lowSignalStrategy",
    requested: raw,
    effective: L1_DEFAULT.lowSignalStrategy,
    reason: "unknown_low_signal_strategy_falls_back_to_l1_default",
    source: "l1-default",
    constrainedBy: "lowSignalStrategy in one_reply|all_named_confirmers",
  });
  return policyValue({
    value: L1_DEFAULT.lowSignalStrategy,
    source: "l1-default",
    requested: raw,
    constrainedBy: "lowSignalStrategy in one_reply|all_named_confirmers",
  });
}

/**
 * EffectivePolicy = L1 ∩ L2.
 * L1-Hard never yields. L1-Default applies unless L2 tightens or selects a
 * permitted alternative (e.g. low-signal confirmers).
 *
 * P1-A1: five capability segments compiled together; no consumers yet.
 */
export function compileEffectiveCollaborationPolicy(
  input: GroupPolicyInput = {},
): EffectiveCollaborationPolicy {
  const clamps: PolicyClamp[] = [];

  const mentionMustRespond = input.mentionBotMustRespond ?? L1_DEFAULT.mentionBotMustRespond;
  const mentionProvenance = policyValue({
    value: mentionMustRespond,
    source: input.mentionBotMustRespond === undefined ? "l1-default" : "l2",
    ...(input.mentionBotMustRespond !== undefined
      ? { requested: input.mentionBotMustRespond }
      : {}),
  });

  const mode = resolveMode(input, clamps);
  const maxVisible = resolveMaxVisible(input, clamps);
  const openDiscussion =
    input.openDiscussionWithoutMention ?? L1_DEFAULT.openDiscussionWithoutMention;
  const openDiscussionSource: PolicyValueSource =
    input.openDiscussionWithoutMention === undefined ? "l1-default" : "l2";
  const allowSupplement =
    input.allowSupplementAfterPrimary ?? L1_DEFAULT.allowSupplementAfterPrimary;
  const allowSupplementSource: PolicyValueSource =
    input.allowSupplementAfterPrimary === undefined ? "l1-default" : "l2";
  const coordinatorWrap = input.coordinatorSummarizeAfterRound === true;
  const coordinatorWrapSource: PolicyValueSource =
    input.coordinatorSummarizeAfterRound === undefined ? "l1-default" : "l2";
  const decisionMode = resolveDecisionMode(input, clamps);
  const lowSignal = resolveLowSignal(input, clamps);
  const allowProposal = input.allowAgentPublishProposal ?? L1_DEFAULT.allowAgentPublishProposal;
  const allowProposalSource: PolicyValueSource =
    input.allowAgentPublishProposal === undefined ? "l1-default" : "l2";
  const allowSecondaryTakeover = input.allowSecondaryTakeover ?? L1_DEFAULT.allowSecondaryTakeover;
  const allowSecondarySource: PolicyValueSource =
    input.allowSecondaryTakeover === undefined ? "l1-default" : "l2";
  const humanStartsNewRound = input.humanStartsNewRound ?? L1_DEFAULT.humanStartsNewRound;
  const humanStartsSource: PolicyValueSource =
    input.humanStartsNewRound === undefined ? "l1-default" : "l2";
  const entersWaiting =
    input.entersWaitingForHumanAfterVisibleTurnsExhausted ??
    L1_DEFAULT.entersWaitingForHumanAfterVisibleTurnsExhausted;
  const entersWaitingSource: PolicyValueSource =
    input.entersWaitingForHumanAfterVisibleTurnsExhausted === undefined ? "l1-default" : "l2";
  const botMaySelfAdvance =
    input.botMaySelfAdvanceWithoutHuman ?? L1_DEFAULT.botMaySelfAdvanceWithoutHuman;
  const botMaySelfAdvanceSource: PolicyValueSource =
    input.botMaySelfAdvanceWithoutHuman === undefined ? "l1-default" : "l2";

  const rawCoordinator =
    typeof input.coordinatorBotId === "string" ? input.coordinatorBotId.trim() : "";
  const coordinatorBotId = rawCoordinator || null;
  const coordinatorSource: PolicyValueSource =
    input.coordinatorBotId === undefined || input.coordinatorBotId === null ? "l1-default" : "l2";

  const participation = compileParticipationSegment({
    openDiscussion,
    openDiscussionSource,
    maxVisible,
    mentionMustRespond,
    mentionProvenance,
    lowSignal,
    humanStartsNewRound,
    humanStartsSource,
    rollCallCeilingRaw: input.maxVisibleBotRepliesPerRoundBroad,
  });

  const dispatch = compileDispatchSegment({
    coordinatorWrap,
    coordinatorWrapSource,
    allowSupplement,
    allowSupplementSource,
    allowSupplementRequested:
      input.allowSupplementAfterPrimary !== undefined
        ? input.allowSupplementAfterPrimary
        : undefined,
    maxVisible: maxVisible.value,
    allowSecondaryTakeover,
    allowSecondarySource,
    preserveConflict: mode.template.preserveConflict,
    maxBeatsPerEpisode: input.maxBeatsPerEpisode,
  });

  const governance = compileGovernanceSegment({
    decisionMode,
    allowProposal,
    allowProposalSource,
    entersWaiting,
    entersWaitingSource,
    botMaySelfAdvance,
    botMaySelfAdvanceSource,
    coordinatorBotId,
    coordinatorSource,
    strategy: mode.template,
    deliverableRequiredOverride: input.deliverableRequired,
    acceptanceCriteriaRequiredOverride: input.acceptanceCriteriaRequired,
    allowBotToBotHandoffOverride: input.allowBotToBotHandoff,
  });

  const context = compileContextSegment({ input });
  const presentation = compilePresentationSegment({ input });

  const segmentProvenance = {
    participation: participation.provenance,
    dispatch: dispatch.provenance,
    governance: governance.provenance,
    context: context.provenance,
    presentation: presentation.provenance,
  };

  assertProvenanceCoverage100({
    participation: participation.segment,
    dispatch: dispatch.segment,
    governance: governance.segment,
    context: context.segment,
    presentation: presentation.segment,
    provenance: segmentProvenance,
  });

  return {
    protocolVersion: COLLABORATION_POLICY_PROTOCOL_VERSION,
    invariants: SYSTEM_INVARIANTS,
    strategy: mode.template,
    participation: participation.segment,
    dispatch: dispatch.segment,
    governance: governance.segment,
    context: context.segment,
    presentation: presentation.segment,
    guidance: {
      systemInstructions: uniqueInstructions(input.systemInstructions),
    },
    provenance: {
      collaborationMode: mode.provenance,
      openDiscussionWithoutMention: policyValue({
        value: openDiscussion,
        source: openDiscussionSource,
      }),
      allowSupplementAfterPrimary: policyValue({
        value: allowSupplement,
        source: allowSupplementSource,
        ...(input.allowSupplementAfterPrimary !== undefined
          ? { requested: input.allowSupplementAfterPrimary }
          : {}),
      }),
      maxVisibleBotRepliesPerRound: maxVisible,
      mentionBotMustRespond: mentionProvenance,
      lowSignalStrategy: lowSignal,
      coordinatorWrap: policyValue({
        value: coordinatorWrap,
        source: coordinatorWrapSource,
      }),
      decisionMode,
      allowAgentPublishProposal: policyValue({
        value: allowProposal,
        source: allowProposalSource,
      }),
      allowSecondaryTakeover: policyValue({
        value: allowSecondaryTakeover,
        source: allowSecondarySource,
      }),
      segments: segmentProvenance,
    },
    clamps,
  };
}

export function groupPolicyInputFromOperatingState(params: {
  collaborationMode?: string | null;
  collaborationPolicy?: {
    openDiscussionWithoutMention?: boolean | null;
    allowSupplementAfterPrimary?: boolean | null;
    maxVisibleBotRepliesPerRound?: number | null;
    maxVisibleBotRepliesPerRoundBroad?: number | null;
    mentionBotMustRespond?: boolean | null;
    humanStartsNewRound?: boolean | null;
    botMaySelfAdvanceWithoutHuman?: boolean | null;
    entersWaitingForHumanAfterVisibleTurnsExhausted?: boolean | null;
    coordinatorSummarizeAfterRound?: boolean | null;
    lowSignalStrategy?: string | null;
    allowSecondaryTakeover?: boolean | null;
    replyLanguage?: "zh" | "en" | "inherit" | null;
  } | null;
  finalDecisionMode?: string | null;
  finalDecisionPolicy?: {
    mode?: string | null;
    allowAgentPublishProposal?: boolean | null;
  } | null;
  allowAgentPublishProposal?: boolean | null;
  systemInstructions?: readonly string[] | null;
  lowSignalStrategy?: string | null;
  coordinatorBotId?: string | null;
  confidentialityTier?: string | null;
  deliverableRequired?: boolean | null;
  acceptanceCriteriaRequired?: boolean | null;
  allowBotToBotHandoff?: boolean | null;
  maxBeatsPerEpisode?: number | null;
}): GroupPolicyInput {
  const policy = params.collaborationPolicy;
  return {
    collaborationMode: params.collaborationMode,
    openDiscussionWithoutMention: policy?.openDiscussionWithoutMention ?? undefined,
    allowSupplementAfterPrimary: policy?.allowSupplementAfterPrimary ?? undefined,
    maxVisibleBotRepliesPerRound: policy?.maxVisibleBotRepliesPerRound ?? undefined,
    maxVisibleBotRepliesPerRoundBroad: policy?.maxVisibleBotRepliesPerRoundBroad ?? undefined,
    mentionBotMustRespond: policy?.mentionBotMustRespond ?? undefined,
    humanStartsNewRound: policy?.humanStartsNewRound ?? undefined,
    botMaySelfAdvanceWithoutHuman: policy?.botMaySelfAdvanceWithoutHuman ?? undefined,
    entersWaitingForHumanAfterVisibleTurnsExhausted:
      policy?.entersWaitingForHumanAfterVisibleTurnsExhausted ?? undefined,
    coordinatorSummarizeAfterRound: policy?.coordinatorSummarizeAfterRound ?? undefined,
    lowSignalStrategy: resolveLowSignalStrategy(
      params.lowSignalStrategy ?? policy?.lowSignalStrategy,
    ),
    allowSecondaryTakeover: policy?.allowSecondaryTakeover ?? undefined,
    finalDecisionMode: params.finalDecisionMode ?? params.finalDecisionPolicy?.mode ?? undefined,
    allowAgentPublishProposal:
      params.allowAgentPublishProposal ??
      params.finalDecisionPolicy?.allowAgentPublishProposal ??
      undefined,
    systemInstructions: params.systemInstructions,
    replyLanguage: policy?.replyLanguage ?? undefined,
    coordinatorBotId: params.coordinatorBotId ?? undefined,
    confidentialityTier: params.confidentialityTier ?? undefined,
    deliverableRequired: params.deliverableRequired ?? undefined,
    acceptanceCriteriaRequired: params.acceptanceCriteriaRequired ?? undefined,
    allowBotToBotHandoff: params.allowBotToBotHandoff ?? undefined,
    maxBeatsPerEpisode: params.maxBeatsPerEpisode ?? undefined,
  };
}
