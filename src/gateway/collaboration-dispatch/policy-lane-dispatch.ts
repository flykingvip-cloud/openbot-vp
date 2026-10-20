/**
 * P1-A5 ② — dispatch capability lane (Floor Runtime v2.1 §5.5;
 * BP-03 / BP-06..10 / BP-13 + B1 keywordCaps L1 reference).
 *
 * Migrates tier1b merge (BP-03), round-runtime PolicyV1 (BP-06..10), and chat.ts
 * preserveConflict (BP-13) off raw groupProfile.collaborationMode
 * onto authority.policy.effective.dispatch (via this composition-root helper).
 * Flag `collaboration.lane.dispatch` = legacy | shadow | effective
 * (default unset = legacy → zero live change).
 * P0 G8: do not change that unset default to `effective`.
 *
 * Shadow fields (§5.5): supplementEnabled, maxSupplementBots, coordinatorWrap,
 * timeouts, cheapGate thresholds, tier1Merge, preserveConflict.
 * B1 keywordCaps: legacy keeps pre-lane numeric caps (equal to L1_KEYWORD_CAPS_DEFAULTS);
 * shadow/effective compare / serve effective.dispatch.tuning.keywordCaps.
 *
 * Allowlist bucket `dispatch` shrinks to [] because consumers no longer carry
 * the bypass AST sites (reads live only in this module).
 */
import type { OpenBotConfig } from "../../config/types.js";
import type { GatewayCollaborationGroupOperatingState } from "../collaboration-learning.js";
import type { CollaborationEventKey } from "./collaboration-event-key.js";
import type { EffectiveCollaborationPolicy } from "./effective-policy.js";
import { toLegacyPolicyView } from "./legacy-policy-view.js";
import {
  L1_CHEAP_GATE_DEFAULTS,
  L1_KEYWORD_CAPS_DEFAULTS,
  L1_TIER1_MERGE_DEFAULTS,
} from "./policy-compiler-sections.js";
import {
  maybeRecordLaneDivergence,
  resolvePolicyLaneMode,
  type PolicyLaneDivergence,
  type PolicyLaneMode,
} from "./policy-lane-divergence.js";
import type { CollaborationPolicyV1 } from "./policy.js";
import { compileGroupEffectivePolicy } from "./resolve-effective-policy.js";

export const DISPATCH_LANE = "dispatch" as const;

export type Tier1MergePolicyResolved = Readonly<{
  dutyFloor: number;
  proactiveReplyThreshold: number;
  dutyWeight: number;
  relevanceWeight: number;
}>;

export type DispatchLaneTier1MergeResolution = Readonly<{
  mode: PolicyLaneMode;
  merge: Tier1MergePolicyResolved;
  divergences: readonly PolicyLaneDivergence[];
}>;

export type DispatchLanePolicyV1Resolution = Readonly<{
  mode: PolicyLaneMode;
  /** CollaborationPolicyV1 served to round-runtime / cheap-gate / completion-contract. */
  policy: CollaborationPolicyV1;
  divergences: readonly PolicyLaneDivergence[];
}>;

export type DispatchLanePreserveConflictResolution = Readonly<{
  mode: PolicyLaneMode;
  preserveConflict: boolean;
  divergences: readonly PolicyLaneDivergence[];
}>;

export type DispatchLaneKeywordCapsResolution = Readonly<{
  mode: PolicyLaneMode;
  caps: Readonly<{
    chitchat: number;
    simpleKnowledge: number;
    numberedDecision: number;
    lowSignal: number;
  }>;
  divergences: readonly PolicyLaneDivergence[];
}>;

/** Plan flag `collab.lane.dispatch` → config `collaboration.lane.dispatch` (default legacy). */
export function resolveDispatchLaneMode(cfg?: OpenBotConfig): PolicyLaneMode {
  return resolvePolicyLaneMode(DISPATCH_LANE, cfg);
}

