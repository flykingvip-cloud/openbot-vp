/**
 * P1-A5 ⑤ — presentation capability lane (Floor Runtime v2.1 §5.5; BP-14 + BP-20).
 *
 * BP-14: the group bot-turn replyLanguage consumer (server-methods/chat.ts
 * runGroupBotDiscussionTurn) used to read the raw
 * `operatingState.collaborationPolicy.replyLanguage`. It now asks this
 * composition-root helper, which serves either the raw value (legacy) or
 * `authority.policy.effective.presentation.replyLanguage` (effective).
 * Flag `collaboration.lane.presentation` = legacy | shadow | effective
 * (default unset = legacy → zero live change). Shadow computes both, serves legacy
 * live and writes policy_lane_divergence{lane:"presentation"} on mismatch.
 *
 * BP-20: the UI used to compile its own EffectivePolicy from an incomplete
 * client-side input and rendered "可自推进", which the runtime never executes.
 * `projectSpaceEffectivePolicyView()` is the server-side projection: the frozen
 * EffectivePolicy (with provenance) + policyHash / provenanceHash /
 * compilerRevision + the list of effective leaves the runtime does not enforce,
 * returned on collaboration.spaces.list / collaboration.space.get. The UI only renders it.
 *
 * Allowlist bucket `presentation` shrinks to [] because the consumer no longer
 * carries the bypass AST site (the raw read lives only in this module, which is a
 * composition-root file for lint:collab:policy-consumption).
 */
import type { OpenBotConfig } from "../../config/types.js";
import type { GatewayCollaborationGroupOperatingState } from "../collaboration-learning.js";
import type { CollaborationEventKey } from "./collaboration-event-key.js";
import type { EffectiveCollaborationPolicy } from "./effective-policy.js";
import type { DeepReadonly, FrozenEffectivePolicy } from "./policy-identity.js";
import { normalizeConfidentialityTierForCompiler } from "./policy-lane-context.js";
import {
  maybeRecordLaneDivergence,
  resolvePolicyLaneMode,
  type PolicyLaneDivergence,
  type PolicyLaneMode,
} from "./policy-lane-divergence.js";
import {
  compileGroupEffectivePolicy,
  resolveGroupEffectivePolicy,
} from "./resolve-effective-policy.js";

export const PRESENTATION_LANE = "presentation" as const;

/** Value handed to resolveCollaborationReplyLanguage({ groupLanguage }). */
export type PresentationGroupLanguage = "zh" | "en" | "inherit" | null | undefined;

export type PresentationLaneResolution = Readonly<{
  mode: PolicyLaneMode;
  /**
   * Group language served to resolveCollaborationReplyLanguage. Only "zh" / "en"
   * pin the language; anything else falls through to per-turn detection.
   */
  groupLanguage: PresentationGroupLanguage;
  /** Divergences recorded for this resolution (also pushed to the shared sink). */
  divergences: readonly PolicyLaneDivergence[];
}>;

/** Plan flag `collab.lane.presentation` → config `collaboration.lane.presentation` (default legacy). */
export function resolvePresentationLaneMode(cfg?: OpenBotConfig): PolicyLaneMode {
  return resolvePolicyLaneMode(PRESENTATION_LANE, cfg);
}

type OperatingStateLike =
  | DeepReadonly<Pick<GatewayCollaborationGroupOperatingState, "collaborationPolicy">>
  | { collaborationPolicy?: { replyLanguage?: unknown } | null }
  | null
  | undefined;

/**
 * BP-14 legacy source: raw `operatingState.collaborationPolicy.replyLanguage`.
 * Read only here (composition root) so scanned consumer files carry no bypass.
 */
export function readOperatingStateReplyLanguageRaw(
  operatingState: OperatingStateLike,
): PresentationGroupLanguage {
  const raw = (operatingState as { collaborationPolicy?: { replyLanguage?: unknown } | null })
    ?.collaborationPolicy?.replyLanguage;
  if (raw === null) {
    return null;
  }
  // Legacy passed the raw value verbatim (typed zh|en|inherit, persisted data may be dirty);
  // resolveCollaborationReplyLanguage only pins on "zh" / "en".
  return typeof raw === "string" ? (raw as PresentationGroupLanguage) : undefined;
}

/** The behavioural projection both sides are compared on: pinned language or per-turn detect. */
export function pinnedReplyLanguage(value: unknown): "zh" | "en" | null {
  return value === "zh" || value === "en" ? value : null;
}

/**
 * BP-14 — group bot-turn replyLanguage.
 * Legacy: raw operatingState.collaborationPolicy.replyLanguage.
 * Effective: authority.policy.effective.presentation.replyLanguage (zh|en|inherit;
 * dirty L2 values are already "inherit" with the raw value in provenance.requested).
 */
