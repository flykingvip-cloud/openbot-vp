import type { GatewayCollaborationGroupOperatingState } from "../collaboration-learning.js";
/**
 * P1-A2 — the unique composition root for group EffectivePolicy
 * (Floor Runtime v2.1 §1 diagram "resolveGroupEffectivePolicy() ← 唯一组合根",
 * BP-17, §5.0 P1-A2).
 *
 * Every group-policy compile in the gateway goes through this module:
 *   - dispatch (decision-engine flag-off path, discussion-turn-prompt,
 *     RoundPolicySnapshot / RuntimeAuthority) via `groupPolicySourceFromScope`;
 *   - collaboration-learning state-machine (task / handoff / deliverable /
 *     decision gates) via `{ operatingState }`;
 *   - get-reply-run Context Scope via `resolveRunContextPolicy`.
 *
 * Inputs are normalised into one `GroupEffectivePolicySource`:
 *   - `operatingState` — persisted L2 values (the only long-term source);
 *   - `legacyOverlay` — pre-P1-A5 dispatch-only overlays that the legacy
 *     dispatch path already applied (session collaborationGroupProfile mode /
 *     finalDecisionPolicy / systemInstructions, and the chat.ts:814-819
 *     4-source coordinator). They are kept so P1-A2 changes no live value;
 *     capability lanes ③/④/⑤ (P1-A5) remove them. `legacyOverlayDivergence()`
 *     names the overlay fields that make dispatch and learning disagree for the
 *     same group, so that remainder is measurable instead of implicit.
 *
 * Given the same source, dispatch and learning get the same policyHash (the
 * algorithm is `hashEffectiveCollaborationPolicy`, unchanged).
 */
import {
  DEFAULT_CONTEXT_POLICY,
  type ContextPolicyV1,
  type ContextSourceType,
} from "../context-scope/types.js";
import type { EffectiveCollaborationPolicy, GroupPolicyInput } from "./effective-policy.js";
import { hashEffectiveCollaborationPolicy } from "./policy-compiler-hash.js";
import {
  compileEffectiveCollaborationPolicy,
  groupPolicyInputFromOperatingState,
} from "./policy-compiler.js";
import {
  POLICY_COMPILER_REVISION,
  deepFreeze,
  hashProvenanceAndClamps,
  type DeepReadonly,
  type FrozenEffectivePolicy,
} from "./policy-identity.js";
import type { CollaborationDispatchScope } from "./types.js";

type FinalDecisionPolicyInput = {
  mode?: string | null;
  allowAgentPublishProposal?: boolean | null;
} | null;

/** Dispatch-only overlays applied by the legacy path (removed lane by lane in P1-A5). */
export type GroupPolicyLegacyOverlay = Readonly<{
  /** Session collaborationGroupProfile.collaborationMode (lane ② / ⑤). */
  collaborationMode?: string | null;
  /** Session collaborationGroupProfile.finalDecisionPolicy (lane ③). */
  finalDecisionPolicy?: FinalDecisionPolicyInput;
  /** Session collaborationGroupProfile.systemInstructions (guidance only). */
  systemInstructions?: readonly string[] | null;
  /** chat.ts:814-819 4-source coordinator (BP-15; Q3 migration in lane ③). */
  coordinatorBotId?: string | null;
  /**
   * Session overlay/profile confidentialityTier (BP-12; P1-A5 ④).
   * Fed into GroupPolicyInput so effective.context.confidentialityCeiling stays
   * value-equivalent to the live Context Scope maxLevel. Cleared when lane.context=effective
   * is the steady state and OS owns the tier.
   */
  confidentialityTier?: string | null;
}>;

export type GroupEffectivePolicySource = Readonly<{
  operatingState?: GatewayCollaborationGroupOperatingState | null;
  legacyOverlay?: GroupPolicyLegacyOverlay | null;
}>;

export type ResolvedGroupEffectivePolicy = Readonly<{
  effective: FrozenEffectivePolicy;
  input: DeepReadonly<GroupPolicyInput>;
  /** hashEffectiveCollaborationPolicy (unchanged algorithm). */
  policyHash: string;
  provenanceHash: string;
  compilerRevision: string;
}>;

export type GroupPolicyLegacyOverlayField = keyof GroupPolicyLegacyOverlay;

/** The single place that maps a group policy source to compiler input. */
export function resolveGroupPolicyInput(source: GroupEffectivePolicySource = {}): GroupPolicyInput {
  const state = source.operatingState ?? null;
  const overlay = source.legacyOverlay ?? null;
  return groupPolicyInputFromOperatingState({
    collaborationMode: overlay?.collaborationMode ?? state?.groupProfile?.collaborationMode,
    collaborationPolicy: state?.collaborationPolicy ?? null,
    finalDecisionPolicy:
      overlay?.finalDecisionPolicy ?? state?.governance?.finalDecisionPolicy ?? null,
    systemInstructions: overlay?.systemInstructions,
    coordinatorBotId: overlay?.coordinatorBotId ?? state?.governance?.coordinatorBotId ?? null,
    // P1-A5 ④: session confidentiality → compiler (secret collapsed by caller / normalize).
    confidentialityTier: overlay?.confidentialityTier ?? undefined,
  });
}