function resolveEffectiveOrCompile(params: {
  effective?: EffectiveCollaborationPolicy | null;
  operatingState?: GatewayCollaborationGroupOperatingState | null;
}): EffectiveCollaborationPolicy {
  if (params.effective) {
    return params.effective;
  }
  return compileGroupEffectivePolicy({
    operatingState: params.operatingState ?? null,
  });
}

/** BP-03 legacy: raw tier1MergeRaw when present, else L1_TIER1_MERGE_DEFAULTS (compiler). */
export function legacyTier1Merge(
  raw?: Partial<Tier1MergePolicyResolved> | null,
): Tier1MergePolicyResolved {
  return {
    dutyFloor: raw?.dutyFloor ?? L1_TIER1_MERGE_DEFAULTS.dutyFloor,
    proactiveReplyThreshold:
      raw?.proactiveReplyThreshold ?? L1_TIER1_MERGE_DEFAULTS.proactiveReplyThreshold,
    dutyWeight: raw?.dutyWeight ?? L1_TIER1_MERGE_DEFAULTS.dutyWeight,
    relevanceWeight: raw?.relevanceWeight ?? L1_TIER1_MERGE_DEFAULTS.relevanceWeight,
  };
}

export function effectiveTier1Merge(
  effective: EffectiveCollaborationPolicy,
): Tier1MergePolicyResolved {
  const t = effective.dispatch.tuning.tier1Merge;
  return {
    dutyFloor: t.dutyFloor,
    proactiveReplyThreshold: t.proactiveReplyThreshold,
    dutyWeight: t.dutyWeight,
    relevanceWeight: t.relevanceWeight,
  };
}

/**
 * BP-03 — tier1b merge weights.
 * Legacy: L1_TIER1_MERGE_DEFAULTS (Φ keys never written; optional tier1MergeRaw for tests).
 * Effective: authority.policy.effective.dispatch.tuning.tier1Merge.
 */
export function resolveDispatchLaneTier1Merge(params: {
  effective?: EffectiveCollaborationPolicy | null;
  /**
   * Optional stale/foreign raw for shadow tests. Production never populated
   * Φ keys never written; legacy = L1_TIER1_MERGE_DEFAULTS.
   */
  tier1MergeRaw?: Partial<Tier1MergePolicyResolved> | null;
  operatingState?: GatewayCollaborationGroupOperatingState | null;
  mode?: PolicyLaneMode;
  key?: CollaborationEventKey | null;
  cfg?: OpenBotConfig;
}): DispatchLaneTier1MergeResolution {
  const mode = params.mode ?? resolveDispatchLaneMode(params.cfg);
  const legacy = legacyTier1Merge(params.tier1MergeRaw);
  if (mode === "legacy") {
    return { mode, merge: legacy, divergences: [] };
  }
  const effective = resolveEffectiveOrCompile(params);
  const eff = effectiveTier1Merge(effective);
  const divergences: PolicyLaneDivergence[] = [];
  maybeRecordLaneDivergence({
    lane: DISPATCH_LANE,
    mode,
    field: "tier1Merge",
    legacyValue: legacy,
    effectiveValue: eff,
    key: params.key,
    out: divergences,
  });
  if (mode === "effective") {
    return { mode, merge: eff, divergences };
  }
  return { mode, merge: legacy, divergences };
}

/** Shadow-compare the PolicyV1 fields that map onto effective.dispatch (design §5.5). */
function dispatchShadowFieldsFromPolicyV1(policy: CollaborationPolicyV1): Record<string, unknown> {
  return {
    supplementEnabled: policy.supplement.enabled,
    maxSupplementBots: policy.supplement.maxSupplementBots,
    coordinatorWrap: policy.coordinator.enabled,
    timeouts: {
      placeholderMs: policy.fallback.timeoutPolicy.placeholderMs,
      byTaskType: policy.fallback.timeoutPolicy.byTaskType,
    },
    allowSecondaryTakeover: policy.fallback.allowSecondaryTakeover,
  };
}

