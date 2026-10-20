import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
/**
 * P1-A5 ③ — governance capability lane (Floor Runtime v2.1 §5.5;
 * BP-15/16 coordinator single-source, B8 actor fail-closed shadow,
 * BP-17 overlay policyHash compare).
 *
 * Migrates chat.ts 4-source coordinator (BP-15) and tier1a
 * standing-coordinator resolution (BP-16) onto
 * authority.policy.effective.governance.coordinatorBotId via this
 * composition-root helper. Flag `collaboration.lane.governance` =
 * legacy | shadow | effective (default unset = legacy → zero live change).
 *
 * Behavior gates (default OFF; shadow divergence must be clean before on):
 *   - collaboration.governance.actorFailClosed
 *   - collaboration.edge.isolation (declared; wiring deferred — see final-gate report)
 *
 * BP-17: learning already uses compileGroupEffectivePolicy (P1-A2). This helper
 * records policyHash divergence when a dispatch-only coordinator overlay would
 * change the hash vs OS-only (same-group learning path).
 *
 * Allowlist bucket `governance` shrinks to [] because consumers no longer carry
 * the bypass AST sites (reads live only in this module).
 */
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { GatewayCollaborationGroupOperatingState } from "../collaboration-learning.js";
import type { CollaborationEventKey } from "./collaboration-event-key.js";
import type { EffectiveCollaborationPolicy } from "./effective-policy.js";
import {
  classifyGovernanceActor,
  type GovernanceActor,
  type GovernanceMemberRoleLike,
} from "./governance-gate.js";
import { normalizeAgentIdentifier } from "./mention-utils.js";
import { hashEffectiveCollaborationPolicy } from "./policy-compiler-hash.js";
import {
  maybeRecordLaneDivergence,
  resolvePolicyLaneMode,
  type PolicyLaneDivergence,
  type PolicyLaneMode,
} from "./policy-lane-divergence.js";
import {
  compileGroupEffectivePolicy,
  type GroupPolicyLegacyOverlay,
} from "./resolve-effective-policy.js";

export const GOVERNANCE_LANE = "governance" as const;

export type GovernanceLaneCoordinatorResolution = Readonly<{
  mode: PolicyLaneMode;
  /** Served standing coordinator bot id (empty string = none). */
  coordinatorBotId: string;
  divergences: readonly PolicyLaneDivergence[];
}>;

export type GovernanceLaneActorResolution = Readonly<{
  mode: PolicyLaneMode;
  actor: GovernanceActor;
  /** True when collaboration.governance.actorFailClosed is on. */
  actorFailClosed: boolean;
  divergences: readonly PolicyLaneDivergence[];
}>;

export type GovernanceLanePolicyHashResolution = Readonly<{
  mode: PolicyLaneMode;
  /** Hash served for the caller's path (legacy = with overlay when present). */
  policyHash: string;
  /** OS-only hash (learning path). */
  learningPolicyHash: string;
  divergences: readonly PolicyLaneDivergence[];
}>;

/**
 * Plan flag `collab.lane.governance` → config `collaboration.lane.governance` (default legacy).
 * Prefer passing `cfg` from the entry point (one loadConfig / runtime snapshot per
 * request). Omitting cfg falls back to loadConfig() per call — equal under the
 * production runtime snapshot / config cache; entry pass-through additionally
 * freezes flags if setRuntimeConfigSnapshot refreshes mid-request.
 */
export function resolveGovernanceLaneMode(cfg?: OpenBotConfig): PolicyLaneMode {
  return resolvePolicyLaneMode(GOVERNANCE_LANE, cfg);
}

/** Behavior gate `collaboration.governance.actorFailClosed` (default false). */
export function resolveActorFailClosed(cfg?: OpenBotConfig): boolean {
  return (cfg ?? loadConfig()).collaboration?.governance?.actorFailClosed === true;
}

/** Behavior gate `collaboration.edge.isolation` (default false). */
export function resolveEdgeIsolation(cfg?: OpenBotConfig): boolean {
  return (cfg ?? loadConfig()).collaboration?.edge?.isolation === true;
}

