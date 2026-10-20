/**
 * P1-A5 ④ — context capability lane (Floor Runtime v2.1 §5.5 / §2.5).
 *
 * Migrates BP-11 / BP-12 consumers off raw PolicyV1.contextPolicy and session
 * confidentialityTier reads onto authority.policy.effective.context (via this
 * composition-root helper). Flag `collaboration.lane.context` =
 * legacy | shadow | effective (default unset = **effective** after Owner cutover).
 * Explicit `legacy` or `shadow` remains the kill-switch / observe rollback.
 *
 * Shadow: compute both values, serve legacy live, write policy_lane_divergence
 * when they differ. Effective: serve effective.context-derived values.
 * Allowlist bucket `context` shrinks to [] because consumers no longer carry
 * the bypass AST sites (reads live only in this composition-root module).
 */
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  resolveSessionParticipationOverlay,
  type SessionParticipationOverlayField,
} from "../collaboration-learning/session-participation-overlay.js";
import { maxLevelFromGroupConfidentiality } from "../context-scope/confidentiality.js";
import type { ContextPolicyV1 } from "../context-scope/types.js";
import type { CollaborationEventKey } from "./collaboration-event-key.js";
import type { EffectiveCollaborationPolicy } from "./effective-policy.js";
import { contextPolicyFromEffective } from "./legacy-policy-view.js";
import {
  maybeRecordLaneDivergence,
  type PolicyLaneDivergence,
  type PolicyLaneMode,
} from "./policy-lane-divergence.js";
import type { CollaborationPolicyV1 } from "./policy.js";
import {
  compileGroupEffectivePolicy,
  resolveRunContextPolicy,
} from "./resolve-effective-policy.js";
import type { RoundPolicySnapshot } from "./round-policy-snapshot.js";

// P1-A5 ⑤: the switch + divergence sink moved to policy-lane-divergence.ts (shared by
// every lane). Re-exported here so ④ callers / tests keep their import path.
export {
  drainPolicyLaneDivergences,
  peekPolicyLaneDivergences,
  recordPolicyLaneDivergence,
  type PolicyLaneDivergence,
  type PolicyLaneId,
  type PolicyLaneMode,
} from "./policy-lane-divergence.js";

export const CONTEXT_LANE = "context" as const;

export type ContextLaneResolution = Readonly<{
  mode: PolicyLaneMode;
  /** Value served to resolveContextScopePlan.contextPolicy (named planPolicy to avoid BP-11 AST). */
  planPolicy: ContextPolicyV1;
  /**
   * Value served to resolveContextScopePlan.groupConfidentiality.
   * Undefined means "omit" (controller falls back to internal) — the legacy
   * round-runtime behaviour for BP-11.
   */
  groupConfidentiality: string | undefined;
  /** Divergences recorded for this resolution (also pushed to the module sink). */
  divergences: readonly PolicyLaneDivergence[];
}>;

/**
 * Production default for the context lane after Owner cutover (2026-10-14).
 * Other capability lanes still default to legacy via {@link resolvePolicyLaneMode}.
 */
export const CONTEXT_LANE_DEFAULT_MODE: PolicyLaneMode = "effective";

/**
 * Plan flag `collab.lane.context` → config `collaboration.lane.context`.
 * Unset / invalid → {@link CONTEXT_LANE_DEFAULT_MODE} (`effective`).
 * Explicit `legacy` | `shadow` | `effective` are honored (kill-switch / observe).
 */
export function resolveContextLaneMode(cfg?: OpenBotConfig): PolicyLaneMode {
  const source = cfg ?? loadConfig();
  const raw = source.collaboration?.lane?.context;
  if (raw === "shadow" || raw === "effective" || raw === "legacy") {
    return raw;
  }
  return CONTEXT_LANE_DEFAULT_MODE;
}

/**
 * Map session participation tiers onto compiler-accepted confidentialityTier.
 * `secret` collapses to `restricted` so effective.context.confidentialityCeiling
 * matches maxLevelFromGroupConfidentiality(sessionTier) for the live plan.
 */
