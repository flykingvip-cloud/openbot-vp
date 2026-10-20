/**
 * P1-A5 ① — participation capability lane (Floor Runtime v2.1 §5.5;
 * BP-01 / BP-02 / BP-04/05 / BP-18 mentionBotMustRespond).
 *
 * Migrates visible-reply-limit (BP-01/02) and discussion-turn-prompt (BP-18
 * mentionBotMustRespond recompile) off raw OS policy / out-of-root compile
 * onto authority.policy.effective.participation via this composition-root helper.
 * Flag `collaboration.lane.participation` = legacy | shadow | effective
 * (default unset = legacy → zero live change).
 *
 * Shadow: compute both values, serve legacy live, write policy_lane_divergence
 * {lane:"participation"} when they differ. Effective: serve effective.participation.
 * BP-04/05 (charter dead branch) is deleted in decision-engine.ts with a 2³
 * exhaustive test; no lane switch needed (branch was unreachable).
 *
 * Allowlist bucket `participation` shrinks to [] because consumers no longer
 * carry the bypass AST sites (reads / recompiles live only in this module).
 */
import type { OpenBotConfig } from "../../config/types.js";
import type { GatewayCollaborationGroupOperatingState } from "../collaboration-learning.js";
import type { CollaborationEventKey } from "./collaboration-event-key.js";
import type { EffectiveCollaborationPolicy } from "./effective-policy.js";
import { L1_DEFAULT } from "./policy-compiler.js";
import {
  maybeRecordLaneDivergence,
  resolvePolicyLaneMode,
  type PolicyLaneDivergence,
  type PolicyLaneMode,
} from "./policy-lane-divergence.js";
import { compileGroupEffectivePolicy } from "./resolve-effective-policy.js";
import { COLLABORATION_ABSOLUTE_VISIBLE_TURN_LIMIT } from "./types.js";

export const PARTICIPATION_LANE = "participation" as const;

/** L1 defaults — single source = policy-compiler L1_DEFAULT (do not fork values). */
const L1_MAX_VISIBLE = L1_DEFAULT.maxVisibleBotRepliesPerRound;
const L1_OPEN_DISCUSSION = L1_DEFAULT.openDiscussionWithoutMention;
const L1_MENTION_MUST_RESPOND = L1_DEFAULT.mentionBotMustRespond;

export type ParticipationLaneVisibleLimits = Readonly<{
  mode: PolicyLaneMode;
  /** Served maxVisible / policyCeiling (BP-01). */
  policyCeiling: number;
  /**
   * Served broadcast / roll-call ceiling (BP-02) at consume-time
   * (legacy clamp or min(botCount, effective.rollCall.ceiling)).
   */
  broadcastCeiling: number;
  /** Divergences recorded for this resolution (also pushed to the shared sink). */
  divergences: readonly PolicyLaneDivergence[];
}>;

export type ParticipationLaneMentionResolution = Readonly<{
  mode: PolicyLaneMode;
  mentionBotMustRespond: boolean;
  divergences: readonly PolicyLaneDivergence[];
}>;

export type ParticipationLaneOpenDiscussionResolution = Readonly<{
  mode: PolicyLaneMode;
  openDiscussionWithoutMention: boolean;
  divergences: readonly PolicyLaneDivergence[];
}>;

type OperatingStateLike =
  | DeepReadonlyOs
  | { collaborationPolicy?: CollaborationPolicySlice | null }
  | null
  | undefined;

type DeepReadonlyOs =
  | Readonly<Pick<GatewayCollaborationGroupOperatingState, "collaborationPolicy">>
  | null
  | undefined;

type CollaborationPolicySlice = {
  maxVisibleBotRepliesPerRound?: unknown;
  maxVisibleBotRepliesPerRoundBroad?: unknown;
  openDiscussionWithoutMention?: unknown;
  mentionBotMustRespond?: unknown;
};

/** Plan flag `collab.lane.participation` → config `collaboration.lane.participation` (default legacy). */
export function resolveParticipationLaneMode(cfg?: OpenBotConfig): PolicyLaneMode {
  return resolvePolicyLaneMode(PARTICIPATION_LANE, cfg);
}

function readPolicy(os: OperatingStateLike): CollaborationPolicySlice | null | undefined {
  return (os as { collaborationPolicy?: CollaborationPolicySlice | null } | null | undefined)
    ?.collaborationPolicy;
}