function dispatchShadowFieldsFromEffective(
  effective: EffectiveCollaborationPolicy,
): Record<string, unknown> {
  return {
    supplementEnabled: effective.dispatch.supplementEnabled,
    maxSupplementBots: effective.dispatch.maxSupplementBots,
    coordinatorWrap: effective.dispatch.coordinatorWrap,
    timeouts: {
      placeholderMs: effective.dispatch.tuning.timeouts.placeholderMs,
      byTaskType: { ...effective.dispatch.tuning.timeouts.byTaskType },
    },
    allowSecondaryTakeover: effective.dispatch.allowSecondaryTakeover,
  };
}

/**
 * BP-06..10 — CollaborationPolicyV1 for round-runtime.
 * Legacy: optional policyV1 override, else toLegacyPolicyView(effective)
 * (byte-for-byte with pre-lane round-runtime). Effective: toLegacyPolicyView(effective).
 * Shadow compares the dispatch-mapped fields and also records cheapGate L1 vs tuning.
 */
export function resolveDispatchLanePolicyV1(params: {
  effective?: EffectiveCollaborationPolicy | null;
  /**
   * Optional PolicyV1 override (round-runtime params.policy / shadow tests).
   * Production legacy path equals toLegacyPolicyView(effective) — the same view
   * previously stored as a derived PolicyV1 view of effective.
   */
  policyV1?: CollaborationPolicyV1 | null;
  operatingState?: GatewayCollaborationGroupOperatingState | null;
  forDirectSession?: boolean;
  mode?: PolicyLaneMode;
  key?: CollaborationEventKey | null;
  cfg?: OpenBotConfig;
}): DispatchLanePolicyV1Resolution {
  const mode = params.mode ?? resolveDispatchLaneMode(params.cfg);
  const effective = resolveEffectiveOrCompile(params);
  const fromEffective = toLegacyPolicyView(effective, {
    forDirectSession: params.forDirectSession === true,
  });
  // Clone arrays: DeepReadonly policyV1 needs mutable allowedIncrementTypes downstream.
  const clonePolicy = (p: CollaborationPolicyV1): CollaborationPolicyV1 => ({
    ...p,
    supplement: {
      ...p.supplement,
      allowedIncrementTypes: [...p.supplement.allowedIncrementTypes],
    },
  });
  const legacyPolicy = params.policyV1 ? clonePolicy(params.policyV1) : clonePolicy(fromEffective);
  if (mode === "legacy") {
    return { mode, policy: legacyPolicy, divergences: [] };
  }
  const divergences: PolicyLaneDivergence[] = [];
  const legacyFields = dispatchShadowFieldsFromPolicyV1(legacyPolicy);
  const effectiveFields = dispatchShadowFieldsFromEffective(effective);
  for (const field of Object.keys(effectiveFields)) {
    maybeRecordLaneDivergence({
      lane: DISPATCH_LANE,
      mode,
      field,
      legacyValue: legacyFields[field],
      effectiveValue: effectiveFields[field],
      key: params.key,
      out: divergences,
    });
  }
  // cheapGate: no live PolicyV1 consumer; compare L1 defaults vs tuning (always equal today).
  maybeRecordLaneDivergence({
    lane: DISPATCH_LANE,
    mode,
    field: "cheapGate",
    legacyValue: { ...L1_CHEAP_GATE_DEFAULTS },
    effectiveValue: { ...effective.dispatch.tuning.cheapGate },
    key: params.key,
    out: divergences,
  });
  if (mode === "effective") {
    return { mode, policy: clonePolicy(fromEffective), divergences };
  }
  return { mode, policy: legacyPolicy, divergences };
}

type GroupProfileLike = { collaborationMode?: string | null } | null | undefined;

/**
 * BP-13 legacy source: operatingState.groupProfile.collaborationMode === "review_driven"
 * (chat.ts pre-lane). challenge role always preserves conflict.
 */