export function normalizeConfidentialityTierForCompiler(
  tier: string | null | undefined,
): "public" | "internal" | "restricted" | undefined {
  const trimmed = typeof tier === "string" ? tier.trim() : "";
  if (!trimmed) {
    return undefined;
  }
  if (trimmed === "public" || trimmed === "internal" || trimmed === "restricted") {
    return trimmed;
  }
  if (trimmed === "secret") {
    return "restricted";
  }
  return undefined;
}

function maybeDiverge(params: {
  mode: PolicyLaneMode;
  field: string;
  legacyValue: unknown;
  effectiveValue: unknown;
  key?: CollaborationEventKey | null;
  out: PolicyLaneDivergence[];
}): void {
  maybeRecordLaneDivergence({ lane: CONTEXT_LANE, ...params });
}

/**
 * BP-11 — round-runtime contextScopePlan inputs.
 * Legacy: PolicyV1.contextPolicy, no groupConfidentiality (internal fallback).
 * Effective: contextPolicy + confidentialityCeiling from authority.policy.effective.context.
 */
export function resolveContextLaneForRound(params: {
  effective: EffectiveCollaborationPolicy | RoundPolicySnapshot["effective"];
  /**
   * Frozen CollaborationPolicyV1 (legacy BP-11 source). `.contextPolicy` is read
   * here in the composition root so round-runtime.ts stays free of the bypass AST.
   */
  legacyPolicy: Pick<CollaborationPolicyV1, "contextPolicy">;
  forDirectSession?: boolean;
  mode?: PolicyLaneMode;
  key?: CollaborationEventKey | null;
  cfg?: OpenBotConfig;
}): ContextLaneResolution {
  const mode = params.mode ?? resolveContextLaneMode(params.cfg);
  const legacyContextPolicy = params.legacyPolicy.contextPolicy;
  const effectivePolicy = contextPolicyFromEffective(
    params.effective.context,
    params.forDirectSession === true,
  );
  const effectiveConfidentiality = params.effective.context.confidentialityCeiling;
  const divergences: PolicyLaneDivergence[] = [];

  maybeDiverge({
    mode,
    field: "contextPolicy",
    legacyValue: legacyContextPolicy,
    effectiveValue: effectivePolicy,
    key: params.key,
    out: divergences,
  });
  maybeDiverge({
    mode,
    field: "groupConfidentiality",
    // Legacy round path omitted the arg → controller treats as internal.
    legacyValue: maxLevelFromGroupConfidentiality(undefined),
    effectiveValue: effectiveConfidentiality,
    key: params.key,
    out: divergences,
  });

  if (mode === "effective") {
    return {
      mode,
      planPolicy: effectivePolicy,
      groupConfidentiality: effectiveConfidentiality,
      divergences,
    };
  }
  // legacy + shadow: serve legacy live (omit groupConfidentiality).
  return {
    mode,
    planPolicy: legacyContextPolicy,
    groupConfidentiality: undefined,
    divergences,
  };
}

/**
 * Read session confidentiality tiers inside the composition root (BP-12 sources).
 * Scanned consumer files must not touch these property paths.
 */
export function readSessionConfidentialityTier(
  sessionEntry:
    | {
        collaborationParticipationOverlay?: SessionParticipationOverlayField | null;
        collaborationGroupProfile?: { confidentialityTier?: string | null } | null;
      }
    | null
    | undefined,
  botId?: string | null,
): string | undefined {
  const overlay = resolveSessionParticipationOverlay({
    field: sessionEntry?.collaborationParticipationOverlay ?? undefined,
    botId,
  });
  const raw =
    overlay?.confidentialityTier ?? sessionEntry?.collaborationGroupProfile?.confidentialityTier;
  if (typeof raw === "string" && raw.trim()) {
    return raw;
  }
  return undefined;
}

/**
 * BP-12 — get-reply-run Context Scope inputs.
 * Legacy: session overlay/profile confidentialityTier + resolveRunContextPolicy.
 * Effective: compile with session tier fed into composition root so
 * effective.context.confidentialityCeiling stays value-equivalent, then read it.
 */