type CoordinatorSources = {
  /** runtimeOrganizationContext.coordinator?.agentId */
  runtimeOrganizationCoordinatorAgentId?: string | null;
  managedSpaceCoordinatorBotId?: string | null;
  operatingStateCoordinatorBotId?: string | null;
  groupProfileCoordinatorBotId?: string | null;
};

/**
 * BP-15 legacy: first non-empty, non-steward among
 * org → managedSpace → governance → groupProfile (chat.ts pre-lane order).
 */
export function legacyStandingCoordinatorBotId(sources: CoordinatorSources): string {
  const ordered = [
    sources.runtimeOrganizationCoordinatorAgentId,
    sources.managedSpaceCoordinatorBotId,
    sources.operatingStateCoordinatorBotId,
    sources.groupProfileCoordinatorBotId,
  ];
  for (const raw of ordered) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (id && !isBuiltinStewardAgent(id)) {
      return id;
    }
  }
  return "";
}

/**
 * BP-16 legacy: first non-steward candidate (tier1a pre-lane candidate list).
 */
export function legacyCoordinatorFromCandidates(
  candidates: readonly string[] | null | undefined,
): string {
  for (const candidate of candidates ?? []) {
    const normalized = normalizeAgentIdentifier(candidate);
    if (normalized && !isBuiltinStewardAgent(normalized)) {
      return normalized;
    }
  }
  return "";
}

export function effectiveCoordinatorBotId(effective: EffectiveCollaborationPolicy): string {
  const id = effective.governance.coordinatorBotId?.trim() ?? "";
  if (!id || isBuiltinStewardAgent(id)) {
    return "";
  }
  return normalizeAgentIdentifier(id) || id;
}

function resolveEffectiveOrCompile(params: {
  effective?: EffectiveCollaborationPolicy | null;
  operatingState?: GatewayCollaborationGroupOperatingState | null;
  legacyOverlay?: GroupPolicyLegacyOverlay | null;
}): EffectiveCollaborationPolicy {
  if (params.effective) {
    return params.effective;
  }
  return compileGroupEffectivePolicy({
    operatingState: params.operatingState ?? null,
    legacyOverlay: params.legacyOverlay ?? null,
  });
}

/**
 * BP-15 — standing coordinator for chat.ts scope build.
 * Reads multi-source fields ONLY here (composition root).
 * Legacy: 4-source first-match. Effective: effective.governance.coordinatorBotId.
 */
export function resolveGovernanceLaneCoordinatorBotId(params: {
  /** Whole runtimeOrganizationContext — .coordinator read only here. */
  runtimeOrganizationContext?: { coordinator?: { agentId?: string | null } | null } | null;
  /** Whole managedSpace — .coordinatorBotId read only here. */
  managedSpace?: { coordinatorBotId?: string | null } | null;
  operatingState?: GatewayCollaborationGroupOperatingState | null;
  /** Whole groupProfile — .coordinatorBotId read only here. */
  groupProfile?: { coordinatorBotId?: string | null } | null;
  /**
   * Optional pre-resolved candidate list (tier1a / tests). When set, legacy
   * uses legacyCoordinatorFromCandidates instead of 4-source.
   */
  legacyCandidates?: readonly string[] | null;
  /** Optional explicit legacy id (facts.coordinatorBotId after projection). */
  legacyCoordinatorBotId?: string | null;
  effective?: EffectiveCollaborationPolicy | null;
  mode?: PolicyLaneMode;
  key?: CollaborationEventKey | null;
  cfg?: OpenBotConfig;
}): GovernanceLaneCoordinatorResolution {
  const mode = params.mode ?? resolveGovernanceLaneMode(params.cfg);
  let legacy: string;
  const explicitLegacy = params.legacyCoordinatorBotId?.trim() ?? "";
  if (explicitLegacy && !isBuiltinStewardAgent(explicitLegacy)) {
    legacy = normalizeAgentIdentifier(explicitLegacy) || explicitLegacy;
  } else if (params.legacyCandidates !== undefined) {
    legacy = legacyCoordinatorFromCandidates(params.legacyCandidates);
  } else {
    legacy = legacyStandingCoordinatorBotId({
      runtimeOrganizationCoordinatorAgentId:
        params.runtimeOrganizationContext?.coordinator?.agentId,
      managedSpaceCoordinatorBotId: params.managedSpace?.coordinatorBotId,
      operatingStateCoordinatorBotId: params.operatingState?.governance?.coordinatorBotId,
      groupProfileCoordinatorBotId: params.groupProfile?.coordinatorBotId,
    });
  }
  if (mode === "legacy") {
    return { mode, coordinatorBotId: legacy, divergences: [] };
  }
  const effective = resolveEffectiveOrCompile({
    effective: params.effective,
    operatingState: params.operatingState,
    // Q3: effective path compiles WITHOUT the 4-source overlay — only OS governance.
    legacyOverlay: null,
  });
  const eff = effectiveCoordinatorBotId(effective);
  const divergences: PolicyLaneDivergence[] = [];
  maybeRecordLaneDivergence({
    lane: GOVERNANCE_LANE,
    mode,
    field: "coordinatorBotId",
    legacyValue: legacy || null,
    effectiveValue: eff || null,
    key: params.key,
    out: divergences,
  });
  if (mode === "effective") {
    return { mode, coordinatorBotId: eff, divergences };
  }
  return { mode, coordinatorBotId: legacy, divergences };
}