/**
 * BP-01 legacy source: raw OS maxVisibleBotRepliesPerRound, clamped like
 * visible-reply-limit.resolvePolicyCeiling (pre-lane). Missing → effective if
 * provided, else L1 default 5. Read only here (composition root).
 */
export function legacyPolicyCeiling(
  operatingState: OperatingStateLike,
  effective?: EffectiveCollaborationPolicy | null,
): number {
  const raw = readPolicy(operatingState)?.maxVisibleBotRepliesPerRound;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(1, Math.min(COLLABORATION_ABSOLUTE_VISIBLE_TURN_LIMIT, Math.trunc(raw)));
  }
  if (effective) {
    return effective.participation.maxVisibleBotRepliesPerRound;
  }
  return L1_MAX_VISIBLE;
}

/**
 * BP-02 legacy source at consume-time: min(botCount, clamped raw broad) — equivalent to
 * the pre-lane `Math.min(botCount, resolveBroadCastCeiling(...))` pair. Missing raw →
 * min(botCount, absolute ceiling).
 */
export function legacyBroadcastCeiling(
  operatingState: OperatingStateLike,
  botCount: number,
): number {
  const raw = readPolicy(operatingState)?.maxVisibleBotRepliesPerRoundBroad;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const clamped = Math.max(
      1,
      Math.min(COLLABORATION_ABSOLUTE_VISIBLE_TURN_LIMIT, Math.trunc(raw)),
    );
    return Math.min(botCount, clamped);
  }
  return Math.min(botCount, COLLABORATION_ABSOLUTE_VISIBLE_TURN_LIMIT);
}

/** Effective BP-01: participation.maxVisibleBotRepliesPerRound (already clamped by compiler). */
export function effectivePolicyCeiling(effective: EffectiveCollaborationPolicy): number {
  return effective.participation.maxVisibleBotRepliesPerRound;
}

/**
 * Effective BP-02 consume-time: min(botCount, rollCall.ceiling).
 * Compiler stores the absolute ceiling; consume-time applies botCount (compiler comment).
 */
export function effectiveBroadcastCeiling(
  effective: EffectiveCollaborationPolicy,
  botCount: number,
): number {
  return Math.min(botCount, effective.participation.rollCall.ceiling);
}

function resolveEffectiveOrCompile(params: {
  effective?: EffectiveCollaborationPolicy | null;
  operatingState?: OperatingStateLike;
}): EffectiveCollaborationPolicy {
  if (params.effective) {
    return params.effective;
  }
  return compileGroupEffectivePolicy({
    operatingState: (params.operatingState ??
      null) as GatewayCollaborationGroupOperatingState | null,
  });
}

/**
 * BP-01 / BP-02 — visible reply / broadcast ceilings.
 * Legacy: raw OS clamp (byte-for-byte with pre-lane visible-reply-limit).
 * Effective: authority.policy.effective.participation.maxVisible / rollCall.ceiling.
 */
export function resolveParticipationLaneVisibleLimits(params: {
  /** authority.policy.effective (RoundPolicySnapshot.effective). */
  effective?: EffectiveCollaborationPolicy | null;
  /** Legacy BP-01/02 source (scope.operatingState). */
  operatingState?: OperatingStateLike;
  botCount: number;
  mode?: PolicyLaneMode;
  key?: CollaborationEventKey | null;
  cfg?: OpenBotConfig;
}): ParticipationLaneVisibleLimits {
  const mode = params.mode ?? resolveParticipationLaneMode(params.cfg);
  const legacyCeiling = legacyPolicyCeiling(params.operatingState, params.effective);
  const legacyBroadcast = legacyBroadcastCeiling(params.operatingState, params.botCount);
  if (mode === "legacy") {
    // Zero live change and no extra compile on the default path.
    return {
      mode,
      policyCeiling: legacyCeiling,
      broadcastCeiling: legacyBroadcast,
      divergences: [],
    };
  }
  const effective = resolveEffectiveOrCompile(params);
  const effCeiling = effectivePolicyCeiling(effective);
  const effBroadcast = effectiveBroadcastCeiling(effective, params.botCount);
  const divergences: PolicyLaneDivergence[] = [];
  maybeRecordLaneDivergence({
    lane: PARTICIPATION_LANE,
    mode,
    field: "maxVisible",
    legacyValue: legacyCeiling,
    effectiveValue: effCeiling,
    key: params.key,
    out: divergences,
  });
  maybeRecordLaneDivergence({
    lane: PARTICIPATION_LANE,
    mode,
    field: "rollCall.ceiling",
    legacyValue: legacyBroadcast,
    effectiveValue: effBroadcast,
    key: params.key,
    out: divergences,
  });
  if (mode === "effective") {
    return {
      mode,
      policyCeiling: effCeiling,
      broadcastCeiling: effBroadcast,
      divergences,
    };
  }
  return {
    mode,
    policyCeiling: legacyCeiling,
    broadcastCeiling: legacyBroadcast,
    divergences,
  };
}