export function resolvePresentationLaneReplyLanguage(params: {
  /** authority.policy.effective (RoundPolicySnapshot.effective). */
  effective?: EffectiveCollaborationPolicy | FrozenEffectivePolicy | null;
  /** Legacy BP-14 source (scope.operatingState). */
  operatingState?: OperatingStateLike;
  mode?: PolicyLaneMode;
  key?: CollaborationEventKey | null;
  cfg?: OpenBotConfig;
}): PresentationLaneResolution {
  const mode = params.mode ?? resolvePresentationLaneMode(params.cfg);
  const legacyLanguage = readOperatingStateReplyLanguageRaw(params.operatingState);
  if (mode === "legacy") {
    // Zero live change and no extra compile on the default path.
    return { mode, groupLanguage: legacyLanguage, divergences: [] };
  }
  const effective =
    params.effective ??
    compileGroupEffectivePolicy({
      operatingState: (params.operatingState ??
        null) as GatewayCollaborationGroupOperatingState | null,
    });
  const effectiveLanguage = effective.presentation.replyLanguage;
  const divergences: PolicyLaneDivergence[] = [];
  maybeRecordLaneDivergence({
    lane: PRESENTATION_LANE,
    mode,
    field: "replyLanguage",
    legacyValue: pinnedReplyLanguage(legacyLanguage),
    effectiveValue: pinnedReplyLanguage(effectiveLanguage),
    key: params.key,
    out: divergences,
  });
  if (mode === "effective") {
    return { mode, groupLanguage: effectiveLanguage, divergences };
  }
  return { mode, groupLanguage: legacyLanguage, divergences };
}

/**
 * Effective leaves the runtime does not execute today.
 * P4: `governance.botMaySelfAdvanceWithoutHuman` is enforced by
 * `trySelfAdvance` / Governance Gate `self_advance` (removed from this list).
 * `participation.proactiveBots` remains presentation-only.
 */
export const RUNTIME_NOT_ENFORCED_EFFECTIVE_FIELDS = Object.freeze([
  "participation.proactiveBots",
] as const);

export type RuntimeNotEnforcedEffectiveField =
  (typeof RUNTIME_NOT_ENFORCED_EFFECTIVE_FIELDS)[number];

/** Server-rendered policy view returned with each collaboration space (BP-20). */
export type CollaborationSpaceEffectivePolicyView = Readonly<{
  /** Deep-frozen EffectivePolicy; `effective.provenance` carries per-leaf provenance. */
  effective: FrozenEffectivePolicy;
  policyHash: string;
  provenanceHash: string;
  compilerRevision: string;
  /** Effective leaves that are compiled but not executed by the runtime. */
  runtimeNotEnforced: readonly RuntimeNotEnforcedEffectiveField[];
}>;

/** Space snapshot fields the projection reads (structural; avoids a snapshot-type cycle). */
export type SpaceEffectivePolicySource = {
  operatingState?: GatewayCollaborationGroupOperatingState | null;
  collaborationMode?: string | null;
  finalDecisionPolicy?: {
    mode?: string | null;
    allowAgentPublishProposal?: boolean | null;
  } | null;
  systemInstructions?: readonly string[] | null;
  confidentialityTier?: string | null;
};

/**
 * BP-20 — compile the space's EffectivePolicy once on the server through the unique
 * composition root (resolveGroupEffectivePolicy) and return it frozen with provenance.
 * Same precedence the UI applied client-side (space profile over operatingState),
 * but with the complete server-side input.
 */
export function projectSpaceEffectivePolicyView(
  space: SpaceEffectivePolicySource,
): CollaborationSpaceEffectivePolicyView {
  const confidentialityTier = normalizeConfidentialityTierForCompiler(space.confidentialityTier);
  const resolved = resolveGroupEffectivePolicy({
    operatingState: space.operatingState ?? null,
    legacyOverlay: {
      ...(space.collaborationMode ? { collaborationMode: space.collaborationMode } : {}),
      ...(space.finalDecisionPolicy ? { finalDecisionPolicy: space.finalDecisionPolicy } : {}),
      ...(space.systemInstructions?.length ? { systemInstructions: space.systemInstructions } : {}),
      ...(confidentialityTier ? { confidentialityTier } : {}),
    },
  });
  return Object.freeze({
    effective: resolved.effective,
    policyHash: resolved.policyHash,
    provenanceHash: resolved.provenanceHash,
    compilerRevision: resolved.compilerRevision,
    runtimeNotEnforced: RUNTIME_NOT_ENFORCED_EFFECTIVE_FIELDS,
  });
}

/**
 * Attach `effectivePolicy` to a space snapshot at the RPC egress. A compile failure
 * never fails the listing: the space is returned without the view (UI then renders
 * only the static system / role lines).
 */
export function withSpaceEffectivePolicy<T extends SpaceEffectivePolicySource>(
  space: T,
): T & { effectivePolicy?: CollaborationSpaceEffectivePolicyView } {
  try {
    return { ...space, effectivePolicy: projectSpaceEffectivePolicyView(space) };
  } catch {
    return space;
  }
}