export function resolveContextLaneForReplyRun(params: {
  forDirectSession: boolean;
  /** Raw session overlay/profile tier (legacy BP-12 source). */
  sessionConfidentialityTier?: string | null;
  /**
   * Optional already-compiled effective (group path). When absent, compile a
   * minimal effective from the session tier alone (direct-session / no OS).
   */
  effective?: EffectiveCollaborationPolicy | null;
  mode?: PolicyLaneMode;
  key?: CollaborationEventKey | null;
  cfg?: OpenBotConfig;
}): ContextLaneResolution {
  const mode = params.mode ?? resolveContextLaneMode(params.cfg);
  const legacyContextPolicy = resolveRunContextPolicy({
    forDirectSession: params.forDirectSession,
  });
  const legacyConfidentiality = params.sessionConfidentialityTier;

  const effective =
    params.effective ??
    compileGroupEffectivePolicy({
      legacyOverlay: {
        confidentialityTier: normalizeConfidentialityTierForCompiler(
          params.sessionConfidentialityTier,
        ),
      },
    });
  const effectivePolicy = contextPolicyFromEffective(effective.context, params.forDirectSession);
  const effectiveConfidentiality = effective.context.confidentialityCeiling;

  const divergences: PolicyLaneDivergence[] = [];
  maybeDiverge({
    mode,
    field: "contextPolicy",
    legacyValue: legacyContextPolicy,
    effectiveValue: effectivePolicy,
    key: params.key,
    out: divergences,
  });
  maybeDiverge({
    mode,
    field: "confidentiality.maxLevel",
    legacyValue: maxLevelFromGroupConfidentiality(legacyConfidentiality),
    effectiveValue: maxLevelFromGroupConfidentiality(effectiveConfidentiality),
    key: params.key,
    out: divergences,
  });

  if (mode === "effective") {
    return {
      mode,
      planPolicy: effectivePolicy,
      groupConfidentiality: effectiveConfidentiality,
      divergences,
    };
  }
  return {
    mode,
    planPolicy: legacyContextPolicy,
    groupConfidentiality:
      typeof legacyConfidentiality === "string" && legacyConfidentiality.trim()
        ? legacyConfidentiality
        : undefined,
    divergences,
  };
}

/**
 * Context Scope single-track cutover guide (P2 helpers; Owner cutover → effective).
 *
 * Consumers must obtain ContextPolicy via {@link resolveContextLaneForRound} /
 * {@link resolveContextLaneForReplyRun} (composition root). Raw
 * `PolicyV1.contextPolicy` reads in runtime consumers remain blocked by
 * `scripts/check-collab-policy-consumption.mjs` (context bucket = []).
 *
 * Default `collaboration.lane.context` is unset → **effective**. Kill-switch:
 * set `legacy` (or `shadow` to re-observe) explicitly.
 */
export function describeContextLaneSingleTrackCutover(): {
  flag: "collaboration.lane.context";
  defaultMode: "effective";
  shadowRecordsDivergence: true;
  effectiveServesAuthority: true;
  killSwitch: "legacy";
  groupChatDefaults: {
    inboundChatOrUnset: "minimal";
    mandatorySources: readonly ["conversation", "group"];
    knowledgeRequires: readonly ["retrieve", "act", "ui_scope"];
  };
  cutoverSteps: readonly string[];
} {
  return {
    flag: "collaboration.lane.context",
    defaultMode: "effective",
    shadowRecordsDivergence: true,
    effectiveServesAuthority: true,
    killSwitch: "legacy",
    groupChatDefaults: {
      inboundChatOrUnset: "minimal",
      mandatorySources: ["conversation", "group"],
      knowledgeRequires: ["retrieve", "act", "ui_scope"],
    },
    cutoverSteps: [
      "Production default is unset → effective (serves authority.policy.effective.context).",
      "Kill-switch / rollback: set collaboration.lane.context=legacy (or shadow to re-observe).",
      "isContextLaneShadowWindowClean remains available for observe windows under shadow.",
      "Group chat stays conversation+group mandatory; knowledge still needs retrieve/act or UI scope.",
      "Do not enable Floor live as part of this cutover.",
    ],
  };
}

/**
 * True when no context-lane divergences are present in the provided list
 * (typically drained from peekPolicyLaneDivergences after a shadow window).
 * Does not flip the flag — production default is already effective; use shadow
 * observe + this helper when rolling back to shadow for a re-validation window.
 */
export function isContextLaneShadowWindowClean(
  divergences: readonly PolicyLaneDivergence[],
): boolean {
  return !divergences.some((entry) => entry.lane === CONTEXT_LANE);
}
