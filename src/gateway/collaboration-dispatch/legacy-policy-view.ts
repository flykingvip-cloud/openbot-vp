/**
 * P1-A3 — derive CollaborationPolicyV1 from EffectivePolicy
 * (Floor Runtime v2.1 §5.0 / §5.5 P1-A3, BP-06).
 *
 * Retires `overlayFromLegacyOperatingState`: PolicyV1 is a *view* of the
 * composition-root EffectivePolicy, not a parallel read of
 * `operatingState.collaborationPolicy`. Consumers that still take PolicyV1
 * (cheap-gate / round-runtime / completion-contract / toLegacyPolicyView)
 * therefore see the same values EffectivePolicy already owns for the overlay
 * whitelist. P0 G8 keeps that bridge on the production Legacy path: the
 * dispatch lane default stays `legacy`, and this view is not a second policy
 * source. Do not add Policy fields here.
 *
 * Mapped from effective (BP-06 whitelist + dispatch.tuning timeouts / takeover):
 *   mention.mentionBotMustRespond ← participation.mentionBotMustRespond
 *   supplement.enabled            ← dispatch.supplementEnabled
 *   supplement.maxSupplementBots  ← dispatch.maxSupplementBots
 *   coordinator.enabled           ← dispatch.coordinatorWrap
 *   fallback.allowSecondaryTakeover ← dispatch.allowSecondaryTakeover
 *   fallback.timeoutPolicy        ← dispatch.tuning.timeouts
 *   contextPolicy                 ← context (same narrowing as resolveRunContextPolicy)
 *
 * Remaining PolicyV1 fields keep DEFAULT_COLLABORATION_POLICY (assignment,
 * conflict, quality, review, non-overlay mention keys). `conflict.preserveDisagreement`
 * was never overlaid and is left on the PolicyV1 default until lane ②.
 */
import type { GatewayCollaborationGroupOperatingState } from "../collaboration-learning/operating-state-types.js";
import {
  DEFAULT_CONTEXT_POLICY,
  type ContextPolicyV1,
  type ContextSourceType,
} from "../context-scope/types.js";
import type { EffectiveCollaborationPolicy } from "./effective-policy.js";
import {
  DEFAULT_COLLABORATION_POLICY,
  type CollaborationPolicyV1,
  type TimeoutTaskType,
} from "./policy.js";
import { compileGroupEffectivePolicy } from "./resolve-effective-policy.js";

export type ToLegacyPolicyViewOptions = Readonly<{
  /** Mirror resolveCollaborationPolicyV1({ forDirectSession: true }). */
  forDirectSession?: boolean;
}>;

/** PolicyV1 fields that live consumers read (gate §5.0 P1-A3). */
export const LEGACY_POLICY_V1_CONSUMED_FIELDS = [
  "mention.mentionBotMustRespond",
  "supplement.enabled",
  "supplement.maxSupplementBots",
  "coordinator.enabled",
  "fallback.allowSecondaryTakeover",
  "fallback.timeoutPolicy.placeholderMs",
  "fallback.timeoutPolicy.byTaskType",
  "contextPolicy",
] as const;

const TIMEOUT_TASK_TYPES: readonly TimeoutTaskType[] = [
  "chitchat",
  "chat",
  "knowledge",
  "analysis",
  "research",
  "data",
  "decision",
  "execution",
  "unknown",
];

export function contextPolicyFromEffective(
  context: EffectiveCollaborationPolicy["context"],
  forDirectSession: boolean,
): ContextPolicyV1 {
  const allowedSourceTypes = context.allowedSourceTypes.filter((type): type is ContextSourceType =>
    (DEFAULT_CONTEXT_POLICY.allowedSourceTypes as readonly string[]).includes(type),
  );
  // Key order mirrors DEFAULT_CONTEXT_POLICY so serialised plans stay byte-identical.
  return {
    defaultMode: context.defaultMode === "auto" ? "auto" : DEFAULT_CONTEXT_POLICY.defaultMode,
    allowMemberOverride: context.allowMemberOverride,
    mandatoryGroupContext: forDirectSession ? false : context.mandatoryGroupContext,
    allowExternalSources: context.crossSourceRetrieval,
    maxContextTokens: context.budget.maxTokens,
    maxFilesPerRound: context.budget.maxFiles,
    allowedSourceTypes,
  };
}

function timeoutPolicyFromEffective(
  timeouts: EffectiveCollaborationPolicy["dispatch"]["tuning"]["timeouts"],
): CollaborationPolicyV1["fallback"]["timeoutPolicy"] {
  const byTaskType = {
    ...DEFAULT_COLLABORATION_POLICY.fallback.timeoutPolicy.byTaskType,
  } as Record<TimeoutTaskType, number>;
  for (const key of TIMEOUT_TASK_TYPES) {
    const value = timeouts.byTaskType[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      byTaskType[key] = value;
    }
  }
  return {
    placeholderMs: timeouts.placeholderMs,
    byTaskType,
  };
}

/**
 * Pure view: EffectivePolicy → CollaborationPolicyV1.
 * Does not read operatingState; callers compile via the composition root first.
 */
export function toLegacyPolicyView(
  effective: EffectiveCollaborationPolicy,
  options: ToLegacyPolicyViewOptions = {},
): CollaborationPolicyV1 {
  const forDirectSession = options.forDirectSession === true;
  const base = DEFAULT_COLLABORATION_POLICY;
  const view: CollaborationPolicyV1 = {
    ...base,
    mention: {
      ...base.mention,
      mentionBotMustRespond: effective.participation.mentionBotMustRespond,
    },
    supplement: {
      ...base.supplement,
      allowedIncrementTypes: [...base.supplement.allowedIncrementTypes],
      enabled: forDirectSession ? false : effective.dispatch.supplementEnabled,
      maxSupplementBots: effective.dispatch.maxSupplementBots,
    },
    coordinator: {
      ...base.coordinator,
      enabled: forDirectSession ? false : effective.dispatch.coordinatorWrap,
    },
    fallback: {
      ...base.fallback,
      allowSecondaryTakeover: effective.dispatch.allowSecondaryTakeover,
      timeoutPolicy: timeoutPolicyFromEffective(effective.dispatch.tuning.timeouts),
    },
    contextPolicy: contextPolicyFromEffective(effective.context, forDirectSession),
  };
  return view;
}

/**
 * Composition-root entry for PolicyV1: compile EffectivePolicy, then project.
 * Replaces overlayFromLegacyOperatingState (BP-06).
 */
export function resolveCollaborationPolicyV1(params?: {
  operatingState?: GatewayCollaborationGroupOperatingState | null;
  forDirectSession?: boolean;
}): CollaborationPolicyV1 {
  const effective = compileGroupEffectivePolicy({
    operatingState: params?.operatingState ?? null,
  });
  return toLegacyPolicyView(effective, { forDirectSession: params?.forDirectSession });
}