/**
 * B8 — actor classification.
 * Legacy / actorFailClosed=false: current classifyGovernanceActor (fail-open empty→human).
 * Fail-closed: empty or unmatched id → observer (denied by evaluateGovernanceGate).
 */
export function classifyGovernanceActorFailClosed(
  actorId: string | null | undefined,
  memberRoleMap?: readonly GovernanceMemberRoleLike[] | null,
): GovernanceActor {
  const id = actorId?.trim() ?? "";
  if (!id) {
    return { type: "human", id: "", governanceRole: "observer" };
  }
  const classified = classifyGovernanceActor(actorId, memberRoleMap);
  // Unmatched non-bot/non-agent identity with no memberRoleMap hit stays human
  // in legacy; fail-closed treats "no role entry + no bot:/agent: prefix" as
  // observer when memberRoleMap was provided and empty of matches.
  if (
    memberRoleMap &&
    memberRoleMap.length > 0 &&
    !classified.governanceRole &&
    classified.type === "human"
  ) {
    const compact = id.toLowerCase().replace(/\s+/g, "");
    const matched = memberRoleMap.some((member) => {
      const candidates = [member.memberId, member.label];
      return candidates.some((entry) => {
        const value = (entry ?? "").trim().toLowerCase().replace(/\s+/g, "");
        return (
          value === compact ||
          value === `human:${compact}` ||
          value === `bot:${compact}` ||
          value === `agent:${compact}` ||
          value.endsWith(`:${compact}`)
        );
      });
    });
    if (!matched) {
      return { type: "human", id, governanceRole: "observer" };
    }
  }
  return classified;
}

export function resolveGovernanceLaneActor(params: {
  actorId: string | null | undefined;
  memberRoleMap?: readonly GovernanceMemberRoleLike[] | null;
  mode?: PolicyLaneMode;
  key?: CollaborationEventKey | null;
  cfg?: OpenBotConfig;
}): GovernanceLaneActorResolution {
  const mode = params.mode ?? resolveGovernanceLaneMode(params.cfg);
  const actorFailClosed = resolveActorFailClosed(params.cfg);
  // Legacy (default): byte-equal to classifyGovernanceActor — no failClosed work, no sink.
  if (mode === "legacy") {
    return {
      mode,
      actor: classifyGovernanceActor(params.actorId, params.memberRoleMap),
      actorFailClosed,
      divergences: [],
    };
  }
  const legacy = classifyGovernanceActor(params.actorId, params.memberRoleMap);
  const failClosed = classifyGovernanceActorFailClosed(params.actorId, params.memberRoleMap);
  // Serve fail-closed only when BOTH the behavior gate is on AND lane is effective.
  const serveFailClosed = actorFailClosed && mode === "effective";
  const served = serveFailClosed ? failClosed : legacy;
  const divergences: PolicyLaneDivergence[] = [];
  maybeRecordLaneDivergence({
    lane: GOVERNANCE_LANE,
    mode,
    field: "actorClassification",
    legacyValue: legacy,
    effectiveValue: failClosed,
    key: params.key,
    out: divergences,
  });
  return { mode, actor: served, actorFailClosed, divergences };
}