export function legacyPreserveConflict(params: {
  contributionRole?: string | null;
  operatingState?: { groupProfile?: GroupProfileLike } | null;
  /** Optional scope.groupProfile — NOT used by legacy (byte-for-byte OS-only). */
  groupProfile?: GroupProfileLike;
}): boolean {
  if (params.contributionRole === "challenge") {
    return true;
  }
  return params.operatingState?.groupProfile?.collaborationMode === "review_driven";
}

export function effectivePreserveConflict(params: {
  contributionRole?: string | null;
  effective: EffectiveCollaborationPolicy;
}): boolean {
  if (params.contributionRole === "challenge") {
    return true;
  }
  return params.effective.strategy.preserveConflict;
}

/**
 * BP-13 — preserveConflict for redundancy suppression.
 * Legacy: OS groupProfile.collaborationMode === "review_driven" (or challenge).
 * Effective: authority.policy.effective.strategy.preserveConflict (or challenge).
 */
export function resolveDispatchLanePreserveConflict(params: {
  effective?: EffectiveCollaborationPolicy | null;
  contributionRole?: string | null;
  operatingState?: GatewayCollaborationGroupOperatingState | null;
  groupProfile?: GroupProfileLike;
  mode?: PolicyLaneMode;
  key?: CollaborationEventKey | null;
  cfg?: OpenBotConfig;
}): DispatchLanePreserveConflictResolution {
  const mode = params.mode ?? resolveDispatchLaneMode(params.cfg);
  const legacy = legacyPreserveConflict({
    contributionRole: params.contributionRole,
    operatingState: params.operatingState,
    groupProfile: params.groupProfile,
  });
  if (mode === "legacy") {
    return { mode, preserveConflict: legacy, divergences: [] };
  }
  const effective = resolveEffectiveOrCompile(params);
  const eff = effectivePreserveConflict({
    contributionRole: params.contributionRole,
    effective,
  });
  const divergences: PolicyLaneDivergence[] = [];
  maybeRecordLaneDivergence({
    lane: DISPATCH_LANE,
    mode,
    field: "preserveConflict",
    legacyValue: legacy,
    effectiveValue: eff,
    key: params.key,
    out: divergences,
  });
  if (mode === "effective") {
    return { mode, preserveConflict: eff, divergences };
  }
  return { mode, preserveConflict: legacy, divergences };
}

/**
 * B1 keywordCaps — legacy numeric caps equal L1_KEYWORD_CAPS_DEFAULTS (compiler).
 * Effective serves effective.dispatch.tuning.keywordCaps.
 */
export function resolveDispatchLaneKeywordCaps(params: {
  effective?: EffectiveCollaborationPolicy | null;
  operatingState?: GatewayCollaborationGroupOperatingState | null;
  mode?: PolicyLaneMode;
  key?: CollaborationEventKey | null;
  cfg?: OpenBotConfig;
}): DispatchLaneKeywordCapsResolution {
  const mode = params.mode ?? resolveDispatchLaneMode(params.cfg);
  const legacy = {
    chitchat: L1_KEYWORD_CAPS_DEFAULTS.chitchat,
    simpleKnowledge: L1_KEYWORD_CAPS_DEFAULTS.simpleKnowledge,
    numberedDecision: L1_KEYWORD_CAPS_DEFAULTS.numberedDecision,
    lowSignal: L1_KEYWORD_CAPS_DEFAULTS.lowSignal,
  };
  if (mode === "legacy") {
    return { mode, caps: legacy, divergences: [] };
  }
  const effective = resolveEffectiveOrCompile(params);
  const eff = { ...effective.dispatch.tuning.keywordCaps };
  const divergences: PolicyLaneDivergence[] = [];
  maybeRecordLaneDivergence({
    lane: DISPATCH_LANE,
    mode,
    field: "keywordCaps",
    legacyValue: legacy,
    effectiveValue: eff,
    key: params.key,
    out: divergences,
  });
  if (mode === "effective") {
    return { mode, caps: eff, divergences };
  }
  return { mode, caps: legacy, divergences };
}