/**
 * Raw OS boolean with L1 default (matches compiler when the field is absent).
 * Used as the legacy side of shadow comparison for mention / openDiscussion.
 */
export function readRawParticipationBool(
  operatingState: OperatingStateLike,
  field: "mentionBotMustRespond" | "openDiscussionWithoutMention",
  fallback: boolean,
): boolean {
  const raw = readPolicy(operatingState)?.[field];
  return typeof raw === "boolean" ? raw : fallback;
}

/**
 * BP-18 mentionBotMustRespond consumer (discussion-turn-prompt).
 * Legacy: same as pre-lane — injected effective, else compile from OS (moved into
 * this composition root so the consumer carries no policy-recompile AST).
 * Effective: authority.policy.effective.participation.mentionBotMustRespond.
 * Shadow also compares raw OS (?? L1 false) vs effective for divergence telemetry.
 */
export function resolveParticipationLaneMentionMustRespond(params: {
  effective?: EffectiveCollaborationPolicy | null;
  operatingState?: OperatingStateLike;
  mode?: PolicyLaneMode;
  key?: CollaborationEventKey | null;
  cfg?: OpenBotConfig;
}): ParticipationLaneMentionResolution {
  const mode = params.mode ?? resolveParticipationLaneMode(params.cfg);
  // Legacy serve path: prefer injected effective (P0.0b single-compile), else compile here.
  const legacyEffective = resolveEffectiveOrCompile(params);
  const legacyValue = legacyEffective.participation.mentionBotMustRespond;
  if (mode === "legacy") {
    return { mode, mentionBotMustRespond: legacyValue, divergences: [] };
  }
  const effective = params.effective ?? legacyEffective;
  const effectiveValue = effective.participation.mentionBotMustRespond;
  const rawForCompare = readRawParticipationBool(
    params.operatingState,
    "mentionBotMustRespond",
    L1_MENTION_MUST_RESPOND,
  );
  const divergences: PolicyLaneDivergence[] = [];
  maybeRecordLaneDivergence({
    lane: PARTICIPATION_LANE,
    mode,
    field: "mentionBotMustRespond",
    legacyValue: rawForCompare,
    effectiveValue,
    key: params.key,
    out: divergences,
  });
  // Also record if the legacy-served compile differs from the provided effective
  // (stale/foreign effective) — same field name with a distinct compare is enough via
  // the raw-vs-effective pair above when OS matches the injected effective.
  if (mode === "effective") {
    return { mode, mentionBotMustRespond: effectiveValue, divergences };
  }
  return { mode, mentionBotMustRespond: legacyValue, divergences };
}

/**
 * openDiscussionWithoutMention — shadow/effective compare helper.
 * Live decide path already serves effective.participation; this records divergence
 * when a caller has real operatingState (design §5.5 shadow field list).
 */
export function resolveParticipationLaneOpenDiscussion(params: {
  effective?: EffectiveCollaborationPolicy | null;
  operatingState?: OperatingStateLike;
  mode?: PolicyLaneMode;
  key?: CollaborationEventKey | null;
  cfg?: OpenBotConfig;
}): ParticipationLaneOpenDiscussionResolution {
  const mode = params.mode ?? resolveParticipationLaneMode(params.cfg);
  const legacyRaw = readRawParticipationBool(
    params.operatingState,
    "openDiscussionWithoutMention",
    L1_OPEN_DISCUSSION,
  );
  if (mode === "legacy") {
    return { mode, openDiscussionWithoutMention: legacyRaw, divergences: [] };
  }
  const effective = resolveEffectiveOrCompile(params);
  const effectiveValue = effective.participation.openDiscussionWithoutMention;
  const divergences: PolicyLaneDivergence[] = [];
  maybeRecordLaneDivergence({
    lane: PARTICIPATION_LANE,
    mode,
    field: "openDiscussionWithoutMention",
    legacyValue: legacyRaw,
    effectiveValue,
    key: params.key,
    out: divergences,
  });
  if (mode === "effective") {
    return { mode, openDiscussionWithoutMention: effectiveValue, divergences };
  }
  return { mode, openDiscussionWithoutMention: legacyRaw, divergences };
}