/**
 * BP-17 — compare policyHash with dispatch coordinator overlay vs OS-only (learning).
 * Does not change compile entry points; records divergence for shadow/effective.
 * Legacy (default): pure no-op — no compile, no sink.
 */
export function resolveGovernanceLanePolicyHash(params: {
  operatingState?: GatewayCollaborationGroupOperatingState | null;
  /** Dispatch-only overlay (scope.coordinatorBotId etc.). */
  legacyOverlay?: GroupPolicyLegacyOverlay | null;
  /**
   * Optional already-computed hashes from the caller's normal compile path.
   * When provided in shadow/effective, avoids a redundant recompile of that side.
   */
  servedDispatchPolicyHash?: string | null;
  servedLearningPolicyHash?: string | null;
  mode?: PolicyLaneMode;
  key?: CollaborationEventKey | null;
  cfg?: OpenBotConfig;
}): GovernanceLanePolicyHashResolution {
  const mode = params.mode ?? resolveGovernanceLaneMode(params.cfg);
  // Legacy (default): pure no-op — no compile, no sink. Callers keep using their
  // existing compileGroupEffectivePolicy / snapshot policyHash unchanged.
  if (mode === "legacy") {
    return {
      mode,
      policyHash: params.servedDispatchPolicyHash ?? "",
      learningPolicyHash: params.servedLearningPolicyHash ?? "",
      divergences: [],
    };
  }
  const learningPolicyHash =
    params.servedLearningPolicyHash ??
    hashEffectiveCollaborationPolicy(
      compileGroupEffectivePolicy({
        operatingState: params.operatingState ?? null,
        legacyOverlay: null,
      }),
    );
  const dispatchPolicyHash =
    params.servedDispatchPolicyHash ??
    hashEffectiveCollaborationPolicy(
      compileGroupEffectivePolicy({
        operatingState: params.operatingState ?? null,
        legacyOverlay: params.legacyOverlay ?? null,
      }),
    );
  const divergences: PolicyLaneDivergence[] = [];
  maybeRecordLaneDivergence({
    lane: GOVERNANCE_LANE,
    mode,
    field: "policyHash",
    legacyValue: dispatchPolicyHash,
    effectiveValue: learningPolicyHash,
    key: params.key,
    out: divergences,
  });
  // effective: prefer OS-only (learning ≡ dispatch after Q3; no overlay).
  if (mode === "effective") {
    return {
      mode,
      policyHash: learningPolicyHash,
      learningPolicyHash,
      divergences,
    };
  }
  return {
    mode,
    policyHash: dispatchPolicyHash,
    learningPolicyHash,
    divergences,
  };
}

/**
 * Production hook for BP-17 shadow: call after the normal learning/dispatch compile.
 * - legacy (default): returns immediately — zero compiles, zero sink writes.
 * - shadow/effective: compares OS-only vs overlay hashes and records divergence.
 */
export function observeGovernanceLanePolicyHashDivergence(params: {
  operatingState?: GatewayCollaborationGroupOperatingState | null;
  legacyOverlay?: GroupPolicyLegacyOverlay | null;
  /** Hash the caller already computed for the dispatch/overlay path (optional). */
  servedDispatchPolicyHash?: string | null;
  /** Hash the caller already computed for the learning/OS-only path (optional). */
  servedLearningPolicyHash?: string | null;
  key?: CollaborationEventKey | null;
  cfg?: OpenBotConfig;
}): void {
  if (resolveGovernanceLaneMode(params.cfg) === "legacy") {
    return;
  }
  resolveGovernanceLanePolicyHash(params);
}