/** Map a dispatch scope onto the composition-root source (legacy overlay kept verbatim). */
export function groupPolicySourceFromScope(
  scope: CollaborationDispatchScope,
): GroupEffectivePolicySource {
  const profile = scope.groupProfile;
  return {
    operatingState: scope.operatingState ?? null,
    legacyOverlay: {
      collaborationMode: profile?.collaborationMode,
      finalDecisionPolicy: profile?.finalDecisionPolicy,
      systemInstructions: profile?.systemInstructions,
      coordinatorBotId: scope.coordinatorBotId,
    },
  };
}

/**
 * Compile without freezing — the shape every legacy (flag-off) consumer received
 * before P1-A2. Freezing remains governed by `collaboration.policySnapshot`.
 */
export function compileGroupEffectivePolicy(
  source: GroupEffectivePolicySource = {},
): EffectiveCollaborationPolicy {
  return compileEffectiveCollaborationPolicy(resolveGroupPolicyInput(source));
}

/** Compile once, clone, deep-freeze and hash (shared with createRoundPolicySnapshot). */
export function compileAndFreezeGroupPolicyInput(
  input: GroupPolicyInput | null | undefined,
): ResolvedGroupEffectivePolicy {
  const compiled = compileEffectiveCollaborationPolicy(input ?? {});
  const clonedEffective = structuredClone(compiled);
  const clonedInput = structuredClone(input ?? {});
  return {
    policyHash: hashEffectiveCollaborationPolicy(clonedEffective),
    provenanceHash: hashProvenanceAndClamps({
      provenance: clonedEffective.provenance,
      clamps: clonedEffective.clamps,
    }),
    compilerRevision: POLICY_COMPILER_REVISION,
    effective: deepFreeze(clonedEffective),
    input: deepFreeze(clonedInput),
  };
}

/** Unique composition root: deep-frozen EffectivePolicy + policyHash + provenanceHash. */
export function resolveGroupEffectivePolicy(
  source: GroupEffectivePolicySource = {},
): ResolvedGroupEffectivePolicy {
  return compileAndFreezeGroupPolicyInput(resolveGroupPolicyInput(source));
}

/**
 * Legacy overlay fields whose presence changes compiler input relative to the
 * operatingState-only source (what learning sees). Empty ⇒ dispatch and learning
 * compile identical input for this group and therefore get the same policyHash.
 */
export function legacyOverlayDivergence(
  source: GroupEffectivePolicySource,
): GroupPolicyLegacyOverlayField[] {
  const overlay = source.legacyOverlay;
  if (!overlay) {
    return [];
  }
  const base = resolveGroupPolicyInput({ operatingState: source.operatingState });
  const fields: GroupPolicyLegacyOverlayField[] = [];
  const probe = (field: GroupPolicyLegacyOverlayField, pick: (i: GroupPolicyInput) => unknown) => {
    const withField = resolveGroupPolicyInput({
      operatingState: source.operatingState,
      legacyOverlay: { [field]: overlay[field] } as GroupPolicyLegacyOverlay,
    });
    if (JSON.stringify(pick(withField)) !== JSON.stringify(pick(base))) {
      fields.push(field);
    }
  };
  probe("collaborationMode", (i) => i.collaborationMode);
  probe("finalDecisionPolicy", (i) => [i.finalDecisionMode, i.allowAgentPublishProposal]);
  probe("systemInstructions", (i) => i.systemInstructions ?? []);
  probe("coordinatorBotId", (i) => i.coordinatorBotId ?? null);
  return fields;
}

/**
 * get-reply-run Context Scope policy (BP-12 contextPolicy half), derived from the
 * composition root's `effective.context`. Value-identical to the pre-P1-A2
 * `resolveCollaborationPolicyV1({ forDirectSession }).contextPolicy` (asserted in
 * resolve-effective-policy.test.ts). The confidentiality half of BP-12 is
 * resolved by `policy-lane-context.ts` (P1-A5 ④); this helper covers contextPolicy only.
 */
export function resolveRunContextPolicy(params: { forDirectSession: boolean }): ContextPolicyV1 {
  const { context } = compileGroupEffectivePolicy({});
  // ContextPolicyV1 is narrower than effective.context (defaultMode is "auto" only;
  // source types are a closed union). Values it cannot represent fall back to the
  // legacy constant instead of widening the live Context Scope.
  const allowedSourceTypes = context.allowedSourceTypes.filter((type): type is ContextSourceType =>
    (DEFAULT_CONTEXT_POLICY.allowedSourceTypes as readonly string[]).includes(type),
  );
  // Key order mirrors DEFAULT_CONTEXT_POLICY so serialised plans stay byte-identical.
  return {
    defaultMode: context.defaultMode === "auto" ? "auto" : DEFAULT_CONTEXT_POLICY.defaultMode,
    allowMemberOverride: context.allowMemberOverride,
    mandatoryGroupContext: params.forDirectSession ? false : context.mandatoryGroupContext,
    allowExternalSources: context.crossSourceRetrieval,
    maxContextTokens: context.budget.maxTokens,
    maxFilesPerRound: context.budget.maxFiles,
    allowedSourceTypes,
  };
}

/**
 * @deprecated P1-A2: use `compileGroupEffectivePolicy(groupPolicySourceFromScope(scope))`.
 * Kept as a thin alias for existing imports; routes through the composition root.
 */
export function compileEffectivePolicyFromScope(
  scope: CollaborationDispatchScope,
): EffectiveCollaborationPolicy {
  return compileGroupEffectivePolicy(groupPolicySourceFromScope(scope));
}
